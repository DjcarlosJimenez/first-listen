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

const migrationVersion = "20260611006000";
const migrationName = "owner_control_center_expansion";
const migrationPath =
  "supabase/migrations/20260611006000_owner_control_center_expansion.sql";
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

const healthSql = `
  select public.validate_platform_control_config(
    public.default_platform_control_config()
    || jsonb_build_object(
      'homepage',
      (public.default_platform_control_config()->'homepage')
      || jsonb_build_object(
        'order',
        jsonb_build_array(
          'review_queue', 'spotlight', 'top_results', 'organic_rankings',
          'community_activity', 'artist_spotlight', 'external_discovery',
          'trending', 'most_shared', 'most_supported', 'newest_songs',
          'away_summary'
        )
      )
    )
  );
  select jsonb_build_object(
    'validate_function',
      to_regprocedure('public.validate_platform_control_config(jsonb)') is not null,
    'external_discovery_allowed', true
  ) as health;
`;

if (!apply) {
  const result = await query(`
    begin;
    ${migrationSql}
    ${healthSql}
    rollback;
  `);
  console.log(
    JSON.stringify({
      status: "dry_run_passed",
      migration: `${migrationVersion}_${migrationName}`,
      health: result.at(-1)?.health ?? null,
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
    array['Allow External Discovery in Owner Control Center homepage layout.']
  );
  commit;
`);

const verification = await query(`
  select
    version,
    name
  from supabase_migrations.schema_migrations
  where version = '${migrationVersion}';
  ${healthSql}
`);

console.log(
  JSON.stringify({
    status: "applied",
    migration: verification[0],
    health: verification.at(-1)?.health ?? null,
  }),
);
