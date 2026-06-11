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

const version = "20260611002000";
const name = "fix_control_center_emergency_trigger_claimed_at";
const sql = await readFile(
  "supabase/migrations/20260611002000_fix_control_center_emergency_trigger_claimed_at.sql",
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
    select public.priority25_claimed_at_repair_report() as repair;
    rollback;
  `);
  console.log(
    JSON.stringify({
      status: "dry_run_passed",
      migration: `${version}_${name}`,
      repair: result.at(-1)?.repair ?? null,
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
    array['Applied through the audited First Listen claimed_at repair runner.']
  );
  commit;
`);

const result = await query(`
  select version, name, public.priority25_claimed_at_repair_report() as repair
  from supabase_migrations.schema_migrations
  where version = '${version}';
`);
console.log(JSON.stringify({ status: "applied", migration: result[0] }));
