-- Priority 39E.1
-- Keep Listening Bank visible in the user experience and prevent active
-- diagnostics logs from growing without bounds.

create table if not exists public.listening_bank_activity_log_archive (
  id uuid primary key,
  user_id uuid references public.profiles(id) on delete set null,
  listening_session_id uuid references public.listening_sessions(id) on delete set null,
  reward_claim_id uuid references public.listening_reward_claims(id) on delete set null,
  event_key text not null,
  event_type text not null,
  status text not null,
  amount_seconds integer not null default 0,
  token_amount integer not null default 0,
  title text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  archived_at timestamptz not null default now(),
  archived_by uuid references public.profiles(id) on delete set null,
  archive_reason text not null default 'auto_cleanup'
);

create index if not exists listening_bank_activity_archive_user_idx
  on public.listening_bank_activity_log_archive (user_id, created_at desc);
create index if not exists listening_bank_activity_archive_reason_idx
  on public.listening_bank_activity_log_archive (archive_reason, archived_at desc);

alter table public.listening_bank_activity_log_archive enable row level security;

revoke all on table public.listening_bank_activity_log_archive
  from public, anon, authenticated;
grant select on table public.listening_bank_activity_log_archive to authenticated;

drop policy if exists "users read own archived listening activity or staff reads all"
  on public.listening_bank_activity_log_archive;
create policy "users read own archived listening activity or staff reads all"
  on public.listening_bank_activity_log_archive
  for select
  using (
    auth.uid() = user_id
    or public.can_manage_platform_control()
  );

create or replace function public.default_listening_bank_control_config()
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'diagnostics', jsonb_build_object(
      'enabled', true,
      'showOwnerDiagnostics', true,
      'showActivityLog', true,
      'showCalculationTimestamp', true,
      'activityLogLimit', 20,
      'activityLogLimitMode', '20',
      'customActivityLogLimit', 20,
      'autoCleanupOldRecords', true,
      'autoCleanupKeepVisible', 30
    ),
    'testing', jsonb_build_object(
      'enabled', true,
      'rollbackSafeOnly', true,
      'allowProductionSimulations', true
    ),
    'rewards', jsonb_build_object(
      'minutesPerToken', 120,
      'dailyCapMinutes', 180,
      'showUserTransparency', true,
      'showApprovalRules', true
    ),
    'module', jsonb_build_object(
      'show', true,
      'desktop', jsonb_build_object(
        'visibility', 'visible',
        'position', 2,
        'column', 'full_width',
        'size', 'standard'
      ),
      'mobile', jsonb_build_object(
        'visibility', 'visible',
        'position', 2,
        'column', 'full_width',
        'size', 'standard'
      ),
      'visibility', jsonb_build_object(
        'showApprovedMinutes', true,
        'showPendingMinutes', true,
        'showRejectedMinutes', true,
        'showTokenConversion', true,
        'showNextRewardThreshold', true
      )
    ),
    'events', '[]'::jsonb
  );
$$;

create or replace function public.priority39e1_activity_log_limit(target_config jsonb)
returns integer
language sql
stable
set search_path = pg_catalog
as $$
  with limit_values as (
    select
      coalesce(target_config#>>'{listeningBank,diagnostics,activityLogLimitMode}', '20') as limit_mode,
      coalesce(target_config#>>'{listeningBank,diagnostics,activityLogLimit}', '20') as visible_limit,
      coalesce(target_config#>>'{listeningBank,diagnostics,customActivityLogLimit}', '20') as custom_limit
  )
  select greatest(
    10,
    least(
      500,
      case
        when limit_mode = 'custom' and custom_limit ~ '^[0-9]+$'
          then custom_limit::integer
        when limit_mode in ('10', '20', '30', '50')
          then limit_mode::integer
        when visible_limit ~ '^[0-9]+$'
          then visible_limit::integer
        else 20
      end
    )
  )
  from limit_values;
$$;

create or replace function public.priority39e1_activity_archive_keep(target_config jsonb)
returns integer
language sql
stable
set search_path = pg_catalog
as $$
  select greatest(
    10,
    least(
      500,
      case
        when coalesce(
          target_config#>>'{listeningBank,diagnostics,autoCleanupKeepVisible}',
          '30'
        ) ~ '^[0-9]+$'
        then (target_config#>>'{listeningBank,diagnostics,autoCleanupKeepVisible}')::integer
        else 30
      end
    )
  );
$$;

create or replace function public.ensure_priority39e1_platform_config(target_config jsonb)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  with base as (
    select public.ensure_priority39b_platform_config(
      coalesce(target_config, '{}'::jsonb)
    ) as config
  ),
  defaults as (
    select
      config,
      coalesce(config#>>'{listeningBank,diagnostics,activityLogLimitMode}', '20') as limit_mode,
      coalesce(config#>>'{listeningBank,diagnostics,activityLogLimit}', '20') as visible_limit,
      coalesce(config#>>'{listeningBank,diagnostics,customActivityLogLimit}', '20') as custom_limit,
      coalesce(config#>>'{listeningBank,diagnostics,autoCleanupOldRecords}', 'true') as cleanup_enabled,
      coalesce(config#>>'{listeningBank,diagnostics,autoCleanupKeepVisible}', '30') as cleanup_keep
    from base
  )
  select jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                config,
                '{listeningBank,diagnostics,activityLogLimit}',
                to_jsonb(
                  case
                    when limit_mode = 'custom' and custom_limit ~ '^[0-9]+$'
                      then greatest(10, least(500, custom_limit::integer))
                    when limit_mode in ('10', '20', '30', '50')
                      then limit_mode::integer
                    when visible_limit ~ '^[0-9]+$' and visible_limit::integer <> 50
                      then greatest(10, least(500, visible_limit::integer))
                    else 20
                  end
                ),
                true
              ),
              '{listeningBank,diagnostics,activityLogLimitMode}',
              to_jsonb(
                case
                  when limit_mode in ('10', '20', '30', '50', 'custom')
                    then limit_mode
                  when visible_limit in ('10', '20', '30') then visible_limit
                  else '20'
                end
              ),
              true
            ),
            '{listeningBank,diagnostics,customActivityLogLimit}',
            to_jsonb(
              case
                when custom_limit ~ '^[0-9]+$'
                  then greatest(10, least(500, custom_limit::integer))
                else 20
              end
            ),
            true
          ),
          '{listeningBank,diagnostics,autoCleanupOldRecords}',
          to_jsonb(
            case
              when lower(cleanup_enabled) in ('true', 'false')
                then cleanup_enabled::boolean
              else true
            end
          ),
          true
        ),
        '{listeningBank,diagnostics,autoCleanupKeepVisible}',
        to_jsonb(
          case
            when cleanup_keep ~ '^[0-9]+$'
              then greatest(10, least(500, cleanup_keep::integer))
            else 30
          end
        ),
        true
      ),
      '{listeningBank,module,desktop,position}',
      to_jsonb(greatest(
        1,
        least(50, coalesce((config#>>'{listeningBank,module,desktop,position}')::integer, 2))
      )),
      true
    ),
    '{listeningBank,module,mobile,position}',
    to_jsonb(greatest(
      1,
      least(50, coalesce((config#>>'{listeningBank,module,mobile,position}')::integer, 2))
    )),
    true
  )
  from defaults;
$$;

create or replace function public.archive_listening_bank_activity_records(
  retain_newest integer,
  archive_reason text default 'auto_cleanup'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  keep_count integer := greatest(0, least(500, coalesce(retain_newest, 30)));
  archived_count integer := 0;
  deleted_count integer := 0;
begin
  with ranked as (
    select
      log.*,
      row_number() over (order by log.created_at desc, log.id desc) as row_number
    from public.listening_bank_activity_log log
  ),
  candidates as (
    select *
    from ranked
    where row_number > keep_count
  ),
  archived as (
    insert into public.listening_bank_activity_log_archive (
      id,
      user_id,
      listening_session_id,
      reward_claim_id,
      event_key,
      event_type,
      status,
      amount_seconds,
      token_amount,
      title,
      details,
      created_at,
      archived_at,
      archived_by,
      archive_reason
    )
    select
      id,
      user_id,
      listening_session_id,
      reward_claim_id,
      event_key,
      event_type,
      status,
      amount_seconds,
      token_amount,
      title,
      details,
      created_at,
      now(),
      auth.uid(),
      left(coalesce(archive_reason, 'auto_cleanup'), 120)
    from candidates
    on conflict (id) do update
      set archived_at = excluded.archived_at,
          archived_by = excluded.archived_by,
          archive_reason = excluded.archive_reason
    returning id
  ),
  deleted as (
    delete from public.listening_bank_activity_log
    where id in (select id from candidates)
    returning id
  )
  select
    (select count(*) from archived),
    (select count(*) from deleted)
  into archived_count, deleted_count;

  return jsonb_build_object(
    'retained_visible_records', keep_count,
    'archived_records', archived_count,
    'removed_from_active_log', deleted_count,
    'archive_reason', coalesce(archive_reason, 'auto_cleanup')
  );
end;
$$;

create or replace function public.admin_archive_listening_bank_activity(
  retain_newest integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  config jsonb;
  keep_count integer;
begin
  if not public.can_manage_platform_control() then
    raise exception 'Super Admin access required.';
  end if;

  select public.ensure_priority39e1_platform_config(state.draft_config)
  into config
  from public.platform_control_state state
  where id = true;

  keep_count := coalesce(
    retain_newest,
    public.priority39e1_activity_archive_keep(config)
  );

  return public.archive_listening_bank_activity_records(
    keep_count,
    'manual_archive'
  );
end;
$$;

create or replace function public.admin_cleanup_old_listening_bank_activity()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  config jsonb;
begin
  if not public.can_manage_platform_control() then
    raise exception 'Super Admin access required.';
  end if;

  select public.ensure_priority39e1_platform_config(state.draft_config)
  into config
  from public.platform_control_state state
  where id = true;

  return public.archive_listening_bank_activity_records(
    public.priority39e1_activity_archive_keep(config),
    'manual_auto_cleanup'
  );
end;
$$;

create or replace function public.admin_clear_listening_bank_activity()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.can_manage_platform_control() then
    raise exception 'Super Admin access required.';
  end if;

  return public.archive_listening_bank_activity_records(0, 'manual_clear');
end;
$$;

create or replace function public.cleanup_listening_bank_activity_after_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  config jsonb;
  cleanup_enabled boolean := true;
begin
  select public.ensure_priority39e1_platform_config(state.published_config)
  into config
  from public.platform_control_state state
  where id = true;

  cleanup_enabled := coalesce(
    (config#>>'{listeningBank,diagnostics,autoCleanupOldRecords}')::boolean,
    true
  );

  if cleanup_enabled then
    perform public.archive_listening_bank_activity_records(
      public.priority39e1_activity_archive_keep(config),
      'auto_cleanup'
    );
  end if;

  return null;
end;
$$;

drop trigger if exists listening_bank_activity_auto_cleanup
  on public.listening_bank_activity_log;
create trigger listening_bank_activity_auto_cleanup
  after insert on public.listening_bank_activity_log
  for each statement
  execute function public.cleanup_listening_bank_activity_after_insert();

create or replace function public.admin_get_listening_bank_owner_payload()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  result jsonb;
  activity_limit integer;
  archive_keep integer;
  owner_profile public.profiles%rowtype;
  settings public.listening_reward_settings%rowtype;
  config jsonb;
begin
  if not public.can_manage_platform_control() then
    raise exception 'Super Admin access required.';
  end if;

  select public.ensure_priority39e1_platform_config(state.draft_config)
  into config
  from public.platform_control_state state
  where id = true;

  activity_limit := public.priority39e1_activity_log_limit(config);
  archive_keep := public.priority39e1_activity_archive_keep(config);

  select *
  into owner_profile
  from public.profiles
  where id = auth.uid();

  select *
  into settings
  from public.listening_reward_settings
  where id = true;

  select jsonb_build_object(
    'diagnostics', jsonb_build_object(
      'total_listening_time_today', coalesce((
        select sum(engaged_seconds)
        from public.listening_sessions
        where created_at >= date_trunc('day', now())
      ), 0),
      'approved_listening_time_today', coalesce((
        select sum(settled_seconds)
        from public.listening_sessions
        where created_at >= date_trunc('day', now())
      ), 0),
      'pending_listening_time', coalesce((
        select sum(greatest(verified_seconds - settled_seconds, 0))
        from public.listening_sessions
        where status = 'active'
      ), 0),
      'rejected_listening_time', coalesce((
        select sum(rejected_heartbeats * settings.heartbeat_interval_seconds)
        from public.listening_sessions
        where created_at >= date_trunc('day', now())
      ), 0),
      'current_listening_bank', coalesce(owner_profile.listening_bank_seconds, 0),
      'current_token_balance', coalesce(owner_profile.credits, 0),
      'visible_activity_log_limit', activity_limit,
      'current_activity_entries', (
        select count(*) from public.listening_bank_activity_log
      ),
      'archived_activity_entries', (
        select count(*) from public.listening_bank_activity_log_archive
      ),
      'auto_cleanup_enabled', coalesce(
        (config#>>'{listeningBank,diagnostics,autoCleanupOldRecords}')::boolean,
        true
      ),
      'auto_cleanup_keep_visible', archive_keep,
      'last_approval_event', (
        select max(created_at)
        from public.listening_bank_activity_log
        where status = 'approved'
      ),
      'last_rejection_event', (
        select max(created_at)
        from public.listening_bank_activity_log
        where status = 'rejected'
      ),
      'last_rejection_reason_code', (
        select details->>'reason_code'
        from public.listening_bank_activity_log
        where status = 'rejected'
        order by created_at desc
        limit 1
      ),
      'last_rejection_reason_description', (
        select details->>'reason_description'
        from public.listening_bank_activity_log
        where status = 'rejected'
        order by created_at desc
        limit 1
      ),
      'last_reward_event', (
        select max(created_at)
        from public.listening_reward_claims
      ),
      'last_bank_update', (
        select max(created_at)
        from public.listening_bank_activity_log
      ),
      'last_archive_event', (
        select max(archived_at)
        from public.listening_bank_activity_log_archive
      ),
      'last_calculation_timestamp', now(),
      'minutes_per_token', settings.minutes_per_credit,
      'daily_cap_minutes', settings.daily_cap_minutes,
      'rewards_enabled', settings.enabled
    ),
    'activity_log', coalesce((
      select jsonb_agg(to_jsonb(log_row) order by log_row.created_at desc)
      from (
        select
          id,
          user_id,
          event_key,
          event_type,
          status,
          amount_seconds,
          token_amount,
          title,
          details,
          created_at
        from public.listening_bank_activity_log
        order by created_at desc
        limit activity_limit
      ) log_row
    ), '[]'::jsonb),
    'rejection_insights', jsonb_build_object(
      'last_100_rejections', coalesce((
        select jsonb_agg(to_jsonb(rejection_row) order by rejection_row.created_at desc)
        from (
          select
            id,
            user_id,
            listening_session_id,
            details->>'song_id' as song_id,
            coalesce(details->>'reason_code', 'legacy_reason_unavailable') as reason_code,
            coalesce(
              details->>'reason_description',
              'Reason was not captured before rejection reasons were enabled.'
            ) as reason_description,
            created_at
          from public.listening_bank_activity_log
          where status = 'rejected'
          order by created_at desc
          limit 100
        ) rejection_row
      ), '[]'::jsonb),
      'reason_frequency', coalesce((
        select jsonb_agg(to_jsonb(reason_row) order by reason_row.total desc, reason_row.reason_code)
        from (
          select
            coalesce(details->>'reason_code', 'legacy_reason_unavailable') as reason_code,
            coalesce(
              details->>'reason_description',
              'Reason was not captured before rejection reasons were enabled.'
            ) as reason_description,
            count(*)::integer as total
          from public.listening_bank_activity_log
          where status = 'rejected'
          group by 1, 2
          order by count(*) desc, 1
          limit 20
        ) reason_row
      ), '[]'::jsonb),
      'most_common_failure_causes', coalesce((
        select jsonb_agg(reason_row.reason_description order by reason_row.total desc, reason_row.reason_code)
        from (
          select
            coalesce(details->>'reason_code', 'legacy_reason_unavailable') as reason_code,
            coalesce(
              details->>'reason_description',
              'Reason was not captured before rejection reasons were enabled.'
            ) as reason_description,
            count(*)::integer as total
          from public.listening_bank_activity_log
          where status = 'rejected'
          group by 1, 2
          order by count(*) desc, 1
          limit 5
        ) reason_row
      ), '[]'::jsonb)
    ),
    'events', coalesce(config#>'{listeningBank,events}', '[]'::jsonb),
    'active_event', coalesce((
      select to_jsonb(active)
      from public.current_listening_event_bonus() active
      limit 1
    ), '{}'::jsonb),
    'test_scenarios', jsonb_build_array(
      'simulate_5_minutes',
      'simulate_10_minutes',
      'simulate_30_minutes',
      'simulate_60_minutes',
      'simulate_approval_event',
      'simulate_reward_event',
      'simulate_token_award'
    )
  )
  into result;

  return result;
end;
$$;

update public.platform_control_state
set
  draft_config = public.ensure_priority39e1_platform_config(draft_config),
  published_config = public.ensure_priority39e1_platform_config(published_config),
  stable_config = public.ensure_priority39e1_platform_config(stable_config),
  updated_at = now()
where id = true;

select public.archive_listening_bank_activity_records(30, 'migration_auto_cleanup');

revoke all on function public.priority39e1_activity_log_limit(jsonb) from public, anon, authenticated;
revoke all on function public.priority39e1_activity_archive_keep(jsonb) from public, anon, authenticated;
revoke all on function public.ensure_priority39e1_platform_config(jsonb) from public, anon, authenticated;
revoke all on function public.archive_listening_bank_activity_records(integer, text) from public, anon, authenticated;
revoke all on function public.admin_archive_listening_bank_activity(integer) from public, anon;
revoke all on function public.admin_cleanup_old_listening_bank_activity() from public, anon;
revoke all on function public.admin_clear_listening_bank_activity() from public, anon;
revoke all on function public.cleanup_listening_bank_activity_after_insert() from public, anon, authenticated;
revoke all on function public.admin_get_listening_bank_owner_payload() from public, anon;

grant execute on function public.admin_archive_listening_bank_activity(integer) to authenticated;
grant execute on function public.admin_cleanup_old_listening_bank_activity() to authenticated;
grant execute on function public.admin_clear_listening_bank_activity() to authenticated;
grant execute on function public.admin_get_listening_bank_owner_payload() to authenticated;
