-- Human-facing guest identities, guest community activity, and ordered
-- per-song platform links for threshold-gated artist profile reveals.

create table if not exists public.song_platform_links (
  id uuid primary key default uuid_generate_v4(),
  song_id uuid not null references public.songs(id) on delete cascade,
  platform public.music_platform not null,
  music_url text not null check (char_length(trim(music_url)) between 8 and 2000),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (song_id, platform)
);

create unique index if not exists song_platform_links_primary_idx
  on public.song_platform_links (song_id)
  where is_primary;
create index if not exists song_platform_links_song_idx
  on public.song_platform_links (song_id, platform);

insert into public.song_platform_links (
  song_id,
  platform,
  music_url,
  is_primary
)
select id, platform, music_url, true
from public.songs
on conflict (song_id, platform) do update
set
  music_url = excluded.music_url,
  is_primary = true,
  updated_at = now();

create or replace function public.sync_primary_song_platform_link()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.music_url_matches_platform(new.music_url, new.platform) then
    raise exception 'The song URL does not match its platform';
  end if;

  update public.song_platform_links
  set is_primary = false, updated_at = now()
  where song_id = new.id
    and is_primary;

  insert into public.song_platform_links (
    song_id,
    platform,
    music_url,
    is_primary
  )
  values (
    new.id,
    new.platform,
    trim(new.music_url),
    true
  )
  on conflict (song_id, platform) do update
  set
    music_url = excluded.music_url,
    is_primary = true,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists sync_primary_song_platform_link
  on public.songs;
create trigger sync_primary_song_platform_link
after insert or update of platform, music_url
on public.songs
for each row execute function public.sync_primary_song_platform_link();

alter table public.song_platform_links enable row level security;
revoke all on table public.song_platform_links
  from public, anon, authenticated;

alter table public.community_support_events
  alter column supporter_id drop not null,
  add column if not exists guest_session_id uuid
    references public.guest_sessions(id) on delete cascade,
  add column if not exists actor_display_name text;

alter table public.community_support_events
  drop constraint if exists community_support_events_event_type_check;
alter table public.community_support_events
  add constraint community_support_events_event_type_check
  check (
    event_type in (
      'valid_listen',
      'complete_listen',
      'review',
      'follow',
      'like',
      'comment',
      'share'
    )
  );

alter table public.community_support_events
  drop constraint if exists community_support_events_actor_check;
alter table public.community_support_events
  add constraint community_support_events_actor_check
  check (num_nonnulls(supporter_id, guest_session_id) = 1);

create unique index if not exists community_support_events_guest_source_idx
  on public.community_support_events (
    guest_session_id,
    artist_id,
    event_type,
    source_id
  )
  where guest_session_id is not null
    and source_id is not null;

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
  normalized_nickname text := nullif(trim(guest_nickname), '');
  normalized_language text :=
    case when guest_language = 'es' then 'es' else 'en' end;
  generated_suffix text :=
    upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 6));
  generated_listener_id text :=
    'FL-' ||
    upper(substr(md5(gen_random_uuid()::text), 1, 4)) || '-' ||
    upper(substr(md5(clock_timestamp()::text || random()::text), 1, 4));
begin
  if normalized_nickname is not null
    and (
      char_length(normalized_nickname) not between 2 and 30
      or lower(normalized_nickname) in (
        'anonymous',
        'anonymous user',
        'guest',
        'guest listener',
        'anonymous listener'
      )
    )
  then
    raise exception 'Choose a nickname between 2 and 30 characters or leave it blank';
  end if;

  insert into public.guest_sessions (
    nickname,
    guest_listener_id,
    recovery_code,
    interface_language,
    expires_at
  )
  values (
    coalesce(normalized_nickname, 'Listener ' || generated_suffix),
    generated_listener_id,
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
  guest_name text;
  target_artist_id uuid;
  activity_source uuid;
begin
  select user_id
  into target_artist_id
  from public.songs
  where id = target_song_id
    and is_active
    and removed_at is null
    and archived_at is null;
  if target_artist_id is null then raise exception 'Song not found'; end if;

  if auth.uid() is not null then
    delete from public.song_likes
    where user_id = auth.uid() and song_id = target_song_id
    returning id into activity_source;
    if found then
      delete from public.community_support_events
      where source_id = activity_source and event_type = 'like';
      return false;
    end if;

    insert into public.song_likes (user_id, song_id)
    values (auth.uid(), target_song_id)
    returning id into activity_source;

    if target_artist_id <> auth.uid() then
      insert into public.community_support_events (
        supporter_id,
        artist_id,
        song_id,
        event_type,
        visibility,
        source_id
      )
      select
        auth.uid(),
        target_artist_id,
        target_song_id,
        'like',
        community_visibility,
        activity_source
      from public.profiles
      where id = auth.uid()
      on conflict do nothing;
    end if;
    return true;
  end if;

  guest_id := public.resolve_guest_session(guest_access_token);
  if guest_id is null then raise exception 'Guest profile required'; end if;

  delete from public.song_likes
  where guest_session_id = guest_id and song_id = target_song_id
  returning id into activity_source;
  if found then
    delete from public.community_support_events
    where source_id = activity_source and event_type = 'like';
    return false;
  end if;

  insert into public.song_likes (guest_session_id, song_id)
  values (guest_id, target_song_id)
  returning id into activity_source;

  select nickname into guest_name
  from public.guest_sessions
  where id = guest_id;

  insert into public.community_support_events (
    guest_session_id,
    actor_display_name,
    artist_id,
    song_id,
    event_type,
    visibility,
    source_id
  )
  values (
    guest_id,
    guest_name,
    target_artist_id,
    target_song_id,
    'like',
    'public',
    activity_source
  )
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
  if found then
    delete from public.community_support_events
    where guest_session_id = guest_id
      and artist_id = target_artist_id
      and event_type = 'follow';
    return false;
  end if;

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

  insert into public.community_support_events (
    guest_session_id,
    actor_display_name,
    artist_id,
    event_type,
    visibility,
    source_id
  )
  values (
    guest_id,
    guest_name,
    target_artist_id,
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
  guest_name text;
  new_comment_id uuid;
  target_artist_id uuid;
begin
  if char_length(trim(comment_body)) not between 2 and 1000 then
    raise exception 'Comment must contain between 2 and 1000 characters';
  end if;

  select user_id
  into target_artist_id
  from public.songs
  where id = target_song_id
    and is_active
    and removed_at is null
    and archived_at is null;
  if target_artist_id is null then raise exception 'Song not found'; end if;

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

    if target_artist_id <> auth.uid() then
      insert into public.community_support_events (
        supporter_id,
        artist_id,
        song_id,
        event_type,
        visibility,
        source_id
      )
      select
        auth.uid(),
        target_artist_id,
        target_song_id,
        'comment',
        community_visibility,
        new_comment_id
      from public.profiles
      where id = auth.uid()
      on conflict do nothing;
    end if;
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

    select nickname into guest_name
    from public.guest_sessions
    where id = guest_id;

    insert into public.community_support_events (
      guest_session_id,
      actor_display_name,
      artist_id,
      song_id,
      event_type,
      visibility,
      source_id
    )
    values (
      guest_id,
      guest_name,
      target_artist_id,
      target_song_id,
      'comment',
      'public',
      new_comment_id
    )
    on conflict do nothing;
  end if;

  return new_comment_id;
end;
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
  guest_name text;
  target_artist_id uuid;
  activity_source uuid;
begin
  if share_kind_value not in ('community', 'original_platform') then
    raise exception 'Unsupported share type';
  end if;
  if share_kind_value = 'original_platform'
    and nullif(trim(share_platform), '') is null
  then raise exception 'Original platform is required'; end if;

  select user_id
  into target_artist_id
  from public.songs
  where id = target_song_id
    and is_active
    and removed_at is null
    and archived_at is null;
  if target_artist_id is null then raise exception 'Song not found'; end if;

  if auth.uid() is not null then
    insert into public.song_shares (
      user_id, song_id, share_kind, platform
    )
    values (
      auth.uid(), target_song_id, share_kind_value,
      case when share_kind_value = 'community' then null else trim(share_platform) end
    )
    returning id into activity_source;

    if target_artist_id <> auth.uid() then
      insert into public.community_support_events (
        supporter_id,
        artist_id,
        song_id,
        event_type,
        visibility,
        source_id
      )
      select
        auth.uid(),
        target_artist_id,
        target_song_id,
        'share',
        community_visibility,
        activity_source
      from public.profiles
      where id = auth.uid()
      on conflict do nothing;
    end if;
  else
    guest_id := public.resolve_guest_session(guest_access_token);
    if guest_id is null then raise exception 'Guest profile required'; end if;

    insert into public.song_shares (
      guest_session_id, song_id, share_kind, platform
    )
    values (
      guest_id, target_song_id, share_kind_value,
      case when share_kind_value = 'community' then null else trim(share_platform) end
    )
    returning id into activity_source;

    select nickname into guest_name
    from public.guest_sessions
    where id = guest_id;

    insert into public.community_support_events (
      guest_session_id,
      actor_display_name,
      artist_id,
      song_id,
      event_type,
      visibility,
      source_id
    )
    values (
      guest_id,
      guest_name,
      target_artist_id,
      target_song_id,
      'share',
      'public',
      activity_source
    )
    on conflict do nothing;
  end if;
end;
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
      when events.guest_session_id is not null then null
      when (
        events.event_type = 'follow'
        or (
          events.visibility = 'public'
          and actors.community_visibility = 'public'
        )
      )
        and actors.account_status = 'active'
        and actors.banned_at is null
      then actors.id
      else null
    end,
    case
      when events.guest_session_id is not null
        then coalesce(events.actor_display_name, guests.nickname, 'Listener')
      when (
        events.event_type = 'follow'
        or (
          events.visibility = 'public'
          and actors.community_visibility = 'public'
        )
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
  left join public.profiles as actors
    on actors.id = events.supporter_id
  left join public.guest_sessions as guests
    on guests.id = events.guest_session_id
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

drop function if exists public.get_public_artist_songs(uuid);
create or replace function public.get_public_artist_songs(
  target_artist_id uuid
)
returns table (
  song_id uuid,
  title text,
  artist_name text,
  cover_image_url text,
  music_url text,
  platform public.music_platform,
  genre text,
  song_language text,
  country text,
  explicit_content boolean,
  submitted_at timestamptz,
  reviews_received integer,
  average_rating numeric,
  hook_score integer,
  platform_links jsonb
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
    songs.cover_image_url,
    songs.music_url,
    songs.platform,
    songs.genre,
    songs.song_language,
    songs.country,
    songs.explicit_content,
    songs.created_at,
    coalesce(metrics.reviews_received, 0),
    coalesce(metrics.average_rating, 0),
    coalesce(metrics.hook_score, 0),
    coalesce(links.platform_links, '[]'::jsonb)
  from public.songs
  join public.profiles as creators on creators.id = songs.user_id
  left join lateral (
    select
      count(*)::integer as reviews_received,
      round(avg(reviews.rating)::numeric, 2) as average_rating,
      round((
        avg(case when reviews.listen_full then 100 else 0 end) +
        avg(case when reviews.add_to_playlist then 100 else 0 end) +
        avg(case when reviews.grabbed_attention then 100 else 0 end) +
        avg(case when reviews.share_with_friend then 100 else 0 end)
      ) / 4, 0)::integer as hook_score
    from public.reviews
    where reviews.song_id = songs.id
      and reviews.quality_passed
  ) metrics on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'platform', platform_links.platform,
        'music_url', platform_links.music_url
      )
      order by case platform_links.platform
        when 'youtube_music' then 1
        when 'youtube' then 2
        when 'apple_music' then 3
        when 'spotify' then 4
        when 'tiktok' then 5
        when 'soundcloud' then 6
        else 99
      end
    ) as platform_links
    from public.song_platform_links as platform_links
    where platform_links.song_id = songs.id
  ) links on true
  where songs.user_id = target_artist_id
    and songs.is_active
    and songs.removed_at is null
    and songs.archived_at is null
    and songs.merged_into_song_id is null
    and creators.account_status = 'active'
    and creators.banned_at is null
    and (
      not songs.explicit_content
      or exists (
        select 1
        from public.profiles as viewer
        where viewer.id = auth.uid()
          and viewer.account_status = 'active'
          and viewer.show_explicit_content
      )
    )
  order by songs.created_at desc;
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
  guest_language text;
  guest_name text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if guest_id is null then return false; end if;

  select interface_language, nickname
  into guest_language, guest_name
  from public.guest_sessions
  where id = guest_id;

  insert into public.artist_follows (follower_id, artist_id, created_at)
  select auth.uid(), artist_id, created_at
  from public.guest_artist_follows
  where guest_session_id = guest_id
    and artist_id <> auth.uid()
  on conflict do nothing;

  delete from public.community_support_events
  where supporter_id = auth.uid()
    and event_type = 'follow'
    and source_id = auth.uid()
    and artist_id in (
      select artist_id
      from public.guest_artist_follows
      where guest_session_id = guest_id
    );

  delete from public.community_notifications
  where actor_id = auth.uid()
    and event_type = 'follow'
    and source_id = auth.uid()
    and recipient_id in (
      select artist_id
      from public.guest_artist_follows
      where guest_session_id = guest_id
    );

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

  insert into public.song_views (
    user_id,
    song_id,
    view_date,
    created_at
  )
  select
    auth.uid(),
    song_id,
    view_date,
    created_at
  from public.song_views
  where guest_session_id = guest_id
  on conflict do nothing;

  delete from public.guest_artist_follows
  where guest_session_id = guest_id;
  delete from public.guest_saved_songs
  where guest_session_id = guest_id;
  delete from public.song_likes
  where guest_session_id = guest_id;
  delete from public.song_views
  where guest_session_id = guest_id;

  update public.song_comments
  set user_id = auth.uid(), guest_session_id = null
  where guest_session_id = guest_id;

  update public.song_shares
  set user_id = auth.uid(), guest_session_id = null
  where guest_session_id = guest_id;

  update public.community_support_events
  set
    supporter_id = auth.uid(),
    guest_session_id = null,
    actor_display_name = null
  where guest_session_id = guest_id;

  update public.profiles
  set
    display_name = guest_name,
    interface_language = coalesce(guest_language, interface_language),
    updated_at = now()
  where id = auth.uid();

  update public.guest_sessions
  set converted_to_user_id = auth.uid(), last_seen_at = now()
  where id = guest_id;

  return true;
end;
$$;

create or replace function public.true_guest_identity_health_report()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'platform_links_table',
      to_regclass('public.song_platform_links') is not null,
    'songs_without_primary_link', (
      select count(*)::integer
      from public.songs
      where songs.removed_at is null
        and not exists (
          select 1
          from public.song_platform_links
          where song_platform_links.song_id = songs.id
            and song_platform_links.is_primary
        )
    ),
    'invalid_guest_actor_events', (
      select count(*)::integer
      from public.community_support_events
      where num_nonnulls(supporter_id, guest_session_id) <> 1
    ),
    'guest_events_without_names', (
      select count(*)::integer
      from public.community_support_events
      where guest_session_id is not null
        and nullif(trim(actor_display_name), '') is null
    )
  );
$$;

revoke all on function public.sync_primary_song_platform_link()
  from public, anon, authenticated;
revoke all on function public.create_guest_identity(text, text)
  from public, anon, authenticated;
revoke all on function public.toggle_song_like(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.toggle_follow_artist(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.add_song_comment(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.record_song_share(uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.get_public_artist_activity(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.get_public_artist_songs(uuid)
  from public, anon, authenticated;
revoke all on function public.convert_guest_to_account(uuid)
  from public, anon, authenticated;
revoke all on function public.true_guest_identity_health_report()
  from public, anon, authenticated;

grant execute on function public.create_guest_identity(text, text)
  to anon, authenticated;
grant execute on function public.toggle_song_like(uuid, uuid)
  to anon, authenticated;
grant execute on function public.toggle_follow_artist(uuid, uuid)
  to anon, authenticated;
grant execute on function public.add_song_comment(uuid, text, uuid)
  to anon, authenticated;
grant execute on function public.record_song_share(uuid, text, text, uuid)
  to anon, authenticated;
grant execute on function public.get_public_artist_activity(uuid, integer)
  to anon, authenticated;
grant execute on function public.get_public_artist_songs(uuid)
  to anon, authenticated;
grant execute on function public.convert_guest_to_account(uuid)
  to authenticated;
grant execute on function public.true_guest_identity_health_report()
  to service_role;
