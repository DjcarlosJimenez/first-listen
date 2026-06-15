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

const migrationVersion = "20260615001000";
const migrationName = "feedback_engine_optional_artist_message";
const migrationPath =
  "supabase/migrations/20260615001000_feedback_engine_optional_artist_message.sql";
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
    'reviews_comment_optional_constraint',
      exists (
        select 1
        from pg_constraint
        where conname = 'reviews_comment_optional_or_useful_check'
          and conrelid = 'public.reviews'::regclass
      ),
    'legacy_reviews_comment_check_removed',
      not exists (
        select 1
        from pg_constraint
        where conname = 'reviews_comment_check'
          and conrelid = 'public.reviews'::regclass
      ),
    'reviews_comment_default_empty',
      exists (
        select 1
        from pg_attrdef defaults
        join pg_attribute attributes
          on attributes.attrelid = defaults.adrelid
          and attributes.attnum = defaults.adnum
        where defaults.adrelid = 'public.reviews'::regclass
          and attributes.attname = 'comment'
          and pg_get_expr(defaults.adbin, defaults.adrelid) = '''''::text'
      ),
    'submit_review_rpc_exists',
      to_regprocedure(
        'public.submit_review_with_listening(uuid,boolean,boolean,boolean,boolean,smallint,text,boolean,uuid)'
      ) is not null,
    'submit_review_rpc_allows_optional_message',
      pg_get_functiondef(to_regprocedure(
        'public.submit_review_with_listening(uuid,boolean,boolean,boolean,boolean,smallint,text,boolean,uuid)'
      )::oid) like '%Optional artist message was not saved because it was too short.%'
      and pg_get_functiondef(to_regprocedure(
        'public.submit_review_with_listening(uuid,boolean,boolean,boolean,boolean,smallint,text,boolean,uuid)'
      )::oid) like '%stored_comment := '''';%',
    'authenticated_can_execute_submit_review_rpc',
      has_function_privilege(
        'authenticated',
        'public.submit_review_with_listening(uuid,boolean,boolean,boolean,boolean,smallint,text,boolean,uuid)'::regprocedure,
        'EXECUTE'
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
      'Allow structured feedback to be submitted without a required artist message.'
    ]
  );
  commit;
`);

const verification = await query(healthSql);
await query("select pg_notify('pgrst', 'reload schema');");

console.log(
  JSON.stringify({
    status: "applied",
    migration: `${migrationVersion}_${migrationName}`,
    health: verification.at(-1)?.health ?? null,
    schema_cache: "reload_requested",
  }),
);
