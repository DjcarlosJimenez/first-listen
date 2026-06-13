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

const migrationVersion = "20260613002000";
const migrationName = "moderator_permission_hardening";
const migrationPath =
  "supabase/migrations/20260613002000_moderator_permission_hardening.sql";
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
    'admin_list_users',
      to_regprocedure('public.admin_list_users(integer)') is not null,
    'admin_issue_user_warning',
      to_regprocedure('public.admin_issue_user_warning(uuid,text)') is not null,
    'admin_enforce_account',
      to_regprocedure('public.admin_enforce_account(uuid,text,text)') is not null,
    'admin_set_song_state',
      to_regprocedure('public.admin_set_song_state(uuid,boolean,boolean)') is not null,
    'admin_list_feedback',
      to_regprocedure('public.admin_list_feedback(text,integer)') is not null,
    'admin_update_feedback',
      to_regprocedure('public.admin_update_feedback(uuid,text,text)') is not null,
    'moderator_hide_reported_song',
      to_regprocedure('public.moderator_hide_reported_song(uuid,text)') is not null,
    'admin_moderate_review_comment',
      to_regprocedure('public.admin_moderate_review_comment(uuid,text,text)') is not null,
    'user_directory_admin_only',
      pg_get_functiondef(to_regprocedure('public.admin_list_users(integer)')::oid)
        like '%current_user_role() not in (''super_admin'', ''admin'')%',
    'account_enforcement_admin_only',
      pg_get_functiondef(to_regprocedure('public.admin_enforce_account(uuid,text,text)')::oid)
        like '%actor_role not in (''super_admin'', ''admin'')%',
    'song_state_admin_only',
      pg_get_functiondef(to_regprocedure('public.admin_set_song_state(uuid,boolean,boolean)')::oid)
        like '%current_user_role() not in (''super_admin'', ''admin'')%',
    'feedback_admin_only',
      pg_get_functiondef(to_regprocedure('public.admin_update_feedback(uuid,text,text)')::oid)
        like '%current_user_role() not in (''super_admin'', ''admin'')%',
    'reported_song_hide_scoped',
      pg_get_functiondef(to_regprocedure('public.moderator_hide_reported_song(uuid,text)')::oid)
        like '%Only open or escalated reports can hide content%',
    'reported_comment_scoped',
      pg_get_functiondef(to_regprocedure('public.admin_moderate_review_comment(uuid,text,text)')::oid)
        like '%Moderators can only remove reported comments%'
  ) as health;
`;

const history = await query(`
  select version, name
  from supabase_migrations.schema_migrations
  where version = '${migrationVersion}';
`);

if (history.length) {
  const verification = await query(healthSql);
  await query("select pg_notify('pgrst', 'reload schema');");
  console.log(
    JSON.stringify({
      status: "already_applied",
      migration: history[0],
      health: verification.at(-1)?.health ?? null,
      schema_cache: "reload_requested",
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
      'Restrict moderators to report-scoped content moderation.'
    ]
  );
  commit;
`);

const verification = await query(`
  select version, name
  from supabase_migrations.schema_migrations
  where version = '${migrationVersion}';
  ${healthSql}
  select pg_notify('pgrst', 'reload schema') as schema_cache_reload;
`);

console.log(
  JSON.stringify({
    status: "applied",
    migration: verification[0],
    health: verification.at(-2)?.health ?? null,
    schema_cache: "reload_requested",
  }),
);
