-- Twenty-four hour guest listening with no Auth account, rewards, uploads,
-- rankings, follows, or public profile.

create table if not exists public.guest_sessions (
  id uuid primary key default uuid_generate_v4(),
  access_token uuid not null unique default uuid_generate_v4(),
  valid_listens integer not null default 0 check (valid_listens >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  last_seen_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table if not exists public.guest_listening_sessions (
  id uuid primary key default uuid_generate_v4(),
  guest_session_id uuid not null
    references public.guest_sessions(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  platform public.music_platform not null,
  status text not null default 'active'
    check (status in ('active', 'finished')),
  telemetry_supported boolean not null default false,
  verified_seconds integer not null default 0 check (verified_seconds >= 0),
  provider_duration_seconds numeric,
  valid_requirement_seconds integer not null default 30
    check (valid_requirement_seconds between 15 and 120),
  last_position_seconds numeric,
  max_position_seconds numeric not null default 0,
  last_heartbeat_at timestamptz,
  valid_listen_at timestamptz,
  complete_listen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guest_session_id, song_id)
);

create index if not exists guest_sessions_expiry_idx
  on public.guest_sessions (expires_at);
create index if not exists guest_listening_sessions_guest_idx
  on public.guest_listening_sessions (guest_session_id, created_at desc);
create index if not exists guest_listening_sessions_song_idx
  on public.guest_listening_sessions (song_id, valid_listen_at)
  where valid_listen_at is not null;

alter table public.guest_sessions enable row level security;
alter table public.guest_listening_sessions enable row level security;

revoke all on table public.guest_sessions
  from public, anon, authenticated;
revoke all on table public.guest_listening_sessions
  from public, anon, authenticated;

create or replace function public.start_guest_session(
  existing_access_token uuid default null
)
returns table (
  guest_access_token uuid,
  expires_at timestamptz,
  valid_listens integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  active_guest public.guest_sessions%rowtype;
begin
  if existing_access_token is not null then
    select *
    into active_guest
    from public.guest_sessions
    where access_token = existing_access_token
      and expires_at > now()
    for update;
  end if;

  if active_guest.id is null then
    insert into public.guest_sessions default values
    returning * into active_guest;
  else
    update public.guest_sessions
    set last_seen_at = now()
    where id = active_guest.id;
  end if;

  return query
  select
    active_guest.access_token,
    active_guest.expires_at,
    active_guest.valid_listens;
end;
$$;

create or replace function public.get_guest_song_queue(
  guest_access_token uuid,
  queue_limit integer default 12
)
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
  feedback_focus text[],
  country text,
  explicit_content boolean,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  active_guest_id uuid;
begin
  select id
  into active_guest_id
  from public.guest_sessions
  where access_token = guest_access_token
    and expires_at > now();

  if active_guest_id is null then
    raise exception 'Guest access has expired';
  end if;

  update public.guest_sessions
  set last_seen_at = now()
  where id = active_guest_id;

  return query
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
    songs.feedback_focus,
    songs.country,
    songs.explicit_content,
    songs.created_at
  from public.songs
  join public.profiles as creators on creators.id = songs.user_id
  left join public.spotlight_slots as slots
    on slots.song_id = songs.id
    and (slots.active_from is null or slots.active_from <= now())
    and (slots.active_until is null or slots.active_until > now())
  where songs.is_active
    and songs.removed_at is null
    and not songs.explicit_content
    and songs.approval_status in ('auto_approved', 'approved')
    and songs.queue_tier in ('public', 'sponsored')
    and creators.account_status = 'active'
    and creators.banned_at is null
    and coalesce(creators.last_contribution_at, creators.created_at)
      > now() - interval '14 days'
    and not exists (
      select 1
      from public.guest_listening_sessions as guest_listens
      where guest_listens.guest_session_id = active_guest_id
        and guest_listens.song_id = songs.id
        and guest_listens.valid_listen_at is not null
    )
  order by
    slots.slot_number nulls last,
    songs.created_at asc
  limit greatest(1, least(queue_limit, 24));
end;
$$;

create or replace function public.start_guest_listening_session(
  guest_access_token uuid,
  target_song_id uuid
)
returns table (
  listening_session_id uuid,
  heartbeat_interval_seconds integer,
  valid_requirement_seconds integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  active_guest_id uuid;
  target_platform public.music_platform;
  active_listening_id uuid;
begin
  select id
  into active_guest_id
  from public.guest_sessions
  where access_token = guest_access_token
    and expires_at > now()
  for update;
  if active_guest_id is null then raise exception 'Guest access has expired'; end if;

  if (
    select count(*)
    from public.guest_listening_sessions
    where guest_session_id = active_guest_id
      and created_at >= now() - interval '1 minute'
  ) >= 8 then
    raise exception 'Please wait before starting another song';
  end if;

  select songs.platform
  into target_platform
  from public.songs
  join public.profiles as creators on creators.id = songs.user_id
  where songs.id = target_song_id
    and songs.is_active
    and songs.removed_at is null
    and not songs.explicit_content
    and songs.approval_status in ('auto_approved', 'approved')
    and creators.account_status = 'active'
    and creators.banned_at is null;
  if target_platform is null then raise exception 'Song is unavailable'; end if;

  update public.guest_listening_sessions
  set status = 'finished', updated_at = now()
  where guest_session_id = active_guest_id
    and status = 'active'
    and song_id <> target_song_id;

  insert into public.guest_listening_sessions (
    guest_session_id,
    song_id,
    platform,
    telemetry_supported
  )
  values (
    active_guest_id,
    target_song_id,
    target_platform,
    target_platform in ('youtube', 'youtube_music', 'soundcloud')
  )
  on conflict (guest_session_id, song_id)
  do update set
    status = 'active',
    updated_at = now()
  returning id into active_listening_id;

  update public.guest_sessions
  set last_seen_at = now()
  where id = active_guest_id;

  return query select active_listening_id, 10, 30;
end;
$$;

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
  active_guest public.guest_sessions%rowtype;
  current_session public.guest_listening_sessions%rowtype;
  target_artist_id uuid;
  elapsed_seconds numeric;
  forward_seconds numeric;
  novel_seconds numeric;
  counted_seconds integer := 0;
  requirement_seconds integer;
  engagement_valid boolean := false;
  became_valid boolean := false;
  became_complete boolean := false;
  warning_message text := '';
begin
  select *
  into active_guest
  from public.guest_sessions
  where access_token = guest_access_token
    and expires_at > now();
  if active_guest.id is null then raise exception 'Guest access has expired'; end if;

  select *
  into current_session
  from public.guest_listening_sessions
  where id = target_session_id
    and guest_session_id = active_guest.id
  for update;
  if current_session.id is null then raise exception 'Guest listening session not found'; end if;

  requirement_seconds := case
    when playback_duration_seconds between 15 and 43200
      then least(120, greatest(30, ceil(playback_duration_seconds * 0.25)::integer))
    else current_session.valid_requirement_seconds
  end;

  if current_session.status <> 'active' then
    return query select
      false,
      0,
      current_session.verified_seconds,
      current_session.valid_listen_at is not null,
      current_session.complete_listen_at is not null,
      requirement_seconds,
      'Listening session is no longer active.'::text;
    return;
  end if;

  if current_session.last_heartbeat_at is null then
    update public.guest_listening_sessions
    set
      provider_duration_seconds = playback_duration_seconds,
      valid_requirement_seconds = requirement_seconds,
      last_position_seconds = playback_position_seconds,
      max_position_seconds = greatest(max_position_seconds, playback_position_seconds),
      last_heartbeat_at = now(),
      updated_at = now()
    where id = target_session_id;

    return query select
      false,
      0,
      current_session.verified_seconds,
      current_session.valid_listen_at is not null,
      current_session.complete_listen_at is not null,
      requirement_seconds,
      ''::text;
    return;
  end if;

  elapsed_seconds := extract(epoch from (now() - current_session.last_heartbeat_at));
  forward_seconds := playback_position_seconds - current_session.last_position_seconds;
  novel_seconds := playback_position_seconds - current_session.max_position_seconds;

  engagement_valid :=
    current_session.telemetry_supported
    and playback_state in ('playing', 'ended')
    and playback_muted is false
    and coalesce(playback_volume, 0) > 0
    and page_visible
    and page_focused
    and interaction_recent
    and playback_position_seconds >= 0
    and playback_duration_seconds between 15 and 43200
    and playback_position_seconds <= playback_duration_seconds + 5
    and elapsed_seconds between 1 and 32
    and forward_seconds between 1 and elapsed_seconds + 6
    and novel_seconds > 0;

  if engagement_valid then
    counted_seconds := greatest(
      0,
      least(
        floor(elapsed_seconds)::integer,
        floor(forward_seconds)::integer,
        floor(novel_seconds)::integer,
        15
      )
    );
  elsif not current_session.telemetry_supported then
    warning_message := 'This provider does not expose verifiable playback.';
  elsif playback_state not in ('playing', 'ended') then
    warning_message := 'Playback is not active.';
  elsif playback_muted or coalesce(playback_volume, 0) <= 0 then
    warning_message := 'Muted playback is not counted.';
  elsif not page_visible or not page_focused then
    warning_message := 'Keep First Listen visible while supporting this artist.';
  elsif not interaction_recent then
    warning_message := 'Interact with the session to continue.';
  elsif novel_seconds <= 0 then
    warning_message := 'Replayed sections are not counted twice.';
  elsif not engagement_valid then
    warning_message := 'Playback progress could not be verified.';
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
  then
    update public.guest_listening_sessions
    set valid_listen_at = now(), updated_at = now()
    where id = target_session_id;

    update public.guest_sessions
    set valid_listens = valid_listens + 1, last_seen_at = now()
    where id = active_guest.id;

    select songs.user_id
    into target_artist_id
    from public.songs
    where songs.id = current_session.song_id;

    insert into public.community_notifications (
      recipient_id,
      actor_id,
      song_id,
      event_type,
      actor_visibility,
      source_id
    )
    values (
      target_artist_id,
      null,
      current_session.song_id,
      'valid_listen',
      'anonymous',
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

create or replace function public.finish_guest_listening_session(
  guest_access_token uuid,
  target_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.guest_listening_sessions as sessions
  set status = 'finished', updated_at = now()
  from public.guest_sessions as guests
  where sessions.id = target_session_id
    and sessions.guest_session_id = guests.id
    and guests.access_token = guest_access_token;
end;
$$;

revoke all on function public.start_guest_session(uuid)
  from public, anon, authenticated;
revoke all on function public.get_guest_song_queue(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.start_guest_listening_session(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.record_guest_listening_heartbeat(
  uuid, uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) from public, anon, authenticated;
revoke all on function public.finish_guest_listening_session(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.start_guest_session(uuid)
  to anon, authenticated;
grant execute on function public.get_guest_song_queue(uuid, integer)
  to anon, authenticated;
grant execute on function public.start_guest_listening_session(uuid, uuid)
  to anon, authenticated;
grant execute on function public.record_guest_listening_heartbeat(
  uuid, uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) to anon, authenticated;
grant execute on function public.finish_guest_listening_session(uuid, uuid)
  to anon, authenticated;

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
  listening_hours_received numeric,
  valid_listens_received integer,
  complete_listens_received integer,
  community_rank text,
  activity_status public.creator_activity_status
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
    round(coalesce(artist_metrics.listening_seconds, 0)::numeric / 3600, 2),
    coalesce(artist_metrics.valid_listens_received, 0)::integer,
    coalesce(artist_metrics.complete_listens_received, 0)::integer,
    public.community_rank_name(profiles.community_points),
    case
      when coalesce(profiles.last_contribution_at, profiles.created_at)
        <= now() - interval '60 days'
        then 'archived'::public.creator_activity_status
      when coalesce(profiles.last_contribution_at, profiles.created_at)
        <= now() - interval '14 days'
        then 'paused'::public.creator_activity_status
      else 'active'::public.creator_activity_status
    end
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
      (
        select round(avg(reviews.rating)::numeric, 2)
        from public.reviews
        join public.songs on songs.id = reviews.song_id
        where songs.user_id = profiles.id
          and reviews.quality_passed
      ) as average_rating,
      (
        coalesce((
          select sum(listens.settled_seconds)
          from public.listening_sessions as listens
          join public.songs on songs.id = listens.song_id
          where songs.user_id = profiles.id
            and listens.reward_eligible
        ), 0)
        +
        coalesce((
          select sum(guest_listens.verified_seconds)
          from public.guest_listening_sessions as guest_listens
          join public.songs on songs.id = guest_listens.song_id
          where songs.user_id = profiles.id
        ), 0)
      )::bigint as listening_seconds,
      (
        (
          select count(*)
          from public.listening_sessions as listens
          join public.songs on songs.id = listens.song_id
          where songs.user_id = profiles.id
            and listens.reward_eligible
            and listens.valid_listen_at is not null
        )
        +
        (
          select count(*)
          from public.guest_listening_sessions as guest_listens
          join public.songs on songs.id = guest_listens.song_id
          where songs.user_id = profiles.id
            and guest_listens.valid_listen_at is not null
        )
      )::integer as valid_listens_received,
      (
        (
          select count(*)
          from public.listening_sessions as listens
          join public.songs on songs.id = listens.song_id
          where songs.user_id = profiles.id
            and listens.reward_eligible
            and listens.complete_listen_at is not null
        )
        +
        (
          select count(*)
          from public.guest_listening_sessions as guest_listens
          join public.songs on songs.id = guest_listens.song_id
          where songs.user_id = profiles.id
            and guest_listens.complete_listen_at is not null
        )
      )::integer as complete_listens_received
  ) artist_metrics on true
  where profiles.id = target_artist_id
    and profiles.account_status = 'active'
    and profiles.banned_at is null;
$$;

create or replace function public.get_public_artist_activity(
  target_artist_id uuid,
  activity_limit integer default 12
)
returns table (
  event_id uuid,
  event_type text,
  actor_id uuid,
  actor_name text,
  song_id uuid,
  song_title text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with activity as (
    select
      events.id,
      events.event_type,
      case
        when (
          events.event_type = 'follow'
          or (events.visibility = 'public' and actors.community_visibility = 'public')
        )
          and actors.account_status = 'active'
          and actors.banned_at is null
        then actors.id
        else null
      end as actor_id,
      case
        when (
          events.event_type = 'follow'
          or (events.visibility = 'public' and actors.community_visibility = 'public')
        )
          and actors.account_status = 'active'
          and actors.banned_at is null
        then coalesce(actors.display_name, 'Former member')
        else 'Anonymous Listener'
      end as actor_name,
      events.song_id,
      songs.title as song_title,
      events.created_at
    from public.community_support_events as events
    left join public.profiles as actors on actors.id = events.supporter_id
    left join public.songs on songs.id = events.song_id
    where events.artist_id = target_artist_id

    union all

    select
      guest_listens.id,
      'valid_listen'::text,
      null::uuid,
      'Anonymous Listener'::text,
      guest_listens.song_id,
      songs.title,
      guest_listens.valid_listen_at
    from public.guest_listening_sessions as guest_listens
    join public.songs on songs.id = guest_listens.song_id
    where songs.user_id = target_artist_id
      and guest_listens.valid_listen_at is not null
  )
  select
    activity.id,
    activity.event_type,
    activity.actor_id,
    activity.actor_name,
    activity.song_id,
    activity.song_title,
    activity.created_at
  from activity
  where exists (
    select 1
    from public.profiles as artists
    where artists.id = target_artist_id
      and artists.account_status = 'active'
      and artists.banned_at is null
  )
  order by activity.created_at desc
  limit greatest(1, least(activity_limit, 50));
$$;

create or replace function public.guest_experience_health_report()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'tables', jsonb_build_object(
      'guest_sessions', to_regclass('public.guest_sessions') is not null,
      'guest_listening_sessions',
        to_regclass('public.guest_listening_sessions') is not null
    ),
    'rls', jsonb_build_object(
      'guest_sessions', coalesce((
        select relrowsecurity
        from pg_class
        where oid = 'public.guest_sessions'::regclass
      ), false),
      'guest_listening_sessions', coalesce((
        select relrowsecurity
        from pg_class
        where oid = 'public.guest_listening_sessions'::regclass
      ), false)
    ),
    'orphan_listens', (
      select count(*)
      from public.guest_listening_sessions as listens
      left join public.guest_sessions as guests
        on guests.id = listens.guest_session_id
      left join public.songs on songs.id = listens.song_id
      where guests.id is null or songs.id is null
    ),
    'active_sessions', (
      select count(*)
      from public.guest_sessions
      where expires_at > now()
    )
  );
$$;

revoke all on function public.guest_experience_health_report()
  from public, anon, authenticated;
grant execute on function public.guest_experience_health_report()
  to service_role;
