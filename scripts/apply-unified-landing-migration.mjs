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

const migrationVersion = "20260610017000";
const migrationName = "unified_landing_admin_controls";
const migrationPath =
  "supabase/migrations/20260610017000_unified_landing_admin_controls.sql";
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
    JSON.stringify({
      status: "already_applied",
      migration: history[0],
    }),
  );
  process.exit(0);
}

if (!apply) {
  await query(`
    begin;
    ${migrationSql}
    select public.unified_landing_health_report();
    rollback;
  `);
  console.log(
    JSON.stringify({
      status: "dry_run_passed",
      migration: `${migrationVersion}_${migrationName}`,
      applied: false,
    }),
  );
  process.exit(0);
}

await query(`
  begin;
  ${migrationSql}
  insert into supabase_migrations.schema_migrations (
    version,
    name,
    statements
  )
  values (
    '${migrationVersion}',
    '${migrationName}',
    array['Applied through the audited First Listen migration runner.']
  );
  commit;
`);

const verification = await query(`
  select
    version,
    name,
    public.unified_landing_health_report() as health
  from supabase_migrations.schema_migrations
  where version = '${migrationVersion}';
`);

console.log(
  JSON.stringify({
    status: "applied",
    migration: verification[0],
  }),
);

