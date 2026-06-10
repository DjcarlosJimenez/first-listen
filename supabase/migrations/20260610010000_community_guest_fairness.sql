-- Persistent guest identity, community song interactions, continuous listening
-- accounting, 24-hour valid-listen fairness, and Spotlight mission repair.

alter table public.guest_sessions
  add column if not exists nickname text,
  add column if not exists guest_listener_id text,
  add column if not exists recovery_code text,
  add column if not exists interface_language text not null default 'en',
  add column if not exists converted_to_user_id uuid
    references public.profiles(id) on delete set null;

alter table public.guest_sessions
  drop constraint if exists guest_sessions_check;
alter table public.guest_sessions
  alter column expires_at drop not null;

update public.guest_sessions
set
  nickname = coalesce(
    nullif(trim(nickname), ''),
    'Listener ' || upper(substr(replace(id::text, '-', ''), 1, 6))
  ),
  guest_listener_id = coalesce(
    guest_listener_id,
    'FL-' ||
      upper(substr(replace(id::text, '-', ''), 1, 4)) || '-' ||
      upper(substr(replace(id::text, '-', ''), 5, 4))
  ),
  recovery_code = coalesce(
    recovery_code,
    'MUSIC-' ||
      upper(substr(md5(id::text || created_at::text), 1, 5)) || '-' ||
      upper(substr(md5(access_token::text), 1, 4))
  ),
  expires_at = null;

alter table public.guest_sessions
  alter column nickname set not null,
  alter column guest_listener_id set not null,
  alter column recovery_code set not null;

alter table public.guest_sessions
  drop constraint if exists guest_sessions_nickname_check;
alter table public.guest_sessions
  add constraint guest_sessions_nickname_check
  check (
    char_length(trim(nickname)) between 2 and 30
    and lower(trim(nickname)) not in (
      'anonymous',
      'anonymous user',
      'guest',
      'guest listener',
      'anonymous listener'
    )
  );

alter table public.guest_sessions
  drop constraint if exists guest_sessions_interface_language_check;
alter table public.guest_sessions
  add constraint guest_sessions_interface_language_check
  check (interface_language in ('en', 'es'));

create unique index if not exists guest_sessions_listener_id_idx
  on public.guest_sessions (guest_listener_id);
create unique index if not exists guest_sessions_recovery_code_idx
  on public.guest_sessions (upper(recovery_code));

alter table public.guest_listening_sessions
  drop constraint if exists
    guest_listening_sessions_guest_session_id_song_id_key;

with ranked_active_sessions as (
  select
    id,
    row_number() over (
      partition by guest_session_id
      order by created_at desc, id desc
    ) as active_order
  from public.guest_listening_sessions
  where status = 'active'
)
update public.guest_listening_sessions as sessions
set
  status = 'finished',
  updated_at = now()
from ranked_active_sessions
where sessions.id = ranked_active_sessions.id
  and ranked_active_sessions.active_order > 1;

create unique index if not exists guest_listening_one_active_idx
  on public.guest_listening_sessions (guest_session_id)
  where status = 'active';

drop index if exists public.listening_sessions_one_reward_ledger_idx;

create table if not exists public.guest_artist_follows (
  guest_session_id uuid not null
    references public.guest_sessions(id) on delete cascade,
  artist_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (guest_session_id, artist_id)
);

create table if not exists public.guest_saved_songs (
  guest_session_id uuid not null
    references public.guest_sessions(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (guest_session_id, song_id)
);

create table if not exists public.song_likes (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade,
  guest_session_id uuid references public.guest_sessions(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (num_nonnulls(user_id, guest_session_id) = 1)
);

create unique index if not exists song_likes_user_song_idx
  on public.song_likes (user_id, song_id)
  where user_id is not null;
create unique index if not exists song_likes_guest_song_idx
  on public.song_likes (guest_session_id, song_id)
  where guest_session_id is not null;

create table if not exists public.song_comments (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete set null,
  guest_session_id uuid references public.guest_sessions(id) on delete set null,
  song_id uuid not null references public.songs(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 2 and 1000),
  removed_at timestamptz,
  removed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(user_id, guest_session_id) <= 1)
);

create index if not exists song_comments_song_idx
  on public.song_comments (song_id, created_at desc)
  where removed_at is null;

create table if not exists public.song_shares (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete set null,
  guest_session_id uuid references public.guest_sessions(id) on delete set null,
  song_id uuid not null references public.songs(id) on delete cascade,
  share_kind text not null
    check (share_kind in ('community', 'original_platform')),
  platform text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(user_id, guest_session_id) <= 1),
  check (
    (share_kind = 'community' and platform is null)
    or
    (share_kind = 'original_platform' and nullif(trim(platform), '') is not null)
  )
);

create index if not exists song_shares_song_idx
  on public.song_shares (song_id, share_kind, created_at desc);

create table if not exists public.song_views (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete set null,
  guest_session_id uuid references public.guest_sessions(id) on delete set null,
  song_id uuid not null references public.songs(id) on delete cascade,
  view_date date not null default current_date,
  created_at timestamptz not null default now(),
  check (num_nonnulls(user_id, guest_session_id) <= 1)
);

create unique index if not exists song_views_user_daily_idx
  on public.song_views (user_id, song_id, view_date)
  where user_id is not null;
create unique index if not exists song_views_guest_daily_idx
  on public.song_views (guest_session_id, song_id, view_date)
  where guest_session_id is not null;

create table if not exists public.daily_mission_song_completions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  mission_id uuid not null references public.daily_missions(id) on delete cascade,
  mission_date date not null default current_date,
  song_id uuid not null references public.songs(id) on delete cascade,
  listening_session_id uuid not null
    references public.listening_sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, mission_id, mission_date, song_id)
);

update public.daily_missions
set
  title_en = 'Listen to 2 Spotlight songs',
  title_es = 'Escucha 2 canciones Spotlight',
  description_en =
    'Complete valid listens for two different Spotlight songs today.',
  description_es =
    'Completa escuchas válidas de dos canciones Spotlight diferentes hoy.'
where mission_key = 'review_spotlight_songs';

alter table public.guest_artist_follows enable row level security;
alter table public.guest_saved_songs enable row level security;
alter table public.song_likes enable row level security;
alter table public.song_comments enable row level security;
alter table public.song_shares enable row level security;
alter table public.song_views enable row level security;
alter table public.daily_mission_song_completions enable row level security;

revoke all on table public.guest_artist_follows from public, anon, authenticated;
revoke all on table public.guest_saved_songs from public, anon, authenticated;
revoke all on table public.song_likes from public, anon, authenticated;
revoke all on table public.song_comments from public, anon, authenticated;
revoke all on table public.song_shares from public, anon, authenticated;
revoke all on table public.song_views from public, anon, authenticated;
revoke all on table public.daily_mission_song_completions
  from public, anon, authenticated;

alter table public.community_notifications
  add column if not exists actor_display_name text;

create or replace function public.resolve_guest_session(
  guest_access_token uuid
)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select guest_sessions.id
  from public.guest_sessions
  where guest_sessions.access_token = guest_access_token
    and guest_sessions.converted_to_user_id is null;
$$;

revoke all on function public.resolve_guest_session(uuid)
  from public, anon, authenticated;

create or replace function public.create_guest_identity(
  guest_nickname text,
  guest_language text default 'en'
)
returns table (
  guest_access_token uuid,
  guest_listener_id text,
  recovery_code text,
  nickname text,
  interface_language text,
  valid_listens integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  created_guest public.guest_sessions%rowtype;
  normalized_nickname text := trim(guest_nickname);
  normalized_language text := case when guest_language = 'es' then 'es' else 'en' end;
begin
  if char_length(normalized_nickname) not between 2 and 30
    or lower(normalized_nickname) in (
      'anonymous',
      'anonymous user',
      'guest',
      'guest listener',
      'anonymous listener'
    )
  then
    raise exception 'Choose a nickname between 2 and 30 characters';
  end if;

  insert into public.guest_sessions (
    nickname,
    guest_listener_id,
    recovery_code,
    interface_language,
    expires_at
  )
  values (
    normalized_nickname,
    'FL-' || upper(substr(md5(gen_random_uuid()::text), 1, 4)) || '-' ||
      upper(substr(md5(clock_timestamp()::text || random()::text), 1, 4)),
    'MUSIC-' || upper(substr(md5(gen_random_uuid()::text), 1, 5)) || '-' ||
      upper(substr(md5(clock_timestamp()::text || random()::text), 1, 4)),
    normalized_language,
    null
  )
  returning * into created_guest;

  return query
  select
    created_guest.access_token,
    created_guest.guest_listener_id,
    created_guest.recovery_code,
    created_guest.nickname,
    created_guest.interface_language,
    created_guest.valid_listens;
end;
$$;

create or replace function public.recover_guest_identity(
  submitted_recovery_code text
)
returns table (
  guest_access_token uuid,
  guest_listener_id text,
  recovery_code text,
  nickname text,
  interface_language text,
  valid_listens integer
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.guest_sessions
  set last_seen_at = now()
  where upper(recovery_code) = upper(trim(submitted_recovery_code))
    and converted_to_user_id is null
  returning
    access_token,
    guest_listener_id,
    recovery_code,
    nickname,
    interface_language,
    valid_listens;
$$;

create or replace function public.get_guest_identity(
  guest_access_token uuid
)
returns table (
  guest_listener_id text,
  recovery_code text,
  nickname text,
  interface_language text,
  valid_listens integer
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.guest_sessions
  set last_seen_at = now()
  where access_token = guest_access_token
    and converted_to_user_id is null
  returning
    guest_listener_id,
    recovery_code,
    nickname,
    interface_language,
    valid_listens;
$$;

create or replace function public.update_guest_language(
  guest_access_token uuid,
  guest_language text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if guest_language not in ('en', 'es') then
    raise exception 'Unsupported language';
  end if;

  update public.guest_sessions
  set interface_language = guest_language, last_seen_at = now()
  where access_token = guest_access_token
    and converted_to_user_id is null;

  if not found then raise exception 'Guest profile not found'; end if;
end;
$$;

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
      and converted_to_user_id is null
    for update;
  end if;

  if active_guest.id is null then
    insert into public.guest_sessions (
      nickname,
      guest_listener_id,
      recovery_code,
      expires_at
    )
    values (
      'Listener ' || upper(substr(md5(gen_random_uuid()::text), 1, 6)),
      'FL-' || upper(substr(md5(gen_random_uuid()::text), 1, 4)) || '-' ||
        upper(substr(md5(clock_timestamp()::text || random()::text), 1, 4)),
      'MUSIC-' || upper(substr(md5(gen_random_uuid()::text), 1, 5)) || '-' ||
        upper(substr(md5(clock_timestamp()::text || random()::text), 1, 4)),
      null
    )
    returning * into active_guest;
  else
    update public.guest_sessions
    set last_seen_at = now()
    where id = active_guest.id;
  end if;

  return query
  select active_guest.access_token, null::timestamptz, active_guest.valid_listens;
end;
$$;

drop function if exists public.get_guest_song_queue(uuid, integer);
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
language sql
security definer
set search_path = pg_catalog, public
as $$
  with active_guest as (
    select public.resolve_guest_session(guest_access_token) as id
  )
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
  cross join active_guest
  left join public.spotlight_slots as slots
    on slots.song_id = songs.id
    and (slots.active_from is null or slots.active_from <= now())
    and (slots.active_until is null or slots.active_until > now())
  where active_guest.id is not null
    and songs.is_active
    and songs.removed_at is null
    and songs.archived_at is null
    and songs.merged_into_song_id is null
    and not songs.explicit_content
    and songs.approval_status in ('auto_approved', 'approved')
    and songs.queue_tier in ('public', 'sponsored')
    and creators.account_status = 'active'
    and creators.banned_at is null
  order by
    exists (
      select 1
      from public.guest_listening_sessions as listens
      where listens.guest_session_id = active_guest.id
        and listens.song_id = songs.id
        and listens.created_at >= now() - interval '24 hours'
    ),
    slots.slot_number nulls last,
    songs.created_at asc
  limit greatest(1, least(queue_limit, 24));
$$;

drop function if exists public.start_guest_listening_session(uuid, uuid);
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
  active_guest_id uuid := public.resolve_guest_session(guest_access_token);
  target_platform public.music_platform;
  active_listening_id uuid;
begin
  if active_guest_id is null then raise exception 'Guest profile not found'; end if;

  select sessions.id
  into active_listening_id
  from public.guest_listening_sessions as sessions
  where sessions.guest_session_id = active_guest_id
    and sessions.song_id = target_song_id
    and sessions.status = 'active'
  limit 1;

  if active_listening_id is not null then
    return query select active_listening_id, 10, 30;
    return;
  end if;

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
    and songs.archived_at is null
    and songs.merged_into_song_id is null
    and not songs.explicit_content
    and songs.approval_status in ('auto_approved', 'approved')
    and creators.account_status = 'active'
    and creators.banned_at is null;
  if target_platform is null then raise exception 'Song is unavailable'; end if;

  update public.guest_listening_sessions
  set status = 'finished', updated_at = now()
  where guest_session_id = active_guest_id
    and status = 'active';

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
  returning id into active_listening_id;

  update public.guest_sessions
  set last_seen_at = now()
  where id = active_guest_id;

  return query select active_listening_id, 10, 30;
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
  elsif playback_muted or coalesce(playback_volume, 0) <= 0 then
    warning_message := 'Muted playback is not counted.';
  elsif not page_visible or not page_focused then
    warning_message := 'Keep First Listen visible while supporting this artist.';
  elsif not interaction_recent then
    warning_message := 'Interact with the session to continue.';
  else
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

drop function if exists public.start_listening_session(uuid);
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
  join public.profiles as creators on creators.id = songs.user_id
  where songs.id = target_song_id
    and songs.user_id <> auth.uid()
    and songs.is_active
    and songs.removed_at is null
    and songs.archived_at is null
    and songs.merged_into_song_id is null
    and creators.account_status = 'active'
    and creators.banned_at is null;
  if not found then raise exception 'Song is unavailable for listening'; end if;

  select * into settings
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
  ) >= 8 then
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
    telemetry_supported,
    reward_eligible
  )
  values (
    auth.uid(),
    target_song_id,
    target_platform,
    supports_verified_audio,
    true
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
  today_other_seconds integer := 0;
  current_daily_remaining integer;
  engagement_valid boolean := false;
  warning_message text := '';
  requirement_seconds integer;
  became_valid boolean := false;
  became_complete boolean := false;
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
    verified_seconds = verified_seconds + countable_seconds,
    settled_seconds = settled_seconds + countable_seconds,
    rejected_heartbeats = rejected_heartbeats +
      case when engagement_valid then 0 else 1 end,
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
    countable_seconds > 0,
    countable_seconds,
    current_session.verified_seconds,
    greatest(0, current_daily_remaining - countable_seconds),
    became_valid or current_session.valid_listen_at is not null,
    became_complete or current_session.complete_listen_at is not null,
    requirement_seconds,
    warning_message;
end;
$$;

create or replace function public.advance_spotlight_mission_from_listen()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_mission_id uuid;
  target_count_value integer;
  next_progress integer;
begin
  if old.valid_listen_at is not null or new.valid_listen_at is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.spotlight_slots
    where spotlight_slots.song_id = new.song_id
      and (active_from is null or active_from <= new.valid_listen_at)
      and (active_until is null or active_until > new.valid_listen_at)
  ) then
    return new;
  end if;

  select id, target_count
  into target_mission_id, target_count_value
  from public.daily_missions
  where mission_key = 'review_spotlight_songs'
    and active
    and (starts_at is null or starts_at <= new.valid_listen_at)
    and (ends_at is null or ends_at > new.valid_listen_at)
  limit 1;

  if target_mission_id is null then return new; end if;

  insert into public.daily_mission_song_completions (
    user_id,
    mission_id,
    mission_date,
    song_id,
    listening_session_id
  )
  values (
    new.user_id,
    target_mission_id,
    (new.valid_listen_at at time zone 'UTC')::date,
    new.song_id,
    new.id
  )
  on conflict do nothing;

  select count(*)::integer
  into next_progress
  from public.daily_mission_song_completions
  where user_id = new.user_id
    and mission_id = target_mission_id
    and mission_date = (new.valid_listen_at at time zone 'UTC')::date;

  insert into public.daily_mission_progress (
    user_id,
    mission_id,
    mission_date,
    progress_count,
    completed_at,
    updated_at
  )
  values (
    new.user_id,
    target_mission_id,
    (new.valid_listen_at at time zone 'UTC')::date,
    least(target_count_value, next_progress),
    case when next_progress >= target_count_value then now() end,
    now()
  )
  on conflict (user_id, mission_id, mission_date)
  do update set
    progress_count = least(target_count_value, next_progress),
    completed_at = case
      when next_progress >= target_count_value
      then coalesce(daily_mission_progress.completed_at, now())
      else null
    end,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists reviews_advance_spotlight_daily_mission
  on public.reviews;
drop trigger if exists listening_advance_spotlight_daily_mission
  on public.listening_sessions;
create trigger listening_advance_spotlight_daily_mission
after update of valid_listen_at on public.listening_sessions
for each row
when (old.valid_listen_at is null and new.valid_listen_at is not null)
execute function public.advance_spotlight_mission_from_listen();

create or replace function public.toggle_song_like(
  target_song_id uuid,
  guest_access_token uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  guest_id uuid;
begin
  if not exists (
    select 1 from public.songs
    where id = target_song_id
      and is_active
      and removed_at is null
      and archived_at is null
  ) then raise exception 'Song not found'; end if;

  if auth.uid() is not null then
    delete from public.song_likes
    where user_id = auth.uid() and song_id = target_song_id;
    if found then return false; end if;

    insert into public.song_likes (user_id, song_id)
    values (auth.uid(), target_song_id);
    return true;
  end if;

  guest_id := public.resolve_guest_session(guest_access_token);
  if guest_id is null then raise exception 'Guest profile required'; end if;

  delete from public.song_likes
  where guest_session_id = guest_id and song_id = target_song_id;
  if found then return false; end if;

  insert into public.song_likes (guest_session_id, song_id)
  values (guest_id, target_song_id);
  return true;
end;
$$;

create or replace function public.toggle_save_song(
  target_song_id uuid,
  guest_access_token uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  guest_id uuid;
begin
  if auth.uid() is not null then
    delete from public.saved_songs
    where user_id = auth.uid() and song_id = target_song_id;
    if found then return false; end if;

    insert into public.saved_songs (user_id, song_id)
    values (auth.uid(), target_song_id)
    on conflict do nothing;
    return true;
  end if;

  guest_id := public.resolve_guest_session(guest_access_token);
  if guest_id is null then raise exception 'Guest profile required'; end if;

  delete from public.guest_saved_songs
  where guest_session_id = guest_id and song_id = target_song_id;
  if found then return false; end if;

  insert into public.guest_saved_songs (guest_session_id, song_id)
  values (guest_id, target_song_id)
  on conflict do nothing;
  return true;
end;
$$;

create or replace function public.toggle_follow_artist(
  target_artist_id uuid,
  guest_access_token uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  guest_id uuid;
  guest_name text;
begin
  if not exists (
    select 1 from public.profiles
    where id = target_artist_id
      and account_status = 'active'
      and banned_at is null
  ) then raise exception 'Artist not found'; end if;

  if auth.uid() is not null then
    if target_artist_id = auth.uid() then return false; end if;
    delete from public.artist_follows
    where follower_id = auth.uid() and artist_id = target_artist_id;
    if found then return false; end if;

    insert into public.artist_follows (follower_id, artist_id)
    values (auth.uid(), target_artist_id)
    on conflict do nothing;
    return true;
  end if;

  guest_id := public.resolve_guest_session(guest_access_token);
  if guest_id is null then raise exception 'Guest profile required'; end if;

  delete from public.guest_artist_follows
  where guest_session_id = guest_id and artist_id = target_artist_id;
  if found then return false; end if;

  insert into public.guest_artist_follows (guest_session_id, artist_id)
  values (guest_id, target_artist_id);

  select nickname into guest_name
  from public.guest_sessions
  where id = guest_id;

  insert into public.community_notifications (
    recipient_id,
    actor_id,
    actor_display_name,
    event_type,
    actor_visibility,
    source_id
  )
  values (
    target_artist_id,
    null,
    guest_name,
    'follow',
    'public',
    guest_id
  )
  on conflict do nothing;

  return true;
end;
$$;

create or replace function public.add_song_comment(
  target_song_id uuid,
  comment_body text,
  guest_access_token uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  guest_id uuid;
  new_comment_id uuid;
begin
  if char_length(trim(comment_body)) not between 2 and 1000 then
    raise exception 'Comment must contain between 2 and 1000 characters';
  end if;
  if not exists (
    select 1 from public.songs
    where id = target_song_id
      and is_active
      and removed_at is null
      and archived_at is null
  ) then raise exception 'Song not found'; end if;

  if auth.uid() is not null then
    if (
      select count(*)
      from public.song_comments
      where user_id = auth.uid()
        and created_at >= now() - interval '1 minute'
    ) >= 5 then raise exception 'Please wait before commenting again'; end if;

    insert into public.song_comments (user_id, song_id, body)
    values (auth.uid(), target_song_id, trim(comment_body))
    returning id into new_comment_id;
  else
    guest_id := public.resolve_guest_session(guest_access_token);
    if guest_id is null then raise exception 'Guest profile required'; end if;
    if (
      select count(*)
      from public.song_comments
      where guest_session_id = guest_id
        and created_at >= now() - interval '1 minute'
    ) >= 5 then raise exception 'Please wait before commenting again'; end if;

    insert into public.song_comments (guest_session_id, song_id, body)
    values (guest_id, target_song_id, trim(comment_body))
    returning id into new_comment_id;
  end if;

  return new_comment_id;
end;
$$;

create or replace function public.get_song_comments(
  target_song_id uuid,
  comment_limit integer default 30
)
returns table (
  comment_id uuid,
  author_name text,
  guest_author boolean,
  comment_body text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    comments.id,
    coalesce(profiles.display_name, guests.nickname, 'Former listener'),
    comments.guest_session_id is not null,
    comments.body,
    comments.created_at
  from public.song_comments as comments
  left join public.profiles on profiles.id = comments.user_id
  left join public.guest_sessions as guests
    on guests.id = comments.guest_session_id
  where comments.song_id = target_song_id
    and comments.removed_at is null
  order by comments.created_at desc
  limit greatest(1, least(comment_limit, 100));
$$;

create or replace function public.record_song_share(
  target_song_id uuid,
  share_kind_value text,
  share_platform text default null,
  guest_access_token uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  guest_id uuid;
begin
  if share_kind_value not in ('community', 'original_platform') then
    raise exception 'Unsupported share type';
  end if;
  if share_kind_value = 'original_platform'
    and nullif(trim(share_platform), '') is null
  then raise exception 'Original platform is required'; end if;

  if auth.uid() is not null then
    insert into public.song_shares (
      user_id, song_id, share_kind, platform
    )
    values (
      auth.uid(), target_song_id, share_kind_value,
      case when share_kind_value = 'community' then null else trim(share_platform) end
    );
  else
    guest_id := public.resolve_guest_session(guest_access_token);
    if guest_id is null then raise exception 'Guest profile required'; end if;
    insert into public.song_shares (
      guest_session_id, song_id, share_kind, platform
    )
    values (
      guest_id, target_song_id, share_kind_value,
      case when share_kind_value = 'community' then null else trim(share_platform) end
    );
  end if;
end;
$$;

create or replace function public.record_song_view(
  target_song_id uuid,
  guest_access_token uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  guest_id uuid;
begin
  if auth.uid() is not null then
    insert into public.song_views (user_id, song_id)
    values (auth.uid(), target_song_id)
    on conflict do nothing;
  else
    guest_id := public.resolve_guest_session(guest_access_token);
    if guest_id is null then return; end if;
    insert into public.song_views (guest_session_id, song_id)
    values (guest_id, target_song_id)
    on conflict do nothing;
  end if;
end;
$$;

create or replace function public.get_song_engagement(
  target_song_id uuid,
  guest_access_token uuid default null
)
returns table (
  view_count integer,
  valid_listen_count integer,
  like_count integer,
  comment_count integer,
  follower_count integer,
  community_share_count integer,
  original_share_count integer,
  liked boolean,
  saved boolean,
  following boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with target as (
    select songs.user_id as artist_id
    from public.songs
    where songs.id = target_song_id
  ),
  guest as (
    select public.resolve_guest_session(guest_access_token) as id
  )
  select
    (select count(*)::integer from public.song_views where song_id = target_song_id),
    (
      (select count(*) from public.listening_sessions
       where song_id = target_song_id and valid_listen_at is not null)
      +
      (select count(*) from public.guest_listening_sessions
       where song_id = target_song_id and valid_listen_at is not null)
    )::integer,
    (select count(*)::integer from public.song_likes where song_id = target_song_id),
    (select count(*)::integer from public.song_comments
      where song_id = target_song_id and removed_at is null),
    (
      (select count(*) from public.artist_follows
       where artist_id = target.artist_id)
      +
      (select count(*) from public.guest_artist_follows
       where artist_id = target.artist_id)
    )::integer,
    (select count(*)::integer from public.song_shares
      where song_id = target_song_id and share_kind = 'community'),
    (select count(*)::integer from public.song_shares
      where song_id = target_song_id and share_kind = 'original_platform'),
    case
      when auth.uid() is not null then exists (
        select 1 from public.song_likes
        where user_id = auth.uid() and song_id = target_song_id
      )
      else exists (
        select 1 from public.song_likes
        where guest_session_id = guest.id and song_id = target_song_id
      )
    end,
    case
      when auth.uid() is not null then exists (
        select 1 from public.saved_songs
        where user_id = auth.uid() and song_id = target_song_id
      )
      else exists (
        select 1 from public.guest_saved_songs
        where guest_session_id = guest.id and song_id = target_song_id
      )
    end,
    case
      when auth.uid() is not null then exists (
        select 1 from public.artist_follows
        where follower_id = auth.uid() and artist_id = target.artist_id
      )
      else exists (
        select 1 from public.guest_artist_follows
        where guest_session_id = guest.id and artist_id = target.artist_id
      )
    end
  from target
  cross join guest;
$$;

create or replace function public.convert_guest_to_account(
  guest_access_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  guest_id uuid := public.resolve_guest_session(guest_access_token);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if guest_id is null then return false; end if;

  insert into public.artist_follows (follower_id, artist_id, created_at)
  select auth.uid(), artist_id, created_at
  from public.guest_artist_follows
  where guest_session_id = guest_id
    and artist_id <> auth.uid()
  on conflict do nothing;

  insert into public.saved_songs (user_id, song_id, created_at)
  select auth.uid(), song_id, created_at
  from public.guest_saved_songs
  where guest_session_id = guest_id
  on conflict do nothing;

  insert into public.song_likes (user_id, song_id, created_at)
  select auth.uid(), song_id, created_at
  from public.song_likes
  where guest_session_id = guest_id
  on conflict do nothing;

  delete from public.song_likes where guest_session_id = guest_id;

  update public.song_comments
  set user_id = auth.uid(), guest_session_id = null
  where guest_session_id = guest_id;

  update public.song_shares
  set user_id = auth.uid(), guest_session_id = null
  where guest_session_id = guest_id;

  update public.guest_sessions
  set converted_to_user_id = auth.uid(), last_seen_at = now()
  where id = guest_id;

  return true;
end;
$$;

drop function if exists public.get_my_community_notifications(integer);
create or replace function public.get_my_community_notifications(
  notification_limit integer default 20
)
returns table (
  notification_id uuid,
  event_type text,
  actor_id uuid,
  actor_name text,
  song_id uuid,
  song_title text,
  is_read boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    notifications.id,
    notifications.event_type,
    case
      when notifications.actor_id is not null
        and (
          notifications.event_type = 'follow'
          or coalesce(actors.community_visibility, notifications.actor_visibility)
            = 'public'
        )
        and actors.account_status = 'active'
        and actors.banned_at is null
      then actors.id
      else null
    end,
    case
      when notifications.actor_display_name is not null
        and notifications.actor_visibility = 'public'
      then notifications.actor_display_name
      when notifications.actor_id is not null
        and (
          notifications.event_type = 'follow'
          or coalesce(actors.community_visibility, notifications.actor_visibility)
            = 'public'
        )
        and actors.account_status = 'active'
        and actors.banned_at is null
      then coalesce(actors.display_name, 'Former member')
      else 'Anonymous Listener'
    end,
    notifications.song_id,
    songs.title,
    notifications.read_at is not null,
    notifications.created_at
  from public.community_notifications as notifications
  left join public.profiles as actors on actors.id = notifications.actor_id
  left join public.songs on songs.id = notifications.song_id
  where notifications.recipient_id = auth.uid()
    and public.is_active_user()
  order by notifications.created_at desc
  limit greatest(1, least(notification_limit, 50));
$$;

drop function if exists public.get_public_artist_profile(uuid);
create or replace function public.get_public_artist_profile(
  target_artist_id uuid
)
returns table (
  artist_id uuid,
  artist_name text,
  followers integer,
  following integer,
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
    (
      (select count(*) from public.artist_follows
       where artist_follows.artist_id = profiles.id)
      +
      (select count(*) from public.guest_artist_follows
       where guest_artist_follows.artist_id = profiles.id)
    )::integer,
    (select count(*)::integer from public.artist_follows
     where artist_follows.follower_id = profiles.id),
    coalesce(song_counts.songs_submitted, 0)::integer,
    coalesce(song_counts.genres, array[]::text[]),
    coalesce(song_counts.languages, array[]::text[]),
    exists (
      select 1
      from public.artist_follows
      where follower_id = auth.uid()
        and artist_id = profiles.id
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
    select
      count(*)::integer as songs_submitted,
      array_remove(array_agg(distinct songs.genre), null) as genres,
      array_remove(array_agg(distinct songs.song_language), null) as languages
    from public.songs
    where songs.user_id = profiles.id
      and songs.is_active
      and songs.removed_at is null
      and songs.archived_at is null
      and songs.merged_into_song_id is null
  ) song_counts on true
  left join lateral (
    select
      (
        select round(avg(reviews.rating)::numeric, 2)
        from public.reviews
        join public.songs on songs.id = reviews.song_id
        where songs.user_id = profiles.id
          and songs.removed_at is null
          and reviews.quality_passed
      ) as average_rating,
      (
        coalesce((
          select sum(listens.settled_seconds)
          from public.listening_sessions as listens
          join public.songs on songs.id = listens.song_id
          where songs.user_id = profiles.id
            and songs.removed_at is null
        ), 0)
        +
        coalesce((
          select sum(guest_listens.verified_seconds)
          from public.guest_listening_sessions as guest_listens
          join public.songs on songs.id = guest_listens.song_id
          where songs.user_id = profiles.id
            and songs.removed_at is null
        ), 0)
      )::bigint as listening_seconds,
      (
        (select count(*)
         from public.listening_sessions as listens
         join public.songs on songs.id = listens.song_id
         where songs.user_id = profiles.id
           and songs.removed_at is null
           and listens.valid_listen_at is not null)
        +
        (select count(*)
         from public.guest_listening_sessions as guest_listens
         join public.songs on songs.id = guest_listens.song_id
         where songs.user_id = profiles.id
           and songs.removed_at is null
           and guest_listens.valid_listen_at is not null)
      )::integer as valid_listens_received,
      (
        (select count(*)
         from public.listening_sessions as listens
         join public.songs on songs.id = listens.song_id
         where songs.user_id = profiles.id
           and songs.removed_at is null
           and listens.complete_listen_at is not null)
        +
        (select count(*)
         from public.guest_listening_sessions as guest_listens
         join public.songs on songs.id = guest_listens.song_id
         where songs.user_id = profiles.id
           and songs.removed_at is null
           and guest_listens.complete_listen_at is not null)
      )::integer as complete_listens_received
  ) artist_metrics on true
  where profiles.id = target_artist_id
    and profiles.account_status = 'active'
    and profiles.banned_at is null;
$$;

create or replace function public.community_engagement_health_report()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'tables', jsonb_build_object(
      'guest_artist_follows', to_regclass('public.guest_artist_follows') is not null,
      'guest_saved_songs', to_regclass('public.guest_saved_songs') is not null,
      'song_likes', to_regclass('public.song_likes') is not null,
      'song_comments', to_regclass('public.song_comments') is not null,
      'song_shares', to_regclass('public.song_shares') is not null,
      'song_views', to_regclass('public.song_views') is not null,
      'daily_mission_song_completions',
        to_regclass('public.daily_mission_song_completions') is not null
    ),
    'persistent_guests', (
      select count(*)::integer
      from public.guest_sessions
      where expires_at is null and converted_to_user_id is null
    ),
    'invalid_guest_identity', (
      select count(*)::integer
      from public.guest_sessions
      where nickname is null
        or guest_listener_id is null
        or recovery_code is null
    ),
    'duplicate_user_likes', (
      select count(*)::integer
      from (
        select user_id, song_id
        from public.song_likes
        where user_id is not null
        group by user_id, song_id
        having count(*) > 1
      ) duplicates
    ),
    'duplicate_guest_likes', (
      select count(*)::integer
      from (
        select guest_session_id, song_id
        from public.song_likes
        where guest_session_id is not null
        group by guest_session_id, song_id
        having count(*) > 1
      ) duplicates
    ),
    'valid_listen_window_violations', (
      select count(*)::integer
      from public.listening_sessions as left_session
      join public.listening_sessions as right_session
        on right_session.user_id = left_session.user_id
        and right_session.song_id = left_session.song_id
        and right_session.id > left_session.id
        and right_session.valid_listen_at between
          left_session.valid_listen_at
          and left_session.valid_listen_at + interval '24 hours'
      where left_session.valid_listen_at is not null
    )
  );
$$;

revoke all on function public.create_guest_identity(text, text)
  from public, anon, authenticated;
revoke all on function public.recover_guest_identity(text)
  from public, anon, authenticated;
revoke all on function public.get_guest_identity(uuid)
  from public, anon, authenticated;
revoke all on function public.update_guest_language(uuid, text)
  from public, anon, authenticated;
revoke all on function public.start_guest_session(uuid)
  from public, anon, authenticated;
revoke all on function public.get_guest_song_queue(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.start_guest_listening_session(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.record_guest_listening_heartbeat(
  uuid, uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) from public, anon, authenticated;
revoke all on function public.start_listening_session(uuid)
  from public, anon, authenticated;
revoke all on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) from public, anon, authenticated;
revoke all on function public.toggle_song_like(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.toggle_save_song(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.toggle_follow_artist(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.add_song_comment(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.get_song_comments(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.record_song_share(uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.record_song_view(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_song_engagement(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.convert_guest_to_account(uuid)
  from public, anon, authenticated;
revoke all on function public.get_my_community_notifications(integer)
  from public, anon, authenticated;
revoke all on function public.get_public_artist_profile(uuid)
  from public, anon, authenticated;
revoke all on function public.community_engagement_health_report()
  from public, anon, authenticated;

grant execute on function public.create_guest_identity(text, text)
  to anon, authenticated;
grant execute on function public.recover_guest_identity(text)
  to anon, authenticated;
grant execute on function public.get_guest_identity(uuid)
  to anon, authenticated;
grant execute on function public.update_guest_language(uuid, text)
  to anon, authenticated;
grant execute on function public.start_guest_session(uuid)
  to anon, authenticated;
grant execute on function public.get_guest_song_queue(uuid, integer)
  to anon, authenticated;
grant execute on function public.start_guest_listening_session(uuid, uuid)
  to anon, authenticated;
grant execute on function public.record_guest_listening_heartbeat(
  uuid, uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) to anon, authenticated;
grant execute on function public.start_listening_session(uuid)
  to authenticated;
grant execute on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) to authenticated;
grant execute on function public.toggle_song_like(uuid, uuid)
  to anon, authenticated;
grant execute on function public.toggle_save_song(uuid, uuid)
  to anon, authenticated;
grant execute on function public.toggle_follow_artist(uuid, uuid)
  to anon, authenticated;
grant execute on function public.add_song_comment(uuid, text, uuid)
  to anon, authenticated;
grant execute on function public.get_song_comments(uuid, integer)
  to anon, authenticated;
grant execute on function public.record_song_share(uuid, text, text, uuid)
  to anon, authenticated;
grant execute on function public.record_song_view(uuid, uuid)
  to anon, authenticated;
grant execute on function public.get_song_engagement(uuid, uuid)
  to anon, authenticated;
grant execute on function public.convert_guest_to_account(uuid)
  to authenticated;
grant execute on function public.get_my_community_notifications(integer)
  to authenticated;
grant execute on function public.get_public_artist_profile(uuid)
  to anon, authenticated;
grant execute on function public.community_engagement_health_report()
  to service_role;
