import { readFile } from "node:fs/promises";

async function loadLocalEnvironment() {
  const contents = await readFile(".env.local", "utf8");
  for (const line of contents.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

await loadLocalEnvironment();

const projectRef = process.env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!projectRef || !accessToken) {
  throw new Error("SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required.");
}

const migrationVersion = "20260611005000";
const migrationName = "owner_control_center_email_fix";
const migrationPath =
  "supabase/migrations/20260611005000_owner_control_center_email_fix.sql";
const migrationSql = await readFile(migrationPath, "utf8");
const apply = process.argv.includes("--apply");
const endpoint =
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

async function query(sql) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) {
    throw new Error(
      `Supabase database query failed (${response.status}): ${await response.text()}`,
    );
  }
  return response.json();
}

const history = await query(`
  select version, name
  from supabase_migrations.schema_migrations
  where version = '${migrationVersion}';
`);

if (history.length) {
  console.log(
    JSON.stringify({ status: "already_applied", migration: history[0] }),
  );
  process.exit(0);
}

const verificationSql = `
  do $$
  declare
    founder_id uuid;
    payload jsonb;
  begin
    select id
    into founder_id
    from public.profiles
    where role::text = 'super_admin'
      and founder_number = 1
      and account_status = 'active'
      and banned_at is null
    limit 1;

    if founder_id is null then
      raise exception 'Founder #1 super_admin profile was not found.';
    end if;

    perform set_config('request.jwt.claim.sub', founder_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    payload := public.admin_get_control_center();

    if payload ? 'state' is false
      or payload ? 'snapshots' is false
      or payload ? 'preview_access' is false
      or payload ? 'health' is false
    then
      raise exception 'Owner Control Center payload is incomplete.';
    end if;
  end;
  $$;
  select jsonb_build_object(
    'profiles_has_email', exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'email'
    ),
    'auth_users_has_email', exists (
      select 1
      from information_schema.columns
      where table_schema = 'auth'
        and table_name = 'users'
        and column_name = 'email'
    ),
    'profile_email_reference_removed',
      position(
        'profile.email'
        in pg_get_functiondef('public.admin_get_control_center()'::regprocedure)
      ) = 0,
    'auth_email_reference_present',
      position(
        'auth_user.email'
        in pg_get_functiondef('public.admin_get_control_center()'::regprocedure)
      ) > 0,
    'founder_rpc_loads', true
  ) as verification;
`;

if (!apply) {
  const result = await query(`
    begin;
    ${migrationSql}
    ${verificationSql}
    rollback;
  `);
  console.log(
    JSON.stringify({
      status: "dry_run_passed",
      migration: `${migrationVersion}_${migrationName}`,
      verification: result.at(-1)?.verification ?? null,
      applied: false,
    }),
  );
  process.exit(0);
}

await query(`
  begin;
  ${migrationSql}
  ${verificationSql}
  insert into supabase_migrations.schema_migrations (
    version,
    name,
    statements
  )
  values (
    '${migrationVersion}',
    '${migrationName}',
    array['Applied through the audited First Listen owner-control email repair runner.']
  );
  commit;
`);

const verification = await query(`
  ${verificationSql}
`);

console.log(
  JSON.stringify({
    status: "applied",
    migration: { version: migrationVersion, name: migrationName },
    verification: verification.at(-1)?.verification ?? null,
  }),
);
