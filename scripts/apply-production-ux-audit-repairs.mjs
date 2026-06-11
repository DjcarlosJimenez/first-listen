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

const version = "20260611003000";
const name = "production_ux_audit_repairs";
const migrationPath =
  "supabase/migrations/20260611003000_production_ux_audit_repairs.sql";
const sql = await readFile(migrationPath, "utf8");
const apply = process.argv.includes("--apply");
const endpoint =
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

async function query(statement) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ query: statement }),
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
  where version = '${version}';
`);

if (history.length) {
  console.log(JSON.stringify({ status: "already_applied", migration: history[0] }));
  process.exit(0);
}

const verificationQuery = `
  select
    count(*) filter (where last_contribution_at is null) as null_activity_profiles,
    count(*) as total_profiles
  from public.profiles;
`;

if (!apply) {
  const result = await query(`
    begin;
    ${sql}
    ${verificationQuery}
    rollback;
  `);
  console.log(
    JSON.stringify({
      status: "dry_run_passed",
      migration: `${version}_${name}`,
      verification: result.at(-1) ?? null,
      applied: false,
    }),
  );
  process.exit(0);
}

await query(`
  begin;
  ${sql}
  insert into supabase_migrations.schema_migrations (version, name, statements)
  values (
    '${version}',
    '${name}',
    array['Applied through the audited First Listen production UX audit runner.']
  );
  commit;
`);

const result = await query(`
  select
    version,
    name,
    (
      select json_build_object(
        'null_activity_profiles',
        count(*) filter (where last_contribution_at is null),
        'total_profiles',
        count(*)
      )
      from public.profiles
    ) as verification
  from supabase_migrations.schema_migrations
  where version = '${version}';
`);
console.log(JSON.stringify({ status: "applied", migration: result[0] }));
