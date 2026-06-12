-- Priority 39F
-- Make desktop listening validation fairer and update Time Bank controls.

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
    'validation', jsonb_build_object(
      'desktopValidationMode', 'playback_based'
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

create or replace function public.ensure_priority39f_platform_config(target_config jsonb)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  with base as (
    select public.ensure_priority39e1_platform_config(
      coalesce(target_config, '{}'::jsonb)
    ) as config
  ),
  normalized as (
    select
      config,
      case
        when config#>>'{listeningBank,validation,desktopValidationMode}'
          in ('strict', 'balanced', 'playback_based')
        then config#>>'{listeningBank,validation,desktopValidationMode}'
        else 'playback_based'
      end as desktop_mode
    from base
  )
  select jsonb_set(
    config,
    '{listeningBank,validation}',
    jsonb_build_object('desktopValidationMode', desktop_mode),
    true
  )
  from normalized;
$$;

update public.platform_control_state
set
  draft_config = public.ensure_priority39f_platform_config(draft_config),
  published_config = public.ensure_priority39f_platform_config(published_config),
  stable_config = public.ensure_priority39f_platform_config(stable_config),
  updated_at = now()
where id = true;

update public.listening_sessions
set
  last_rejection_reason_code = 'legacy_focus_rule',
  last_rejection_reason_description = 'Legacy desktop focus rule no longer used.'
where last_rejection_reason_code = 'tab_not_focused';

update public.listening_sessions
set
  last_rejection_reason_code = 'window_not_visible',
  last_rejection_reason_description = 'Window Not Visible'
where last_rejection_reason_code = 'tab_not_visible';

update public.listening_bank_activity_log
set
  title = case
    when title = 'Listening Time Rejected' then 'Playback Time Rejected'
    when title = 'Listening Session Approved' then 'Playback Session Approved'
    else title
  end,
  details = case
    when details->>'reason_code' = 'tab_not_focused'
      then details || jsonb_build_object(
        'reason_code', 'legacy_focus_rule',
        'reason_description', 'Legacy desktop focus rule no longer used.'
      )
    when details->>'reason_code' = 'tab_not_visible'
      then details || jsonb_build_object(
        'reason_code', 'window_not_visible',
        'reason_description', 'Window Not Visible'
      )
    else details
  end
where title in ('Listening Time Rejected', 'Listening Session Approved')
  or details->>'reason_code' in ('tab_not_focused', 'tab_not_visible');

update public.listening_bank_activity_log_archive
set
  title = case
    when title = 'Listening Time Rejected' then 'Playback Time Rejected'
    when title = 'Listening Session Approved' then 'Playback Session Approved'
    else title
  end,
  details = case
    when details->>'reason_code' = 'tab_not_focused'
      then details || jsonb_build_object(
        'reason_code', 'legacy_focus_rule',
        'reason_description', 'Legacy desktop focus rule no longer used.'
      )
    when details->>'reason_code' = 'tab_not_visible'
      then details || jsonb_build_object(
        'reason_code', 'window_not_visible',
        'reason_description', 'Window Not Visible'
      )
    else details
  end
where title in ('Listening Time Rejected', 'Listening Session Approved')
  or details->>'reason_code' in ('tab_not_focused', 'tab_not_visible');

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
      'playback_minutes_approved',
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
      'playback_time_rejected',
      'rejected',
      0,
      0,
      'Playback Time Rejected',
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
      'playback_session_approved',
      'approved',
      new.settled_seconds,
      0,
      'Playback Session Approved',
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
  control_config jsonb;
  desktop_validation_mode text := 'playback_based';
  requires_visible boolean := false;
  requires_focus boolean := false;
  requires_interaction boolean := false;
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
  requirement_seconds integer;
  engagement_valid boolean := false;
  became_valid boolean := false;
  became_complete boolean := false;
  warning_message text := '';
  target_artist_id uuid;
  guest_name text;
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
    counted_seconds := greatest(
      0,
      least(
        floor(elapsed_seconds)::integer,
        floor(forward_seconds)::integer,
        15
      )
    );
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

revoke all on function public.ensure_priority39f_platform_config(jsonb)
  from public, anon, authenticated;
revoke all on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) from public, anon;
revoke all on function public.record_guest_listening_heartbeat(
  uuid, uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) from public, anon;

grant execute on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) to authenticated;
grant execute on function public.record_guest_listening_heartbeat(
  uuid, uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) to authenticated, anon;
