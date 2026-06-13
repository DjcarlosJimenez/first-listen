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
  begin;

  create temp table permission_results (
    role_name text,
    action text,
    outcome text,
    detail text,
    expected text
  ) on commit drop;

  create temp table baseline_role_counts on commit drop as
  select role::text as role_name, count(*)::int as total
  from public.profiles
  where role in ('super_admin', 'admin', 'moderator')
    and account_status = 'active'
  group by role;

  create or replace function pg_temp.run_permission_check(
    role_name text,
    actor_id uuid,
    action_name text,
    command_sql text,
    expected_result text
  )
  returns void
  language plpgsql
  as $$
  begin
    if actor_id is null then
      insert into permission_results
        (role_name, action, outcome, detail, expected)
      values
        (role_name, action_name, 'skipped', 'No active production profile with this role.', expected_result);
      return;
    end if;

    perform set_config('request.jwt.claim.sub', actor_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);

    begin
      execute command_sql;
      insert into permission_results
        (role_name, action, outcome, detail, expected)
      values
        (role_name, action_name, 'success', 'RPC completed.', expected_result);
    exception when others then
      insert into permission_results
        (role_name, action, outcome, detail, expected)
      values
        (role_name, action_name, 'error', SQLERRM, expected_result);
    end;
  end;
  $$;

  do $$
  declare
    super_actor uuid;
    admin_actor uuid;
    moderator_actor uuid;
    role_seed_actor uuid;
    projected_admin boolean := false;
    projected_moderator boolean := false;
  begin
    select id into super_actor
    from public.profiles
    where role = 'super_admin' and account_status = 'active'
    order by created_at
    limit 1;

    select id into admin_actor
    from public.profiles
    where role = 'admin' and account_status = 'active'
    order by created_at
    limit 1;

    select id into moderator_actor
    from public.profiles
    where role = 'moderator' and account_status = 'active'
    order by created_at
    limit 1;

    select id into role_seed_actor
    from public.profiles
    where account_status = 'active'
    order by
      case role
        when 'user' then 1
        when 'admin' then 2
        when 'moderator' then 3
        else 4
      end,
      created_at
    limit 1;

    perform pg_temp.run_permission_check(
      'super_admin',
      super_actor,
      'admin_list_users',
      'select * from public.admin_list_users(1)',
      'allowed'
    );
    perform pg_temp.run_permission_check(
      'super_admin',
      super_actor,
      'admin_set_song_state',
      'select public.admin_set_song_state(gen_random_uuid(), false, false)',
      'allowed_until_target_validation'
    );
    perform pg_temp.run_permission_check(
      'super_admin',
      super_actor,
      'admin_list_feedback',
      'select * from public.admin_list_feedback(''all'', 1)',
      'allowed'
    );

    if admin_actor is null and role_seed_actor is not null then
      admin_actor := role_seed_actor;
      projected_admin := true;
      update public.profiles
      set role = 'admin'::public.app_role
      where id = admin_actor;
    end if;

    perform pg_temp.run_permission_check(
      case when projected_admin then 'admin_projected_rollback' else 'admin' end,
      admin_actor,
      'admin_list_users',
      'select * from public.admin_list_users(1)',
      'allowed'
    );
    perform pg_temp.run_permission_check(
      case when projected_admin then 'admin_projected_rollback' else 'admin' end,
      admin_actor,
      'admin_issue_user_warning',
      'select public.admin_issue_user_warning(gen_random_uuid(), ''Permission test'')',
      'allowed_until_target_validation'
    );
    perform pg_temp.run_permission_check(
      case when projected_admin then 'admin_projected_rollback' else 'admin' end,
      admin_actor,
      'admin_enforce_account',
      'select public.admin_enforce_account(gen_random_uuid(), ''suspend'', ''Permission test'')',
      'allowed_until_target_validation'
    );
    perform pg_temp.run_permission_check(
      case when projected_admin then 'admin_projected_rollback' else 'admin' end,
      admin_actor,
      'admin_set_song_state',
      'select public.admin_set_song_state(gen_random_uuid(), false, false)',
      'allowed_until_target_validation'
    );
    perform pg_temp.run_permission_check(
      case when projected_admin then 'admin_projected_rollback' else 'admin' end,
      admin_actor,
      'admin_list_feedback',
      'select * from public.admin_list_feedback(''all'', 1)',
      'allowed'
    );
    perform pg_temp.run_permission_check(
      case when projected_admin then 'admin_projected_rollback' else 'admin' end,
      admin_actor,
      'admin_update_feedback',
      'select public.admin_update_feedback(gen_random_uuid(), ''resolved'', null)',
      'allowed_until_target_validation'
    );

    if moderator_actor is null and role_seed_actor is not null then
      moderator_actor := role_seed_actor;
      projected_moderator := true;
      update public.profiles
      set role = 'moderator'::public.app_role
      where id = moderator_actor;
    end if;

    perform pg_temp.run_permission_check(
      case when projected_moderator then 'moderator_projected_rollback' else 'moderator' end,
      moderator_actor,
      'admin_list_users',
      'select * from public.admin_list_users(1)',
      'blocked'
    );
    perform pg_temp.run_permission_check(
      case when projected_moderator then 'moderator_projected_rollback' else 'moderator' end,
      moderator_actor,
      'admin_issue_user_warning',
      'select public.admin_issue_user_warning(gen_random_uuid(), ''Permission test'')',
      'blocked'
    );
    perform pg_temp.run_permission_check(
      case when projected_moderator then 'moderator_projected_rollback' else 'moderator' end,
      moderator_actor,
      'admin_enforce_account',
      'select public.admin_enforce_account(gen_random_uuid(), ''suspend'', ''Permission test'')',
      'blocked'
    );
    perform pg_temp.run_permission_check(
      case when projected_moderator then 'moderator_projected_rollback' else 'moderator' end,
      moderator_actor,
      'admin_set_song_state',
      'select public.admin_set_song_state(gen_random_uuid(), false, false)',
      'blocked'
    );
    perform pg_temp.run_permission_check(
      case when projected_moderator then 'moderator_projected_rollback' else 'moderator' end,
      moderator_actor,
      'admin_list_feedback',
      'select * from public.admin_list_feedback(''all'', 1)',
      'blocked'
    );
    perform pg_temp.run_permission_check(
      case when projected_moderator then 'moderator_projected_rollback' else 'moderator' end,
      moderator_actor,
      'admin_update_feedback',
      'select public.admin_update_feedback(gen_random_uuid(), ''resolved'', null)',
      'blocked'
    );
    perform pg_temp.run_permission_check(
      case when projected_moderator then 'moderator_projected_rollback' else 'moderator' end,
      moderator_actor,
      'admin_resolve_report',
      'select public.admin_resolve_report(gen_random_uuid(), ''reviewing''::public.report_status)',
      'allowed_until_target_validation'
    );
    perform pg_temp.run_permission_check(
      case when projected_moderator then 'moderator_projected_rollback' else 'moderator' end,
      moderator_actor,
      'admin_resolve_comment_report',
      'select public.admin_resolve_comment_report(gen_random_uuid(), ''reviewing''::public.report_status)',
      'allowed_until_target_validation'
    );
    perform pg_temp.run_permission_check(
      case when projected_moderator then 'moderator_projected_rollback' else 'moderator' end,
      moderator_actor,
      'moderator_hide_reported_song',
      'select public.moderator_hide_reported_song(gen_random_uuid(), ''Permission test'')',
      'allowed_until_target_validation'
    );
    perform pg_temp.run_permission_check(
      case when projected_moderator then 'moderator_projected_rollback' else 'moderator' end,
      moderator_actor,
      'admin_moderate_review_comment_restore',
      'select public.admin_moderate_review_comment(gen_random_uuid(), ''restore'', ''Permission test'')',
      'blocked'
    );
    perform pg_temp.run_permission_check(
      case when projected_moderator then 'moderator_projected_rollback' else 'moderator' end,
      moderator_actor,
      'admin_moderate_review_comment_remove_unreported',
      'select public.admin_moderate_review_comment(gen_random_uuid(), ''remove'', ''Permission test'')',
      'scoped_to_reported_comments'
    );
  end;
  $$;

  select jsonb_build_object(
    'migration', (
      select to_jsonb(migration)
      from (
        select version, name
        from supabase_migrations.schema_migrations
        where version = '20260613002000'
      ) migration
    ),
    'active_role_counts', (
      select jsonb_object_agg(role_name, total)
      from baseline_role_counts counts
    ),
    'rpc_source_checks', jsonb_build_object(
      'admin_list_users_admin_only',
        pg_get_functiondef(to_regprocedure('public.admin_list_users(integer)')::oid)
          like '%current_user_role() not in (''super_admin'', ''admin'')%',
      'admin_issue_user_warning_admin_only',
        pg_get_functiondef(to_regprocedure('public.admin_issue_user_warning(uuid,text)')::oid)
          like '%actor_role not in (''super_admin'', ''admin'')%',
      'admin_enforce_account_admin_only',
        pg_get_functiondef(to_regprocedure('public.admin_enforce_account(uuid,text,text)')::oid)
          like '%actor_role not in (''super_admin'', ''admin'')%',
      'admin_set_song_state_admin_only',
        pg_get_functiondef(to_regprocedure('public.admin_set_song_state(uuid,boolean,boolean)')::oid)
          like '%current_user_role() not in (''super_admin'', ''admin'')%',
      'feedback_admin_only',
        pg_get_functiondef(to_regprocedure('public.admin_update_feedback(uuid,text,text)')::oid)
          like '%current_user_role() not in (''super_admin'', ''admin'')%',
      'moderator_reported_song_scope',
        pg_get_functiondef(to_regprocedure('public.moderator_hide_reported_song(uuid,text)')::oid)
          like '%Only open or escalated reports can hide content%',
      'moderator_comment_scope',
        pg_get_functiondef(to_regprocedure('public.admin_moderate_review_comment(uuid,text,text)')::oid)
          like '%Moderators can only remove reported comments%'
    ),
    'permission_results', (
      select jsonb_agg(
        jsonb_build_object(
          'role', role_name,
          'action', action,
          'outcome', outcome,
          'detail', detail,
          'expected', expected
        )
        order by role_name, action
      )
      from permission_results
    )
  ) as report;

  rollback;
`);

console.log(JSON.stringify(report.at(-1)?.report ?? {}, null, 2));
