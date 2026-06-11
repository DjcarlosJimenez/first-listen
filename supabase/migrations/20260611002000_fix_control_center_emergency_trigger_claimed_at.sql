-- Emergency repair for Priority 25:
-- the shared emergency trigger must branch by table before reading table fields.

create or replace function public.enforce_platform_emergency_controls()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  config jsonb;
  claimed_today integer;
begin
  select published_config into config
  from public.platform_control_state
  where id = true;

  if tg_table_name = 'songs' then
    if coalesce((config#>>'{tokens,emergency,pauseSubmissions}')::boolean, false)
    then
      raise exception 'Song submissions are temporarily paused.';
    end if;
    return new;
  end if;

  if tg_table_name = 'listening_reward_claims' then
    if coalesce((config#>>'{tokens,emergency,pauseTokenGeneration}')::boolean, false)
      or coalesce((config#>>'{tokens,emergency,pauseRewards}')::boolean, false)
    then
      raise exception 'Listening rewards are temporarily paused.';
    end if;

    select count(*)::integer into claimed_today
    from public.listening_reward_claims claim
    where claim.user_id = new.user_id
      and claim.created_at >= date_trunc('day', now());

    if claimed_today >= coalesce(
      (config#>>'{tokens,maxTokensPerDay}')::integer, 3
    ) then
      raise exception 'Daily listening reward limit reached.';
    end if;
    return new;
  end if;

  if tg_table_name = 'daily_mission_progress' then
    if new.claimed_at is not null
      and old.claimed_at is null
      and (
        coalesce((config#>>'{tokens,emergency,pauseMissions}')::boolean, false)
        or coalesce((config#>>'{tokens,emergency,pauseRewards}')::boolean, false)
      )
    then
      raise exception 'Mission rewards are temporarily paused.';
    end if;
    return new;
  end if;

  return new;
end;
$$;

create or replace function public.priority25_claimed_at_repair_report()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'healthy',
      to_regclass('public.daily_mission_progress') is not null
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'daily_mission_progress'
          and column_name = 'claimed_at'
      )
      and position(
        'if tg_table_name = ''songs'' then'
        in pg_get_functiondef(
          'public.enforce_platform_emergency_controls()'::regprocedure
        )
      ) > 0,
    'daily_mission_progress_claimed_at', exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'daily_mission_progress'
        and column_name = 'claimed_at'
    ),
    'songs_claimed_at', exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'songs'
        and column_name = 'claimed_at'
    ),
    'listening_reward_claims_claimed_at', exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'listening_reward_claims'
        and column_name = 'claimed_at'
    ),
    'emergency_triggers', (
      select jsonb_agg(
        jsonb_build_object(
          'trigger', trigger_name,
          'table', event_object_table,
          'event', event_manipulation
        )
        order by event_object_table, trigger_name
      )
      from information_schema.triggers
      where trigger_schema = 'public'
        and action_statement ilike '%enforce_platform_emergency_controls%'
    ),
    'function_branches_before_claimed_at', position(
      'if tg_table_name = ''daily_mission_progress'' then'
      in pg_get_functiondef(
        'public.enforce_platform_emergency_controls()'::regprocedure
      )
    ) > 0
  );
$$;

revoke all on function public.priority25_claimed_at_repair_report() from public;
grant execute on function public.priority25_claimed_at_repair_report()
  to authenticated, service_role;
