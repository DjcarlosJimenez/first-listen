-- Playback earning progress by song.
-- This keeps replay listening enjoyable while preventing the same seconds from
-- adding unlimited Time Bank.

create table if not exists public.playback_earning_segments (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade,
  guest_session_id uuid references public.guest_sessions(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  source_listening_session_id uuid references public.listening_sessions(id) on delete set null,
  source_guest_listening_session_id uuid references public.guest_listening_sessions(id) on delete set null,
  start_second integer not null check (start_second >= 0),
  end_second integer not null check (end_second > start_second),
  seconds_earned integer not null check (seconds_earned > 0),
  created_at timestamptz not null default now(),
  constraint playback_earning_segments_one_listener check (
    (user_id is not null and guest_session_id is null)
    or (user_id is null and guest_session_id is not null)
  )
);

create index if not exists playback_earning_segments_user_song_idx
  on public.playback_earning_segments (user_id, song_id, start_second, end_second)
  where user_id is not null;

create index if not exists playback_earning_segments_guest_song_idx
  on public.playback_earning_segments (guest_session_id, song_id, start_second, end_second)
  where guest_session_id is not null;

alter table public.playback_earning_segments enable row level security;

revoke all on table public.playback_earning_segments
  from public, anon, authenticated;

drop function if exists public.record_playback_earning_segment(
  uuid, uuid, uuid, uuid, uuid, numeric, numeric, integer
);
create or replace function public.record_playback_earning_segment(
  p_listener_user_id uuid,
  p_listener_guest_session_id uuid,
  p_target_song_id uuid,
  p_source_listening_session_id uuid,
  p_source_guest_listening_session_id uuid,
  p_segment_start_seconds numeric,
  p_segment_end_seconds numeric,
  p_max_seconds_to_count integer
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_start_second integer := greatest(0, floor(coalesce(p_segment_start_seconds, 0))::integer);
  v_end_second integer := greatest(
    0,
    ceil(coalesce(p_segment_end_seconds, p_segment_start_seconds, 0))::integer
  );
  v_max_seconds integer := greatest(0, coalesce(p_max_seconds_to_count, 0));
  v_inserted_seconds integer := 0;
begin
  if p_target_song_id is null then
    raise exception 'Target song is required';
  end if;

  if (p_listener_user_id is null and p_listener_guest_session_id is null)
    or (p_listener_user_id is not null and p_listener_guest_session_id is not null)
  then
    raise exception 'Exactly one listener identity is required';
  end if;

  if v_max_seconds <= 0 or v_end_second <= v_start_second then
    return 0;
  end if;

  with candidate_seconds as (
    select generated.sec::integer as sec
    from generate_series(v_start_second, v_end_second - 1) as generated(sec)
    where not exists (
      select 1
      from public.playback_earning_segments as segment
      where segment.song_id = p_target_song_id
        and (
          (p_listener_user_id is not null and segment.user_id = p_listener_user_id)
          or (
            p_listener_guest_session_id is not null
            and segment.guest_session_id = p_listener_guest_session_id
          )
        )
        and generated.sec >= segment.start_second
        and generated.sec < segment.end_second
    )
    order by generated.sec
    limit v_max_seconds
  ),
  numbered as (
    select
      candidate_seconds.sec,
      candidate_seconds.sec
        - (row_number() over (order by candidate_seconds.sec))::integer as group_key
    from candidate_seconds
  ),
  ranges as (
    select
      min(numbered.sec)::integer as start_second,
      (max(numbered.sec) + 1)::integer as end_second,
      count(*)::integer as seconds_earned
    from numbered
    group by numbered.group_key
  ),
  inserted as (
    insert into public.playback_earning_segments (
      user_id,
      guest_session_id,
      song_id,
      source_listening_session_id,
      source_guest_listening_session_id,
      start_second,
      end_second,
      seconds_earned
    )
    select
      p_listener_user_id,
      p_listener_guest_session_id,
      p_target_song_id,
      p_source_listening_session_id,
      p_source_guest_listening_session_id,
      ranges.start_second,
      ranges.end_second,
      ranges.seconds_earned
    from ranges
    returning seconds_earned
  )
  select coalesce(sum(inserted.seconds_earned), 0)::integer
  into v_inserted_seconds
  from inserted;

  return v_inserted_seconds;
end;
$$;

drop function if exists public.get_playback_earning_status(uuid, numeric, uuid);
create or replace function public.get_playback_earning_status(
  p_target_song_id uuid,
  p_playback_duration_seconds numeric default null,
  p_guest_access_token uuid default null
)
returns table (
  song_id uuid,
  earned_seconds integer,
  remaining_seconds integer,
  duration_seconds integer,
  can_earn_more boolean,
  suggested_resume_seconds integer,
  replay_state text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_guest_session_id uuid := null;
  v_duration integer := 0;
  v_earned integer := 0;
  v_first_gap integer := null;
begin
  if p_target_song_id is null then
    raise exception 'Target song is required';
  end if;

  if v_user_id is null and p_guest_access_token is not null then
    v_guest_session_id := public.resolve_guest_session(p_guest_access_token);
  end if;

  select greatest(
    0,
    coalesce(
      ceil(nullif(p_playback_duration_seconds, 0))::integer,
      songs.observed_duration_seconds,
      songs.content_duration_seconds,
      0
    )
  )
  into v_duration
  from public.songs
  where songs.id = p_target_song_id;

  v_duration := coalesce(v_duration, 0);

  if v_user_id is not null or v_guest_session_id is not null then
    select coalesce(
      sum(
        case
          when v_duration > 0 then
            greatest(
              0,
              least(segment.end_second, v_duration)
                - greatest(segment.start_second, 0)
            )
          else segment.seconds_earned
        end
      ),
      0
    )::integer
    into v_earned
    from public.playback_earning_segments as segment
    where segment.song_id = p_target_song_id
      and (
        (v_user_id is not null and segment.user_id = v_user_id)
        or (v_guest_session_id is not null and segment.guest_session_id = v_guest_session_id)
      );
  end if;

  if v_duration > 0
    and (v_user_id is not null or v_guest_session_id is not null)
    and v_earned < v_duration
  then
    select seconds.sec::integer
    into v_first_gap
    from generate_series(0, v_duration - 1) as seconds(sec)
    where not exists (
      select 1
      from public.playback_earning_segments as segment
      where segment.song_id = p_target_song_id
        and (
          (v_user_id is not null and segment.user_id = v_user_id)
          or (
            v_guest_session_id is not null
            and segment.guest_session_id = v_guest_session_id
          )
        )
        and seconds.sec >= segment.start_second
        and seconds.sec < segment.end_second
    )
    order by seconds.sec
    limit 1;
  end if;

  return query select
    p_target_song_id,
    v_earned,
    case when v_duration > 0 then greatest(0, v_duration - v_earned) else 0 end,
    v_duration,
    case when v_duration > 0 then v_earned < v_duration else false end,
    v_first_gap,
    case
      when v_duration <= 0 and v_earned <= 0 then 'new'
      when v_earned <= 0 then 'new'
      when v_duration > 0 and v_earned >= v_duration then 'complete'
      else 'partial'
    end;
end;
$$;

drop function if exists public.get_playback_earning_opportunities(integer, uuid);
create or replace function public.get_playback_earning_opportunities(
  p_opportunity_limit integer default 8,
  p_guest_access_token uuid default null
)
returns table (
  song_id uuid,
  title text,
  artist_name text,
  cover_image_url text,
  platform text,
  earned_seconds integer,
  remaining_seconds integer,
  duration_seconds integer,
  suggested_resume_seconds integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_guest_session_id uuid := null;
begin
  if v_user_id is null and p_guest_access_token is not null then
    v_guest_session_id := public.resolve_guest_session(p_guest_access_token);
  end if;

  if v_user_id is null and v_guest_session_id is null then
    return;
  end if;

  return query
  with song_durations as (
    select
      songs.id,
      greatest(
        0,
        coalesce(
          songs.observed_duration_seconds,
          songs.content_duration_seconds,
          0
        )
      )::integer as duration_seconds
    from public.songs
    where songs.is_active is true
      and songs.archived_at is null
      and songs.removed_at is null
  ),
  progress as (
    select
      segment.song_id,
      coalesce(
        sum(
          greatest(
            0,
            least(segment.end_second, song_durations.duration_seconds)
              - greatest(segment.start_second, 0)
          )
        ),
        0
      )::integer as earned_seconds,
      song_durations.duration_seconds
    from public.playback_earning_segments as segment
    join song_durations on song_durations.id = segment.song_id
    where song_durations.duration_seconds > 0
      and (
        (v_user_id is not null and segment.user_id = v_user_id)
        or (
          v_guest_session_id is not null
          and segment.guest_session_id = v_guest_session_id
        )
      )
    group by segment.song_id, song_durations.duration_seconds
  )
  select
    songs.id,
    songs.title,
    songs.artist_name,
    songs.cover_image_url,
    songs.platform,
    progress.earned_seconds,
    greatest(0, progress.duration_seconds - progress.earned_seconds)::integer,
    progress.duration_seconds,
    first_gap.sec::integer
  from progress
  join public.songs on songs.id = progress.song_id
  left join lateral (
    select seconds.sec
    from generate_series(0, progress.duration_seconds - 1) as seconds(sec)
    where not exists (
      select 1
      from public.playback_earning_segments as segment
      where segment.song_id = progress.song_id
        and (
          (v_user_id is not null and segment.user_id = v_user_id)
          or (
            v_guest_session_id is not null
            and segment.guest_session_id = v_guest_session_id
          )
        )
        and seconds.sec >= segment.start_second
        and seconds.sec < segment.end_second
    )
    order by seconds.sec
    limit 1
  ) as first_gap on true
  where progress.earned_seconds > 0
    and progress.earned_seconds < progress.duration_seconds
  order by
    greatest(0, progress.duration_seconds - progress.earned_seconds) desc,
    songs.created_at desc
  limit greatest(1, least(25, coalesce(p_opportunity_limit, 8)));
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
  control_config jsonb;
  desktop_validation_mode text := 'playback_based';
  requires_visible boolean := false;
  requires_focus boolean := false;
  requires_interaction boolean := false;
  elapsed_seconds numeric;
  forward_seconds numeric;
  engagement_seconds integer := 0;
  countable_seconds integer := 0;
  unique_earning_seconds integer := 0;
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
  earning_segment_start integer := 0;
  earning_segment_end integer := 0;
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

  select public.ensure_priority39f_platform_config(state.published_config)
  into control_config
  from public.platform_control_state state
  where id = true;

  desktop_validation_mode := coalesce(
    control_config#>>'{listeningBank,validation,desktopValidationMode}',
    'playback_based'
  );
  if desktop_validation_mode not in ('strict', 'balanced', 'playback_based') then
    desktop_validation_mode := 'playback_based';
  end if;
  requires_visible := desktop_validation_mode in ('strict', 'balanced');
  requires_focus := desktop_validation_mode = 'strict';
  requires_interaction := desktop_validation_mode in ('strict', 'balanced');

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
      'Playback session is no longer active.'::text;
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
    and (not requires_visible or page_visible)
    and (not requires_focus or page_focused)
    and (not requires_interaction or interaction_recent)
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

  if countable_seconds > 0 then
    earning_segment_start := greatest(
      0,
      floor(playback_position_seconds - countable_seconds)::integer
    );
    earning_segment_end := greatest(
      earning_segment_start,
      ceil(playback_position_seconds)::integer
    );
    unique_earning_seconds := public.record_playback_earning_segment(
      auth.uid(),
      null,
      current_session.song_id,
      target_session_id,
      null,
      earning_segment_start,
      earning_segment_end,
      countable_seconds
    );
    banked_seconds := unique_earning_seconds;
  end if;

  if banked_seconds > 0 and active_listening_multiplier > 1 then
    banked_seconds := greatest(
      banked_seconds,
      floor(banked_seconds * active_listening_multiplier)::integer
    );
    event_bonus_seconds := greatest(0, banked_seconds - unique_earning_seconds);
  end if;

  if banked_seconds > 0 then
    warning_message := '';
  elsif engagement_valid and countable_seconds > 0 then
    rejection_reason_code := 'song_time_already_counted';
    rejection_reason_description := 'Song Time Already Counted';
    warning_message := 'This part of the song has already added Time Bank. Keep discovering to earn more.';
  elsif current_daily_remaining = 0 and engagement_valid then
    rejection_reason_code := 'daily_cap_reached';
    rejection_reason_description := 'Daily Cap Reached';
    warning_message := 'You have reached today''s play-time limit.';
  elsif not settings.enabled then
    rejection_reason_code := 'rewards_disabled';
    rejection_reason_description := 'Time Bank rewards are temporarily disabled.';
    warning_message := 'Time Bank rewards are temporarily disabled.';
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
    rejection_reason_description := 'Muted';
    warning_message := 'Muted playback does not earn play time.';
  elsif coalesce(playback_volume, 0) <= 0 then
    rejection_reason_code := 'volume_zero';
    rejection_reason_description := 'Volume Zero';
    warning_message := 'Volume set to zero does not earn play time.';
  elsif requires_visible and not page_visible then
    rejection_reason_code := 'window_not_visible';
    rejection_reason_description := 'Window Not Visible';
    warning_message := 'Playback must remain visible in the selected validation mode.';
  elsif requires_focus and not page_focused then
    rejection_reason_code := 'active_window_required';
    rejection_reason_description := 'Active Window Required';
    warning_message := 'Strict validation requires the First Listen window to stay active.';
  elsif requires_interaction and not interaction_recent then
    rejection_reason_code := 'insufficient_user_interaction';
    rejection_reason_description := 'Insufficient User Interaction';
    warning_message := 'Interact with the session to continue earning play time.';
  elsif playback_position_seconds < 0
    or playback_duration_seconds not between 15 and 43200
    or playback_position_seconds > playback_duration_seconds + 5
    or elapsed_seconds not between 1 and settings.heartbeat_interval_seconds + 20
    or forward_seconds > elapsed_seconds + 6
  then
    rejection_reason_code := 'playback_error';
    rejection_reason_description := 'Playback Error';
    warning_message := 'Playback telemetry could not be verified.';
  elsif forward_seconds < 0.25 then
    rejection_reason_code := 'playback_frozen';
    rejection_reason_description := 'Playback Frozen';
    warning_message := 'Playback is not progressing.';
  else
    rejection_reason_code := 'playback_error';
    rejection_reason_description := 'Playback Error';
    warning_message := 'Playback telemetry could not be verified.';
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
        'base_seconds', unique_earning_seconds,
        'attempted_seconds', countable_seconds,
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
      auth.uid(), 1, 'Valid play', 'listening_session',
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

drop function if exists public.record_guest_listening_heartbeat(
  uuid, uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
);
create or replace function public.record_guest_listening_heartbeat(
  guest_access_token uuid,
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
  active_guest_id uuid := public.resolve_guest_session(guest_access_token);
  current_session public.guest_listening_sessions%rowtype;
  control_config jsonb;
  desktop_validation_mode text := 'playback_based';
  requires_visible boolean := false;
  requires_focus boolean := false;
  requires_interaction boolean := false;
  elapsed_seconds numeric;
  forward_seconds numeric;
  counted_seconds integer := 0;
  raw_counted_seconds integer := 0;
  requirement_seconds integer;
  engagement_valid boolean := false;
  became_valid boolean := false;
  became_complete boolean := false;
  warning_message text := '';
  target_artist_id uuid;
  guest_name text;
  earning_segment_start integer := 0;
  earning_segment_end integer := 0;
begin
  if active_guest_id is null then raise exception 'Guest profile not found'; end if;

  select *
  into current_session
  from public.guest_listening_sessions
  where id = target_session_id
    and guest_session_id = active_guest_id
  for update;
  if current_session.id is null then raise exception 'Guest listening session not found'; end if;

  select public.ensure_priority39f_platform_config(state.published_config)
  into control_config
  from public.platform_control_state state
  where id = true;

  desktop_validation_mode := coalesce(
    control_config#>>'{listeningBank,validation,desktopValidationMode}',
    'playback_based'
  );
  if desktop_validation_mode not in ('strict', 'balanced', 'playback_based') then
    desktop_validation_mode := 'playback_based';
  end if;
  requires_visible := desktop_validation_mode in ('strict', 'balanced');
  requires_focus := desktop_validation_mode = 'strict';
  requires_interaction := desktop_validation_mode in ('strict', 'balanced');

  requirement_seconds := case
    when playback_duration_seconds between 15 and 43200
      then least(120, greatest(30, ceil(playback_duration_seconds * 0.25)::integer))
    else current_session.valid_requirement_seconds
  end;

  if current_session.status <> 'active' then
    return query select
      false, 0, current_session.verified_seconds,
      current_session.valid_listen_at is not null,
      current_session.complete_listen_at is not null,
      requirement_seconds,
      'Playback session is no longer active.'::text;
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

  engagement_valid :=
    current_session.telemetry_supported
    and playback_state in ('playing', 'ended')
    and playback_muted is false
    and coalesce(playback_volume, 0) > 0
    and (not requires_visible or page_visible)
    and (not requires_focus or page_focused)
    and (not requires_interaction or interaction_recent)
    and playback_position_seconds >= 0
    and playback_duration_seconds between 15 and 43200
    and playback_position_seconds <= playback_duration_seconds + 5
    and elapsed_seconds between 1 and 32
    and forward_seconds between 0.25 and elapsed_seconds + 6;

  if engagement_valid then
    raw_counted_seconds := greatest(
      0,
      least(
        floor(elapsed_seconds)::integer,
        floor(forward_seconds)::integer,
        15
      )
    );

    if raw_counted_seconds > 0 then
      earning_segment_start := greatest(
        0,
        floor(playback_position_seconds - raw_counted_seconds)::integer
      );
      earning_segment_end := greatest(
        earning_segment_start,
        ceil(playback_position_seconds)::integer
      );
      counted_seconds := public.record_playback_earning_segment(
        null,
        active_guest_id,
        current_session.song_id,
        null,
        target_session_id,
        earning_segment_start,
        earning_segment_end,
        raw_counted_seconds
      );
    end if;
  elsif not current_session.telemetry_supported then
    warning_message := 'This provider does not expose verifiable playback.';
  elsif playback_state not in ('playing', 'ended') then
    warning_message := 'Playback is not active.';
  elsif playback_muted then
    warning_message := 'Muted playback is not counted.';
  elsif coalesce(playback_volume, 0) <= 0 then
    warning_message := 'Volume set to zero is not counted.';
  elsif requires_visible and not page_visible then
    warning_message := 'Playback must remain visible in the selected validation mode.';
  elsif requires_focus and not page_focused then
    warning_message := 'Strict validation requires the First Listen window to stay active.';
  elsif requires_interaction and not interaction_recent then
    warning_message := 'Interact with the session to continue.';
  elsif forward_seconds < 0.25 then
    warning_message := 'Playback is not progressing.';
  else
    warning_message := 'Playback telemetry could not be verified.';
  end if;

  if engagement_valid and raw_counted_seconds > 0 and counted_seconds = 0 then
    warning_message := 'This part of the song has already been counted.';
  end if;

  update public.guest_listening_sessions
  set
    verified_seconds = verified_seconds + counted_seconds,
    provider_duration_seconds = playback_duration_seconds,
    valid_requirement_seconds = requirement_seconds,
    last_position_seconds = playback_position_seconds,
    max_position_seconds = greatest(max_position_seconds, playback_position_seconds),
    last_heartbeat_at = now(),
    updated_at = now()
  where id = target_session_id
  returning * into current_session;

  if current_session.valid_listen_at is null
    and current_session.verified_seconds >= requirement_seconds
    and not exists (
      select 1
      from public.guest_listening_sessions as recent
      where recent.guest_session_id = active_guest_id
        and recent.song_id = current_session.song_id
        and recent.id <> current_session.id
        and recent.valid_listen_at >= now() - interval '24 hours'
    )
  then
    update public.guest_listening_sessions
    set valid_listen_at = now(), updated_at = now()
    where id = target_session_id;

    update public.guest_sessions
    set valid_listens = valid_listens + 1, last_seen_at = now()
    where id = active_guest_id;

    select songs.user_id
    into target_artist_id
    from public.songs
    where songs.id = current_session.song_id;

    select nickname into guest_name
    from public.guest_sessions
    where id = active_guest_id;

    insert into public.community_notifications (
      recipient_id,
      actor_id,
      actor_display_name,
      song_id,
      event_type,
      actor_visibility,
      source_id
    )
    values (
      target_artist_id,
      null,
      guest_name,
      current_session.song_id,
      'valid_listen',
      'public',
      current_session.id
    )
    on conflict do nothing;

    became_valid := true;
  end if;

  if current_session.complete_listen_at is null
    and playback_duration_seconds between 15 and 43200
    and current_session.verified_seconds >= ceil(playback_duration_seconds * 0.90)
  then
    update public.guest_listening_sessions
    set complete_listen_at = now(), updated_at = now()
    where id = target_session_id;
    became_complete := true;
  end if;

  return query select
    counted_seconds > 0,
    counted_seconds,
    current_session.verified_seconds,
    became_valid or current_session.valid_listen_at is not null,
    became_complete or current_session.complete_listen_at is not null,
    requirement_seconds,
    warning_message;
end;
$$;

revoke all on function public.record_playback_earning_segment(
  uuid, uuid, uuid, uuid, uuid, numeric, numeric, integer
) from public, anon, authenticated;
revoke all on function public.get_playback_earning_status(uuid, numeric, uuid)
  from public;
revoke all on function public.get_playback_earning_opportunities(integer, uuid)
  from public;
revoke all on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) from public, anon;
revoke all on function public.record_guest_listening_heartbeat(
  uuid, uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) from public, anon;

grant execute on function public.get_playback_earning_status(uuid, numeric, uuid)
  to anon, authenticated;
grant execute on function public.get_playback_earning_opportunities(integer, uuid)
  to anon, authenticated;
grant execute on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) to authenticated;
grant execute on function public.record_guest_listening_heartbeat(
  uuid, uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) to authenticated, anon;

comment on table public.playback_earning_segments
  is 'Per-listener playback coverage used to prevent repeated song seconds from earning unlimited Time Bank.';
comment on function public.get_playback_earning_status(uuid, numeric, uuid)
  is 'Returns how much earnable playback time remains for a listener on a song.';
comment on function public.get_playback_earning_opportunities(integer, uuid)
  is 'Returns songs where the listener has partially earned playback time and can still earn more.';
