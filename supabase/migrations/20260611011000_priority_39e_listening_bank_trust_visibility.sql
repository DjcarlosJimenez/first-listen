-- Priority 39E: Listening Bank trust and visibility repair.
--
-- Store clear rejection reasons for Listening Bank activity, expose those
-- reasons in user and owner diagnostics, and avoid logging the first telemetry
-- baseline sample as a rejected heartbeat.

alter table public.listening_sessions
  add column if not exists last_rejection_reason_code text,
  add column if not exists last_rejection_reason_description text,
  add column if not exists last_rejection_at timestamptz;

create index if not exists listening_sessions_last_rejection_idx
  on public.listening_sessions (last_rejection_at desc)
  where last_rejection_at is not null;

create or replace function public.log_listening_session_activity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  approved_delta integer;
  rejected_delta integer;
  reason_code text;
  reason_description text;
begin
  approved_delta := greatest(0, new.settled_seconds - old.settled_seconds);
  rejected_delta := greatest(0, new.rejected_heartbeats - old.rejected_heartbeats);
  reason_code := coalesce(new.last_rejection_reason_code, 'unknown_rejection');
  reason_description := coalesce(
    new.last_rejection_reason_description,
    'First Listen could not determine why this heartbeat was rejected.'
  );

  if approved_delta > 0 then
    perform public.log_listening_bank_activity(
      new.user_id,
      new.id,
      null,
      'minutes_approved',
      'listening_minutes_approved',
      'approved',
      approved_delta,
      0,
      '+' || ceil(approved_delta / 60.0)::integer || ' Minutes Approved',
      jsonb_build_object('song_id', new.song_id, 'platform', new.platform)
    );
  end if;

  if rejected_delta > 0 then
    perform public.log_listening_bank_activity(
      new.user_id,
      new.id,
      null,
      'heartbeat_rejected',
      'listening_time_rejected',
      'rejected',
      0,
      0,
      'Listening Time Rejected',
      jsonb_build_object(
        'song_id', new.song_id,
        'platform', new.platform,
        'reason_code', reason_code,
        'reason_description', reason_description,
        'reason_recorded_at', coalesce(new.last_rejection_at, now()),
        'rejected_heartbeats', rejected_delta,
        'total_rejected_heartbeats', new.rejected_heartbeats
      )
    );
  end if;

  if old.valid_listen_at is null and new.valid_listen_at is not null then
    perform public.log_listening_bank_activity(
      new.user_id,
      new.id,
      null,
      'session_approved',
      'listening_session_approved',
      'approved',
      new.settled_seconds,
      0,
      'Listening Session Approved',
      jsonb_build_object('song_id', new.song_id)
    );
  end if;

  return new;
end;
$$;

drop function if exists public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
);
create or replace function public.record_listening_heartbeat(
  target_session_id uuid,
  playback_position_seconds numeric,
  playback_duration_seconds numeric,
  playback_state text,
  playback_muted boolean,
  playback_volume numeric,
  page_visible boolean,
  page_focused boolean,
  interaction_recent boolean
)
returns table (
  accepted boolean,
  seconds_counted integer,
  session_verified_seconds integer,
  daily_seconds_remaining integer,
  valid_listen_recorded boolean,
  complete_listen_recorded boolean,
  valid_requirement_seconds integer,
  warning text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_session public.listening_sessions%rowtype;
  settings public.listening_reward_settings%rowtype;
  elapsed_seconds numeric;
  forward_seconds numeric;
  engagement_seconds integer := 0;
  countable_seconds integer := 0;
  banked_seconds integer := 0;
  event_bonus_seconds integer := 0;
  today_other_seconds integer := 0;
  current_daily_remaining integer;
  engagement_valid boolean := false;
  heartbeat_rejected boolean := false;
  rejection_reason_code text := null;
  rejection_reason_description text := null;
  warning_message text := '';
  requirement_seconds integer;
  became_valid boolean := false;
  became_complete boolean := false;
  active_event_id text := null;
  active_event_name text := null;
  active_listening_multiplier numeric := 1;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select *
  into current_session
  from public.listening_sessions
  where id = target_session_id
    and user_id = auth.uid()
  for update;
  if not found then raise exception 'Listening session not found'; end if;

  select * into settings
  from public.listening_reward_settings
  where id = true;

  select event_id, event_name, listening_multiplier
  into active_event_id, active_event_name, active_listening_multiplier
  from public.current_listening_event_bonus()
  limit 1;

  select coalesce(sum(settled_seconds), 0)::integer
  into today_other_seconds
  from public.listening_sessions
  where user_id = auth.uid()
    and id <> target_session_id
    and created_at >= date_trunc('day', now());

  current_daily_remaining := greatest(
    0,
    settings.daily_cap_minutes * 60 -
      today_other_seconds -
      current_session.settled_seconds
  );

  requirement_seconds := case
    when playback_duration_seconds between 15 and 43200
      then least(120, greatest(30, ceil(playback_duration_seconds * 0.25)::integer))
    else coalesce(current_session.valid_requirement_seconds, 30)
  end;

  if current_session.status <> 'active' then
    return query select
      false, 0, current_session.verified_seconds, current_daily_remaining,
      current_session.valid_listen_at is not null,
      current_session.complete_listen_at is not null,
      coalesce(current_session.valid_requirement_seconds, requirement_seconds),
      'Listening session is no longer active.'::text;
    return;
  end if;

  elapsed_seconds := case
    when current_session.last_heartbeat_at is null then 0
    else extract(epoch from (now() - current_session.last_heartbeat_at))
  end;
  forward_seconds := case
    when current_session.last_position_seconds is null then 0
    else playback_position_seconds - current_session.last_position_seconds
  end;

  if current_session.last_heartbeat_at is null then
    update public.listening_sessions
    set
      provider_duration_seconds = playback_duration_seconds,
      valid_requirement_seconds = requirement_seconds,
      last_position_seconds = playback_position_seconds,
      max_position_seconds = greatest(max_position_seconds, playback_position_seconds),
      last_heartbeat_at = now(),
      updated_at = now()
    where id = target_session_id
    returning * into current_session;

    update public.songs
    set observed_duration_seconds = round(playback_duration_seconds)::integer
    where songs.id = current_session.song_id
      and playback_duration_seconds between 15 and 43200
      and (
        songs.observed_duration_seconds is null
        or abs(songs.observed_duration_seconds - playback_duration_seconds) <= 5
      );

    return query select
      false,
      0,
      current_session.verified_seconds,
      current_daily_remaining,
      current_session.valid_listen_at is not null,
      current_session.complete_listen_at is not null,
      requirement_seconds,
      ''::text;
    return;
  end if;

  engagement_valid :=
    settings.enabled
    and current_session.telemetry_supported
    and playback_state in ('playing', 'ended')
    and playback_muted is false
    and coalesce(playback_volume, 0) > 0
    and page_visible
    and page_focused
    and interaction_recent
    and playback_position_seconds >= 0
    and playback_duration_seconds between 15 and 43200
    and playback_position_seconds <= playback_duration_seconds + 5
    and elapsed_seconds between 1 and settings.heartbeat_interval_seconds + 20
    and forward_seconds between 0.25 and elapsed_seconds + 6;

  if engagement_valid then
    engagement_seconds := greatest(
      0,
      least(
        floor(elapsed_seconds)::integer,
        floor(forward_seconds)::integer,
        settings.heartbeat_interval_seconds + 5
      )
    );
    countable_seconds := least(engagement_seconds, current_daily_remaining);
  end if;

  banked_seconds := countable_seconds;
  if banked_seconds > 0 and active_listening_multiplier > 1 then
    banked_seconds := greatest(
      banked_seconds,
      floor(banked_seconds * active_listening_multiplier)::integer
    );
    event_bonus_seconds := greatest(0, banked_seconds - countable_seconds);
  end if;

  if banked_seconds > 0 then
    warning_message := '';
  elsif current_daily_remaining = 0 and engagement_valid then
    rejection_reason_code := 'daily_cap_reached';
    rejection_reason_description := 'Daily Cap Reached';
    warning_message := 'You have reached today''s listening limit.';
  elsif not settings.enabled then
    rejection_reason_code := 'rewards_disabled';
    rejection_reason_description := 'Listening rewards are temporarily disabled.';
    warning_message := 'Listening rewards are temporarily disabled.';
  elsif not current_session.telemetry_supported then
    rejection_reason_code := 'playback_telemetry_missing';
    rejection_reason_description := 'Playback Telemetry Missing';
    warning_message := 'This provider cannot verify reward-eligible playback.';
  elsif playback_state not in ('playing', 'ended') then
    rejection_reason_code := 'playback_not_active';
    rejection_reason_description := 'Playback is not active.';
    warning_message := 'Playback is not active.';
  elsif playback_muted then
    rejection_reason_code := 'playback_muted';
    rejection_reason_description := 'Playback Muted';
    warning_message := 'Muted playback does not earn listening time.';
  elsif coalesce(playback_volume, 0) <= 0 then
    rejection_reason_code := 'volume_zero';
    rejection_reason_description := 'Volume Set To Zero';
    warning_message := 'Volume set to zero does not earn listening time.';
  elsif not page_visible then
    rejection_reason_code := 'tab_not_visible';
    rejection_reason_description := 'Tab Not Visible';
    warning_message := 'Keep First Listen visible to earn time.';
  elsif not page_focused then
    rejection_reason_code := 'tab_not_focused';
    rejection_reason_description := 'Tab Not Focused';
    warning_message := 'Keep First Listen active to earn time.';
  elsif not interaction_recent then
    rejection_reason_code := 'insufficient_user_interaction';
    rejection_reason_description := 'Insufficient User Interaction';
    warning_message := 'Interact with the session to continue earning time.';
  elsif playback_position_seconds < 0
    or playback_duration_seconds not between 15 and 43200
    or playback_position_seconds > playback_duration_seconds + 5
    or forward_seconds < 0.25
    or forward_seconds > elapsed_seconds + 6
  then
    rejection_reason_code := 'playback_progress_invalid';
    rejection_reason_description := 'Playback Progress Invalid';
    warning_message := 'Playback progress could not be verified.';
  elsif elapsed_seconds not between 1 and settings.heartbeat_interval_seconds + 20 then
    rejection_reason_code := 'playback_telemetry_missing';
    rejection_reason_description := 'Playback Telemetry Missing';
    warning_message := 'Playback telemetry arrived outside the verification window.';
  else
    rejection_reason_code := 'playback_progress_invalid';
    rejection_reason_description := 'Playback Progress Invalid';
    warning_message := 'Playback progress could not be verified.';
  end if;

  heartbeat_rejected := banked_seconds <= 0;

  update public.listening_sessions
  set
    provider_duration_seconds = playback_duration_seconds,
    valid_requirement_seconds = requirement_seconds,
    last_position_seconds = playback_position_seconds,
    max_position_seconds = greatest(max_position_seconds, playback_position_seconds),
    engaged_seconds = engaged_seconds + engagement_seconds,
    verified_seconds = verified_seconds + banked_seconds,
    settled_seconds = settled_seconds + banked_seconds,
    rejected_heartbeats = rejected_heartbeats +
      case when heartbeat_rejected then 1 else 0 end,
    last_rejection_reason_code = case
      when heartbeat_rejected then rejection_reason_code
      else last_rejection_reason_code
    end,
    last_rejection_reason_description = case
      when heartbeat_rejected then rejection_reason_description
      else last_rejection_reason_description
    end,
    last_rejection_at = case
      when heartbeat_rejected then now()
      else last_rejection_at
    end,
    loop_count = loop_count + case when forward_seconds < -3 then 1 else 0 end,
    last_heartbeat_at = now(),
    updated_at = now()
  where id = target_session_id
  returning * into current_session;

  if banked_seconds > 0 then
    update public.profiles
    set
      listening_bank_seconds = listening_bank_seconds + banked_seconds,
      lifetime_listening_seconds = lifetime_listening_seconds + banked_seconds,
      updated_at = now()
    where id = auth.uid();
  end if;

  if event_bonus_seconds > 0 then
    perform public.log_listening_bank_activity(
      auth.uid(),
      target_session_id,
      null,
      'event_bonus_applied',
      'listening_event_bonus',
      'bonus',
      event_bonus_seconds,
      0,
      'Bonus Event Applied',
      jsonb_build_object(
        'event_id', active_event_id,
        'event_name', active_event_name,
        'listening_multiplier', active_listening_multiplier,
        'base_seconds', countable_seconds,
        'bonus_seconds', event_bonus_seconds
      )
    );
  end if;

  if current_session.valid_listen_at is null
    and current_session.engaged_seconds >= requirement_seconds
    and not exists (
      select 1
      from public.listening_sessions as recent
      where recent.user_id = auth.uid()
        and recent.song_id = current_session.song_id
        and recent.id <> current_session.id
        and recent.valid_listen_at >= now() - interval '24 hours'
    )
  then
    update public.listening_sessions
    set
      valid_listen_at = now(),
      community_point_awarded = true,
      updated_at = now()
    where id = target_session_id;

    update public.profiles
    set valid_listens = valid_listens + 1, updated_at = now()
    where id = auth.uid();

    perform public.award_community_points(
      auth.uid(), 1, 'Valid listen', 'listening_session',
      target_session_id, null
    );
    perform public.record_creator_contribution(auth.uid(), now());
    became_valid := true;
  end if;

  if current_session.complete_listen_at is null
    and playback_duration_seconds between 15 and 43200
    and current_session.engaged_seconds >= ceil(playback_duration_seconds * 0.90)
  then
    update public.listening_sessions
    set complete_listen_at = now(), updated_at = now()
    where id = target_session_id;

    update public.profiles
    set complete_listens = complete_listens + 1, updated_at = now()
    where id = auth.uid();

    perform public.record_creator_contribution(auth.uid(), now());
    became_complete := true;
  end if;

  return query select
    banked_seconds > 0,
    banked_seconds,
    current_session.verified_seconds,
    greatest(0, current_daily_remaining - banked_seconds),
    became_valid or current_session.valid_listen_at is not null,
    became_complete or current_session.complete_listen_at is not null,
    requirement_seconds,
    warning_message;
end;
$$;

drop function if exists public.get_listening_bank_status_v2();
create or replace function public.get_listening_bank_status_v2()
returns table (
  bank_seconds bigint,
  pending_seconds bigint,
  approved_seconds bigint,
  rejected_seconds bigint,
  lifetime_seconds bigint,
  today_seconds integer,
  weekly_seconds bigint,
  monthly_seconds bigint,
  available_reward_credits integer,
  seconds_to_next_credit integer,
  minutes_per_credit integer,
  daily_cap_minutes integer,
  level_number smallint,
  level_name text,
  rewards_enabled boolean,
  community_points integer,
  community_rank text,
  valid_listens integer,
  complete_listens integer,
  today_valid_listens integer,
  today_complete_listens integer,
  today_average_completion_rate numeric,
  last_rejection_reason_code text,
  last_rejection_reason_description text,
  last_rejection_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with settings as (
    select *
    from public.listening_reward_settings
    where id = true
  ),
  profile as (
    select
      profiles.listening_bank_seconds,
      profiles.lifetime_listening_seconds,
      profiles.community_points,
      profiles.valid_listens,
      profiles.complete_listens
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.account_status = 'active'
      and profiles.banned_at is null
  ),
  periods as (
    select
      coalesce(sum(settled_seconds) filter (
        where created_at >= date_trunc('day', now())
      ), 0)::integer as today_seconds,
      coalesce(sum(settled_seconds) filter (
        where created_at >= date_trunc('week', now())
      ), 0)::bigint as weekly_seconds,
      coalesce(sum(settled_seconds) filter (
        where created_at >= date_trunc('month', now())
      ), 0)::bigint as monthly_seconds,
      coalesce(sum(greatest(verified_seconds - settled_seconds, 0)) filter (
        where status = 'active'
      ), 0)::bigint as pending_seconds,
      coalesce(sum(rejected_heartbeats * settings.heartbeat_interval_seconds) filter (
        where created_at >= date_trunc('day', now())
      ), 0)::bigint as rejected_seconds,
      count(*) filter (
        where valid_listen_at >= date_trunc('day', now())
      )::integer as today_valid_listens,
      count(*) filter (
        where complete_listen_at >= date_trunc('day', now())
      )::integer as today_complete_listens,
      coalesce(round(avg(
        least(
          100,
          engaged_seconds::numeric /
            nullif(provider_duration_seconds, 0) * 100
        )
      ) filter (
        where created_at >= date_trunc('day', now())
          and provider_duration_seconds > 0
          and engaged_seconds > 0
      ), 1), 0) as today_average_completion_rate
    from public.listening_sessions
    cross join settings
    where user_id = auth.uid()
      and reward_eligible
  ),
  last_rejection as (
    select
      log.details->>'reason_code' as reason_code,
      log.details->>'reason_description' as reason_description,
      log.created_at as rejected_at
    from public.listening_bank_activity_log log
    where log.user_id = auth.uid()
      and log.status = 'rejected'
    order by log.created_at desc
    limit 1
  )
  select
    profile.listening_bank_seconds,
    periods.pending_seconds,
    periods.today_seconds::bigint,
    periods.rejected_seconds,
    profile.lifetime_listening_seconds,
    periods.today_seconds,
    periods.weekly_seconds,
    periods.monthly_seconds,
    floor(
      profile.listening_bank_seconds::numeric /
      (settings.minutes_per_credit * 60)
    )::integer,
    case
      when mod(profile.listening_bank_seconds, settings.minutes_per_credit * 60) = 0
        and profile.listening_bank_seconds >= settings.minutes_per_credit * 60
      then 0
      else (
        settings.minutes_per_credit * 60 -
        mod(profile.listening_bank_seconds, settings.minutes_per_credit * 60)
      )::integer
    end,
    settings.minutes_per_credit,
    settings.daily_cap_minutes,
    levels.level_number,
    levels.level_name,
    settings.enabled,
    profile.community_points,
    public.community_rank_name(profile.community_points),
    profile.valid_listens,
    profile.complete_listens,
    periods.today_valid_listens,
    periods.today_complete_listens,
    periods.today_average_completion_rate,
    last_rejection.reason_code,
    last_rejection.reason_description,
    last_rejection.rejected_at
  from profile
  cross join settings
  cross join periods
  left join last_rejection on true
  join lateral (
    select listening_levels.level_number, listening_levels.level_name
    from public.listening_levels
    where listening_levels.minimum_minutes <=
      floor(profile.lifetime_listening_seconds / 60)
    order by listening_levels.minimum_minutes desc
    limit 1
  ) levels on true;
$$;

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
  owner_profile public.profiles%rowtype;
  settings public.listening_reward_settings%rowtype;
  config jsonb;
begin
  if not public.can_manage_platform_control() then
    raise exception 'Super Admin access required.';
  end if;

  select public.ensure_priority39b_platform_config(state.draft_config)
  into config
  from public.platform_control_state state
  where id = true;

  activity_limit := greatest(
    10,
    least(500, coalesce((config#>>'{listeningBank,diagnostics,activityLogLimit}')::integer, 50))
  );

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

update public.listening_bank_activity_log
set details = details || jsonb_build_object(
  'reason_code', 'legacy_reason_unavailable',
  'reason_description', 'Reason was not captured before rejection reasons were enabled.',
  'reason_recorded_at', created_at
)
where status = 'rejected'
  and not (details ? 'reason_code');

revoke all on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) from public, anon;
revoke all on function public.get_listening_bank_status_v2() from public, anon;
revoke all on function public.admin_get_listening_bank_owner_payload() from public, anon;

grant execute on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) to authenticated;
grant execute on function public.get_listening_bank_status_v2() to authenticated;
grant execute on function public.admin_get_listening_bank_owner_payload() to authenticated;
