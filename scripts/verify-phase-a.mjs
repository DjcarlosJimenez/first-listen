import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

async function loadLocalEnvironment() {
  try {
    const contents = await readFile(".env.local", "utf8");
    for (const line of contents.split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // CI and production environments provide variables directly.
  }
}

await loadLocalEnvironment();

const projectRef = process.env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!projectRef || !accessToken) {
  throw new Error("SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required.");
}

const authConfigResponse = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
if (!authConfigResponse.ok) {
  throw new Error(`Auth config lookup failed: ${authConfigResponse.status}`);
}
const authConfig = await authConfigResponse.json();

const keyResponse = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
if (!keyResponse.ok) {
  throw new Error(`API key lookup failed: ${keyResponse.status}`);
}
const keys = await keyResponse.json();
const keyList = Array.isArray(keys) ? keys : keys.api_keys ?? [];
const anonKey = keyList.find((key) => key.name === "anon")?.api_key;
const serviceRoleKey = keyList.find(
  (key) =>
    key.name === "service_role" ||
    key.name === "secret" ||
    key.type === "secret",
)?.api_key;
if (!anonKey || !serviceRoleKey) throw new Error("Supabase API keys are unavailable.");

const url = `https://${projectRef}.supabase.co`;
const options = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
};
const service = createClient(url, serviceRoleKey, options);
const testClient = createClient(url, anonKey, options);
const anon = createClient(url, anonKey, options);
const checks = [];
let testUserId = null;
let baselineFounderCount = null;

function check(name, passed, details = null) {
  checks.push({ name, passed, details });
  if (!passed) throw new Error(`${name}: ${details ?? "failed"}`);
}

async function waitForProfile(id) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const { data, error } = await service
      .from("profiles")
      .select("id, role, founder_number")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Disposable profile was not created.");
}

try {
  const { data: founderProgram, error: founderProgramError } = await service
    .from("founder_program")
    .select("claimed_count")
    .single();
  if (founderProgramError) throw founderProgramError;
  baselineFounderCount = founderProgram.claimed_count;

  const { data: usersData, error: usersError } =
    await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw usersError;
  const productionUsers = usersData.users.filter(
    (user) => !user.user_metadata?.phase_a_test,
  );
  const { data: profiles, error: profilesError } = await service
    .from("profiles")
    .select(
      "id, display_name, role, founder_number, account_status, force_password_change, created_at",
    )
    .in("id", productionUsers.map((user) => user.id));
  if (profilesError) throw profilesError;
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const users = productionUsers.map((user) => ({
    id: user.id,
    email: user.email,
    email_confirmed_at: user.email_confirmed_at ?? null,
    confirmation_sent_at: user.confirmation_sent_at ?? null,
    last_sign_in_at: user.last_sign_in_at ?? null,
    ...profileMap.get(user.id),
  }));

  const founderOne = users.find(
    (user) => user.email?.toLowerCase() === "djemas81@gmail.com",
  );
  const founderTwo = users.find(
    (user) => user.email?.toLowerCase() === "carlos_jimenez_ruiz@hotmail.com",
  );
  check(
    "Founder #1 is confirmed Super Admin",
    founderOne?.role === "super_admin" &&
      founderOne?.founder_number === 1 &&
      Boolean(founderOne?.email_confirmed_at),
    founderOne,
  );
  check(
    "Founder #2 role and Founder assignment remain unchanged",
    founderTwo?.role === "user" &&
      founderTwo?.founder_number === 2 &&
      founderTwo?.account_status === "active",
    founderTwo,
  );
  check(
    "Founder #2 confirmation state is recorded",
    Boolean(founderTwo),
    {
      email_confirmed_at: founderTwo?.email_confirmed_at ?? null,
      last_sign_in_at: founderTwo?.last_sign_in_at ?? null,
    },
  );

  const { data: auditRows, error: auditError } = await service
    .from("admin_audit_log")
    .select("id, actor_id, action, target_type, target_id, details, created_at")
    .eq("action", "bootstrap_super_admin")
    .eq("target_id", founderOne.id);
  if (auditError) throw auditError;
  check(
    "Founder #1 promotion has one audit record",
    auditRows.length === 1 &&
      auditRows[0].details?.previous_role === "user" &&
      auditRows[0].details?.new_role === "super_admin",
    auditRows,
  );

  const anonymousAudit = await anon.from("admin_audit_log").select("id").limit(1);
  check(
    "Anonymous users cannot read the audit log",
    Boolean(anonymousAudit.error),
    anonymousAudit.error?.message,
  );

  check(
    "Production password policy is active",
    authConfig.password_min_length === 8 &&
      authConfig.password_required_characters ===
        "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
    {
      password_min_length: authConfig.password_min_length,
      password_required_characters: authConfig.password_required_characters,
    },
  );
  check(
    "Email confirmation remains required",
    authConfig.mailer_autoconfirm === false &&
      authConfig.mailer_allow_unverified_email_sign_ins === false,
    {
      mailer_autoconfirm: authConfig.mailer_autoconfirm,
      mailer_allow_unverified_email_sign_ins:
        authConfig.mailer_allow_unverified_email_sign_ins,
    },
  );

  const weakSignup = await anon.auth.signUp({
    email: `phase-a-weak-${Date.now()}@example.com`,
    password: "lowercase1",
  });
  check(
    "Weak passwords are rejected by Supabase Auth",
    Boolean(weakSignup.error),
    weakSignup.error?.message,
  );

  const recoveryProbe = await anon.auth.resetPasswordForEmail(
    `phase-a-missing-${Date.now()}@example.com`,
    {
      redirectTo: "http://localhost:3000/auth/callback?next=/reset-password",
    },
  );
  check(
    "Forgot-password request uses a generic non-enumerating response",
    !recoveryProbe.error,
    recoveryProbe.error?.message,
  );

  const testSuffix = randomBytes(8).toString("hex");
  const testEmail = `phase-a-${testSuffix}@example.com`;
  const testPassword = `PhaseA${testSuffix}Aa1`;
  const { data: created, error: createError } =
    await service.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: {
        full_name: "Phase A Access Test",
        legal_accepted: true,
        explicit_content_acknowledged: true,
        system_bootstrap: true,
        phase_a_test: true,
      },
    });
  if (createError || !created.user) {
    throw createError ?? new Error("Disposable user creation failed.");
  }
  testUserId = created.user.id;
  const testProfile = await waitForProfile(testUserId);
  check(
    "Disposable access test does not consume Founder spots",
    testProfile.founder_number === null,
    testProfile,
  );

  const { error: loginError } = await testClient.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  if (loginError) throw loginError;

  const userStats = await testClient.rpc("admin_get_statistics");
  check(
    "User role cannot access admin statistics",
    Boolean(userStats.error),
    userStats.error?.message,
  );

  const { error: adminRoleError } = await service
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", testUserId);
  if (adminRoleError) throw adminRoleError;
  const adminStats = await testClient.rpc("admin_get_statistics");
  check(
    "Admin role can access admin statistics",
    !adminStats.error && Boolean(adminStats.data),
    adminStats.error?.message,
  );

  const { error: moderatorRoleError } = await service
    .from("profiles")
    .update({ role: "moderator" })
    .eq("id", testUserId);
  if (moderatorRoleError) throw moderatorRoleError;
  const moderatorStats = await testClient.rpc("admin_get_statistics");
  check(
    "Moderator role cannot access full admin statistics",
    Boolean(moderatorStats.error),
    moderatorStats.error?.message,
  );
  const moderatorReport = await testClient.rpc("admin_resolve_report", {
    target_report_id: "00000000-0000-0000-0000-000000000000",
    new_status: "resolved",
  });
  check(
    "Moderator retains report moderation permission",
    moderatorReport.error?.message === "Report not found",
    moderatorReport.error?.message,
  );

  const { error: userRoleError } = await service
    .from("profiles")
    .update({ role: "user" })
    .eq("id", testUserId);
  if (userRoleError) throw userRoleError;
  const userReport = await testClient.rpc("admin_resolve_report", {
    target_report_id: "00000000-0000-0000-0000-000000000000",
    new_status: "resolved",
  });
  check(
    "User role cannot moderate reports",
    userReport.error?.message === "Forbidden",
    userReport.error?.message,
  );

  const pageChecks = [
    ["/login", 200],
    ["/signup", 200],
    ["/verify-email", 200],
    ["/forgot-password", 200],
    ["/admin", 307],
    ["/reset-password", 307],
  ];
  for (const [path, expectedStatus] of pageChecks) {
    const response = await fetch(`http://localhost:3000${path}`, {
      redirect: "manual",
    });
    check(
      `${path} returns expected unauthenticated response`,
      response.status === expectedStatus,
      { expected: expectedStatus, actual: response.status },
    );
  }

  const openRedirectProbe = await fetch(
    "http://localhost:3000/auth/callback?next=https://malicious.example",
    { redirect: "manual" },
  );
  check(
    "Auth callback rejects external redirect targets",
    openRedirectProbe.headers.get("location") ===
      "http://localhost:3000/dashboard",
    openRedirectProbe.headers.get("location"),
  );

  const secondPromotion = await service.rpc(
    "promote_founder_one_to_super_admin",
    {
      target_user_id: founderOne.id,
      expected_email: founderOne.email,
    },
  );
  check(
    "Founder #1 bootstrap promotion cannot run twice",
    Boolean(secondPromotion.error),
    secondPromotion.error?.message,
  );

  console.log(
    JSON.stringify(
      {
        status: "passed",
        checked_at: new Date().toISOString(),
        users,
        auth_config: {
          site_url: authConfig.site_url,
          uri_allow_list: authConfig.uri_allow_list,
          smtp_configured: Boolean(authConfig.smtp_host),
          rate_limit_email_sent: authConfig.rate_limit_email_sent,
          password_min_length: authConfig.password_min_length,
          password_required_characters:
            authConfig.password_required_characters,
        },
        checks,
      },
      null,
      2,
    ),
  );
} finally {
  await testClient.auth.signOut();
  if (testUserId) {
    const { error } = await service.auth.admin.deleteUser(testUserId);
    if (error) console.error(`Disposable user cleanup failed: ${error.message}`);
  }
  if (baselineFounderCount !== null) {
    const { data: founderProgram, error } = await service
      .from("founder_program")
      .select("claimed_count")
      .single();
    if (error) throw error;
    if (founderProgram.claimed_count !== baselineFounderCount) {
      throw new Error("Founder count changed during Phase A testing.");
    }
  }
}
