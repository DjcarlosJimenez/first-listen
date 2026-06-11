-- Guest listeners receive the same community context as registered listeners
-- while creator, reward, and ranking participation remain member-only.

alter table public.guest_sessions
  add column if not exists last_activity_summary_at timestamptz;

update public.guest_sessions
set last_activity_summary_at = coalesce(last_activity_summary_at, created_at)
where last_activity_summary_at is null;

alter table public.guest_sessions
  alter column last_activity_summary_at set default now();

create or replace function public.get_guest_experience_summary(
  guest_access_token uuid,
  mark_activity_seen boolean default true
)
returns table (
  summary_since timestamptz,
  community_activity_count bigint,
  community_listens_count bigint,
  community_comments_count bigint,
  community_likes_count bigint,
  community_follows_count bigint,
  community_shares_count bigint,
  new_songs_count bigint,
  valid_listens bigint,
  total_listening_seconds bigint,
  songs_explored bigint,
  likes_count bigint,
  comments_count bigint,
  following_count bigint,
  saved_songs_count bigint,
  shares_count bigint,
  queue_song_count bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  active_guest_id uuid;
  activity_since timestamptz;
begin
  select
    guest.id,
    coalesce(guest.last_activity_summary_at, guest.created_at)
  into active_guest_id, activity_since
  from public.guest_sessions guest
  where guest.access_token = guest_access_token
    and guest.converted_to_user_id is null;

  if active_guest_id is null then
    raise exception 'Guest profile not found';
  end if;

  return query
  select
    activity_since,
    (
      select count(*)
      from public.community_support_events event
      where event.visibility = 'public'
        and event.created_at > activity_since
        and event.guest_session_id is distinct from active_guest_id
    ),
    (
      select count(*)
      from public.community_support_events event
      where event.visibility = 'public'
        and event.created_at > activity_since
        and event.guest_session_id is distinct from active_guest_id
        and event.event_type in ('valid_listen', 'complete_listen', 'review')
    ),
    (
      select count(*)
      from public.community_support_events event
      where event.visibility = 'public'
        and event.created_at > activity_since
        and event.guest_session_id is distinct from active_guest_id
        and event.event_type = 'comment'
    ),
    (
      select count(*)
      from public.community_support_events event
      where event.visibility = 'public'
        and event.created_at > activity_since
        and event.guest_session_id is distinct from active_guest_id
        and event.event_type = 'like'
    ),
    (
      select count(*)
      from public.community_support_events event
      where event.visibility = 'public'
        and event.created_at > activity_since
        and event.guest_session_id is distinct from active_guest_id
        and event.event_type = 'follow'
    ),
    (
      select count(*)
      from public.community_support_events event
      where event.visibility = 'public'
        and event.created_at > activity_since
        and event.guest_session_id is distinct from active_guest_id
        and event.event_type = 'share'
    ),
    (
      select count(*)
      from public.songs song
      join public.profiles creator on creator.id = song.user_id
      where song.created_at > activity_since
        and song.is_active
        and song.removed_at is null
        and song.archived_at is null
        and song.merged_into_song_id is null
        and song.approval_status in ('auto_approved', 'approved')
        and coalesce(song.explicit_content, false) = false
        and creator.account_status = 'active'
        and creator.banned_at is null
    ),
    (
      select count(*)
      from public.guest_listening_sessions session
      where session.guest_session_id = active_guest_id
        and session.valid_listen_at is not null
    ),
    (
      select coalesce(sum(greatest(session.verified_seconds, 0)), 0)::bigint
      from public.guest_listening_sessions session
      where session.guest_session_id = active_guest_id
    ),
    (
      select count(distinct session.song_id)
      from public.guest_listening_sessions session
      where session.guest_session_id = active_guest_id
    ),
    (
      select count(*)
      from public.song_likes song_like
      where song_like.guest_session_id = active_guest_id
    ),
    (
      select count(*)
      from public.song_comments comment
      where comment.guest_session_id = active_guest_id
        and comment.removed_at is null
    ),
    (
      select count(*)
      from public.guest_artist_follows follow
      where follow.guest_session_id = active_guest_id
    ),
    (
      select count(*)
      from public.guest_saved_songs saved
      where saved.guest_session_id = active_guest_id
    ),
    (
      select count(*)
      from public.song_shares share
      where share.guest_session_id = active_guest_id
    ),
    (
      select count(*)
      from public.songs song
      join public.profiles creator on creator.id = song.user_id
      where song.is_active
        and song.removed_at is null
        and song.archived_at is null
        and song.merged_into_song_id is null
        and song.approval_status in ('auto_approved', 'approved')
        and song.queue_tier in ('public', 'sponsored')
        and coalesce(song.explicit_content, false) = false
        and creator.account_status = 'active'
        and creator.banned_at is null
        and not exists (
          select 1
          from public.guest_listening_sessions session
          where session.guest_session_id = active_guest_id
            and session.song_id = song.id
            and session.created_at >= now() - interval '24 hours'
        )
    );

  if mark_activity_seen then
    update public.guest_sessions
    set
      last_activity_summary_at = now(),
      last_seen_at = now()
    where id = active_guest_id;
  end if;
end;
$$;

revoke all on function public.get_guest_experience_summary(uuid, boolean)
  from public;
grant execute on function public.get_guest_experience_summary(uuid, boolean)
  to anon, authenticated, service_role;

create or replace function public.guest_experience_parity_health_report()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'score', 100,
    'guest_summary_column', exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'guest_sessions'
        and column_name = 'last_activity_summary_at'
    ),
    'guest_summary_function',
      to_regprocedure('public.get_guest_experience_summary(uuid,boolean)') is not null,
    'guest_summary_anon_execute', has_function_privilege(
      'anon',
      'public.get_guest_experience_summary(uuid,boolean)',
      'EXECUTE'
    ),
    'guest_tables_rls', (
      select bool_and(relrowsecurity)
      from pg_class
      where oid in (
        'public.guest_sessions'::regclass,
        'public.guest_listening_sessions'::regclass,
        'public.guest_artist_follows'::regclass,
        'public.guest_saved_songs'::regclass
      )
    )
  );
$$;

revoke all on function public.guest_experience_parity_health_report()
  from public, anon, authenticated;
grant execute on function public.guest_experience_parity_health_report()
  to service_role;
