-- Include the active session's pending time in daily-cap progress.
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
  novel_seconds numeric;
  countable_seconds integer := 0;
  today_settled integer := 0;
  current_daily_remaining integer;
  heartbeat_valid boolean := false;
  warning_message text := '';
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select *
  into current_session
  from public.listening_sessions
  where id = target_session_id
    and user_id = auth.uid()
  for update;
  if not found then raise exception 'Listening session not found'; end if;

  select *
  into settings
  from public.listening_reward_settings
  where id = true;

  select coalesce(sum(settled_seconds), 0)::integer
  into today_settled
  from public.listening_sessions
  where user_id = auth.uid()
    and status = 'qualified'
    and qualified_at >= date_trunc('day', now());

  current_daily_remaining :=
    greatest(
      0,
      settings.daily_cap_minutes * 60 -
        today_settled -
        current_session.verified_seconds
    );

  if current_session.status <> 'active' then
    return query select false, 0, current_session.verified_seconds,
      current_daily_remaining, 'Listening session is no longer active.'::text;
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
  novel_seconds :=
    playback_position_seconds - current_session.max_position_seconds;

  if current_session.last_heartbeat_at is null then
    update public.listening_sessions
    set
      provider_duration_seconds = playback_duration_seconds,
      last_position_seconds = playback_position_seconds,
      max_position_seconds = greatest(max_position_seconds, playback_position_seconds),
      last_heartbeat_at = now(),
      updated_at = now()
    where id = target_session_id;

    return query select
      false,
      0,
      current_session.verified_seconds,
      current_daily_remaining,
      ''::text;
    return;
  end if;

  if elapsed_seconds < 5 then
    return query select
      false,
      0,
      current_session.verified_seconds,
      current_daily_remaining,
      'Heartbeat arrived too soon.'::text;
    return;
  end if;

  heartbeat_valid :=
    settings.enabled
    and current_session.telemetry_supported
    and current_daily_remaining > 0
    and playback_state = 'playing'
    and playback_muted is false
    and coalesce(playback_volume, 0) > 0
    and page_visible
    and page_focused
    and interaction_recent
    and playback_position_seconds >= 0
    and playback_duration_seconds between 15 and 7200
    and playback_position_seconds <= playback_duration_seconds + 5
    and elapsed_seconds between greatest(5, settings.heartbeat_interval_seconds - 5)
      and settings.heartbeat_interval_seconds + 20
    and forward_seconds between greatest(1, elapsed_seconds - 6)
      and elapsed_seconds + 6
    and novel_seconds > 0;

  if heartbeat_valid then
    countable_seconds := least(
      floor(elapsed_seconds)::integer,
      floor(forward_seconds)::integer,
      floor(novel_seconds)::integer,
      settings.heartbeat_interval_seconds + 5,
      current_daily_remaining
    );
  elsif current_daily_remaining = 0 then
    warning_message := 'You have reached today''s listening limit.';
  elsif not current_session.telemetry_supported then
    warning_message := 'This provider cannot verify reward-eligible playback.';
  elsif playback_state <> 'playing' then
    warning_message := 'Playback is not active.';
  elsif playback_muted or coalesce(playback_volume, 0) <= 0 then
    warning_message := 'Muted playback does not earn listening time.';
  elsif not page_visible or not page_focused then
    warning_message := 'Keep First Listen visible and active to earn time.';
  elsif not interaction_recent then
    warning_message := 'Interact with the session to continue earning time.';
  elsif novel_seconds <= 0 then
    warning_message := 'Replayed sections do not earn additional listening time.';
  else
    warning_message := 'Playback progress could not be verified.';
  end if;

  update public.listening_sessions
  set
    provider_duration_seconds = playback_duration_seconds,
    last_position_seconds = playback_position_seconds,
    max_position_seconds = greatest(max_position_seconds, playback_position_seconds),
    verified_seconds = verified_seconds + countable_seconds,
    rejected_heartbeats = rejected_heartbeats + case when heartbeat_valid then 0 else 1 end,
    loop_count = loop_count + case when forward_seconds < -3 then 1 else 0 end,
    last_heartbeat_at = now(),
    updated_at = now()
  where id = target_session_id
  returning verified_seconds into current_session.verified_seconds;

  return query
  select
    heartbeat_valid,
    countable_seconds,
    current_session.verified_seconds,
    greatest(0, current_daily_remaining - countable_seconds),
    warning_message;
end;
$$;

revoke all on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) to authenticated;
