-- Priority 39B: Listening Bank auditability, diagnostics, tests, events,
-- and Owner-level module controls.

create table if not exists public.listening_bank_activity_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade,
  listening_session_id uuid references public.listening_sessions(id) on delete set null,
  reward_claim_id uuid references public.listening_reward_claims(id) on delete set null,
  event_key text not null,
  event_type text not null,
  status text not null default 'info'
    check (status in ('approved', 'pending', 'rejected', 'reward', 'bonus', 'test', 'info')),
  amount_seconds integer not null default 0,
  token_amount integer not null default 0,
  title text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists listening_bank_activity_user_idx
  on public.listening_bank_activity_log (user_id, created_at desc);
create index if not exists listening_bank_activity_event_idx
  on public.listening_bank_activity_log (event_type, created_at desc);

alter table public.listening_bank_activity_log enable row level security;

revoke all on table public.listening_bank_activity_log from public, anon, authenticated;
grant select on table public.listening_bank_activity_log to authenticated;

drop policy if exists "users read own listening bank activity or staff reads all"
  on public.listening_bank_activity_log;
create policy "users read own listening bank activity or staff reads all"
  on public.listening_bank_activity_log
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
      'activityLogLimit', 50
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
        'position', 5,
        'column', 'right',
        'size', 'standard'
      ),
      'mobile', jsonb_build_object(
        'visibility', 'visible',
        'position', 5,
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

create or replace function public.ensure_priority39b_platform_config(target_config jsonb)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_set(
    jsonb_set(
      case
        when target_config ? 'listeningBank' then target_config
        else jsonb_set(
          target_config,
          '{listeningBank}',
          public.default_listening_bank_control_config(),
          true
        )
      end,
      '{listeningBank,rewards,minutesPerToken}',
      to_jsonb(greatest(
        15,
        least(
          1440,
          coalesce(
            (target_config#>>'{listeningBank,rewards,minutesPerToken}')::integer,
            (target_config#>>'{tokens,minutesPerToken}')::integer,
            120
          )
        )
      )),
      true
    ),
    '{listeningBank,rewards,dailyCapMinutes}',
    to_jsonb(greatest(
      30,
      least(
        1440,
        coalesce(
          (target_config#>>'{listeningBank,rewards,dailyCapMinutes}')::integer,
          (target_config#>>'{tokens,dailyListeningLimit}')::integer,
          180
        )
      )
    )),
    true
  );
$$;

create or replace function public.validate_listening_bank_config(target_config jsonb)
returns void
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  bank_config jsonb := target_config->'listeningBank';
  event_item jsonb;
  event_start timestamptz;
  event_end timestamptz;
  device_key text;
  module_visibility text;
begin
  if bank_config is null then
    return;
  end if;
  if jsonb_typeof(bank_config) <> 'object' then
    raise exception 'Listening Bank configuration must be an object.';
  end if;
  if coalesce((bank_config#>>'{diagnostics,activityLogLimit}')::integer, 0)
    not between 10 and 500
  then
    raise exception 'Listening Bank activity log limit must be between 10 and 500.';
  end if;
  if coalesce((bank_config#>>'{rewards,minutesPerToken}')::integer, 0)
    not between 15 and 1440
  then
    raise exception 'Listening Bank minutes per token is outside allowed limits.';
  end if;
  if coalesce((bank_config#>>'{rewards,dailyCapMinutes}')::integer, 0)
    not between 30 and 1440
  then
    raise exception 'Listening Bank daily cap is outside allowed limits.';
  end if;

  foreach device_key in array array['desktop', 'mobile'] loop
    module_visibility := coalesce(
      bank_config#>>array['module', device_key, 'visibility'],
      ''
    );
    if module_visibility not in ('visible', 'hidden', 'desktop_only', 'mobile_only') then
      raise exception 'Listening Bank % visibility is invalid.', device_key;
    end if;
    if coalesce((bank_config#>>array['module', device_key, 'position'])::integer, 0)
      not between 1 and 50
    then
      raise exception 'Listening Bank % position is invalid.', device_key;
    end if;
    if coalesce(bank_config#>>array['module', device_key, 'column'], '')
      not in ('left', 'right', 'full_width')
    then
      raise exception 'Listening Bank % column is invalid.', device_key;
    end if;
    if coalesce(bank_config#>>array['module', device_key, 'size'], '')
      not in ('compact', 'standard', 'expanded', 'custom')
    then
      raise exception 'Listening Bank % size is invalid.', device_key;
    end if;
  end loop;

  if jsonb_typeof(bank_config->'events') <> 'array'
    or jsonb_array_length(bank_config->'events') > 25
  then
    raise exception 'Listening Bank events must be an array with at most 25 entries.';
  end if;

  for event_item in
    select item from jsonb_array_elements(bank_config->'events') as events(item)
  loop
    if char_length(coalesce(event_item->>'name', '')) not between 3 and 120 then
      raise exception 'Listening event name is invalid.';
    end if;
    event_start := nullif(event_item->>'startsAt', '')::timestamptz;
    event_end := nullif(event_item->>'endsAt', '')::timestamptz;
    if event_start is not null and event_end is not null and event_end <= event_start then
      raise exception 'Listening event end date must be after start date.';
    end if;
    if coalesce((event_item->>'bonusMinutes')::integer, 0) not between 0 and 1440 then
      raise exception 'Listening event bonus minutes are outside allowed limits.';
    end if;
    if coalesce((event_item->>'bonusThresholdMinutes')::integer, 0) not between 0 and 1440 then
      raise exception 'Listening event threshold minutes are outside allowed limits.';
    end if;
    if coalesce((event_item->>'listeningMultiplier')::numeric, 1) not between 1 and 10 then
      raise exception 'Listening event listening multiplier is outside allowed limits.';
    end if;
    if coalesce((event_item->>'tokenMultiplier')::numeric, 1) not between 1 and 10 then
      raise exception 'Listening event token multiplier is outside allowed limits.';
    end if;
    if coalesce((event_item->>'missionMultiplier')::numeric, 1) not between 1 and 10 then
      raise exception 'Listening event mission multiplier is outside allowed limits.';
    end if;
  end loop;
end;
$$;

create or replace function public.sync_listening_bank_reward_config(target_config jsonb)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
    when target_config ? 'listeningBank' then
      jsonb_set(
        jsonb_set(
          target_config,
          '{tokens,minutesPerToken}',
          to_jsonb((target_config#>>'{listeningBank,rewards,minutesPerToken}')::integer),
          true
        ),
        '{tokens,dailyListeningLimit}',
        to_jsonb((target_config#>>'{listeningBank,rewards,dailyCapMinutes}')::integer),
        true
      )
    else target_config
  end;
$$;

create or replace function public.current_listening_event_bonus()
returns table (
  event_id text,
  event_name text,
  listening_multiplier numeric,
  token_multiplier numeric,
  bonus_minutes integer,
  mission_multiplier numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with config as (
    select public.ensure_priority39b_platform_config(state.published_config) as value
    from public.platform_control_state state
    where state.id = true
  ),
  events as (
    select event_item
    from config,
      jsonb_array_elements(coalesce(config.value#>'{listeningBank,events}', '[]'::jsonb))
      as items(event_item)
    where coalesce((event_item->>'enabled')::boolean, false)
      and not coalesce((event_item->>'preview')::boolean, false)
      and (
        nullif(event_item->>'startsAt', '') is null
        or (event_item->>'startsAt')::timestamptz <= now()
      )
      and (
        nullif(event_item->>'endsAt', '') is null
        or (event_item->>'endsAt')::timestamptz > now()
      )
  )
  select
    coalesce(event_item->>'id', 'active-event') as event_id,
    coalesce(event_item->>'name', 'Listening Event') as event_name,
    case
      when coalesce((event_item#>>'{rewardTypes,listeningMultiplier}')::boolean, false)
      then greatest(1, least(10, coalesce((event_item->>'listeningMultiplier')::numeric, 1)))
      else 1
    end as listening_multiplier,
    case
      when coalesce((event_item#>>'{rewardTypes,tokenMultiplier}')::boolean, false)
      then greatest(1, least(10, coalesce((event_item->>'tokenMultiplier')::numeric, 1)))
      else 1
    end as token_multiplier,
    case
      when coalesce((event_item#>>'{rewardTypes,extraListeningMinutes}')::boolean, false)
      then greatest(0, least(1440, coalesce((event_item->>'bonusMinutes')::integer, 0)))
      else 0
    end as bonus_minutes,
    case
      when coalesce((event_item#>>'{rewardTypes,missionMultiplier}')::boolean, false)
      then greatest(1, least(10, coalesce((event_item->>'missionMultiplier')::numeric, 1)))
      else 1
    end as mission_multiplier
  from events
  order by
    case
      when coalesce((event_item#>>'{rewardTypes,listeningMultiplier}')::boolean, false)
      then coalesce((event_item->>'listeningMultiplier')::numeric, 1)
      else 1
    end desc,
    case
      when coalesce((event_item#>>'{rewardTypes,tokenMultiplier}')::boolean, false)
      then coalesce((event_item->>'tokenMultiplier')::numeric, 1)
      else 1
    end desc
  limit 1;
$$;

create or replace function public.log_listening_bank_activity(
  target_user_id uuid,
  target_session_id uuid,
  target_claim_id uuid,
  activity_event_key text,
  activity_event_type text,
  activity_status text,
  activity_amount_seconds integer,
  activity_token_amount integer,
  activity_title text,
  activity_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.listening_bank_activity_log (
    user_id,
    listening_session_id,
    reward_claim_id,
    event_key,
    event_type,
    status,
    amount_seconds,
    token_amount,
    title,
    details
  )
  values (
    target_user_id,
    target_session_id,
    target_claim_id,
    left(coalesce(activity_event_key, 'listening_bank_event'), 120),
    left(coalesce(activity_event_type, 'info'), 80),
    coalesce(activity_status, 'info'),
    coalesce(activity_amount_seconds, 0),
    coalesce(activity_token_amount, 0),
    left(coalesce(activity_title, 'Listening Bank updated'), 200),
    coalesce(activity_details, '{}'::jsonb)
  );
end;
$$;

create or replace function public.log_listening_session_activity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  approved_delta integer;
  rejected_delta integer;
begin
  approved_delta := greatest(0, new.settled_seconds - old.settled_seconds);
  rejected_delta := greatest(0, new.rejected_heartbeats - old.rejected_heartbeats);

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

drop trigger if exists log_listening_session_activity_trigger
  on public.listening_sessions;
create trigger log_listening_session_activity_trigger
after update on public.listening_sessions
for each row
execute function public.log_listening_session_activity();

create or replace function public.log_listening_reward_claim_activity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.log_listening_bank_activity(
    new.user_id,
    null,
    new.id,
    'token_awarded',
    'listening_reward_claimed',
    'reward',
    -(new.minutes_spent * 60),
    new.credits_awarded,
    '+' || new.credits_awarded || ' Token Awarded',
    jsonb_build_object(
      'minutes_spent', new.minutes_spent,
      'exchange_rate_minutes', new.exchange_rate_minutes
    )
  );
  return new;
end;
$$;

drop trigger if exists log_listening_reward_claim_activity_trigger
  on public.listening_reward_claims;
create trigger log_listening_reward_claim_activity_trigger
after insert on public.listening_reward_claims
for each row
execute function public.log_listening_reward_claim_activity();

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

  if current_daily_remaining = 0 and engagement_valid then
    warning_message := 'You have reached today''s listening limit.';
  elsif not current_session.telemetry_supported then
    warning_message := 'This provider cannot verify reward-eligible playback.';
  elsif playback_state not in ('playing', 'ended') then
    warning_message := 'Playback is not active.';
  elsif playback_muted or coalesce(playback_volume, 0) <= 0 then
    warning_message := 'Muted playback does not earn listening time.';
  elsif not page_visible or not page_focused then
    warning_message := 'Keep First Listen visible and active to earn time.';
  elsif not interaction_recent then
    warning_message := 'Interact with the session to continue earning time.';
  elsif not engagement_valid then
    warning_message := 'Playback progress could not be verified.';
  end if;

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
      case when engagement_valid then 0 else 1 end,
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

create or replace function public.claim_listening_reward()
returns table (
  credits_awarded integer,
  credits_balance integer,
  bank_seconds bigint,
  available_reward_credits integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  settings public.listening_reward_settings%rowtype;
  exchange_seconds integer;
  updated_credits integer;
  updated_bank bigint;
  award_credits integer := 1;
  active_event_id text := null;
  active_event_name text := null;
  active_token_multiplier numeric := 1;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select *
  into settings
  from public.listening_reward_settings
  where id = true;
  if not settings.enabled then raise exception 'Listening rewards are currently paused'; end if;

  select event_id, event_name, token_multiplier
  into active_event_id, active_event_name, active_token_multiplier
  from public.current_listening_event_bonus()
  limit 1;

  if active_token_multiplier > 1 then
    award_credits := greatest(1, floor(active_token_multiplier)::integer);
  end if;

  exchange_seconds := settings.minutes_per_credit * 60;

  update public.profiles
  set
    listening_bank_seconds = listening_bank_seconds - exchange_seconds,
    credits = credits + award_credits,
    listening_reward_credits_earned = listening_reward_credits_earned + award_credits,
    total_review_credits_earned = total_review_credits_earned + award_credits,
    updated_at = now()
  where id = auth.uid()
    and account_status = 'active'
    and listening_bank_seconds >= exchange_seconds
  returning profiles.credits, profiles.listening_bank_seconds
  into updated_credits, updated_bank;

  if not found then
    raise exception 'Not enough listening minutes are available';
  end if;

  insert into public.listening_reward_claims (
    user_id,
    minutes_spent,
    credits_awarded,
    exchange_rate_minutes
  )
  values (auth.uid(), settings.minutes_per_credit, award_credits, settings.minutes_per_credit);

  insert into public.credit_transactions (user_id, amount, reason)
  values (auth.uid(), award_credits, 'Listening Bank reward');

  if award_credits > 1 then
    perform public.log_listening_bank_activity(
      auth.uid(),
      null,
      null,
      'event_token_multiplier',
      'listening_event_bonus',
      'bonus',
      0,
      award_credits - 1,
      'Bonus Event Applied',
      jsonb_build_object(
        'event_id', active_event_id,
        'event_name', active_event_name,
        'token_multiplier', active_token_multiplier,
        'bonus_tokens', award_credits - 1
      )
    );
  end if;

  return query select
    award_credits,
    updated_credits,
    updated_bank,
    floor(updated_bank::numeric / exchange_seconds)::integer;
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
  today_average_completion_rate numeric
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
    periods.today_average_completion_rate
  from profile
  cross join settings
  cross join periods
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

create or replace function public.admin_run_listening_bank_test(test_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  profile_row public.profiles%rowtype;
  settings public.listening_reward_settings%rowtype;
  active_event_name text := null;
  active_listening_multiplier numeric := 1;
  active_token_multiplier numeric := 1;
  simulated_seconds integer := 0;
  before_bank bigint;
  after_bank bigint;
  before_tokens integer;
  after_tokens integer;
  credits_awarded integer := 0;
  exchange_seconds integer;
begin
  if not public.can_manage_platform_control() then
    raise exception 'Super Admin access required.';
  end if;

  select * into profile_row
  from public.profiles
  where id = auth.uid();

  select * into settings
  from public.listening_reward_settings
  where id = true;

  select event_name, listening_multiplier, token_multiplier
  into active_event_name, active_listening_multiplier, active_token_multiplier
  from public.current_listening_event_bonus()
  limit 1;

  before_bank := coalesce(profile_row.listening_bank_seconds, 0);
  before_tokens := coalesce(profile_row.credits, 0);
  exchange_seconds := settings.minutes_per_credit * 60;

  simulated_seconds := case test_key
    when 'simulate_5_minutes' then 5 * 60
    when 'simulate_10_minutes' then 10 * 60
    when 'simulate_30_minutes' then 30 * 60
    when 'simulate_60_minutes' then 60 * 60
    when 'simulate_approval_event' then 10 * 60
    else 0
  end;

  if simulated_seconds > 0 and active_listening_multiplier > 1 then
    simulated_seconds := floor(simulated_seconds * active_listening_multiplier)::integer;
  end if;

  after_bank := before_bank + simulated_seconds;
  after_tokens := before_tokens;

  if test_key in ('simulate_reward_event', 'simulate_token_award') then
    credits_awarded := greatest(1, floor(active_token_multiplier)::integer);
    if test_key = 'simulate_reward_event' then
      after_bank := greatest(0, before_bank - exchange_seconds);
    else
      after_bank := before_bank;
    end if;
    after_tokens := before_tokens + credits_awarded;
  end if;

  return jsonb_build_object(
    'test_key', test_key,
    'rollback_safe', true,
    'permanent_changes', false,
    'before', jsonb_build_object(
      'bank_seconds', before_bank,
      'tokens', before_tokens
    ),
    'after', jsonb_build_object(
      'bank_seconds', after_bank,
      'tokens', after_tokens
    ),
    'expected', jsonb_build_object(
      'seconds_delta', after_bank - before_bank,
      'tokens_delta', after_tokens - before_tokens,
      'active_event', coalesce(active_event_name, 'None'),
      'listening_multiplier', active_listening_multiplier,
      'token_multiplier', active_token_multiplier
    )
  );
end;
$$;

update public.platform_control_state
set
  draft_config = public.sync_listening_bank_reward_config(
    public.ensure_priority39b_platform_config(
      public.ensure_priority39_platform_config(draft_config)
    )
  ),
  published_config = public.sync_listening_bank_reward_config(
    public.ensure_priority39b_platform_config(
      public.ensure_priority39_platform_config(published_config)
    )
  ),
  stable_config = public.sync_listening_bank_reward_config(
    public.ensure_priority39b_platform_config(
      public.ensure_priority39_platform_config(stable_config)
    )
  ),
  updated_at = now()
where id = true;

create or replace function public.admin_update_control_draft(
  section_key text,
  section_value jsonb,
  change_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  previous_config jsonb;
  next_config jsonb;
begin
  if not public.can_manage_platform_control() then
    raise exception 'Super Admin access required.';
  end if;

  if section_key not in (
    'theme', 'homepage', 'ui', 'discovery', 'spotlight', 'artistProfile',
    'membership', 'listeningBank', 'tokens', 'permissions', 'experiments',
    'announcements'
  ) then
    raise exception 'Unsupported configuration section.';
  end if;

  if section_key in ('permissions', 'experiments')
    and not public.is_founder_controller()
  then
    raise exception 'Founder controller access required.';
  end if;

  select draft_config into previous_config
  from public.platform_control_state
  where id = true
  for update;

  next_config := jsonb_set(previous_config, array[section_key], section_value, true);
  next_config := public.sync_listening_bank_reward_config(
    public.ensure_priority39b_platform_config(
      public.ensure_priority39_platform_config(next_config)
    )
  );

  perform public.validate_platform_control_config(next_config);
  perform public.validate_listening_bank_config(next_config);

  update public.platform_control_state
  set
    draft_config = next_config,
    draft_revision = draft_revision + 1,
    has_unpublished_changes = next_config is distinct from published_config,
    updated_by = auth.uid(),
    updated_at = now()
  where id = true;

  insert into public.admin_audit_log (
    actor_id, action, target_type, details
  )
  values (
    auth.uid(),
    'platform_control_draft_updated',
    'platform_control_state',
    jsonb_build_object(
      'section', section_key,
      'description', left(coalesce(change_description, ''), 500)
    )
  );

  return public.admin_get_control_center();
end;
$$;

create or replace function public.admin_replace_control_draft(
  target_config jsonb,
  change_description text default 'Imported configuration'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  repaired_config jsonb;
begin
  if not public.is_founder_controller() then
    raise exception 'Founder controller access required.';
  end if;

  repaired_config := public.sync_listening_bank_reward_config(
    public.ensure_priority39b_platform_config(
      public.ensure_priority39_platform_config(target_config)
    )
  );
  perform public.validate_platform_control_config(repaired_config);
  perform public.validate_listening_bank_config(repaired_config);

  update public.platform_control_state
  set
    draft_config = repaired_config,
    draft_revision = draft_revision + 1,
    has_unpublished_changes = repaired_config is distinct from published_config,
    updated_by = auth.uid(),
    updated_at = now()
  where id = true;

  insert into public.admin_audit_log (
    actor_id, action, target_type, details
  )
  values (
    auth.uid(), 'platform_control_draft_imported', 'platform_control_state',
    jsonb_build_object(
      'description', left(coalesce(change_description, ''), 500),
      'priority39b_listening_bank_repaired', true
    )
  );

  return public.admin_get_control_center();
end;
$$;

create or replace function public.admin_restore_control_snapshot(
  snapshot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  snapshot_config jsonb;
begin
  if not public.can_manage_platform_control() then
    raise exception 'Super Admin access required.';
  end if;

  select config into snapshot_config
  from public.platform_configuration_snapshots snapshot
  where snapshot.id = snapshot_id;
  if snapshot_config is null then
    raise exception 'Configuration snapshot was not found.';
  end if;

  snapshot_config := public.sync_listening_bank_reward_config(
    public.ensure_priority39b_platform_config(
      public.ensure_priority39_platform_config(snapshot_config)
    )
  );
  perform public.validate_platform_control_config(snapshot_config);
  perform public.validate_listening_bank_config(snapshot_config);

  update public.platform_control_state
  set
    draft_config = snapshot_config,
    draft_revision = draft_revision + 1,
    has_unpublished_changes = snapshot_config is distinct from published_config,
    updated_by = auth.uid(),
    updated_at = now()
  where id = true;

  insert into public.admin_audit_log (
    actor_id, action, target_type, target_id, details
  )
  values (
    auth.uid(), 'platform_control_snapshot_restored',
    'platform_configuration_snapshot', snapshot_id,
    jsonb_build_object(
      'restored_to', 'draft',
      'priority39b_listening_bank_repaired', true
    )
  );

  return public.admin_get_control_center();
end;
$$;

create or replace function public.admin_publish_control_draft(
  change_description text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  state public.platform_control_state%rowtype;
  next_config jsonb;
begin
  if not public.can_manage_platform_control() then
    raise exception 'Super Admin access required.';
  end if;

  select * into state
  from public.platform_control_state
  where id = true
  for update;

  next_config := public.sync_listening_bank_reward_config(
    public.ensure_priority39b_platform_config(
      public.ensure_priority39_platform_config(state.draft_config)
    )
  );
  perform public.validate_platform_control_config(next_config);
  perform public.validate_listening_bank_config(next_config);

  insert into public.platform_configuration_snapshots (
    name, description, snapshot_kind, config, source_version, created_by
  )
  values (
    'Automatic backup before version ' || (state.published_version + 1),
    left(coalesce(change_description, ''), 1000),
    'automatic',
    state.published_config,
    state.published_version,
    auth.uid()
  );

  perform public.apply_platform_control_config(next_config);

  update public.platform_control_state
  set
    stable_config = published_config,
    draft_config = next_config,
    published_config = next_config,
    published_version = published_version + 1,
    has_unpublished_changes = false,
    published_by = auth.uid(),
    updated_by = auth.uid(),
    published_at = now(),
    updated_at = now()
  where id = true;

  insert into public.admin_audit_log (
    actor_id, action, target_type, details
  )
  values (
    auth.uid(), 'platform_control_published', 'platform_control_state',
    jsonb_build_object(
      'from_version', state.published_version,
      'to_version', state.published_version + 1,
      'description', left(coalesce(change_description, ''), 500),
      'priority39b_listening_bank_repaired', true
    )
  );

  return public.admin_get_control_center();
end;
$$;

create or replace function public.admin_get_control_center()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  result jsonb;
begin
  if not public.can_manage_platform_control() then
    raise exception 'Super Admin access required.';
  end if;

  select jsonb_build_object(
    'state', jsonb_build_object(
      'published_config', public.ensure_priority39b_platform_config(state.published_config),
      'draft_config', public.ensure_priority39b_platform_config(state.draft_config),
      'stable_config', public.ensure_priority39b_platform_config(state.stable_config),
      'published_version', state.published_version,
      'draft_revision', state.draft_revision,
      'has_unpublished_changes', state.has_unpublished_changes,
      'updated_at', state.updated_at,
      'published_at', state.published_at
    ),
    'founder_controller', public.is_founder_controller(),
    'preview_enabled', coalesce((
      select access.preview_enabled
      from public.platform_preview_access access
      where access.user_id = auth.uid()
    ), false),
    'snapshots', coalesce((
      select jsonb_agg(to_jsonb(snapshot) order by snapshot.created_at desc)
      from (
        select id, name, description, snapshot_kind, source_version, created_by, created_at
        from public.platform_configuration_snapshots
        order by created_at desc
        limit 50
      ) snapshot
    ), '[]'::jsonb),
    'preview_access', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', access.user_id,
          'display_name', profile.display_name,
          'email', coalesce(auth_user.email, ''),
          'can_preview', access.can_preview,
          'preview_enabled', access.preview_enabled,
          'updated_at', access.updated_at
        )
        order by profile.display_name
      )
      from public.platform_preview_access access
      join public.profiles profile on profile.id = access.user_id
      left join auth.users auth_user on auth_user.id = profile.id
    ), '[]'::jsonb),
    'audit_history', coalesce((
      select jsonb_agg(to_jsonb(log) order by log.created_at desc)
      from (
        select id, actor_id, action, target_type, target_id, details, created_at
        from public.admin_audit_log
        where target_type in (
          'platform_control_state', 'platform_configuration_snapshot',
          'platform_preview_access'
        )
        order by created_at desc
        limit 100
      ) log
    ), '[]'::jsonb),
    'token_analytics', jsonb_build_object(
      'tokens_generated_today', coalesce((
        select sum(amount)
        from public.credit_transactions
        where amount > 0 and created_at >= date_trunc('day', now())
      ), 0),
      'tokens_gifted_today', coalesce((
        select sum(abs(amount))
        from public.credit_transactions
        where reason ilike '%gift%' and created_at >= date_trunc('day', now())
      ), 0),
      'tokens_spent_today', abs(coalesce((
        select sum(amount)
        from public.credit_transactions
        where amount < 0 and created_at >= date_trunc('day', now())
      ), 0)),
      'tokens_burned_today', abs(coalesce((
        select sum(amount)
        from public.credit_transactions
        where amount < 0
          and reason not ilike '%gift%'
          and created_at >= date_trunc('day', now())
      ), 0)),
      'tokens_in_circulation', coalesce((select sum(credits) from public.profiles), 0),
      'tokens_earned', coalesce((
        select sum(amount) from public.credit_transactions where amount > 0
      ), 0),
      'tokens_spent', abs(coalesce((
        select sum(amount) from public.credit_transactions where amount < 0
      ), 0)),
      'reward_claims', (select count(*) from public.listening_reward_claims),
      'average_balance', coalesce((
        select round(avg(credits)::numeric, 2) from public.profiles
      ), 0)
    ),
    'listening_bank', public.admin_get_listening_bank_owner_payload(),
    'health', public.admin_get_community_health() || jsonb_build_object(
      'artists_online', (
        select count(distinct session.user_id)
        from public.listening_sessions session
        where session.last_heartbeat_at >= now() - interval '15 minutes'
          and exists (
            select 1 from public.songs song where song.user_id = session.user_id
          )
      ),
      'reviews_today', (
        select count(*) from public.reviews where created_at >= date_trunc('day', now())
      )
    ),
    'top_songs', coalesce((
      select jsonb_agg(to_jsonb(ranked))
      from (
        select song.id, song.title, song.artist_name,
          count(review.id)::integer as reviews
        from public.songs song
        left join public.reviews review on review.song_id = song.id
        where song.removed_at is null
        group by song.id
        order by count(review.id) desc, song.created_at desc
        limit 5
      ) ranked
    ), '[]'::jsonb),
    'top_artists', coalesce((
      select jsonb_agg(to_jsonb(ranked))
      from (
        select profile.id, profile.display_name,
          count(distinct song.id)::integer as songs,
          count(distinct follow.follower_id)::integer as followers
        from public.profiles profile
        left join public.songs song
          on song.user_id = profile.id and song.removed_at is null
        left join public.artist_follows follow on follow.artist_id = profile.id
        group by profile.id
        having count(distinct song.id) > 0
        order by count(distinct follow.follower_id) desc, count(distinct song.id) desc
        limit 5
      ) ranked
    ), '[]'::jsonb),
    'most_shared_songs', coalesce((
      select jsonb_agg(to_jsonb(ranked))
      from (
        select song.id, song.title, song.artist_name,
          count(share.id)::integer as total
        from public.songs song
        join public.song_shares share on share.song_id = song.id
        where song.removed_at is null
        group by song.id
        order by count(share.id) desc
        limit 5
      ) ranked
    ), '[]'::jsonb),
    'most_commented_songs', coalesce((
      select jsonb_agg(to_jsonb(ranked))
      from (
        select song.id, song.title, song.artist_name,
          count(comment.id)::integer as total
        from public.songs song
        join public.song_comments comment
          on comment.song_id = song.id and comment.removed_at is null
        where song.removed_at is null
        group by song.id
        order by count(comment.id) desc
        limit 5
      ) ranked
    ), '[]'::jsonb),
    'most_supported_artists', coalesce((
      select jsonb_agg(to_jsonb(ranked))
      from (
        select profile.id, profile.display_name,
          count(event.id)::integer as total
        from public.profiles profile
        join public.community_support_events event on event.artist_id = profile.id
        group by profile.id
        order by count(event.id) desc
        limit 5
      ) ranked
    ), '[]'::jsonb)
  )
  into result
  from public.platform_control_state state
  where state.id = true;

  return result;
end;
$$;

revoke all on function public.current_listening_event_bonus() from public, anon;
revoke all on function public.log_listening_bank_activity(
  uuid, uuid, uuid, text, text, text, integer, integer, text, jsonb
) from public, anon, authenticated;
revoke all on function public.admin_get_listening_bank_owner_payload() from public, anon;
revoke all on function public.admin_run_listening_bank_test(text) from public, anon;
revoke all on function public.admin_update_control_draft(text, jsonb, text) from public, anon;
revoke all on function public.admin_replace_control_draft(jsonb, text) from public, anon;
revoke all on function public.admin_restore_control_snapshot(uuid) from public, anon;
revoke all on function public.admin_publish_control_draft(text) from public, anon;
revoke all on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) from public, anon;
revoke all on function public.claim_listening_reward() from public, anon;
revoke all on function public.get_listening_bank_status_v2() from public, anon;
revoke all on function public.admin_get_control_center() from public, anon;

grant execute on function public.current_listening_event_bonus() to authenticated, service_role;
grant execute on function public.admin_get_listening_bank_owner_payload() to authenticated;
grant execute on function public.admin_run_listening_bank_test(text) to authenticated;
grant execute on function public.admin_update_control_draft(text, jsonb, text) to authenticated;
grant execute on function public.admin_replace_control_draft(jsonb, text) to authenticated;
grant execute on function public.admin_restore_control_snapshot(uuid) to authenticated;
grant execute on function public.admin_publish_control_draft(text) to authenticated;
grant execute on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) to authenticated;
grant execute on function public.claim_listening_reward() to authenticated;
grant execute on function public.get_listening_bank_status_v2() to authenticated;
grant execute on function public.admin_get_control_center() to authenticated;
