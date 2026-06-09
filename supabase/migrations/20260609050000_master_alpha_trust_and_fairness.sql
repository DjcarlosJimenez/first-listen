-- Master Alpha trust, listening transparency, community reputation, moderation,
-- Founder submissions, and duration-aware queue infrastructure.

alter table public.profiles
  add column if not exists founder_free_submissions_remaining smallint not null default 0,
  add column if not exists community_points integer not null default 0,
  add column if not exists valid_listens integer not null default 0,
  add column if not exists warning_count integer not null default 0,
  add column if not exists banned_at timestamptz,
  add column if not exists banned_by uuid references public.profiles(id) on delete set null,
  add column if not exists ban_reason text;

alter table public.profiles
  drop constraint if exists profiles_founder_free_submissions_remaining_check;
alter table public.profiles
  add constraint profiles_founder_free_submissions_remaining_check
  check (founder_free_submissions_remaining between 0 and 3);

alter table public.profiles
  drop constraint if exists profiles_community_points_check;
alter table public.profiles
  add constraint profiles_community_points_check check (community_points >= 0);

alter table public.profiles
  drop constraint if exists profiles_valid_listens_check;
alter table public.profiles
  add constraint profiles_valid_listens_check check (valid_listens >= 0);

alter table public.profiles
  drop constraint if exists profiles_warning_count_check;
alter table public.profiles
  add constraint profiles_warning_count_check check (warning_count >= 0);

update public.profiles
set
  founder_free_submissions_remaining = greatest(
    0,
    3 - (
      select count(*)::integer
      from public.songs
      where songs.user_id = profiles.id
        and songs.submitted_with_founder_credit
    )
  ),
  founder_free_submission_available = (
    select count(*)
    from public.songs
    where songs.user_id = profiles.id
      and songs.submitted_with_founder_credit
  ) < 3
where founder_number is not null
  and founder_free_submissions_remaining = 0;

alter table public.songs
  add column if not exists media_vertical text not null default 'music',
  add column if not exists content_kind text not null default 'song',
  add column if not exists content_duration_seconds integer,
  add column if not exists observed_duration_seconds integer,
  add column if not exists queue_tier text not null default 'public',
  add column if not exists approval_status text not null default 'auto_approved',
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz;

alter table public.songs
  drop constraint if exists songs_media_vertical_check;
alter table public.songs
  add constraint songs_media_vertical_check
  check (media_vertical in ('music', 'video'));

alter table public.songs
  drop constraint if exists songs_content_kind_check;
alter table public.songs
  add constraint songs_content_kind_check
  check (
    content_kind in (
      'song',
      'music_video',
      'remix',
      'live_session',
      'performance',
      'long_form'
    )
  );

alter table public.songs
  drop constraint if exists songs_content_duration_seconds_check;
alter table public.songs
  add constraint songs_content_duration_seconds_check
  check (
    content_duration_seconds is null
    or content_duration_seconds between 15 and 43200
  );

alter table public.songs
  drop constraint if exists songs_observed_duration_seconds_check;
alter table public.songs
  add constraint songs_observed_duration_seconds_check
  check (
    observed_duration_seconds is null
    or observed_duration_seconds between 15 and 43200
  );

alter table public.songs
  drop constraint if exists songs_queue_tier_check;
alter table public.songs
  add constraint songs_queue_tier_check
  check (queue_tier in ('public', 'manual_review', 'sponsored'));

alter table public.songs
  drop constraint if exists songs_approval_status_check;
alter table public.songs
  add constraint songs_approval_status_check
  check (approval_status in ('auto_approved', 'pending', 'approved', 'rejected'));

alter table public.listening_sessions
  add column if not exists valid_requirement_seconds integer,
  add column if not exists valid_listen_at timestamptz,
  add column if not exists community_point_awarded boolean not null default false,
  add column if not exists finished_at timestamptz;

alter table public.listening_sessions
  drop constraint if exists listening_sessions_valid_requirement_seconds_check;
alter table public.listening_sessions
  add constraint listening_sessions_valid_requirement_seconds_check
  check (
    valid_requirement_seconds is null
    or valid_requirement_seconds between 30 and 120
  );

alter table public.reviews
  add column if not exists helpful_at timestamptz,
  add column if not exists helpful_by uuid references public.profiles(id) on delete set null,
  add column if not exists comment_removed_at timestamptz,
  add column if not exists comment_removed_by uuid references public.profiles(id) on delete set null,
  add column if not exists comment_removal_reason text;

create table if not exists public.community_point_transactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  points integer not null check (points <> 0),
  reason text not null check (char_length(trim(reason)) between 3 and 120),
  source_type text not null check (char_length(trim(source_type)) between 3 and 80),
  source_id uuid not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, source_type, source_id, reason)
);

create index if not exists community_point_transactions_user_idx
  on public.community_point_transactions (user_id, created_at desc);

create table if not exists public.review_comment_reports (
  id uuid primary key default uuid_generate_v4(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (
    reason in ('harassment', 'discrimination', 'spam', 'threats', 'personal_attack', 'other')
  ),
  details text,
  status public.report_status not null default 'open',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (review_id, reporter_id)
);

create index if not exists review_comment_reports_status_idx
  on public.review_comment_reports (status, created_at desc);

create table if not exists public.account_warnings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  issued_by uuid references public.profiles(id) on delete set null,
  reason text not null check (char_length(trim(reason)) between 3 and 500),
  created_at timestamptz not null default now()
);

create index if not exists account_warnings_user_idx
  on public.account_warnings (user_id, created_at desc);

alter table public.community_point_transactions enable row level security;
alter table public.review_comment_reports enable row level security;
alter table public.account_warnings enable row level security;

drop policy if exists "users read own community point history or staff reads all"
  on public.community_point_transactions;
create policy "users read own community point history or staff reads all"
  on public.community_point_transactions
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff());

drop policy if exists "comment reports readable by reporter or staff"
  on public.review_comment_reports;
create policy "comment reports readable by reporter or staff"
  on public.review_comment_reports
  for select
  to authenticated
  using (reporter_id = auth.uid() or public.is_staff());

drop policy if exists "warnings readable by recipient or staff"
  on public.account_warnings;
create policy "warnings readable by recipient or staff"
  on public.account_warnings
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff());

revoke all on table public.community_point_transactions from public, anon, authenticated;
revoke all on table public.review_comment_reports from public, anon, authenticated;
revoke all on table public.account_warnings from public, anon, authenticated;
grant select on table public.community_point_transactions to authenticated;
grant select on table public.review_comment_reports to authenticated;
grant select on table public.account_warnings to authenticated;

create or replace function public.community_rank_name(point_total integer)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when greatest(point_total, 0) >= 2500 then 'First Listen Legend'
    when greatest(point_total, 0) >= 1000 then 'Mentor'
    when greatest(point_total, 0) >= 500 then 'Music Critic'
    when greatest(point_total, 0) >= 100 then 'Contributor'
    else 'New Member'
  end;
$$;

create or replace function public.award_community_points(
  target_user_id uuid,
  point_amount integer,
  point_reason text,
  point_source_type text,
  point_source_id uuid,
  point_created_by uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if point_amount <= 0 then
    raise exception 'Community point awards must be positive';
  end if;

  insert into public.community_point_transactions (
    user_id,
    points,
    reason,
    source_type,
    source_id,
    created_by
  )
  values (
    target_user_id,
    point_amount,
    trim(point_reason),
    trim(point_source_type),
    point_source_id,
    point_created_by
  )
  on conflict do nothing;

  if not found then
    return false;
  end if;

  update public.profiles
  set
    community_points = community_points + point_amount,
    updated_at = now()
  where id = target_user_id;

  return true;
end;
$$;

revoke all on function public.award_community_points(
  uuid, integer, text, text, uuid, uuid
) from public, anon, authenticated;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and account_status = 'active'
      and banned_at is null
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  founder_spot integer;
  starting_credits integer := 1;
  accepted boolean := coalesce((new.raw_user_meta_data ->> 'legal_accepted')::boolean, false);
begin
  if not accepted then
    raise exception 'Legal terms must be accepted';
  end if;

  if not coalesce((new.raw_user_meta_data ->> 'system_bootstrap')::boolean, false) then
    update public.founder_program
    set claimed_count = claimed_count + 1
    where id = true and claimed_count < capacity
    returning claimed_count into founder_spot;
  end if;

  if founder_spot is not null then
    starting_credits := starting_credits + 10;
  end if;

  insert into public.profiles (
    id,
    display_name,
    avatar_url,
    founder_number,
    founder_free_submission_available,
    founder_free_submissions_remaining,
    founder_premium_year_entitlement,
    credits,
    legal_accepted_at,
    explicit_content_acknowledged_at
  )
  values (
    new.id,
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
        'New artist'
      ),
      120
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    founder_spot,
    founder_spot is not null,
    case when founder_spot is null then 0 else 3 end,
    founder_spot is not null,
    starting_credits,
    now(),
    now()
  );

  insert into public.credit_transactions (user_id, amount, reason)
  values (new.id, 1, 'Registration credit');

  if founder_spot is not null then
    insert into public.founder_claims (user_id, founder_number)
    values (new.id, founder_spot);
    insert into public.credit_transactions (user_id, amount, reason)
    values (new.id, 10, 'Founding Artist bonus');
  end if;

  return new;
end;
$$;

drop function if exists public.submit_song(
  text, text, text, text, public.music_platform, text, text, text[], text, boolean
);

create or replace function public.submit_song(
  song_title text,
  song_artist_name text,
  song_cover_image_url text,
  song_music_url text,
  song_platform public.music_platform,
  song_genre text,
  song_language text,
  song_feedback_focus text[],
  song_country text,
  song_explicit_content boolean default false,
  song_content_kind text default 'song',
  song_duration_seconds integer default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_song_id uuid;
  submitter_role public.app_role;
  founder_remaining smallint;
  used_founder_submission boolean := false;
  next_queue_tier text := 'public';
  next_approval_status text := 'auto_approved';
  next_active boolean := true;
  normalized_cover text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select role, founder_free_submissions_remaining
  into submitter_role, founder_remaining
  from public.profiles
  where id = auth.uid()
    and account_status = 'active'
    and banned_at is null
  for update;
  if not found then raise exception 'Active account required'; end if;

  normalized_cover := coalesce(
    nullif(trim(song_cover_image_url), ''),
    'https://www.firstlisten.net/covers/default-song.svg'
  );

  if char_length(trim(song_title)) not between 1 and 120
    or char_length(trim(song_artist_name)) not between 1 and 120
    or char_length(trim(song_country)) not between 2 and 120
    or normalized_cover !~* '^https://'
    or char_length(normalized_cover) > 2000
    or char_length(trim(song_music_url)) > 2000
  then
    raise exception 'Required song metadata is invalid';
  end if;

  if song_genre not in (
    'Pop', 'Rock', 'Hip Hop', 'EDM', 'Country', 'Reggaeton',
    'Regional Mexican', 'Cumbia', 'Salsa', 'Bachata', 'Indie',
    'Alternative', 'Jazz', 'Classical', 'Instrumental', 'Other'
  ) then
    raise exception 'Unsupported genre';
  end if;

  if song_content_kind not in (
    'song', 'music_video', 'remix', 'live_session', 'performance', 'long_form'
  ) then
    raise exception 'Unsupported content type';
  end if;

  if song_duration_seconds is not null
    and song_duration_seconds not between 15 and 43200
  then
    raise exception 'Content duration is invalid';
  end if;

  if not public.music_url_matches_platform(song_music_url, song_platform) then
    raise exception 'Unsupported or invalid music link';
  end if;

  if exists (
    select 1
    from public.songs
    where lower(trim(music_url)) = lower(trim(song_music_url))
  ) then
    raise exception 'This song link has already been submitted';
  end if;

  if coalesce(song_duration_seconds, 0) > 480 or song_content_kind = 'long_form' then
    next_queue_tier := 'manual_review';
    next_approval_status := 'pending';
    next_active := false;
  end if;

  if submitter_role <> 'super_admin' then
    if founder_remaining > 0 then
      update public.profiles
      set
        founder_free_submissions_remaining =
          founder_free_submissions_remaining - 1,
        founder_free_submission_available =
          founder_free_submissions_remaining - 1 > 0,
        updated_at = now()
      where id = auth.uid();
      used_founder_submission := true;
    else
      update public.profiles
      set credits = credits - 1, updated_at = now()
      where id = auth.uid() and credits >= 1;
      if not found then raise exception 'One token is required'; end if;

      insert into public.credit_transactions (user_id, amount, reason)
      values (auth.uid(), -1, 'Content submission');
    end if;
  end if;

  insert into public.songs (
    user_id,
    title,
    artist_name,
    cover_image_url,
    music_url,
    platform,
    genre,
    song_language,
    feedback_focus,
    country,
    explicit_content,
    submitted_with_founder_credit,
    is_active,
    media_vertical,
    content_kind,
    content_duration_seconds,
    queue_tier,
    approval_status
  )
  values (
    auth.uid(),
    trim(song_title),
    trim(song_artist_name),
    normalized_cover,
    trim(song_music_url),
    song_platform,
    song_genre,
    song_language,
    song_feedback_focus,
    trim(song_country),
    song_explicit_content,
    used_founder_submission,
    next_active,
    'music',
    song_content_kind,
    song_duration_seconds,
    next_queue_tier,
    next_approval_status
  )
  returning id into new_song_id;

  return new_song_id;
end;
$$;

revoke all on function public.submit_song(
  text, text, text, text, public.music_platform, text, text, text[], text,
  boolean, text, integer
) from public, anon, authenticated;
grant execute on function public.submit_song(
  text, text, text, text, public.music_platform, text, text, text[], text,
  boolean, text, integer
) to authenticated;

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
    and songs.removed_at is null
    and not exists (
      select 1
      from public.reviews
      where reviews.song_id = songs.id
        and reviews.reviewer_id = auth.uid()
    )
    and not exists (
      select 1
      from public.listening_sessions
      where listening_sessions.song_id = songs.id
        and listening_sessions.user_id = auth.uid()
        and listening_sessions.valid_listen_at is not null
    );
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
  set
    status = 'qualified',
    qualified_at = coalesce(qualified_at, now()),
    finished_at = coalesce(finished_at, now()),
    updated_at = now()
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
  novel_seconds numeric;
  countable_seconds integer := 0;
  today_other_seconds integer := 0;
  current_daily_remaining integer;
  heartbeat_valid boolean := false;
  warning_message text := '';
  requirement_seconds integer;
  became_valid boolean := false;
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
      false,
      0,
      current_session.verified_seconds,
      current_daily_remaining,
      current_session.valid_listen_at is not null,
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
  novel_seconds := playback_position_seconds - current_session.max_position_seconds;

  if current_session.last_heartbeat_at is null then
    update public.listening_sessions
    set
      provider_duration_seconds = playback_duration_seconds,
      valid_requirement_seconds = requirement_seconds,
      last_position_seconds = playback_position_seconds,
      max_position_seconds = greatest(max_position_seconds, playback_position_seconds),
      last_heartbeat_at = now(),
      updated_at = now()
    where id = target_session_id;

    update public.songs
    set observed_duration_seconds = requirement_source.duration_seconds
    from (
      select round(playback_duration_seconds)::integer as duration_seconds
    ) requirement_source
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
      false,
      requirement_seconds,
      ''::text;
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
    and playback_duration_seconds between 15 and 43200
    and playback_position_seconds <= playback_duration_seconds + 5
    and elapsed_seconds between 1 and settings.heartbeat_interval_seconds + 20
    and forward_seconds between 1 and elapsed_seconds + 6
    and novel_seconds > 0;

  if heartbeat_valid then
    countable_seconds := greatest(
      0,
      least(
        floor(elapsed_seconds)::integer,
        floor(forward_seconds)::integer,
        floor(novel_seconds)::integer,
        settings.heartbeat_interval_seconds + 5,
        current_daily_remaining
      )
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
    valid_requirement_seconds = requirement_seconds,
    last_position_seconds = playback_position_seconds,
    max_position_seconds = greatest(max_position_seconds, playback_position_seconds),
    verified_seconds = verified_seconds + countable_seconds,
    settled_seconds = settled_seconds + countable_seconds,
    rejected_heartbeats = rejected_heartbeats + case when heartbeat_valid then 0 else 1 end,
    loop_count = loop_count + case when forward_seconds < -3 then 1 else 0 end,
    last_heartbeat_at = now(),
    updated_at = now()
  where id = target_session_id
  returning * into current_session;

  if countable_seconds > 0 then
    update public.profiles
    set
      listening_bank_seconds = listening_bank_seconds + countable_seconds,
      lifetime_listening_seconds = lifetime_listening_seconds + countable_seconds,
      updated_at = now()
    where id = auth.uid();
  end if;

  if current_session.valid_listen_at is null
    and current_session.verified_seconds >= requirement_seconds
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
      auth.uid(),
      1,
      'Valid listen',
      'listening_session',
      target_session_id,
      null
    );
    became_valid := true;
  end if;

  return query
  select
    heartbeat_valid,
    countable_seconds,
    current_session.verified_seconds,
    greatest(0, current_daily_remaining - countable_seconds),
    became_valid or current_session.valid_listen_at is not null,
    requirement_seconds,
    warning_message;
end;
$$;

create or replace function public.finish_listening_session(target_session_id uuid)
returns table (
  verified_seconds integer,
  valid_listen_recorded boolean,
  valid_requirement_seconds integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  session_row public.listening_sessions%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  update public.listening_sessions
  set
    status = 'qualified',
    qualified_at = coalesce(qualified_at, now()),
    finished_at = coalesce(finished_at, now()),
    updated_at = now()
  where id = target_session_id
    and user_id = auth.uid()
    and status = 'active'
  returning * into session_row;

  if not found then
    select *
    into session_row
    from public.listening_sessions
    where id = target_session_id
      and user_id = auth.uid();
  end if;
  if not found then raise exception 'Listening session not found'; end if;

  return query select
    session_row.verified_seconds,
    session_row.valid_listen_at is not null,
    coalesce(session_row.valid_requirement_seconds, 30);
end;
$$;

create or replace function public.advance_spotlight_daily_mission()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not new.quality_passed
    or new.listening_session_id is null
    or not exists (
      select 1
      from public.listening_sessions
      where listening_sessions.id = new.listening_session_id
        and listening_sessions.user_id = new.reviewer_id
        and listening_sessions.song_id = new.song_id
        and listening_sessions.valid_listen_at is not null
    )
    or not exists (
      select 1
      from public.spotlight_slots
      where spotlight_slots.song_id = new.song_id
        and (
          spotlight_slots.active_from is null
          or spotlight_slots.active_from <= now()
        )
        and (
          spotlight_slots.active_until is null
          or spotlight_slots.active_until > now()
        )
    )
  then
    return new;
  end if;

  insert into public.daily_mission_progress (
    user_id,
    mission_id,
    mission_date,
    progress_count,
    completed_at,
    updated_at
  )
  select
    new.reviewer_id,
    missions.id,
    current_date,
    1,
    case when missions.target_count <= 1 then now() end,
    now()
  from public.daily_missions as missions
  where missions.mission_key = 'review_spotlight_songs'
    and missions.active
    and (missions.starts_at is null or missions.starts_at <= now())
    and (missions.ends_at is null or missions.ends_at > now())
  on conflict (user_id, mission_id, mission_date)
  do update set
    progress_count = least(
      (
        select daily_missions.target_count
        from public.daily_missions
        where daily_missions.id = excluded.mission_id
      ),
      daily_mission_progress.progress_count + 1
    ),
    completed_at = case
      when daily_mission_progress.progress_count + 1 >= (
        select daily_missions.target_count
        from public.daily_missions
        where daily_missions.id = excluded.mission_id
      )
      then coalesce(daily_mission_progress.completed_at, now())
      else daily_mission_progress.completed_at
    end,
    updated_at = now();

  return new;
end;
$$;

drop function if exists public.submit_review(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean
);
drop function if exists public.submit_review_with_listening(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean, uuid
);

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
  listening_bank_seconds bigint,
  community_points_awarded integer
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
  current_bank bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(trim(coalesce(review_comment, ''))) not between 30 and 1000 then
    return query select false, 0::smallint, false,
      'Please provide useful feedback.'::text, 0, null::bigint, 0;
    return;
  end if;
  if review_rating not between 1 and 10 then
    raise exception 'Rating must be between 1 and 10';
  end if;
  if not exists (
    select 1
    from public.songs
    where id = reviewed_song_id
      and user_id <> auth.uid()
      and removed_at is null
  ) then
    raise exception 'Song is unavailable for review';
  end if;

  select exists (
    select 1
    from public.reviews
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
      'Please provide useful feedback.'::text, 0, null::bigint, 0;
    return;
  end if;

  if listening_session_id is not null then
    select *
    into session_row
    from public.listening_sessions
    where id = listening_session_id
      and user_id = auth.uid()
      and song_id = reviewed_song_id
      and status in ('active', 'qualified')
    for update;
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
    coalesce(session_row.settled_seconds, 0),
    case
      when session_row.provider_duration_seconds is null then null
      else round(session_row.provider_duration_seconds)::integer
    end,
    case
      when coalesce(session_row.provider_duration_seconds, 0) > 0
      then least(
        100,
        round(
          (session_row.max_position_seconds / session_row.provider_duration_seconds) * 100,
          2
        )
      )
      else null
    end
  )
  returning id into new_review_id;

  update public.profiles as target_profile
  set completed_reviews = completed_reviews + 1, updated_at = now()
  where id = auth.uid()
  returning target_profile.listening_bank_seconds into current_bank;

  if session_row.id is not null then
    update public.listening_sessions
    set review_id = new_review_id, updated_at = now()
    where id = session_row.id;
  end if;

  perform public.award_community_points(
    auth.uid(),
    5,
    'Complete review',
    'review',
    new_review_id,
    null
  );

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
    ''::text,
    0,
    current_bank,
    5;
end;
$$;

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

drop function if exists public.get_listening_bank_status_v2();

create or replace function public.get_listening_bank_status_v2()
returns table (
  bank_seconds bigint,
  pending_seconds bigint,
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
  valid_listens integer
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
      profiles.valid_listens
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
      ), 0)::bigint as monthly_seconds
    from public.listening_sessions
    where user_id = auth.uid()
  )
  select
    profile.listening_bank_seconds,
    0::bigint,
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
    profile.valid_listens
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

create or replace function public.get_listener_impact_profile()
returns table (
  supporting_seconds bigint,
  songs_reviewed integer,
  creators_supported integer,
  valid_listens integer,
  average_listening_seconds numeric,
  days_active integer,
  community_points integer,
  community_rank text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    profiles.lifetime_listening_seconds,
    (
      select count(*)::integer
      from public.reviews
      where reviews.reviewer_id = auth.uid()
        and reviews.quality_passed
    ),
    (
      select count(distinct songs.user_id)::integer
      from public.listening_sessions
      join public.songs on songs.id = listening_sessions.song_id
      where listening_sessions.user_id = auth.uid()
        and listening_sessions.valid_listen_at is not null
    ),
    profiles.valid_listens,
    coalesce((
      select round(avg(listening_sessions.settled_seconds)::numeric, 2)
      from public.listening_sessions
      where listening_sessions.user_id = auth.uid()
        and listening_sessions.valid_listen_at is not null
    ), 0),
    (
      select count(distinct listening_sessions.created_at::date)::integer
      from public.listening_sessions
      where listening_sessions.user_id = auth.uid()
        and listening_sessions.settled_seconds > 0
    ),
    profiles.community_points,
    public.community_rank_name(profiles.community_points)
  from public.profiles
  where profiles.id = auth.uid()
    and profiles.banned_at is null;
$$;

drop function if exists public.get_smart_review_queue(integer);

create or replace function public.get_smart_review_queue(queue_limit integer default 20)
returns table (
  song_id uuid,
  title text,
  artist_name text,
  cover_image_url text,
  music_url text,
  platform public.music_platform,
  genre text,
  song_language text,
  feedback_focus text[],
  country text,
  explicit_content boolean,
  submitted_at timestamptz,
  match_score integer,
  match_reasons text[]
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with reviewer as (
    select
      profiles.languages_understood,
      profiles.genre_preferences,
      profiles.show_explicit_content,
      least(25, profiles.completed_reviews) as activity_score
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.account_status = 'active'
      and profiles.banned_at is null
  ),
  active_boosts as (
    select song_boosts.song_id
    from public.song_boosts
    where song_boosts.status = 'approved'
      and song_boosts.starts_at <= now()
      and song_boosts.ends_at > now()
  ),
  scored as (
    select
      songs.*,
      (
        case
          when songs.song_language = 'Instrumental'
            or songs.song_language = any(reviewer.languages_understood)
          then 100 else 0
        end
        + case
          when songs.genre = any(reviewer.genre_preferences) then 70
          when songs.genre = any(
            array['Reggaeton','Regional Mexican','Cumbia','Salsa','Bachata']::text[]
          ) and reviewer.genre_preferences && array[
            'Reggaeton','Regional Mexican','Cumbia','Salsa','Bachata'
          ]::text[] then 50
          else 0
        end
        + reviewer.activity_score
        + least(
          20,
          floor(extract(epoch from (now() - songs.created_at)) / 86400)
        )::integer
        + case when active_boosts.song_id is null then 0 else 35 end
      ) as computed_match_score,
      array_remove(array[
        case
          when songs.song_language = 'Instrumental'
            or songs.song_language = any(reviewer.languages_understood)
          then songs.song_language
        end,
        case when songs.genre = any(reviewer.genre_preferences) then songs.genre end,
        case when active_boosts.song_id is not null then 'Boosted visibility' end
      ], null) as computed_match_reasons
    from public.songs
    cross join reviewer
    left join active_boosts on active_boosts.song_id = songs.id
    where songs.is_active
      and songs.removed_at is null
      and songs.approval_status in ('auto_approved', 'approved')
      and songs.queue_tier in ('public', 'sponsored')
      and songs.user_id <> auth.uid()
      and (not songs.explicit_content or reviewer.show_explicit_content)
      and not exists (
        select 1
        from public.reviews
        where reviews.song_id = songs.id
          and reviews.reviewer_id = auth.uid()
      )
      and not exists (
        select 1
        from public.listening_sessions
        where listening_sessions.song_id = songs.id
          and listening_sessions.user_id = auth.uid()
          and listening_sessions.valid_listen_at is not null
      )
  )
  select
    scored.id,
    scored.title,
    scored.artist_name,
    scored.cover_image_url,
    scored.music_url,
    scored.platform,
    scored.genre,
    scored.song_language,
    scored.feedback_focus,
    scored.country,
    scored.explicit_content,
    scored.created_at,
    scored.computed_match_score,
    scored.computed_match_reasons
  from scored
  order by scored.computed_match_score desc, scored.created_at asc
  limit greatest(1, least(queue_limit, 50));
$$;

drop function if exists public.get_public_artist_profile(uuid);

create or replace function public.get_public_artist_profile(target_artist_id uuid)
returns table (
  artist_id uuid,
  artist_name text,
  followers integer,
  songs_submitted integer,
  genres text[],
  languages text[],
  is_following boolean,
  average_rating numeric,
  listening_hours_received numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    profiles.id,
    profiles.display_name,
    coalesce(follower_counts.followers, 0)::integer,
    coalesce(song_counts.songs_submitted, 0)::integer,
    coalesce(song_counts.genres, array[]::text[]),
    coalesce(song_counts.languages, array[]::text[]),
    exists (
      select 1
      from public.artist_follows as follows
      where follows.follower_id = auth.uid()
        and follows.artist_id = profiles.id
    ),
    coalesce(artist_metrics.average_rating, 0),
    round(coalesce(artist_metrics.listening_seconds, 0)::numeric / 3600, 2)
  from public.profiles
  left join lateral (
    select count(*)::integer as followers
    from public.artist_follows as follows
    where follows.artist_id = profiles.id
  ) follower_counts on true
  left join lateral (
    select
      count(*)::integer as songs_submitted,
      array_remove(array_agg(distinct songs.genre), null) as genres,
      array_remove(array_agg(distinct songs.song_language), null) as languages
    from public.songs
    where songs.user_id = profiles.id
      and songs.removed_at is null
  ) song_counts on true
  left join lateral (
    select
      round(avg(reviews.rating)::numeric, 2) as average_rating,
      (
        select coalesce(sum(listening_sessions.settled_seconds), 0)::bigint
        from public.listening_sessions
        join public.songs on songs.id = listening_sessions.song_id
        where songs.user_id = profiles.id
      ) as listening_seconds
    from public.reviews
    join public.songs on songs.id = reviews.song_id
    where songs.user_id = profiles.id
      and reviews.quality_passed
  ) artist_metrics on true
  where profiles.id = target_artist_id
    and profiles.account_status = 'active'
    and profiles.banned_at is null;
$$;

drop function if exists public.get_my_song_comments(uuid);

create or replace function public.get_my_song_comments(target_song_id uuid default null)
returns table (
  review_id uuid,
  reviewer_id uuid,
  song_id uuid,
  song_title text,
  rating smallint,
  comment text,
  quality_score smallint,
  helpful boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    reviews.id,
    reviews.reviewer_id,
    songs.id,
    songs.title,
    reviews.rating,
    reviews.comment,
    reviews.quality_score,
    reviews.helpful_at is not null,
    reviews.created_at
  from public.reviews
  join public.songs on songs.id = reviews.song_id
  where songs.user_id = auth.uid()
    and public.is_active_user()
    and (target_song_id is null or songs.id = target_song_id)
    and reviews.comment_removed_at is null
    and nullif(trim(reviews.comment), '') is not null
  order by reviews.created_at desc;
$$;

create or replace function public.mark_review_helpful(target_review_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_reviewer uuid;
begin
  select reviews.reviewer_id
  into target_reviewer
  from public.reviews
  join public.songs on songs.id = reviews.song_id
  where reviews.id = target_review_id
    and songs.user_id = auth.uid()
    and reviews.comment_removed_at is null
  for update of reviews;
  if not found then raise exception 'Review is unavailable'; end if;

  update public.reviews
  set helpful_at = coalesce(helpful_at, now()), helpful_by = auth.uid()
  where id = target_review_id;

  perform public.award_community_points(
    target_reviewer,
    10,
    'Helpful review',
    'helpful_review',
    target_review_id,
    auth.uid()
  );
  return true;
end;
$$;

create or replace function public.report_review_comment(
  target_review_id uuid,
  report_reason text,
  report_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_id uuid;
  target_reviewer uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if report_reason not in (
    'harassment', 'discrimination', 'spam', 'threats', 'personal_attack', 'other'
  ) then
    raise exception 'Invalid report reason';
  end if;

  select reviews.reviewer_id
  into target_reviewer
  from public.reviews
  join public.songs on songs.id = reviews.song_id
  where reviews.id = target_review_id
    and songs.user_id = auth.uid()
    and reviews.comment_removed_at is null;
  if not found then raise exception 'Comment cannot be reported'; end if;

  insert into public.review_comment_reports (
    review_id,
    reporter_id,
    reported_user_id,
    reason,
    details
  )
  values (
    target_review_id,
    auth.uid(),
    target_reviewer,
    report_reason,
    nullif(trim(coalesce(report_details, '')), '')
  )
  returning id into report_id;

  return report_id;
end;
$$;

create or replace function public.admin_moderate_review_comment(
  target_review_id uuid,
  moderation_action text,
  moderation_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_staff() then raise exception 'Forbidden'; end if;
  if moderation_action not in ('remove', 'restore') then
    raise exception 'Invalid moderation action';
  end if;
  if char_length(trim(moderation_reason)) < 3 then
    raise exception 'Moderation reason is required';
  end if;

  update public.reviews
  set
    comment_removed_at = case
      when moderation_action = 'remove' then now()
      else null
    end,
    comment_removed_by = case
      when moderation_action = 'remove' then auth.uid()
      else null
    end,
    comment_removal_reason = case
      when moderation_action = 'remove' then trim(moderation_reason)
      else null
    end
  where id = target_review_id;
  if not found then raise exception 'Review not found'; end if;

  insert into public.admin_audit_log (
    actor_id, action, target_type, target_id, details
  )
  values (
    auth.uid(),
    'moderate_comment',
    'review',
    target_review_id,
    jsonb_build_object(
      'moderation_action', moderation_action,
      'reason', trim(moderation_reason)
    )
  );
end;
$$;

create or replace function public.admin_issue_user_warning(
  target_user_id uuid,
  warning_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  warning_id uuid;
  target_role public.app_role;
begin
  if not public.is_staff() then raise exception 'Forbidden'; end if;
  if char_length(trim(warning_reason)) < 3 then
    raise exception 'Warning reason is required';
  end if;

  select role into target_role
  from public.profiles
  where id = target_user_id;
  if not found then raise exception 'User not found'; end if;
  if public.current_user_role() <> 'super_admin' and target_role <> 'user' then
    raise exception 'Only Super Admin can warn staff accounts';
  end if;

  insert into public.account_warnings (user_id, issued_by, reason)
  values (target_user_id, auth.uid(), trim(warning_reason))
  returning id into warning_id;

  update public.profiles
  set warning_count = warning_count + 1, updated_at = now()
  where id = target_user_id;

  insert into public.admin_audit_log (
    actor_id, action, target_type, target_id, details
  )
  values (
    auth.uid(),
    'issue_warning',
    'profile',
    target_user_id,
    jsonb_build_object('reason', trim(warning_reason))
  );

  return warning_id;
end;
$$;

create or replace function public.admin_enforce_account(
  target_user_id uuid,
  enforcement text,
  enforcement_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_role public.app_role;
begin
  if not public.is_staff() then raise exception 'Forbidden'; end if;
  if enforcement not in ('activate', 'suspend', 'ban') then
    raise exception 'Invalid enforcement action';
  end if;
  if enforcement <> 'activate' and char_length(trim(enforcement_reason)) < 3 then
    raise exception 'Enforcement reason is required';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'You cannot enforce your own account';
  end if;

  select role into target_role
  from public.profiles
  where id = target_user_id;
  if not found then raise exception 'User not found'; end if;
  if public.current_user_role() <> 'super_admin' and target_role <> 'user' then
    raise exception 'Only Super Admin can enforce staff accounts';
  end if;

  update public.profiles
  set
    account_status = case when enforcement = 'activate' then 'active' else 'suspended' end,
    banned_at = case when enforcement = 'ban' then now() else null end,
    banned_by = case when enforcement = 'ban' then auth.uid() else null end,
    ban_reason = case when enforcement = 'ban' then trim(enforcement_reason) else null end,
    updated_at = now()
  where id = target_user_id;

  insert into public.admin_audit_log (
    actor_id, action, target_type, target_id, details
  )
  values (
    auth.uid(),
    'enforce_account',
    'profile',
    target_user_id,
    jsonb_build_object(
      'enforcement', enforcement,
      'reason', trim(coalesce(enforcement_reason, ''))
    )
  );
end;
$$;

create or replace function public.admin_resolve_comment_report(
  target_report_id uuid,
  new_status public.report_status
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_row public.review_comment_reports%rowtype;
  penalty integer := 0;
begin
  if not public.is_staff() then raise exception 'Forbidden'; end if;

  select *
  into report_row
  from public.review_comment_reports
  where id = target_report_id
  for update;
  if not found then raise exception 'Comment report not found'; end if;

  update public.review_comment_reports
  set status = new_status, reviewed_by = auth.uid(), reviewed_at = now()
  where id = target_report_id;

  if new_status = 'resolved' and report_row.status <> 'resolved' then
    perform public.award_community_points(
      report_row.reporter_id,
      15,
      'Verified report',
      'comment_report',
      target_report_id,
      auth.uid()
    );

    select least(10, community_points)
    into penalty
    from public.profiles
    where id = report_row.reported_user_id
    for update;

    if coalesce(penalty, 0) > 0 then
      insert into public.community_point_transactions (
        user_id,
        points,
        reason,
        source_type,
        source_id,
        created_by
      )
      values (
        report_row.reported_user_id,
        -penalty,
        'Verified moderation violation',
        'comment_report_penalty',
        target_report_id,
        auth.uid()
      )
      on conflict do nothing;

      if found then
        update public.profiles
        set community_points = community_points - penalty, updated_at = now()
        where id = report_row.reported_user_id;
      end if;
    end if;
  end if;

  insert into public.admin_audit_log (
    actor_id, action, target_type, target_id, details
  )
  values (
    auth.uid(),
    'resolve_comment_report',
    'review_comment_report',
    target_report_id,
    jsonb_build_object(
      'previous_status', report_row.status,
      'new_status', new_status,
      'reported_user_id', report_row.reported_user_id,
      'community_point_penalty', coalesce(penalty, 0)
    )
  );
end;
$$;

create or replace function public.admin_approve_long_form_song(
  target_song_id uuid,
  approve boolean,
  approval_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Forbidden';
  end if;
  if char_length(trim(approval_reason)) < 3 then
    raise exception 'Approval reason is required';
  end if;

  update public.songs
  set
    approval_status = case when approve then 'approved' else 'rejected' end,
    is_active = approve,
    approved_by = auth.uid(),
    approved_at = now(),
    removed_at = case when approve then null else now() end,
    removed_by = case when approve then null else auth.uid() end,
    updated_at = now()
  where id = target_song_id
    and approval_status = 'pending';
  if not found then raise exception 'Pending content not found'; end if;

  insert into public.admin_audit_log (
    actor_id, action, target_type, target_id, details
  )
  values (
    auth.uid(),
    'review_long_form',
    'song',
    target_song_id,
    jsonb_build_object(
      'approved', approve,
      'reason', trim(approval_reason)
    )
  );
end;
$$;

create or replace function public.get_my_song_dashboard_v2()
returns table (
  song_id uuid,
  artist_id uuid,
  title text,
  artist_name text,
  cover_image_url text,
  music_url text,
  platform public.music_platform,
  genre text,
  song_language text,
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
  listener_retention numeric,
  boost_status text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    songs.id,
    songs.user_id,
    songs.title,
    songs.artist_name,
    songs.cover_image_url,
    songs.music_url,
    songs.platform,
    songs.genre,
    songs.song_language,
    songs.created_at,
    coalesce(review_metrics.reviews_received, 0),
    coalesce(review_metrics.average_rating, 0),
    coalesce(review_metrics.hook_score, 0),
    coalesce(report_counts.report_count, 0),
    coalesce(listening_metrics.total_listening_seconds, 0),
    coalesce(listening_metrics.average_listening_seconds, 0),
    coalesce(listening_metrics.completion_rate, 0),
    coalesce(review_metrics.playlist_intent, 0),
    coalesce(review_metrics.share_intent, 0),
    coalesce(listening_metrics.listener_retention, 0),
    boost_state.status::text
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
      round(avg(case when reviews.add_to_playlist then 100 else 0 end)::numeric, 2)
        as playlist_intent,
      round(avg(case when reviews.share_with_friend then 100 else 0 end)::numeric, 2)
        as share_intent
    from public.reviews
    where reviews.song_id = songs.id
      and reviews.quality_passed
  ) review_metrics on true
  left join lateral (
    select
      coalesce(sum(listening_sessions.settled_seconds), 0)::bigint
        as total_listening_seconds,
      round(
        avg(listening_sessions.settled_seconds)
          filter (where listening_sessions.settled_seconds > 0),
        2
      ) as average_listening_seconds,
      round(
        avg(
          case
            when listening_sessions.provider_duration_seconds > 0
              and listening_sessions.max_position_seconds /
                listening_sessions.provider_duration_seconds >= 0.9
            then 100
            else 0
          end
        ) filter (
          where listening_sessions.provider_duration_seconds > 0
        ),
        2
      ) as completion_rate,
      round(
        avg(
          least(
            100,
            listening_sessions.max_position_seconds /
              nullif(listening_sessions.provider_duration_seconds, 0) * 100
          )
        ) filter (
          where listening_sessions.provider_duration_seconds > 0
        ),
        2
      ) as listener_retention
    from public.listening_sessions
    where listening_sessions.song_id = songs.id
      and listening_sessions.settled_seconds > 0
  ) listening_metrics on true
  left join lateral (
    select count(*)::integer as report_count
    from public.song_reports
    where song_reports.song_id = songs.id
  ) report_counts on true
  left join lateral (
    select song_boosts.status
    from public.song_boosts
    where song_boosts.song_id = songs.id
      and song_boosts.status in ('pending', 'approved')
    order by song_boosts.requested_at desc
    limit 1
  ) boost_state on true
  where songs.user_id = auth.uid()
    and public.is_active_user()
  order by songs.created_at desc;
$$;

revoke all on function public.start_listening_session(uuid)
  from public, anon, authenticated;
revoke all on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) from public, anon, authenticated;
revoke all on function public.finish_listening_session(uuid)
  from public, anon, authenticated;
revoke all on function public.submit_review_with_listening(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean, uuid
) from public, anon, authenticated;
revoke all on function public.submit_review(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean
) from public, anon, authenticated;
revoke all on function public.get_listening_bank_status_v2()
  from public, anon, authenticated;
revoke all on function public.get_listener_impact_profile()
  from public, anon, authenticated;
revoke all on function public.get_smart_review_queue(integer)
  from public, anon, authenticated;
revoke all on function public.get_public_artist_profile(uuid)
  from public, anon, authenticated;
revoke all on function public.get_my_song_comments(uuid)
  from public, anon, authenticated;
revoke all on function public.mark_review_helpful(uuid)
  from public, anon, authenticated;
revoke all on function public.report_review_comment(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_moderate_review_comment(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_issue_user_warning(uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_enforce_account(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_resolve_comment_report(uuid, public.report_status)
  from public, anon, authenticated;
revoke all on function public.admin_approve_long_form_song(uuid, boolean, text)
  from public, anon, authenticated;

grant execute on function public.start_listening_session(uuid) to authenticated;
grant execute on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) to authenticated;
grant execute on function public.finish_listening_session(uuid) to authenticated;
grant execute on function public.submit_review_with_listening(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean, uuid
) to authenticated;
grant execute on function public.submit_review(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean
) to authenticated;
grant execute on function public.get_listening_bank_status_v2() to authenticated;
grant execute on function public.get_listener_impact_profile() to authenticated;
grant execute on function public.get_smart_review_queue(integer) to authenticated;
grant execute on function public.get_public_artist_profile(uuid) to anon, authenticated;
grant execute on function public.get_my_song_comments(uuid) to authenticated;
grant execute on function public.mark_review_helpful(uuid) to authenticated;
grant execute on function public.report_review_comment(uuid, text, text) to authenticated;
grant execute on function public.admin_moderate_review_comment(uuid, text, text)
  to authenticated;
grant execute on function public.admin_issue_user_warning(uuid, text) to authenticated;
grant execute on function public.admin_enforce_account(uuid, text, text) to authenticated;
grant execute on function public.admin_resolve_comment_report(uuid, public.report_status)
  to authenticated;
grant execute on function public.admin_approve_long_form_song(uuid, boolean, text)
  to authenticated;

create or replace function public.master_alpha_health_report()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'tables', jsonb_build_object(
      'community_point_transactions',
        to_regclass('public.community_point_transactions') is not null,
      'review_comment_reports',
        to_regclass('public.review_comment_reports') is not null,
      'account_warnings',
        to_regclass('public.account_warnings') is not null
    ),
    'functions', jsonb_build_object(
      'record_listening_heartbeat',
        to_regprocedure(
          'public.record_listening_heartbeat(uuid,numeric,numeric,text,boolean,numeric,boolean,boolean,boolean)'
        ) is not null,
      'finish_listening_session',
        to_regprocedure('public.finish_listening_session(uuid)') is not null,
      'get_listener_impact_profile',
        to_regprocedure('public.get_listener_impact_profile()') is not null,
      'mark_review_helpful',
        to_regprocedure('public.mark_review_helpful(uuid)') is not null,
      'report_review_comment',
        to_regprocedure('public.report_review_comment(uuid,text,text)') is not null,
      'admin_enforce_account',
        to_regprocedure('public.admin_enforce_account(uuid,text,text)') is not null,
      'admin_approve_long_form_song',
        to_regprocedure('public.admin_approve_long_form_song(uuid,boolean,text)') is not null
    ),
    'rls', jsonb_build_object(
      'community_point_transactions', coalesce((
        select relrowsecurity
        from pg_class
        where oid = 'public.community_point_transactions'::regclass
      ), false),
      'review_comment_reports', coalesce((
        select relrowsecurity
        from pg_class
        where oid = 'public.review_comment_reports'::regclass
      ), false),
      'account_warnings', coalesce((
        select relrowsecurity
        from pg_class
        where oid = 'public.account_warnings'::regclass
      ), false)
    ),
    'invalid_founder_submission_balances', (
      select count(*)
      from public.profiles
      where founder_free_submissions_remaining not between 0 and 3
    ),
    'community_point_balance_mismatches', (
      select count(*)
      from public.profiles
      left join (
        select user_id, coalesce(sum(points), 0)::integer as ledger_points
        from public.community_point_transactions
        group by user_id
      ) ledger on ledger.user_id = profiles.id
      where profiles.community_points <> coalesce(ledger.ledger_points, 0)
    ),
    'orphan_comment_reports', (
      select count(*)
      from public.review_comment_reports
      left join public.reviews
        on reviews.id = review_comment_reports.review_id
      where reviews.id is null
    ),
    'invalid_active_long_form', (
      select count(*)
      from public.songs
      where is_active
        and removed_at is null
        and (
          content_duration_seconds > 480
          or content_kind = 'long_form'
        )
        and approval_status not in ('approved')
    ),
    'valid_listens', (
      select count(*)
      from public.listening_sessions
      where valid_listen_at is not null
    )
  );
$$;

revoke all on function public.master_alpha_health_report()
  from public, anon, authenticated;
grant execute on function public.master_alpha_health_report() to service_role;
