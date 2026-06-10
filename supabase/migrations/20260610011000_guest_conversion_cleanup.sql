-- Move guest-owned community records into the authenticated account without
-- double-counting the same follow, save, like, or view after conversion.

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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if guest_id is null then return false; end if;

  select interface_language
  into guest_language
  from public.guest_sessions
  where id = guest_id;

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

  update public.profiles
  set
    interface_language = coalesce(guest_language, interface_language),
    updated_at = now()
  where id = auth.uid();

  update public.guest_sessions
  set converted_to_user_id = auth.uid(), last_seen_at = now()
  where id = guest_id;

  return true;
end;
$$;

revoke all on function public.convert_guest_to_account(uuid)
  from public, anon, authenticated;
grant execute on function public.convert_guest_to_account(uuid)
  to authenticated;
