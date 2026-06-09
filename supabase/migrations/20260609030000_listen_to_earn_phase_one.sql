-- Listen-to-Earn Phase 1.
-- Verified playback is accumulated in pending sessions and only banked after
-- the matching review passes the existing server-side quality checks.

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'listening_session_status'
  ) then
    create type public.listening_session_status as enum (
      'active',
      'qualified',
      'abandoned'
    );
  end if;
end $$;

alter table public.profiles
  add column if not exists listening_bank_seconds bigint not null default 0,
  add column if not exists lifetime_listening_seconds bigint not null default 0,
  add column if not exists listening_reward_credits_earned integer not null default 0;

alter table public.profiles
  drop constraint if exists profiles_listening_bank_seconds_check;
alter table public.profiles
  add constraint profiles_listening_bank_seconds_check
  check (listening_bank_seconds >= 0);

alter table public.profiles
  drop constraint if exists profiles_lifetime_listening_seconds_check;
alter table public.profiles
  add constraint profiles_lifetime_listening_seconds_check
  check (lifetime_listening_seconds >= 0);

alter table public.profiles
  drop constraint if exists profiles_listening_reward_credits_earned_check;
alter table public.profiles
  add constraint profiles_listening_reward_credits_earned_check
  check (listening_reward_credits_earned >= 0);

create table if not exists public.listening_reward_settings (
  id boolean primary key default true check (id),
  minutes_per_credit integer not null default 120
    check (minutes_per_credit between 30 and 1440),
  daily_cap_minutes integer not null default 180
    check (daily_cap_minutes between 30 and 1440),
  heartbeat_interval_seconds integer not null default 15
    check (heartbeat_interval_seconds between 10 and 60),
  interaction_grace_seconds integer not null default 300
    check (interaction_grace_seconds between 60 and 900),
  enabled boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.listening_reward_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.listening_levels (
  level_number smallint primary key check (level_number between 1 and 20),
  level_name text not null unique check (char_length(level_name) between 2 and 80),
  minimum_minutes integer not null unique check (minimum_minutes >= 0)
);

insert into public.listening_levels (level_number, level_name, minimum_minutes)
values
  (1, 'Explorer', 0),
  (2, 'Discoverer', 120),
  (3, 'Talent Scout', 600),
  (4, 'Curator', 1800),
  (5, 'Elite Curator', 6000)
on conflict (level_number) do update
set
  level_name = excluded.level_name,
  minimum_minutes = excluded.minimum_minutes;

create table if not exists public.listening_sessions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  platform public.music_platform not null,
  status public.listening_session_status not null default 'active',
  telemetry_supported boolean not null default false,
  provider_duration_seconds numeric(10,3),
  last_position_seconds numeric(10,3),
  max_position_seconds numeric(10,3) not null default 0,
  verified_seconds integer not null default 0 check (verified_seconds >= 0),
  settled_seconds integer not null default 0 check (settled_seconds >= 0),
  rejected_heartbeats integer not null default 0 check (rejected_heartbeats >= 0),
  loop_count integer not null default 0 check (loop_count >= 0),
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz,
  qualified_at timestamptz,
  review_id uuid unique references public.reviews(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists listening_sessions_one_active_user_idx
  on public.listening_sessions (user_id)
  where status = 'active';
create index if not exists listening_sessions_user_day_idx
  on public.listening_sessions (user_id, qualified_at desc)
  where status = 'qualified';
create index if not exists listening_sessions_song_idx
  on public.listening_sessions (song_id, qualified_at desc)
  where status = 'qualified';

create table if not exists public.listening_reward_claims (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  minutes_spent integer not null check (minutes_spent > 0),
  credits_awarded integer not null default 1 check (credits_awarded > 0),
  exchange_rate_minutes integer not null check (exchange_rate_minutes > 0),
  created_at timestamptz not null default now()
);

create index if not exists listening_reward_claims_user_idx
  on public.listening_reward_claims (user_id, created_at desc);

alter table public.reviews
  add column if not exists listening_session_id uuid unique
    references public.listening_sessions(id) on delete set null,
  add column if not exists listening_seconds integer not null default 0,
  add column if not exists listening_duration_seconds integer,
  add column if not exists listening_completion_percent numeric(5,2);

alter table public.reviews
  drop constraint if exists reviews_listening_seconds_check;
alter table public.reviews
  add constraint reviews_listening_seconds_check check (listening_seconds >= 0);

alter table public.listening_reward_settings enable row level security;
alter table public.listening_levels enable row level security;
alter table public.listening_sessions enable row level security;
alter table public.listening_reward_claims enable row level security;

create or replace function public.start_listening_session(target_song_id uuid)
returns table (
  session_id uuid,
  earning_eligible boolean,
  heartbeat_interval_seconds integer,
  interaction_grace_seconds integer,
  daily_cap_seconds integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_platform public.music_platform;
  settings public.listening_reward_settings%rowtype;
  new_session_id uuid;
  existing_session_id uuid;
  supports_verified_audio boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_active_user() then raise exception 'Active account required'; end if;

  select songs.platform
  into target_platform
  from public.songs
  where songs.id = target_song_id
    and songs.user_id <> auth.uid()
    and songs.is_active
    and songs.removed_at is null;
  if not found then raise exception 'Song is unavailable for listening'; end if;

  select *
  into settings
  from public.listening_reward_settings
  where id = true;

  supports_verified_audio :=
    target_platform in ('youtube', 'youtube_music', 'soundcloud');

  select id
  into existing_session_id
  from public.listening_sessions
  where user_id = auth.uid()
    and song_id = target_song_id
    and status = 'active'
  limit 1;

  if existing_session_id is not null then
    return query
    select
      existing_session_id,
      settings.enabled and supports_verified_audio,
      settings.heartbeat_interval_seconds,
      settings.interaction_grace_seconds,
      settings.daily_cap_minutes * 60;
    return;
  end if;

  if (
    select count(*)
    from public.listening_sessions
    where user_id = auth.uid()
      and created_at >= now() - interval '1 minute'
  ) >= 6 then
    raise exception 'Please wait before starting another listening session';
  end if;

  update public.listening_sessions
  set status = 'abandoned', updated_at = now()
  where user_id = auth.uid()
    and status = 'active';

  insert into public.listening_sessions (
    user_id,
    song_id,
    platform,
    telemetry_supported
  )
  values (
    auth.uid(),
    target_song_id,
    target_platform,
    supports_verified_audio
  )
  returning id into new_session_id;

  return query
  select
    new_session_id,
    settings.enabled and supports_verified_audio,
    settings.heartbeat_interval_seconds,
    settings.interaction_grace_seconds,
    settings.daily_cap_minutes * 60;
end;
$$;

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

create or replace function public.submit_review_with_listening(
  reviewed_song_id uuid,
  review_listen_full boolean,
  review_add_to_playlist boolean,
  review_grabbed_attention boolean,
  review_share_with_friend boolean,
  review_rating smallint,
  review_comment text,
  review_pasted_comment_detected boolean default false,
  listening_session_id uuid default null
)
returns table (
  accepted boolean,
  quality_score smallint,
  credit_granted boolean,
  warning text,
  listening_seconds_banked integer,
  listening_bank_seconds bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_comment text := public.normalize_feedback(review_comment);
  repeated_comment boolean;
  computed_score integer := 100;
  new_quality_score numeric;
  new_review_id uuid;
  session_row public.listening_sessions%rowtype;
  settings public.listening_reward_settings%rowtype;
  today_settled integer := 0;
  seconds_to_settle integer := 0;
  completion numeric(5,2);
  new_bank bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(trim(coalesce(review_comment, ''))) not between 30 and 1000 then
    return query select false, 0::smallint, false,
      'Please provide useful feedback.'::text, 0, null::bigint;
    return;
  end if;
  if review_rating not between 1 and 10 then
    raise exception 'Rating must be between 1 and 10';
  end if;
  if not exists (
    select 1 from public.songs
    where id = reviewed_song_id
      and user_id <> auth.uid()
      and is_active
      and removed_at is null
  ) then
    raise exception 'Song is unavailable for review';
  end if;

  select exists (
    select 1 from public.reviews
    where reviewer_id = auth.uid()
      and public.normalize_feedback(comment) = normalized_comment
  ) into repeated_comment;

  if repeated_comment then computed_score := 20; end if;
  if review_pasted_comment_detected then computed_score := computed_score - 50; end if;
  if array_length(regexp_split_to_array(normalized_comment, '\s+'), 1) < 7 then
    computed_score := computed_score - 25;
  end if;
  computed_score := greatest(0, least(100, computed_score));

  if computed_score < 60 then
    return query select false, computed_score::smallint, false,
      'Please provide useful feedback.'::text, 0, null::bigint;
    return;
  end if;

  if listening_session_id is not null then
    select *
    into session_row
    from public.listening_sessions
    where id = listening_session_id
      and user_id = auth.uid()
      and song_id = reviewed_song_id
      and status = 'active'
    for update;
  end if;

  select *
  into settings
  from public.listening_reward_settings
  where id = true;

  if session_row.id is not null then
    select coalesce(sum(settled_seconds), 0)::integer
    into today_settled
    from public.listening_sessions
    where user_id = auth.uid()
      and status = 'qualified'
      and qualified_at >= date_trunc('day', now());

    seconds_to_settle := least(
      session_row.verified_seconds,
      greatest(0, settings.daily_cap_minutes * 60 - today_settled)
    );
    completion := case
      when coalesce(session_row.provider_duration_seconds, 0) > 0
      then least(
        100,
        round(
          (session_row.max_position_seconds / session_row.provider_duration_seconds) * 100,
          2
        )
      )
      else null
    end;
  end if;

  insert into public.reviews (
    song_id,
    reviewer_id,
    listen_full,
    add_to_playlist,
    grabbed_attention,
    share_with_friend,
    rating,
    comment,
    pasted_comment_detected,
    quality_score,
    quality_passed,
    listening_session_id,
    listening_seconds,
    listening_duration_seconds,
    listening_completion_percent
  )
  values (
    reviewed_song_id,
    auth.uid(),
    review_listen_full,
    review_add_to_playlist,
    review_grabbed_attention,
    review_share_with_friend,
    review_rating,
    trim(review_comment),
    review_pasted_comment_detected,
    computed_score,
    true,
    session_row.id,
    seconds_to_settle,
    case
      when session_row.provider_duration_seconds is null then null
      else round(session_row.provider_duration_seconds)::integer
    end,
    completion
  )
  returning id into new_review_id;

  update public.profiles
  set
    completed_reviews = profiles.completed_reviews + 1,
    listening_bank_seconds =
      profiles.listening_bank_seconds + seconds_to_settle,
    lifetime_listening_seconds =
      profiles.lifetime_listening_seconds + seconds_to_settle,
    updated_at = now()
  where id = auth.uid()
  returning profiles.listening_bank_seconds into new_bank;

  if session_row.id is not null then
    update public.listening_sessions
    set
      status = 'qualified',
      settled_seconds = seconds_to_settle,
      qualified_at = now(),
      review_id = new_review_id,
      updated_at = now()
    where id = session_row.id;
  end if;

  select round(avg(reviews.quality_score)::numeric, 2)
  into new_quality_score
  from public.reviews as reviews
  where reviews.reviewer_id = auth.uid();

  update public.profiles
  set review_quality_score = coalesce(new_quality_score, 100)
  where id = auth.uid();

  return query select
    true,
    computed_score::smallint,
    false,
    case
      when session_row.id is null then
        'Review accepted. No verified listening session was available.'
      when seconds_to_settle = 0 and today_settled >= settings.daily_cap_minutes * 60 then
        'Review accepted. You have reached today''s listening limit.'
      else ''
    end,
    seconds_to_settle,
    new_bank;
end;
$$;

-- Compatibility wrapper. New reviews no longer grant automatic milestone
-- credits; verified minutes must be claimed manually.
create or replace function public.submit_review(
  reviewed_song_id uuid,
  review_listen_full boolean,
  review_add_to_playlist boolean,
  review_grabbed_attention boolean,
  review_share_with_friend boolean,
  review_rating smallint,
  review_comment text,
  review_pasted_comment_detected boolean default false
)
returns table (
  accepted boolean,
  quality_score smallint,
  credit_granted boolean,
  warning text
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select
    result.accepted,
    result.quality_score,
    false,
    result.warning
  from public.submit_review_with_listening(
    reviewed_song_id,
    review_listen_full,
    review_add_to_playlist,
    review_grabbed_attention,
    review_share_with_friend,
    review_rating,
    review_comment,
    review_pasted_comment_detected,
    null
  ) as result;
$$;

create or replace function public.get_listening_bank_status()
returns table (
  bank_seconds bigint,
  lifetime_seconds bigint,
  today_seconds integer,
  available_reward_credits integer,
  seconds_to_next_credit integer,
  minutes_per_credit integer,
  daily_cap_minutes integer,
  level_number smallint,
  level_name text,
  rewards_enabled boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with settings as (
    select * from public.listening_reward_settings where id = true
  ),
  profile as (
    select
      profiles.listening_bank_seconds,
      profiles.lifetime_listening_seconds
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.account_status = 'active'
  ),
  today as (
    select coalesce(sum(settled_seconds), 0)::integer as seconds
    from public.listening_sessions
    where user_id = auth.uid()
      and status = 'qualified'
      and qualified_at >= date_trunc('day', now())
  )
  select
    profile.listening_bank_seconds,
    profile.lifetime_listening_seconds,
    today.seconds,
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
    settings.enabled
  from profile
  cross join settings
  cross join today
  join lateral (
    select listening_levels.level_number, listening_levels.level_name
    from public.listening_levels
    where listening_levels.minimum_minutes <=
      floor(profile.lifetime_listening_seconds / 60)
    order by listening_levels.minimum_minutes desc
    limit 1
  ) levels on true;
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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select *
  into settings
  from public.listening_reward_settings
  where id = true;
  if not settings.enabled then raise exception 'Listening rewards are currently paused'; end if;

  exchange_seconds := settings.minutes_per_credit * 60;

  update public.profiles
  set
    listening_bank_seconds = listening_bank_seconds - exchange_seconds,
    credits = credits + 1,
    listening_reward_credits_earned = listening_reward_credits_earned + 1,
    total_review_credits_earned = total_review_credits_earned + 1,
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
  values (auth.uid(), settings.minutes_per_credit, 1, settings.minutes_per_credit);

  insert into public.credit_transactions (user_id, amount, reason)
  values (auth.uid(), 1, 'Listening Bank reward');

  return query select
    1,
    updated_credits,
    updated_bank,
    floor(updated_bank::numeric / exchange_seconds)::integer;
end;
$$;

create or replace function public.admin_update_listening_settings(
  new_minutes_per_credit integer,
  new_daily_cap_minutes integer,
  rewards_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_settings public.listening_reward_settings%rowtype;
begin
  if public.current_user_role() <> 'super_admin' then raise exception 'Forbidden'; end if;
  if new_minutes_per_credit not between 30 and 1440
    or new_daily_cap_minutes not between 30 and 1440
  then
    raise exception 'Listening settings are outside allowed limits';
  end if;

  select *
  into previous_settings
  from public.listening_reward_settings
  where id = true
  for update;

  update public.listening_reward_settings
  set
    minutes_per_credit = new_minutes_per_credit,
    daily_cap_minutes = new_daily_cap_minutes,
    enabled = rewards_enabled,
    updated_by = auth.uid(),
    updated_at = now()
  where id = true;

  insert into public.admin_audit_log (
    actor_id,
    action,
    target_type,
    details
  )
  values (
    auth.uid(),
    'update_listening_settings',
    'listening_reward_settings',
    jsonb_build_object(
      'previous_minutes_per_credit', previous_settings.minutes_per_credit,
      'new_minutes_per_credit', new_minutes_per_credit,
      'previous_daily_cap_minutes', previous_settings.daily_cap_minutes,
      'new_daily_cap_minutes', new_daily_cap_minutes,
      'previous_enabled', previous_settings.enabled,
      'new_enabled', rewards_enabled
    )
  );
end;
$$;

create or replace function public.get_my_song_dashboard_with_listening()
returns table (
  song_id uuid,
  title text,
  artist_name text,
  platform public.music_platform,
  submitted_at timestamptz,
  reviews_received integer,
  average_rating numeric,
  hook_score integer,
  report_count integer,
  total_listening_seconds bigint,
  average_listening_seconds numeric,
  completion_rate numeric,
  playlist_intent numeric,
  share_intent numeric,
  listener_retention numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    songs.id,
    songs.title,
    songs.artist_name,
    songs.platform,
    songs.created_at,
    coalesce(metrics.reviews_received, 0),
    coalesce(metrics.average_rating, 0),
    coalesce(metrics.hook_score, 0),
    coalesce(report_counts.report_count, 0),
    coalesce(metrics.total_listening_seconds, 0),
    coalesce(metrics.average_listening_seconds, 0),
    coalesce(metrics.completion_rate, 0),
    coalesce(metrics.playlist_intent, 0),
    coalesce(metrics.share_intent, 0),
    coalesce(metrics.listener_retention, 0)
  from public.songs
  left join lateral (
    select
      count(*)::integer as reviews_received,
      round(avg(reviews.rating)::numeric, 2) as average_rating,
      round((
        avg(case when reviews.listen_full then 100 else 0 end) +
        avg(case when reviews.add_to_playlist then 100 else 0 end) +
        avg(case when reviews.grabbed_attention then 100 else 0 end) +
        avg(case when reviews.share_with_friend then 100 else 0 end)
      ) / 4, 0)::integer as hook_score,
      coalesce(sum(reviews.listening_seconds), 0)::bigint as total_listening_seconds,
      round(
        (
          avg(reviews.listening_seconds)
            filter (where reviews.listening_seconds > 0)
        )::numeric,
        2
      ) as average_listening_seconds,
      round(
        (
          avg(
            case
              when reviews.listening_completion_percent >= 90 then 100
              else 0
            end
          ) filter (
            where reviews.listening_completion_percent is not null
          )
        )::numeric,
        2
      ) as completion_rate,
      round(avg(case when reviews.add_to_playlist then 100 else 0 end)::numeric, 2)
        as playlist_intent,
      round(avg(case when reviews.share_with_friend then 100 else 0 end)::numeric, 2)
        as share_intent,
      round(
        (
          avg(reviews.listening_completion_percent)
            filter (where reviews.listening_completion_percent is not null)
        )::numeric,
        2
      )
        as listener_retention
    from public.reviews
    where reviews.song_id = songs.id
      and reviews.quality_passed
  ) metrics on true
  left join lateral (
    select count(*)::integer as report_count
    from public.song_reports
    where song_reports.song_id = songs.id
  ) report_counts on true
  where songs.user_id = auth.uid()
    and public.is_active_user()
  order by songs.created_at desc;
$$;

create or replace function public.admin_get_statistics()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Forbidden';
  end if;
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'songs', (select count(*) from public.songs),
    'active_songs', (select count(*) from public.songs where is_active and removed_at is null),
    'open_reports', (select count(*) from public.song_reports where status = 'open'),
    'reviews', (select count(*) from public.reviews),
    'listening_minutes', (
      select floor(coalesce(sum(settled_seconds), 0) / 60)
      from public.listening_sessions
      where status = 'qualified'
    )
  );
end;
$$;

create or replace function public.listening_system_health_report()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'tables', jsonb_build_object(
      'listening_reward_settings', to_regclass('public.listening_reward_settings') is not null,
      'listening_levels', to_regclass('public.listening_levels') is not null,
      'listening_sessions', to_regclass('public.listening_sessions') is not null,
      'listening_reward_claims', to_regclass('public.listening_reward_claims') is not null
    ),
    'functions', jsonb_build_object(
      'start_listening_session', to_regprocedure('public.start_listening_session(uuid)') is not null,
      'record_listening_heartbeat', to_regprocedure(
        'public.record_listening_heartbeat(uuid,numeric,numeric,text,boolean,numeric,boolean,boolean,boolean)'
      ) is not null,
      'submit_review_with_listening', to_regprocedure(
        'public.submit_review_with_listening(uuid,boolean,boolean,boolean,boolean,smallint,text,boolean,uuid)'
      ) is not null,
      'get_listening_bank_status', to_regprocedure('public.get_listening_bank_status()') is not null,
      'claim_listening_reward', to_regprocedure('public.claim_listening_reward()') is not null,
      'admin_update_listening_settings', to_regprocedure(
        'public.admin_update_listening_settings(integer,integer,boolean)'
      ) is not null
    ),
    'settings_rows', (select count(*)::integer from public.listening_reward_settings),
    'levels', (select count(*)::integer from public.listening_levels),
    'active_session_duplicates', (
      select count(*)::integer
      from (
        select user_id
        from public.listening_sessions
        where status = 'active'
        group by user_id
        having count(*) > 1
      ) duplicates
    ),
    'orphan_sessions', (
      select count(*)::integer
      from public.listening_sessions
      where not exists (
        select 1 from public.profiles where profiles.id = listening_sessions.user_id
      )
      or not exists (
        select 1 from public.songs where songs.id = listening_sessions.song_id
      )
    ),
    'negative_balances', (
      select count(*)::integer
      from public.profiles
      where listening_bank_seconds < 0
        or lifetime_listening_seconds < 0
    ),
    'qualified_seconds', (
      select coalesce(sum(settled_seconds), 0)::bigint
      from public.listening_sessions
      where status = 'qualified'
    ),
    'claimed_credits', (
      select coalesce(sum(credits_awarded), 0)::bigint
      from public.listening_reward_claims
    )
  );
$$;

drop policy if exists "users read own listening sessions or super admin reads all"
  on public.listening_sessions;
create policy "users read own listening sessions or super admin reads all"
  on public.listening_sessions for select
  to authenticated
  using (
    public.is_active_user()
    and (user_id = auth.uid() or public.current_user_role() = 'super_admin')
  );

drop policy if exists "users read own listening rewards or super admin reads all"
  on public.listening_reward_claims;
create policy "users read own listening rewards or super admin reads all"
  on public.listening_reward_claims for select
  to authenticated
  using (
    public.is_active_user()
    and (user_id = auth.uid() or public.current_user_role() = 'super_admin')
  );

drop policy if exists "authenticated users read listening levels"
  on public.listening_levels;
create policy "authenticated users read listening levels"
  on public.listening_levels for select
  to authenticated
  using (public.is_active_user());

drop policy if exists "authenticated users read listening reward settings"
  on public.listening_reward_settings;
create policy "authenticated users read listening reward settings"
  on public.listening_reward_settings for select
  to authenticated
  using (public.is_active_user());

revoke all on table public.listening_reward_settings from public, anon, authenticated;
revoke all on table public.listening_levels from public, anon, authenticated;
revoke all on table public.listening_sessions from public, anon, authenticated;
revoke all on table public.listening_reward_claims from public, anon, authenticated;

grant select on table public.listening_reward_settings to authenticated;
grant select on table public.listening_levels to authenticated;
grant select on table public.listening_sessions to authenticated;
grant select on table public.listening_reward_claims to authenticated;

revoke all on function public.start_listening_session(uuid)
  from public, anon, authenticated;
revoke all on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) from public, anon, authenticated;
revoke all on function public.submit_review_with_listening(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean, uuid
) from public, anon, authenticated;
revoke all on function public.get_listening_bank_status()
  from public, anon, authenticated;
revoke all on function public.claim_listening_reward()
  from public, anon, authenticated;
revoke all on function public.admin_update_listening_settings(
  integer, integer, boolean
) from public, anon, authenticated;
revoke all on function public.get_my_song_dashboard_with_listening()
  from public, anon, authenticated;
revoke all on function public.listening_system_health_report()
  from public, anon, authenticated;

grant execute on function public.start_listening_session(uuid) to authenticated;
grant execute on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) to authenticated;
grant execute on function public.submit_review_with_listening(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean, uuid
) to authenticated;
grant execute on function public.get_listening_bank_status() to authenticated;
grant execute on function public.claim_listening_reward() to authenticated;
grant execute on function public.admin_update_listening_settings(
  integer, integer, boolean
) to authenticated;
grant execute on function public.get_my_song_dashboard_with_listening()
  to authenticated;
grant execute on function public.listening_system_health_report()
  to service_role;
