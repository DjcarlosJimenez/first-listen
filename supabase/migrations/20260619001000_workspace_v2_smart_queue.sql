-- Workspace V2 Smart Queue Phase 1.
-- Selection-only change: no playback validation, Time Bank, rewards, reviews,
-- or economy behavior is changed by this migration.

drop function if exists public.get_workspace_v2_smart_queue(integer);

create or replace function public.get_workspace_v2_smart_queue(
  queue_limit integer default 100
)
returns table (
  id uuid,
  user_id uuid,
  title text,
  artist_name text,
  cover_image_url text,
  music_url text,
  platform public.music_platform,
  content_duration_seconds integer,
  featured boolean,
  created_at timestamptz,
  exposure_score numeric,
  last_heard_at timestamptz,
  global_valid_listens bigint,
  user_valid_listens bigint,
  smart_score numeric
)
language sql
security definer
set search_path = pg_catalog, public
as $function$
  with viewer as (
    select
      profiles.id,
      coalesce(profiles.show_explicit_content, false) as show_explicit_content
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.account_status = 'active'
      and profiles.banned_at is null
  ),
  active_boosts as (
    select distinct song_boosts.song_id
    from public.song_boosts
    where song_boosts.status = 'approved'
      and song_boosts.starts_at <= now()
      and song_boosts.ends_at > now()
  ),
  member_exposure as (
    select
      listening_sessions.song_id,
      count(*) filter (
        where listening_sessions.valid_listen_at is not null
      ) as member_valid_listens,
      count(distinct listening_sessions.user_id) filter (
        where listening_sessions.user_id is not null
          and listening_sessions.valid_listen_at is not null
      ) as member_unique_valid_listeners,
      coalesce(sum(listening_sessions.verified_seconds), 0) as member_verified_seconds
    from public.listening_sessions
    group by listening_sessions.song_id
  ),
  guest_exposure as (
    select
      guest_listening_sessions.song_id,
      count(*) filter (
        where guest_listening_sessions.valid_listen_at is not null
      ) as guest_valid_listens,
      count(distinct guest_listening_sessions.guest_session_id) filter (
        where guest_listening_sessions.guest_session_id is not null
          and guest_listening_sessions.valid_listen_at is not null
      ) as guest_unique_valid_listeners,
      coalesce(sum(guest_listening_sessions.verified_seconds), 0) as guest_verified_seconds
    from public.guest_listening_sessions
    group by guest_listening_sessions.song_id
  ),
  user_history as (
    select
      listening_sessions.song_id,
      count(*) filter (
        where listening_sessions.valid_listen_at is not null
      ) as user_valid_listens,
      max(listening_sessions.valid_listen_at) filter (
        where listening_sessions.valid_listen_at is not null
      ) as last_heard_at
    from public.listening_sessions
    where listening_sessions.user_id = auth.uid()
    group by listening_sessions.song_id
  ),
  candidates as (
    select
      songs.id,
      songs.user_id,
      songs.title,
      songs.artist_name,
      songs.cover_image_url,
      songs.music_url,
      songs.platform,
      songs.content_duration_seconds,
      coalesce(songs.featured, false) as featured,
      songs.created_at,
      coalesce(member_exposure.member_valid_listens, 0)
        + coalesce(guest_exposure.guest_valid_listens, 0) as global_valid_listens,
      coalesce(member_exposure.member_unique_valid_listeners, 0)
        + coalesce(guest_exposure.guest_unique_valid_listeners, 0) as global_unique_valid_listeners,
      coalesce(member_exposure.member_verified_seconds, 0)
        + coalesce(guest_exposure.guest_verified_seconds, 0) as global_verified_seconds,
      coalesce(user_history.user_valid_listens, 0) as user_valid_listens,
      user_history.last_heard_at,
      active_boosts.song_id is not null as actively_boosted
    from public.songs
    join public.profiles as creators on creators.id = songs.user_id
    cross join viewer
    left join active_boosts on active_boosts.song_id = songs.id
    left join member_exposure on member_exposure.song_id = songs.id
    left join guest_exposure on guest_exposure.song_id = songs.id
    left join user_history on user_history.song_id = songs.id
    where songs.is_active
      and songs.removed_at is null
      and songs.archived_at is null
      and songs.merged_into_song_id is null
      and songs.approval_status in ('auto_approved', 'approved')
      and songs.queue_tier in ('public', 'sponsored')
      and songs.platform in ('youtube', 'youtube_music', 'soundcloud')
      and nullif(btrim(coalesce(songs.music_url, '')), '') is not null
      and creators.account_status = 'active'
      and creators.banned_at is null
      and (not coalesce(songs.explicit_content, false) or viewer.show_explicit_content)
  ),
  scored as (
    select
      candidates.*,
      (
        case when candidates.user_valid_listens = 0 then 12000 else 0 end
        + case
            when candidates.last_heard_at is null then 2500
            when candidates.last_heard_at < now() - interval '24 hours'
              then least(
                4000,
                floor(extract(epoch from (now() - candidates.last_heard_at)) / 3600) * 25
              )
            else -25000
          end
        + case when candidates.global_valid_listens = 0 then 3500 else 0 end
        + greatest(0, 6000 - (candidates.global_valid_listens * 500))
        + greatest(0, 2000 - (candidates.global_unique_valid_listeners * 250))
        + greatest(
            0,
            1500 - floor(coalesce(candidates.global_verified_seconds, 0) / 60) * 20
          )
        + case when candidates.featured then 1200 else 0 end
        + case when candidates.actively_boosted then 800 else 0 end
        + greatest(
            0,
            420 - floor(extract(epoch from (now() - candidates.created_at)) / 86400) * 30
          )
        - (candidates.user_valid_listens * 1500)
        - (candidates.global_valid_listens * 80)
        - (candidates.global_unique_valid_listeners * 60)
        + (random() * 250)::numeric
      )::numeric as smart_score
    from candidates
  )
  select
    scored.id,
    scored.user_id,
    scored.title,
    scored.artist_name,
    scored.cover_image_url,
    scored.music_url,
    scored.platform,
    scored.content_duration_seconds,
    scored.featured,
    scored.created_at,
    scored.global_valid_listens::numeric as exposure_score,
    scored.last_heard_at,
    scored.global_valid_listens,
    scored.user_valid_listens,
    scored.smart_score
  from scored
  order by
    case
      when scored.last_heard_at >= now() - interval '24 hours' then 1
      else 0
    end asc,
    case when scored.user_valid_listens = 0 then 0 else 1 end asc,
    scored.smart_score desc,
    scored.created_at desc
  limit greatest(1, least(coalesce(queue_limit, 100), 100));
$function$;

comment on function public.get_workspace_v2_smart_queue(integer)
  is 'Returns authenticated Workspace V2 internal playback candidates ordered by per-user freshness, low global exposure, and editorial boosts.';

revoke all on function public.get_workspace_v2_smart_queue(integer)
  from public, anon, authenticated;
grant execute on function public.get_workspace_v2_smart_queue(integer)
  to authenticated, service_role;
