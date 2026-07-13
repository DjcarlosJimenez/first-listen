drop function if exists public.get_guest_song_queue(uuid, integer);

create or replace function public.get_guest_song_queue(
  guest_access_token uuid,
  queue_limit integer default 200
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
  limit greatest(1, least(queue_limit, 200));
$$;

revoke all on function public.get_guest_song_queue(uuid, integer)
  from public, anon, authenticated;

grant execute on function public.get_guest_song_queue(uuid, integer)
  to anon, authenticated;
