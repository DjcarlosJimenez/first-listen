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
    'migration_applied', exists (
      select 1
      from supabase_migrations.schema_migrations
      where version = '20260611004000'
        and name = 'owner_control_center'
    ),
    'pinned_column', exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'spotlight_slots'
        and column_name = 'pinned'
    ),
    'spotlight_slots', (
      select jsonb_agg(slot_number order by slot_number)
      from public.spotlight_slots
    ),
    'default_has_schedule_fields',
      public.default_platform_control_config()#>>'{spotlight,0,startsAt}' is not distinct from null
      and public.default_platform_control_config()#>>'{spotlight,0,endsAt}' is not distinct from null
      and public.default_platform_control_config()#>>'{spotlight,0,pinned}' = 'false',
    'owner_route_guard_expected', true
  ) as report;
`);

const rollbackApply = await query(`
  begin;
  do $$
  declare
    target_config jsonb;
  begin
    select draft_config
    into target_config
    from public.platform_control_state
    where id = true;

    target_config := jsonb_set(
      target_config,
      '{spotlight}',
      jsonb_build_array(
        jsonb_build_object(
          'slot', 1,
          'songId', null,
          'placement', 'editor_pick',
          'label', 'QA Spotlight',
          'pinned', true,
          'startsAt', (now() - interval '5 minutes')::text,
          'endsAt', (now() + interval '5 minutes')::text
        ),
        jsonb_build_object(
          'slot', 2,
          'songId', null,
          'placement', 'new_release',
          'label', 'QA New Release',
          'pinned', false,
          'startsAt', null,
          'endsAt', null
        ),
        jsonb_build_object(
          'slot', 3,
          'songId', null,
          'placement', 'editor_pick',
          'label', 'QA Community Pick',
          'pinned', true,
          'startsAt', null,
          'endsAt', null
        )
      )
    );

    perform public.validate_platform_control_config(target_config);
    perform public.apply_platform_control_config(target_config);
  end;
  $$;
  select jsonb_build_object(
    'rollback_transaction', true,
    'slots', (
      select jsonb_agg(
        jsonb_build_object(
          'slot', slot_number,
          'label', custom_label,
          'placement', placement_kind,
          'pinned', pinned,
          'scheduled', active_from is not null or active_until is not null
        )
        order by slot_number
      )
      from public.spotlight_slots
    )
  ) as verification;
  rollback;
`);

const founderPayload = await query(`
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
      or payload ? 'token_analytics' is false
    then
      raise exception 'Owner Control Center payload is incomplete.';
    end if;
  end;
  $$;
  with payload as (
    select public.admin_get_control_center() as data
  )
  select jsonb_build_object(
    'founder_rpc_loads', true,
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
    'sections', jsonb_build_object(
      'theme_manager', payload.data#>'{state,draft_config,theme}' is not null,
      'homepage_builder', payload.data#>'{state,draft_config,homepage}' is not null,
      'token_economy', payload.data#>'{state,draft_config,tokens}' is not null,
      'announcements', payload.data#>'{state,draft_config,announcements}' is not null,
      'snapshots', jsonb_typeof(payload.data->'snapshots') = 'array',
      'preview_mode', payload.data ? 'preview_enabled',
      'rollback', payload.data#>'{state,stable_config}' is not null,
      'import_export', payload.data#>'{state,draft_config}' is not null,
      'community_health', payload.data ? 'health'
    )
  ) as verification
  from payload;
`);

console.log(JSON.stringify({
  ...report[0]?.report,
  rollback_apply: rollbackApply.at(-1)?.verification ?? null,
  founder_payload: founderPayload.at(-1)?.verification ?? null,
}, null, 2));
