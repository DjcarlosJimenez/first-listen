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

const report = await query(`
  select jsonb_build_object(
    'migrations', (
      select jsonb_agg(to_jsonb(history) order by history.version)
      from (
        select version, name
        from supabase_migrations.schema_migrations
        where version in ('20260611000000', '20260611001000', '20260611002000')
      ) history
    ),
    'health', public.super_admin_control_center_health_report(),
    'tables', (
      select jsonb_object_agg(tablename, rowsecurity)
      from pg_tables
      where schemaname = 'public'
        and tablename in (
          'platform_control_state',
          'platform_configuration_snapshots',
          'platform_preview_access'
        )
    ),
    'functions', (
      select jsonb_agg(proname order by proname)
      from pg_proc
      join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
      where pg_namespace.nspname = 'public'
        and proname in (
          'get_platform_runtime',
          'admin_get_control_center',
          'admin_update_control_draft',
          'admin_publish_control_draft',
          'admin_restore_control_snapshot',
          'admin_emergency_restore_platform',
          'set_my_platform_preview_mode'
        )
    ),
    'founder_controller_count', (
      select count(*)
      from public.profiles
      where role::text = 'super_admin' and founder_number = 1
    ),
    'direct_table_grants', (
      select count(*)
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name in (
          'platform_control_state',
          'platform_configuration_snapshots',
          'platform_preview_access'
        )
        and grantee in ('anon', 'authenticated')
    ),
    'spotlight_slots', (
      select jsonb_agg(slot_number order by slot_number)
      from public.spotlight_slots
    ),
    'discovery_feed_accepts_100', position(
      'least(coalesce(feed_limit, 8), 100)'
      in pg_get_functiondef(
        'public.get_public_discovery_feed(integer)'::regprocedure
      )
    ) > 0,
    'claimed_at_repair_available',
      to_regprocedure('public.priority25_claimed_at_repair_report()') is not null
  ) as report;
`);

const verification = report[0]?.report ?? null;
if (verification?.claimed_at_repair_available) {
  const repair = await query(`
    select public.priority25_claimed_at_repair_report() as repair;
  `);
  verification.claimed_at_repair = repair[0]?.repair ?? null;
}

console.log(JSON.stringify(verification, null, 2));
