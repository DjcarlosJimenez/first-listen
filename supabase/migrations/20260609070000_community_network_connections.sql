-- Community connections, privacy-aware support events, notifications,
-- continuous listening preferences, and a moderate relationship signal.

alter table public.profiles
  add column if not exists community_visibility text not null default 'public',
  add column if not exists autoplay_next_song boolean not null default true;

alter table public.profiles
  drop constraint if exists profiles_community_visibility_check;
alter table public.profiles
  add constraint profiles_community_visibility_check
  check (community_visibility in ('public', 'anonymous'));

create table if not exists public.community_support_events (
  id uuid primary key default uuid_generate_v4(),
  supporter_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.profiles(id) on delete cascade,
  song_id uuid references public.songs(id) on delete cascade,
  event_type text not null
    check (event_type in ('valid_listen', 'complete_listen', 'review', 'follow')),
  visibility text not null
    check (visibility in ('public', 'anonymous')),
  source_id uuid,
  created_at timestamptz not null default now(),
  check (supporter_id <> artist_id)
);

create unique index if not exists community_support_events_source_idx
  on public.community_support_events (
    supporter_id,
    artist_id,
    event_type,
    source_id
  )
  where source_id is not null;

create index if not exists community_support_events_artist_idx
  on public.community_support_events (artist_id, created_at desc);
create index if not exists community_support_events_supporter_idx
  on public.community_support_events (supporter_id, created_at desc);
create index if not exists community_support_events_song_idx
  on public.community_support_events (song_id, created_at desc)
  where song_id is not null;

create table if not exists public.community_notifications (
  id uuid primary key default uuid_generate_v4(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  song_id uuid references public.songs(id) on delete set null,
  event_type text not null
    check (event_type in ('valid_listen', 'complete_listen', 'review', 'follow')),
  actor_visibility text not null
    check (actor_visibility in ('public', 'anonymous')),
  source_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (actor_id is null or actor_id <> recipient_id)
);

create unique index if not exists community_notifications_source_idx
  on public.community_notifications (
    recipient_id,
    event_type,
    source_id
  )
  where source_id is not null;

create index if not exists community_notifications_recipient_idx
  on public.community_notifications (recipient_id, read_at, created_at desc);

alter table public.community_support_events enable row level security;
alter table public.community_notifications enable row level security;

revoke all on table public.community_support_events
  from public, anon, authenticated;
revoke all on table public.community_notifications
  from public, anon, authenticated;
grant select, update (read_at) on table public.community_notifications
  to authenticated;

drop policy if exists "users read own community notifications"
  on public.community_notifications;
create policy "users read own community notifications"
  on public.community_notifications for select
  to authenticated
  using (recipient_id = auth.uid());

drop policy if exists "users mark own community notifications read"
  on public.community_notifications;
create policy "users mark own community notifications read"
  on public.community_notifications for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

do $$
begin
  begin
    alter publication supabase_realtime
      add table public.community_notifications;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end
$$;

create or replace function public.record_community_support_event(
  event_supporter_id uuid,
  event_artist_id uuid,
  event_song_id uuid,
  event_type_name text,
  event_source_id uuid,
  event_visibility text,
  event_created_at timestamptz default now(),
  create_notification boolean default true
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if event_supporter_id is null
    or event_artist_id is null
    or event_supporter_id = event_artist_id
  then
    return;
  end if;

  if event_type_name not in (
    'valid_listen',
    'complete_listen',
    'review',
    'follow'
  ) then
    raise exception 'Unsupported community event type';
  end if;

  insert into public.community_support_events (
    supporter_id,
    artist_id,
    song_id,
    event_type,
    visibility,
    source_id,
    created_at
  )
  values (
    event_supporter_id,
    event_artist_id,
    event_song_id,
    event_type_name,
    case when event_visibility = 'anonymous' then 'anonymous' else 'public' end,
    event_source_id,
    event_created_at
  )
  on conflict do nothing;

  if create_notification then
    insert into public.community_notifications (
      recipient_id,
      actor_id,
      song_id,
      event_type,
      actor_visibility,
      source_id,
      created_at
    )
    values (
      event_artist_id,
      event_supporter_id,
      event_song_id,
      event_type_name,
      case when event_visibility = 'anonymous' then 'anonymous' else 'public' end,
      event_source_id,
      event_created_at
    )
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.record_community_support_event(
  uuid, uuid, uuid, text, uuid, text, timestamptz, boolean
) from public, anon, authenticated;

create or replace function public.capture_listening_community_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_artist_id uuid;
  supporter_visibility text;
begin
  select songs.user_id
  into target_artist_id
  from public.songs
  where songs.id = new.song_id;

  select profiles.community_visibility
  into supporter_visibility
  from public.profiles
  where profiles.id = new.user_id;

  if old.valid_listen_at is null and new.valid_listen_at is not null then
    perform public.record_community_support_event(
      new.user_id,
      target_artist_id,
      new.song_id,
      'valid_listen',
      new.id,
      coalesce(supporter_visibility, 'anonymous'),
      new.valid_listen_at,
      true
    );
  end if;

  if old.complete_listen_at is null and new.complete_listen_at is not null then
    perform public.record_community_support_event(
      new.user_id,
      target_artist_id,
      new.song_id,
      'complete_listen',
      new.id,
      coalesce(supporter_visibility, 'anonymous'),
      new.complete_listen_at,
      false
    );
  end if;

  return new;
end;
$$;

drop trigger if exists capture_listening_community_event
  on public.listening_sessions;
create trigger capture_listening_community_event
after update of valid_listen_at, complete_listen_at
on public.listening_sessions
for each row
when (
  (old.valid_listen_at is null and new.valid_listen_at is not null)
  or
  (old.complete_listen_at is null and new.complete_listen_at is not null)
)
execute function public.capture_listening_community_event();

create or replace function public.capture_review_community_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_artist_id uuid;
  supporter_visibility text;
begin
  if not new.quality_passed then
    return new;
  end if;

  select songs.user_id
  into target_artist_id
  from public.songs
  where songs.id = new.song_id;

  select profiles.community_visibility
  into supporter_visibility
  from public.profiles
  where profiles.id = new.reviewer_id;

  perform public.record_community_support_event(
    new.reviewer_id,
    target_artist_id,
    new.song_id,
    'review',
    new.id,
    coalesce(supporter_visibility, 'anonymous'),
    new.created_at,
    true
  );

  return new;
end;
$$;

drop trigger if exists capture_review_community_event on public.reviews;
create trigger capture_review_community_event
after insert on public.reviews
for each row execute function public.capture_review_community_event();

create or replace function public.capture_follow_community_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.record_community_support_event(
    new.follower_id,
    new.artist_id,
    null,
    'follow',
    new.follower_id,
    'public',
    new.created_at,
    true
  );
  return new;
end;
$$;

drop trigger if exists capture_follow_community_event
  on public.artist_follows;
create trigger capture_follow_community_event
after insert on public.artist_follows
for each row execute function public.capture_follow_community_event();

revoke all on function public.capture_listening_community_event()
  from public, anon, authenticated;
revoke all on function public.capture_review_community_event()
  from public, anon, authenticated;
revoke all on function public.capture_follow_community_event()
  from public, anon, authenticated;

-- Backfill relationship history without generating old notifications.
insert into public.community_support_events (
  supporter_id,
  artist_id,
  song_id,
  event_type,
  visibility,
  source_id,
  created_at
)
select
  sessions.user_id,
  songs.user_id,
  sessions.song_id,
  'valid_listen',
  profiles.community_visibility,
  sessions.id,
  sessions.valid_listen_at
from public.listening_sessions as sessions
join public.songs on songs.id = sessions.song_id
join public.profiles on profiles.id = sessions.user_id
where sessions.valid_listen_at is not null
  and sessions.user_id <> songs.user_id
on conflict do nothing;

insert into public.community_support_events (
  supporter_id,
  artist_id,
  song_id,
  event_type,
  visibility,
  source_id,
  created_at
)
select
  sessions.user_id,
  songs.user_id,
  sessions.song_id,
  'complete_listen',
  profiles.community_visibility,
  sessions.id,
  sessions.complete_listen_at
from public.listening_sessions as sessions
join public.songs on songs.id = sessions.song_id
join public.profiles on profiles.id = sessions.user_id
where sessions.complete_listen_at is not null
  and sessions.user_id <> songs.user_id
on conflict do nothing;

insert into public.community_support_events (
  supporter_id,
  artist_id,
  song_id,
  event_type,
  visibility,
  source_id,
  created_at
)
select
  reviews.reviewer_id,
  songs.user_id,
  reviews.song_id,
  'review',
  profiles.community_visibility,
  reviews.id,
  reviews.created_at
from public.reviews
join public.songs on songs.id = reviews.song_id
join public.profiles on profiles.id = reviews.reviewer_id
where reviews.quality_passed
  and reviews.reviewer_id <> songs.user_id
on conflict do nothing;

insert into public.community_support_events (
  supporter_id,
  artist_id,
  event_type,
  visibility,
  source_id,
  created_at
)
select
  follows.follower_id,
  follows.artist_id,
  'follow',
  'public',
  follows.follower_id,
  follows.created_at
from public.artist_follows as follows
where follows.follower_id <> follows.artist_id
on conflict do nothing;

create or replace function public.update_community_preferences(
  profile_community_visibility text,
  profile_autoplay_next_song boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if profile_community_visibility not in ('public', 'anonymous') then
    raise exception 'Invalid community visibility';
  end if;

  update public.profiles
  set
    community_visibility = profile_community_visibility,
    autoplay_next_song = profile_autoplay_next_song,
    updated_at = now()
  where id = auth.uid()
    and account_status = 'active'
    and banned_at is null;
end;
$$;

create or replace function public.get_my_community_network()
returns table (
  followers integer,
  following integer,
  artists_supported integer,
  visible_supports integer,
  anonymous_supports integer,
  community_visibility text,
  autoplay_next_song boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    (
      select count(*)::integer
      from public.artist_follows
      where artist_id = auth.uid()
    ),
    (
      select count(*)::integer
      from public.artist_follows
      where follower_id = auth.uid()
    ),
    (
      select count(distinct events.artist_id)::integer
      from public.community_support_events as events
      where events.supporter_id = auth.uid()
        and events.event_type in ('valid_listen', 'review')
    ),
    (
      select count(*)::integer
      from public.community_support_events as events
      where events.supporter_id = auth.uid()
        and events.event_type in ('valid_listen', 'review')
        and events.visibility = 'public'
    ),
    (
      select count(*)::integer
      from public.community_support_events as events
      where events.supporter_id = auth.uid()
        and events.event_type in ('valid_listen', 'review')
        and events.visibility = 'anonymous'
    ),
    profiles.community_visibility,
    profiles.autoplay_next_song
  from public.profiles
  where profiles.id = auth.uid()
    and profiles.account_status = 'active'
    and profiles.banned_at is null;
$$;

create or replace function public.get_my_recent_community_activity(
  activity_limit integer default 12
)
returns table (
  event_id uuid,
  event_type text,
  artist_id uuid,
  artist_name text,
  song_id uuid,
  song_title text,
  visibility text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    events.id,
    events.event_type,
    events.artist_id,
    artists.display_name,
    events.song_id,
    songs.title,
    events.visibility,
    events.created_at
  from public.community_support_events as events
  join public.profiles as artists on artists.id = events.artist_id
  left join public.songs on songs.id = events.song_id
  where events.supporter_id = auth.uid()
    and public.is_active_user()
  order by events.created_at desc
  limit greatest(1, least(activity_limit, 50));
$$;

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
      when (
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
      when (
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

create or replace function public.get_my_community_notification_summary()
returns table (
  unread_count integer,
  supporters_count integer,
  followers_count integer,
  reviews_count integer,
  valid_listens_count integer,
  most_supported_song_id uuid,
  most_supported_song_title text,
  most_supported_song_valid_listens integer,
  top_supporter_id uuid,
  top_supporter_name text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with unread as (
    select notifications.*
    from public.community_notifications as notifications
    where notifications.recipient_id = auth.uid()
      and notifications.read_at is null
  ),
  top_song as (
    select
      unread.song_id,
      songs.title,
      count(*) filter (
        where unread.event_type = 'valid_listen'
      )::integer as valid_listens
    from unread
    join public.songs on songs.id = unread.song_id
    where unread.song_id is not null
    group by unread.song_id, songs.title
    order by valid_listens desc, max(unread.created_at) desc
    limit 1
  ),
  top_supporter as (
    select
      actors.id,
      actors.display_name,
      count(*)::integer as support_count
    from unread
    join public.profiles as actors on actors.id = unread.actor_id
    where unread.event_type in ('valid_listen', 'review')
      and actors.community_visibility = 'public'
    group by actors.id, actors.display_name
    order by support_count desc, max(unread.created_at) desc
    limit 1
  )
  select
    (select count(*)::integer from unread),
    (
      select count(distinct actor_id)::integer
      from unread
      where event_type in ('valid_listen', 'review')
    ),
    (
      select count(*)::integer
      from unread
      where event_type = 'follow'
    ),
    (
      select count(*)::integer
      from unread
      where event_type = 'review'
    ),
    (
      select count(*)::integer
      from unread
      where event_type = 'valid_listen'
    ),
    top_song.song_id,
    top_song.title,
    coalesce(top_song.valid_listens, 0),
    top_supporter.id,
    top_supporter.display_name
  from (select 1) as seed
  left join top_song on true
  left join top_supporter on true
  where public.is_active_user();
$$;

create or replace function public.mark_community_notifications_read()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  changed_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  update public.community_notifications
  set read_at = now()
  where recipient_id = auth.uid()
    and read_at is null;

  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

create or replace function public.get_artist_top_supporters(
  target_artist_id uuid,
  supporter_limit integer default 8
)
returns table (
  supporter_id uuid,
  supporter_name text,
  supports_given integer,
  songs_supported integer,
  mutual_following boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    supporters.id,
    supporters.display_name,
    count(*)::integer,
    count(distinct events.song_id)::integer,
    exists (
      select 1
      from public.artist_follows
      where follower_id = supporters.id
        and artist_id = target_artist_id
    )
    and exists (
      select 1
      from public.artist_follows
      where follower_id = target_artist_id
        and artist_id = supporters.id
    )
  from public.community_support_events as events
  join public.profiles as supporters on supporters.id = events.supporter_id
  where events.artist_id = target_artist_id
    and events.event_type in ('valid_listen', 'review')
    and events.visibility = 'public'
    and supporters.community_visibility = 'public'
    and supporters.account_status = 'active'
    and supporters.banned_at is null
  group by supporters.id, supporters.display_name
  order by count(*) desc, count(distinct events.song_id) desc, supporters.id
  limit greatest(1, least(supporter_limit, 24));
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
    end,
    case
      when (
        events.event_type = 'follow'
        or (events.visibility = 'public' and actors.community_visibility = 'public')
      )
        and actors.account_status = 'active'
        and actors.banned_at is null
      then coalesce(actors.display_name, 'Former member')
      else 'Anonymous Listener'
    end,
    events.song_id,
    songs.title,
    events.created_at
  from public.community_support_events as events
  left join public.profiles as actors on actors.id = events.supporter_id
  left join public.songs on songs.id = events.song_id
  where events.artist_id = target_artist_id
    and exists (
      select 1
      from public.profiles as artists
      where artists.id = target_artist_id
        and artists.account_status = 'active'
        and artists.banned_at is null
    )
  order by events.created_at desc
  limit greatest(1, least(activity_limit, 50));
$$;

drop function if exists public.get_today_support_summary();
create or replace function public.get_today_support_summary()
returns table (
  songs_reviewed_today integer,
  songs_supported_today integer,
  creators_supported integer,
  listening_seconds_today integer,
  community_rank text,
  valid_listens_today integer,
  complete_listens_today integer,
  average_completion_rate numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    (
      select count(*)::integer
      from public.reviews
      where reviews.reviewer_id = auth.uid()
        and reviews.quality_passed
        and reviews.created_at >= date_trunc('day', now())
    ),
    (
      select count(distinct supported.song_id)::integer
      from (
        select reviews.song_id
        from public.reviews
        where reviews.reviewer_id = auth.uid()
          and reviews.quality_passed
          and reviews.created_at >= date_trunc('day', now())
        union
        select listening_sessions.song_id
        from public.listening_sessions
        where listening_sessions.user_id = auth.uid()
          and listening_sessions.valid_listen_at >= date_trunc('day', now())
      ) as supported
    ),
    (
      select count(distinct songs.user_id)::integer
      from public.songs
      where songs.id in (
        select reviews.song_id
        from public.reviews
        where reviews.reviewer_id = auth.uid()
          and reviews.quality_passed
          and reviews.created_at >= date_trunc('day', now())
        union
        select listening_sessions.song_id
        from public.listening_sessions
        where listening_sessions.user_id = auth.uid()
          and listening_sessions.valid_listen_at >= date_trunc('day', now())
      )
    ),
    coalesce((
      select sum(listening_sessions.engaged_seconds)::integer
      from public.listening_sessions
      where listening_sessions.user_id = auth.uid()
        and listening_sessions.created_at >= date_trunc('day', now())
        and listening_sessions.reward_eligible
    ), 0),
    public.community_rank_name(profiles.community_points),
    (
      select count(*)::integer
      from public.listening_sessions
      where listening_sessions.user_id = auth.uid()
        and listening_sessions.valid_listen_at >= date_trunc('day', now())
        and listening_sessions.reward_eligible
    ),
    (
      select count(*)::integer
      from public.listening_sessions
      where listening_sessions.user_id = auth.uid()
        and listening_sessions.complete_listen_at >= date_trunc('day', now())
        and listening_sessions.reward_eligible
    ),
    coalesce((
      select round(avg(
        least(
          100,
          listening_sessions.engaged_seconds::numeric /
            nullif(listening_sessions.provider_duration_seconds, 0) * 100
        )
      ), 1)
      from public.listening_sessions
      where listening_sessions.user_id = auth.uid()
        and listening_sessions.created_at >= date_trunc('day', now())
        and listening_sessions.provider_duration_seconds > 0
        and listening_sessions.engaged_seconds > 0
        and listening_sessions.reward_eligible
    ), 0)
  from public.profiles
  where profiles.id = auth.uid()
    and public.is_active_user();
$$;

drop function if exists public.get_smart_review_queue(integer);
create or replace function public.get_smart_review_queue(
  queue_limit integer default 20
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
      least(
        18,
        case
          when exists (
            select 1
            from public.artist_follows
            where follower_id = auth.uid()
              and artist_id = songs.user_id
          )
          and exists (
            select 1
            from public.artist_follows
            where follower_id = songs.user_id
              and artist_id = auth.uid()
          )
          then 10 else 0
        end
        + case
          when exists (
            select 1
            from public.community_support_events
            where supporter_id = auth.uid()
              and artist_id = songs.user_id
              and event_type in ('valid_listen', 'review')
          )
          then 3 else 0
        end
        + case
          when exists (
            select 1
            from public.community_support_events
            where supporter_id = songs.user_id
              and artist_id = auth.uid()
              and event_type in ('valid_listen', 'review')
          )
          then 3 else 0
        end
        + case
          when (
            select count(*)
            from public.community_support_events
            where supporter_id = auth.uid()
              and artist_id = songs.user_id
              and event_type in ('valid_listen', 'review', 'follow')
          ) >= 3
          then 2 else 0
        end
      )::integer as connection_score,
      (
        case
          when songs.song_language = 'Instrumental'
            or songs.song_language = any(reviewer.languages_understood)
          then 100 else 0
        end
        + case
          when songs.genre = any(reviewer.genre_preferences) then 70
          when songs.genre = any(
            array[
              'Reggaeton',
              'Regional Mexican',
              'Cumbia',
              'Salsa',
              'Bachata'
            ]::text[]
          ) and reviewer.genre_preferences && array[
            'Reggaeton',
            'Regional Mexican',
            'Cumbia',
            'Salsa',
            'Bachata'
          ]::text[] then 50
          else 0
        end
        + reviewer.activity_score
        + least(
          20,
          floor(extract(epoch from (now() - songs.created_at)) / 86400)
        )::integer
        + case when active_boosts.song_id is null then 0 else 35 end
      ) as base_match_score,
      array_remove(array[
        case
          when songs.song_language = 'Instrumental'
            or songs.song_language = any(reviewer.languages_understood)
          then songs.song_language
        end,
        case when songs.genre = any(reviewer.genre_preferences) then songs.genre end,
        case when active_boosts.song_id is not null then 'Boosted visibility' end
      ], null) as base_match_reasons
    from public.songs
    join public.profiles as creators on creators.id = songs.user_id
    cross join reviewer
    left join active_boosts on active_boosts.song_id = songs.id
    where songs.is_active
      and songs.removed_at is null
      and songs.approval_status in ('auto_approved', 'approved')
      and songs.queue_tier in ('public', 'sponsored')
      and songs.user_id <> auth.uid()
      and creators.account_status = 'active'
      and creators.banned_at is null
      and coalesce(creators.last_contribution_at, creators.created_at)
        > now() - interval '14 days'
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
    scored.user_id,
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
    scored.base_match_score + scored.connection_score,
    case
      when scored.connection_score > 0
      then array_append(scored.base_match_reasons, 'Community connection')
      else scored.base_match_reasons
    end
  from scored
  order by
    scored.base_match_score + scored.connection_score desc,
    scored.created_at asc
  limit greatest(1, least(queue_limit, 50));
$$;

create or replace function public.community_network_health_report()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'tables', jsonb_build_object(
      'community_support_events',
        to_regclass('public.community_support_events') is not null,
      'community_notifications',
        to_regclass('public.community_notifications') is not null
    ),
    'functions', jsonb_build_object(
      'update_community_preferences',
        to_regprocedure(
          'public.update_community_preferences(text,boolean)'
        ) is not null,
      'get_my_community_network',
        to_regprocedure('public.get_my_community_network()') is not null,
      'get_my_community_notifications',
        to_regprocedure(
          'public.get_my_community_notifications(integer)'
        ) is not null,
      'get_artist_top_supporters',
        to_regprocedure(
          'public.get_artist_top_supporters(uuid,integer)'
        ) is not null,
      'get_public_artist_activity',
        to_regprocedure(
          'public.get_public_artist_activity(uuid,integer)'
        ) is not null
    ),
    'rls', jsonb_build_object(
      'community_support_events', coalesce((
        select relrowsecurity
        from pg_class
        where oid = 'public.community_support_events'::regclass
      ), false),
      'community_notifications', coalesce((
        select relrowsecurity
        from pg_class
        where oid = 'public.community_notifications'::regclass
      ), false)
    ),
    'invalid_visibility_profiles', (
      select count(*)::integer
      from public.profiles
      where community_visibility not in ('public', 'anonymous')
    ),
    'orphan_support_events', (
      select count(*)::integer
      from public.community_support_events as events
      left join public.profiles as supporters
        on supporters.id = events.supporter_id
      left join public.profiles as artists
        on artists.id = events.artist_id
      where supporters.id is null or artists.id is null
    ),
    'orphan_notifications', (
      select count(*)::integer
      from public.community_notifications as notifications
      left join public.profiles as recipients
        on recipients.id = notifications.recipient_id
      where recipients.id is null
    ),
    'realtime_enabled', exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'community_notifications'
    )
  );
$$;

revoke all on function public.update_community_preferences(text, boolean)
  from public, anon, authenticated;
revoke all on function public.get_my_community_network()
  from public, anon, authenticated;
revoke all on function public.get_my_recent_community_activity(integer)
  from public, anon, authenticated;
revoke all on function public.get_my_community_notifications(integer)
  from public, anon, authenticated;
revoke all on function public.get_my_community_notification_summary()
  from public, anon, authenticated;
revoke all on function public.mark_community_notifications_read()
  from public, anon, authenticated;
revoke all on function public.get_artist_top_supporters(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.get_public_artist_activity(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.get_today_support_summary()
  from public, anon, authenticated;
revoke all on function public.get_smart_review_queue(integer)
  from public, anon, authenticated;
revoke all on function public.community_network_health_report()
  from public, anon, authenticated;

grant execute on function public.update_community_preferences(text, boolean)
  to authenticated;
grant execute on function public.get_my_community_network()
  to authenticated;
grant execute on function public.get_my_recent_community_activity(integer)
  to authenticated;
grant execute on function public.get_my_community_notifications(integer)
  to authenticated;
grant execute on function public.get_my_community_notification_summary()
  to authenticated;
grant execute on function public.mark_community_notifications_read()
  to authenticated;
grant execute on function public.get_artist_top_supporters(uuid, integer)
  to anon, authenticated;
grant execute on function public.get_public_artist_activity(uuid, integer)
  to anon, authenticated;
grant execute on function public.get_today_support_summary()
  to authenticated;
grant execute on function public.get_smart_review_queue(integer)
  to authenticated;
grant execute on function public.community_network_health_report()
  to service_role;
