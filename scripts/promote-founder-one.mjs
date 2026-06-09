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
const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  (projectRef ? `https://${projectRef}.supabase.co` : null);
let serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const targetEmail = process.env.FOUNDER_ONE_SUPER_ADMIN_EMAIL;

if (!url || !targetEmail) {
  throw new Error(
    "Supabase project details and FOUNDER_ONE_SUPER_ADMIN_EMAIL are required.",
  );
}

if (!serviceRoleKey) {
  if (!projectRef || !accessToken) {
    throw new Error(
      "Provide SUPABASE_SERVICE_ROLE_KEY or SUPABASE_PROJECT_REF with SUPABASE_ACCESS_TOKEN.",
    );
  }
  const keyResponse = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!keyResponse.ok) {
    throw new Error(`Supabase key lookup failed with ${keyResponse.status}.`);
  }
  const keys = await keyResponse.json();
  const serviceKey = (Array.isArray(keys) ? keys : keys.api_keys ?? []).find(
    (key) =>
      key.name === "service_role" ||
      key.name === "secret" ||
      key.type === "secret",
  );
  serviceRoleKey = serviceKey?.api_key;
}
if (!serviceRoleKey) throw new Error("A server-side Supabase key is required.");

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: usersData, error: usersError } =
  await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (usersError) throw usersError;

const matches = usersData.users.filter(
  (user) => user.email?.toLowerCase() === targetEmail.toLowerCase(),
);
if (matches.length !== 1) {
  throw new Error(`Expected one exact Auth match, found ${matches.length}.`);
}

const targetUser = matches[0];
if (!targetUser.email_confirmed_at) {
  throw new Error("Founder #1 email is not confirmed.");
}

const { data, error } = await supabase.rpc(
  "promote_founder_one_to_super_admin",
  {
    target_user_id: targetUser.id,
    expected_email: targetEmail,
  },
);
if (error) throw error;

console.log(JSON.stringify(data, null, 2));
