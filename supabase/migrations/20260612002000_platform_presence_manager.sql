-- Priority PPM-1: Platform Presence Manager.
--
-- Artists control one primary playback source and optional additional platform
-- destinations. This migration is additive and does not delete existing songs,
-- reviews, or platform-link records.

alter type public.music_platform add value if not exists 'amazon_music';
alter type public.music_platform add value if not exists 'deezer';
alter type public.music_platform add value if not exists 'facebook_video';
alter type public.music_platform add value if not exists 'instagram';
alter type public.music_platform add value if not exists 'other';

create or replace function public.music_url_matches_platform(
  music_url text,
  song_platform public.music_platform
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  normalized text := lower(trim(coalesce(music_url, '')));
  platform_key text := song_platform::text;
begin
  if normalized !~ '^https://' then
    return false;
  end if;

  case platform_key
    when 'spotify' then
      return normalized ~ '^https://open\.spotify\.com/(intl-[a-z-]+/)?track/[a-z0-9]+';
    when 'youtube_music' then
      return normalized ~ '^https://music\.youtube\.com/watch\?';
    when 'youtube' then
      return normalized ~ '^https://(www\.)?(m\.)?(youtube\.com/watch\?|youtube\.com/shorts/|youtu\.be/)';
    when 'soundcloud' then
      return normalized ~ '^https://(www\.)?soundcloud\.com/[^/]+/[^/]+';
    when 'apple_music' then
      return normalized ~ '^https://music\.apple\.com/.+';
    when 'tiktok' then
      return normalized ~ '^https://((www|m)\.)?tiktok\.com/.+' or normalized ~ '^https://(vm|vt)\.tiktok\.com/.+';
    when 'amazon_music' then
      return normalized ~ '^https://([a-z0-9-]+\.)?music\.amazon\.' or normalized ~ '^https://(www\.)?amazon\..*/music';
    when 'deezer' then
      return normalized ~ '^https://(www\.)?deezer\.com/.+';
    when 'facebook_video' then
      return normalized ~ '^https://(www\.)?facebook\.com/.+' or normalized ~ '^https://fb\.watch/.+';
    when 'instagram' then
      return normalized ~ '^https://(www\.)?instagram\.com/(p|reel|tv)/.+';
    when 'other' then
      return char_length(normalized) between 8 and 2000;
    else
      return false;
  end case;
end;
$$;

create or replace function public.song_platform_links_json(target_song_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'platform', links.platform,
        'music_url', links.music_url,
        'is_primary', links.is_primary,
        'resolution_source', links.resolution_source,
        'confidence_score', links.confidence_score,
        'verified_at', links.verified_at,
        'verification_note', links.verification_note
      )
      order by
        case links.platform::text
          when 'youtube_music' then 1
          when 'youtube' then 2
          when 'spotify' then 3
          when 'apple_music' then 4
          when 'tiktok' then 5
          when 'soundcloud' then 6
          when 'amazon_music' then 7
          when 'deezer' then 8
          when 'facebook_video' then 9
          when 'instagram' then 10
          when 'other' then 11
          else 99
        end,
        links.is_primary desc,
        links.confidence_score desc,
        links.created_at
    ),
    '[]'::jsonb
  )
  from public.song_platform_links links
  where links.song_id = target_song_id
    and (
      links.is_primary
      or links.resolution_source in ('manual', 'verified', 'submitted')
    )
    and links.resolution_source <> 'inferred';
$$;

create or replace function public.recommended_song_platform(target_song_id uuid)
returns public.music_platform
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select songs.platform
  from public.songs
  where songs.id = target_song_id;
$$;

create or replace function public.resolve_song_platform_links(target_song_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  song_row public.songs%rowtype;
begin
  select *
  into song_row
  from public.songs
  where id = target_song_id;

  if not found then
    raise exception 'Song not found';
  end if;

  if not public.music_url_matches_platform(song_row.music_url, song_row.platform) then
    raise exception 'The song URL does not match its platform';
  end if;

  update public.song_platform_links
  set is_primary = false, updated_at = now()
  where song_id = song_row.id
    and is_primary
    and platform <> song_row.platform;

  insert into public.song_platform_links (
    song_id,
    platform,
    music_url,
    is_primary,
    resolution_source,
    confidence_score,
    verified_at,
    verification_note,
    last_resolved_at
  )
  values (
    song_row.id,
    song_row.platform,
    trim(song_row.music_url),
    true,
    'submitted',
    100,
    now(),
    'Creator submitted primary link',
    now()
  )
  on conflict (song_id, platform) do update
  set
    music_url = excluded.music_url,
    is_primary = true,
    resolution_source = 'submitted',
    confidence_score = 100,
    verified_at = coalesce(public.song_platform_links.verified_at, excluded.verified_at),
    verification_note = excluded.verification_note,
    last_resolved_at = now(),
    updated_at = now();

  return (
    select count(*)::integer
    from public.song_platform_links
    where song_id = song_row.id
  );
end;
$$;

create or replace function public.sync_primary_song_platform_link()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.resolve_song_platform_links(new.id);
  return new;
end;
$$;

create or replace function public.upsert_song_platform_presence_link(
  target_song_id uuid,
  target_platform public.music_platform,
  target_music_url text,
  presence_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  song_row public.songs%rowtype;
  actor_role public.app_role;
  saved_link public.song_platform_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into song_row
  from public.songs
  where id = target_song_id
    and removed_at is null
    and merged_into_song_id is null;
  if not found then
    raise exception 'Song not found';
  end if;

  select role
  into actor_role
  from public.profiles
  where id = auth.uid()
    and account_status = 'active'
    and banned_at is null;
  if not found then
    raise exception 'Active account required';
  end if;

  if song_row.user_id <> auth.uid()
    and actor_role not in ('super_admin', 'admin', 'moderator')
  then
    raise exception 'Only the creator or staff can manage platform presence';
  end if;

  if target_platform = song_row.platform then
    raise exception 'This platform is already the primary playback source';
  end if;

  if not public.music_url_matches_platform(target_music_url, target_platform) then
    raise exception 'Platform link does not match the selected platform';
  end if;

  insert into public.song_platform_links (
    song_id,
    platform,
    music_url,
    is_primary,
    resolution_source,
    confidence_score,
    verified_at,
    verified_by,
    verification_note,
    last_resolved_at
  )
  values (
    target_song_id,
    target_platform,
    trim(target_music_url),
    false,
    'manual',
    100,
    now(),
    auth.uid(),
    left(coalesce(nullif(trim(presence_note), ''), 'Artist supplied platform destination'), 240),
    now()
  )
  on conflict (song_id, platform) do update
  set
    music_url = excluded.music_url,
    is_primary = false,
    resolution_source = 'manual',
    confidence_score = 100,
    verified_at = now(),
    verified_by = auth.uid(),
    verification_note = excluded.verification_note,
    last_resolved_at = now(),
    updated_at = now()
  returning * into saved_link;

  return jsonb_build_object(
    'platform', saved_link.platform,
    'music_url', saved_link.music_url,
    'is_primary', saved_link.is_primary,
    'resolution_source', saved_link.resolution_source,
    'confidence_score', saved_link.confidence_score
  );
end;
$$;

create or replace function public.remove_song_platform_presence_link(
  target_song_id uuid,
  target_platform public.music_platform
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  song_row public.songs%rowtype;
  actor_role public.app_role;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into song_row
  from public.songs
  where id = target_song_id
    and removed_at is null
    and merged_into_song_id is null;
  if not found then
    raise exception 'Song not found';
  end if;

  select role
  into actor_role
  from public.profiles
  where id = auth.uid()
    and account_status = 'active'
    and banned_at is null;
  if not found then
    raise exception 'Active account required';
  end if;

  if song_row.user_id <> auth.uid()
    and actor_role not in ('super_admin', 'admin', 'moderator')
  then
    raise exception 'Only the creator or staff can manage platform presence';
  end if;

  delete from public.song_platform_links
  where song_id = target_song_id
    and platform = target_platform
    and not is_primary;

  return found;
end;
$$;

create or replace function public.set_song_primary_platform(
  target_song_id uuid,
  target_platform public.music_platform
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  song_row public.songs%rowtype;
  actor_role public.app_role;
  target_link public.song_platform_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if target_platform::text not in (
    'spotify',
    'youtube',
    'youtube_music',
    'soundcloud',
    'apple_music',
    'tiktok'
  ) then
    raise exception 'This platform cannot be used as the primary playback source';
  end if;

  select *
  into song_row
  from public.songs
  where id = target_song_id
    and removed_at is null
    and merged_into_song_id is null;
  if not found then
    raise exception 'Song not found';
  end if;

  select role
  into actor_role
  from public.profiles
  where id = auth.uid()
    and account_status = 'active'
    and banned_at is null;
  if not found then
    raise exception 'Active account required';
  end if;

  if song_row.user_id <> auth.uid()
    and actor_role not in ('super_admin', 'admin', 'moderator')
  then
    raise exception 'Only the creator or staff can change the primary platform';
  end if;

  select *
  into target_link
  from public.song_platform_links
  where song_id = target_song_id
    and platform = target_platform;
  if not found then
    raise exception 'Add this platform before making it primary';
  end if;

  if not public.music_url_matches_platform(target_link.music_url, target_platform) then
    raise exception 'Stored platform link does not match the selected platform';
  end if;

  update public.songs
  set
    platform = target_platform,
    music_url = target_link.music_url
  where id = target_song_id;

  perform public.resolve_song_platform_links(target_song_id);

  return jsonb_build_object(
    'platform', target_platform,
    'music_url', target_link.music_url,
    'platform_links', public.song_platform_links_json(target_song_id)
  );
end;
$$;

create or replace function public.upsert_verified_song_platform_link(
  target_song_id uuid,
  target_platform public.music_platform,
  target_music_url text,
  verification_note text default null
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.upsert_song_platform_presence_link(
    target_song_id,
    target_platform,
    target_music_url,
    verification_note
  );
$$;

create or replace function public.remove_verified_song_platform_link(
  target_song_id uuid,
  target_platform public.music_platform
)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.remove_song_platform_presence_link(target_song_id, target_platform);
$$;

revoke all on function public.upsert_song_platform_presence_link(uuid, public.music_platform, text, text)
  from public, anon, authenticated;
revoke all on function public.remove_song_platform_presence_link(uuid, public.music_platform)
  from public, anon, authenticated;
revoke all on function public.set_song_primary_platform(uuid, public.music_platform)
  from public, anon, authenticated;
revoke all on function public.upsert_verified_song_platform_link(uuid, public.music_platform, text, text)
  from public, anon, authenticated;
revoke all on function public.remove_verified_song_platform_link(uuid, public.music_platform)
  from public, anon, authenticated;

grant execute on function public.song_platform_links_json(uuid) to authenticated, service_role;
grant execute on function public.recommended_song_platform(uuid) to authenticated, service_role;
grant execute on function public.resolve_song_platform_links(uuid) to service_role;
grant execute on function public.upsert_song_platform_presence_link(uuid, public.music_platform, text, text)
  to authenticated;
grant execute on function public.remove_song_platform_presence_link(uuid, public.music_platform)
  to authenticated;
grant execute on function public.set_song_primary_platform(uuid, public.music_platform)
  to authenticated;
grant execute on function public.upsert_verified_song_platform_link(uuid, public.music_platform, text, text)
  to authenticated;
grant execute on function public.remove_verified_song_platform_link(uuid, public.music_platform)
  to authenticated;
