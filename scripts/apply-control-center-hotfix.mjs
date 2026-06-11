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

const version = "20260611001000";
const name = "control_center_preview_and_feed_fix";
const sql = await readFile(
  "supabase/migrations/20260611001000_control_center_preview_and_feed_fix.sql",
  "utf8",
);
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

if (!apply) {
  const result = await query(`
    begin;
    ${sql}
    select public.super_admin_control_center_health_report() as health;
    rollback;
  `);
  console.log(
    JSON.stringify({
      status: "dry_run_passed",
      migration: `${version}_${name}`,
      health: result.at(-1)?.health ?? null,
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
    array['Applied through the audited First Listen control-center hotfix runner.']
  );
  commit;
`);

const result = await query(`
  select version, name, public.super_admin_control_center_health_report() as health
  from supabase_migrations.schema_migrations
  where version = '${version}';
`);
console.log(JSON.stringify({ status: "applied", migration: result[0] }));
