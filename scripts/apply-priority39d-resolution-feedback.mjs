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

const migrationVersion = "20260612000000";
const migrationName = "priority_39d_resolution_feedback_center";
const migrationPath =
  "supabase/migrations/20260612000000_priority_39d_resolution_feedback_center.sql";
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

const healthSql = `
  select jsonb_build_object(
    'feedback_table',
      to_regclass('public.feedback_submissions') is not null,
    'feedback_submit_rpc',
      to_regprocedure('public.submit_feedback(text,text,text,text,text,text,boolean,text)') is not null,
    'feedback_inbox_rpc',
      to_regprocedure('public.admin_list_feedback(text,integer)') is not null,
    'verified_link_rpc',
      to_regprocedure('public.upsert_verified_song_platform_link(uuid,public.music_platform,text,text)') is not null,
    'remove_verified_link_rpc',
      to_regprocedure('public.remove_verified_song_platform_link(uuid,public.music_platform)') is not null,
    'platform_links_verified_columns',
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'song_platform_links'
          and column_name = 'verified_at'
      ),
    'engine_mode',
      public.platform_resolution_engine_mode(),
    'recommendation_mode',
      public.platform_recommendation_engine_mode(),
    'config_has_creator_verified_links',
      coalesce(
        (
          public.ensure_priority39d_platform_config(
            (select published_config from public.platform_control_state where id = true)
          ) #>> '{discovery,platformResolution,allowCreatorVerifiedLinks}'
        )::boolean,
        false
      )
  ) as health;
`;

const history = await query(`
  select version, name
  from supabase_migrations.schema_migrations
  where version = '${migrationVersion}';
`);

if (history.length) {
  const verification = await query(healthSql);
  console.log(
    JSON.stringify({
      status: "already_applied",
      migration: history[0],
      health: verification.at(-1)?.health ?? null,
    }),
  );
  process.exit(0);
}

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
    array[
      'Add verified platform-link controls and Feedback Center inbox.'
    ]
  );
  commit;
`);

const verification = await query(`
  select version, name
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
