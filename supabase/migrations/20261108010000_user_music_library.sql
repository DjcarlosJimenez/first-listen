-- Private user music library: named playlists, liked-song retrieval, and
-- opt-in preferences for future inactivity reminders.

create table if not exists public.user_music_playlists (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_music_playlists_user_name_idx
  on public.user_music_playlists (user_id, lower(trim(name)));

create index if not exists user_music_playlists_user_updated_idx
  on public.user_music_playlists (user_id, updated_at desc);

create table if not exists public.user_music_playlist_items (
  playlist_id uuid not null
    references public.user_music_playlists(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (playlist_id, song_id)
);

create index if not exists user_music_playlist_items_order_idx
  on public.user_music_playlist_items (playlist_id, position, created_at);

create table if not exists public.user_notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  inactive_community_reminders boolean not null default false,
  reminder_interval_days integer not null default 30
    check (reminder_interval_days between 14 and 90),
  reminder_consent_at timestamptz,
  last_reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_music_playlists enable row level security;
alter table public.user_music_playlist_items enable row level security;
alter table public.user_notification_preferences enable row level security;

drop policy if exists "users manage own music playlists"
  on public.user_music_playlists;
create policy "users manage own music playlists"
  on public.user_music_playlists for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "users manage own music playlist items"
  on public.user_music_playlist_items;
create policy "users manage own music playlist items"
  on public.user_music_playlist_items for all
  to authenticated
  using (
    exists (
      select 1
      from public.user_music_playlists
      where user_music_playlists.id = user_music_playlist_items.playlist_id
        and user_music_playlists.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.user_music_playlists
      where user_music_playlists.id = user_music_playlist_items.playlist_id
        and user_music_playlists.user_id = auth.uid()
    )
  );

drop policy if exists "users manage own notification preferences"
  on public.user_notification_preferences;
create policy "users manage own notification preferences"
  on public.user_notification_preferences for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.touch_user_music_playlist()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    update public.user_music_playlists
    set updated_at = now()
    where id = old.playlist_id;
    return old;
  end if;
  update public.user_music_playlists
  set updated_at = now()
  where id = new.playlist_id;
  return new;
end;
$$;

drop trigger if exists user_music_playlist_items_touch_parent
  on public.user_music_playlist_items;
create trigger user_music_playlist_items_touch_parent
after insert or update or delete on public.user_music_playlist_items
for each row execute function public.touch_user_music_playlist();

create or replace function public.create_music_playlist(playlist_name text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  created_id uuid;
  clean_name text := trim(coalesce(playlist_name, ''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(clean_name) not between 1 and 60 then
    raise exception 'Playlist name must contain between 1 and 60 characters';
  end if;

  insert into public.user_music_playlists (user_id, name)
  values (auth.uid(), clean_name)
  returning id into created_id;

  return created_id;
exception
  when unique_violation then
    select id into created_id
    from public.user_music_playlists
    where user_id = auth.uid() and lower(trim(name)) = lower(clean_name)
    limit 1;
    return created_id;
end;
$$;

create or replace function public.rename_music_playlist(
  target_playlist_id uuid,
  playlist_name text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  clean_name text := trim(coalesce(playlist_name, ''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(clean_name) not between 1 and 60 then
    raise exception 'Playlist name must contain between 1 and 60 characters';
  end if;

  update public.user_music_playlists
  set name = clean_name, updated_at = now()
  where id = target_playlist_id and user_id = auth.uid();
  return found;
end;
$$;

create or replace function public.delete_music_playlist(target_playlist_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  delete from public.user_music_playlists
  where id = target_playlist_id and user_id = auth.uid();
  return found;
end;
$$;

create or replace function public.set_music_playlist_song(
  target_playlist_id uuid,
  target_song_id uuid,
  should_include boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  next_position integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.user_music_playlists
    where id = target_playlist_id and user_id = auth.uid()
  ) then raise exception 'Playlist not found'; end if;

  if not coalesce(should_include, true) then
    delete from public.user_music_playlist_items
    where playlist_id = target_playlist_id and song_id = target_song_id;
    return false;
  end if;

  if not exists (
    select 1 from public.songs
    where id = target_song_id and removed_at is null
  ) then raise exception 'Song not found'; end if;

  select coalesce(max(position), -1) + 1 into next_position
  from public.user_music_playlist_items
  where playlist_id = target_playlist_id;

  insert into public.user_music_playlist_items (playlist_id, song_id, position)
  values (target_playlist_id, target_song_id, next_position)
  on conflict (playlist_id, song_id) do nothing;
  return true;
end;
$$;

create or replace function public.move_music_playlist_song(
  target_playlist_id uuid,
  target_song_id uuid,
  move_direction integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_position integer;
  neighbor_song_id uuid;
  neighbor_position integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if move_direction not in (-1, 1) then raise exception 'Invalid direction'; end if;
  if not exists (
    select 1 from public.user_music_playlists
    where id = target_playlist_id and user_id = auth.uid()
  ) then raise exception 'Playlist not found'; end if;

  select position into current_position
  from public.user_music_playlist_items
  where playlist_id = target_playlist_id and song_id = target_song_id;
  if current_position is null then return false; end if;

  if move_direction < 0 then
    select song_id, position into neighbor_song_id, neighbor_position
    from public.user_music_playlist_items
    where playlist_id = target_playlist_id and position < current_position
    order by position desc, created_at desc limit 1;
  else
    select song_id, position into neighbor_song_id, neighbor_position
    from public.user_music_playlist_items
    where playlist_id = target_playlist_id and position > current_position
    order by position asc, created_at asc limit 1;
  end if;

  if neighbor_song_id is null then return false; end if;

  update public.user_music_playlist_items
  set position = case
    when song_id = target_song_id then neighbor_position
    when song_id = neighbor_song_id then current_position
    else position
  end
  where playlist_id = target_playlist_id
    and song_id in (target_song_id, neighbor_song_id);
  return true;
end;
$$;

create or replace function public.get_my_music_playlists()
returns table (
  playlist_id uuid,
  playlist_name text,
  item_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    playlists.id,
    playlists.name,
    count(items.song_id)::integer,
    playlists.created_at,
    playlists.updated_at
  from public.user_music_playlists playlists
  left join public.user_music_playlist_items items
    on items.playlist_id = playlists.id
  where playlists.user_id = auth.uid()
  group by playlists.id
  order by playlists.updated_at desc, playlists.created_at desc;
$$;

create or replace function public.get_my_music_playlist_items(
  target_playlist_id uuid default null
)
returns table (
  playlist_id uuid,
  playlist_name text,
  song_id uuid,
  "position" integer,
  title text,
  artist_name text,
  cover_image_url text,
  music_url text,
  platform public.music_platform,
  genre text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    playlists.id,
    playlists.name,
    songs.id,
    items.position,
    songs.title,
    songs.artist_name,
    songs.cover_image_url,
    songs.music_url,
    songs.platform,
    songs.genre
  from public.user_music_playlists playlists
  join public.user_music_playlist_items items
    on items.playlist_id = playlists.id
  join public.songs on songs.id = items.song_id
  where playlists.user_id = auth.uid()
    and (target_playlist_id is null or playlists.id = target_playlist_id)
    and songs.removed_at is null
  order by playlists.updated_at desc, items.position asc, items.created_at asc;
$$;

create or replace function public.get_my_liked_songs()
returns table (
  song_id uuid,
  artist_id uuid,
  title text,
  artist_name text,
  cover_image_url text,
  music_url text,
  platform public.music_platform,
  genre text,
  liked_at timestamptz
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
    likes.created_at
  from public.song_likes likes
  join public.songs on songs.id = likes.song_id
  where likes.user_id = auth.uid()
    and songs.removed_at is null
  order by likes.created_at desc;
$$;

create or replace function public.get_my_notification_preferences()
returns table (
  inactive_community_reminders boolean,
  reminder_interval_days integer,
  reminder_consent_at timestamptz,
  last_reminder_sent_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    coalesce(preferences.inactive_community_reminders, false),
    coalesce(preferences.reminder_interval_days, 30),
    preferences.reminder_consent_at,
    preferences.last_reminder_sent_at
  from (select auth.uid() as user_id) viewer
  left join public.user_notification_preferences preferences
    on preferences.user_id = viewer.user_id
  where viewer.user_id is not null;
$$;

create or replace function public.update_inactive_reminder_preference(
  reminders_enabled boolean,
  interval_days integer default 30
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if interval_days not between 14 and 90 then
    raise exception 'Reminder interval must be between 14 and 90 days';
  end if;

  insert into public.user_notification_preferences (
    user_id,
    inactive_community_reminders,
    reminder_interval_days,
    reminder_consent_at,
    updated_at
  ) values (
    auth.uid(),
    coalesce(reminders_enabled, false),
    interval_days,
    case when coalesce(reminders_enabled, false) then now() else null end,
    now()
  )
  on conflict (user_id) do update set
    inactive_community_reminders = excluded.inactive_community_reminders,
    reminder_interval_days = excluded.reminder_interval_days,
    reminder_consent_at = case
      when excluded.inactive_community_reminders
        then coalesce(
          public.user_notification_preferences.reminder_consent_at,
          now()
        )
      else null
    end,
    updated_at = now();

  return coalesce(reminders_enabled, false);
end;
$$;

revoke all on table public.user_music_playlists from public, anon, authenticated;
revoke all on table public.user_music_playlist_items from public, anon, authenticated;
revoke all on table public.user_notification_preferences from public, anon, authenticated;
grant select, insert, update, delete on table public.user_music_playlists to authenticated;
grant select, insert, update, delete on table public.user_music_playlist_items to authenticated;
grant select, insert, update on table public.user_notification_preferences to authenticated;

revoke all on function public.create_music_playlist(text) from public, anon, authenticated;
revoke all on function public.rename_music_playlist(uuid, text) from public, anon, authenticated;
revoke all on function public.delete_music_playlist(uuid) from public, anon, authenticated;
revoke all on function public.set_music_playlist_song(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.move_music_playlist_song(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.get_my_music_playlists() from public, anon, authenticated;
revoke all on function public.get_my_music_playlist_items(uuid) from public, anon, authenticated;
revoke all on function public.get_my_liked_songs() from public, anon, authenticated;
revoke all on function public.get_my_notification_preferences() from public, anon, authenticated;
revoke all on function public.update_inactive_reminder_preference(boolean, integer) from public, anon, authenticated;

grant execute on function public.create_music_playlist(text) to authenticated;
grant execute on function public.rename_music_playlist(uuid, text) to authenticated;
grant execute on function public.delete_music_playlist(uuid) to authenticated;
grant execute on function public.set_music_playlist_song(uuid, uuid, boolean) to authenticated;
grant execute on function public.move_music_playlist_song(uuid, uuid, integer) to authenticated;
grant execute on function public.get_my_music_playlists() to authenticated;
grant execute on function public.get_my_music_playlist_items(uuid) to authenticated;
grant execute on function public.get_my_liked_songs() to authenticated;
grant execute on function public.get_my_notification_preferences() to authenticated;
grant execute on function public.update_inactive_reminder_preference(boolean, integer) to authenticated;

comment on table public.user_notification_preferences is
  'Consent and cadence only. No reminder email is sent until a separate reviewed delivery job is enabled.';
