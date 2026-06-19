-- Founder Discovery Analytics Dashboard.
-- Read-only analytics: no playback, queue, reward, Time Bank, review,
-- Smart Queue, or economy behavior is changed by this migration.

drop function if exists public.get_founder_discovery_analytics_report();

create or replace function public.get_founder_discovery_analytics_report()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  report jsonb;
  smart_queue_started_at timestamptz := '2026-06-19 00:00:00+00';
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.account_status = 'active'
      and profiles.banned_at is null
      and (
        profiles.role = 'super_admin'::public.app_role
        or profiles.founder_number = 1
      )
  ) then
    raise exception 'Founder access required';
  end if;

  with active_songs as (
    select
      songs.id,
      songs.title,
      songs.artist_name,
      songs.platform::text as platform,
      songs.music_url,
      songs.created_at,
      coalesce(songs.featured, false) as featured,
      coalesce(songs.content_type, 'music') as content_type,
      coalesce(songs.category, 'music') as category,
      coalesce(songs.subcategory, nullif(btrim(songs.genre), '')) as subcategory,
      coalesce(songs.playback_source, 'unknown') as playback_source
    from public.songs
    join public.profiles as creators on creators.id = songs.user_id
    where songs.is_active
      and songs.removed_at is null
      and songs.archived_at is null
      and songs.merged_into_song_id is null
      and songs.approval_status in ('auto_approved', 'approved')
      and creators.account_status = 'active'
      and creators.banned_at is null
  ),
  internal_songs as (
    select *
    from active_songs
    where platform in ('youtube', 'youtube_music', 'soundcloud')
      and nullif(btrim(coalesce(music_url, '')), '') is not null
  ),
  valid_events as (
    select
      listening_sessions.song_id,
      listening_sessions.user_id::text as listener_key,
      listening_sessions.valid_listen_at as valid_at,
      coalesce(listening_sessions.verified_seconds, 0)::numeric as verified_seconds,
      'member'::text as listener_type
    from public.listening_sessions
    where listening_sessions.valid_listen_at is not null
    union all
    select
      guest_listening_sessions.song_id,
      guest_listening_sessions.guest_session_id::text as listener_key,
      guest_listening_sessions.valid_listen_at as valid_at,
      coalesce(guest_listening_sessions.verified_seconds, 0)::numeric as verified_seconds,
      'guest'::text as listener_type
    from public.guest_listening_sessions
    where guest_listening_sessions.valid_listen_at is not null
  ),
  internal_valid_events as (
    select valid_events.*
    from valid_events
    join internal_songs on internal_songs.id = valid_events.song_id
  ),
  song_metrics as (
    select
      internal_songs.id,
      internal_songs.title,
      internal_songs.artist_name,
      internal_songs.platform,
      internal_songs.created_at,
      internal_songs.featured,
      internal_songs.content_type,
      internal_songs.category,
      internal_songs.subcategory,
      internal_songs.playback_source,
      count(valid_events.song_id)::bigint as valid_listens,
      count(distinct valid_events.listener_key)::bigint as unique_listeners,
      coalesce(sum(valid_events.verified_seconds), 0)::numeric as verified_seconds,
      min(valid_events.valid_at) as first_valid_listen_at,
      max(valid_events.valid_at) as last_valid_listen_at,
      count(valid_events.song_id) filter (
        where valid_events.valid_at >= date_trunc('day', now())
      )::bigint as valid_today,
      count(valid_events.song_id) filter (
        where valid_events.valid_at >= now() - interval '24 hours'
      )::bigint as valid_24h,
      count(valid_events.song_id) filter (
        where valid_events.valid_at >= now() - interval '7 days'
      )::bigint as valid_7d,
      count(valid_events.song_id) filter (
        where valid_events.valid_at < smart_queue_started_at
      )::bigint as valid_before_smart_queue,
      count(valid_events.song_id) filter (
        where valid_events.valid_at >= smart_queue_started_at
      )::bigint as valid_after_smart_queue
    from internal_songs
    left join valid_events on valid_events.song_id = internal_songs.id
    group by
      internal_songs.id,
      internal_songs.title,
      internal_songs.artist_name,
      internal_songs.platform,
      internal_songs.created_at,
      internal_songs.featured,
      internal_songs.content_type,
      internal_songs.category,
      internal_songs.subcategory,
      internal_songs.playback_source
  ),
  totals as (
    select
      (select count(*) from active_songs)::bigint as active_songs,
      (select count(*) from active_songs where id not in (select id from internal_songs))::bigint
        as external_or_non_internal_songs,
      count(*)::bigint as internal_playable_songs,
      coalesce(sum(valid_listens), 0)::bigint as total_valid_listens,
      count(*) filter (where valid_listens = 0)::bigint as zero_listen_songs,
      count(*) filter (where valid_listens <= 2)::bigint as low_exposure_songs,
      count(*) filter (where valid_listens > 0)::bigint as songs_reached,
      coalesce(sum(valid_today), 0)::bigint as valid_listens_today,
      coalesce(sum(valid_24h), 0)::bigint as valid_listens_24h,
      coalesce(sum(valid_7d), 0)::bigint as valid_listens_7d,
      count(*) filter (where first_valid_listen_at >= date_trunc('day', now()))::bigint
        as newly_discovered_today
    from song_metrics
  ),
  top10_current as (
    select *
    from song_metrics
    order by valid_listens desc, unique_listeners desc, created_at desc
    limit 10
  ),
  top10_before as (
    select *
    from song_metrics
    order by valid_before_smart_queue desc, created_at desc
    limit 10
  ),
  concentration as (
    select
      coalesce((select sum(valid_listens) from top10_current), 0)::numeric
        as top10_valid_listens,
      coalesce((select sum(valid_before_smart_queue) from top10_before), 0)::numeric
        as top10_before_valid_listens,
      coalesce((select sum(valid_before_smart_queue) from song_metrics), 0)::numeric
        as total_before_valid_listens
  ),
  days as (
    select generate_series(
      (current_date - interval '13 days')::date,
      current_date,
      interval '1 day'
    )::date as bucket_date
  ),
  daily_spread as (
    select
      days.bucket_date,
      count(internal_valid_events.song_id)::bigint as valid_listens,
      count(distinct internal_valid_events.song_id)::bigint as songs_reached
    from days
    left join internal_valid_events
      on (internal_valid_events.valid_at at time zone 'America/Chicago')::date
        = days.bucket_date
    group by days.bucket_date
  ),
  weeks as (
    select generate_series(
      date_trunc('week', current_date::timestamp - interval '7 weeks')::date,
      date_trunc('week', current_date::timestamp)::date,
      interval '1 week'
    )::date as bucket_date
  ),
  weekly_spread as (
    select
      weeks.bucket_date,
      count(internal_valid_events.song_id)::bigint as valid_listens,
      count(distinct internal_valid_events.song_id)::bigint as songs_reached
    from weeks
    left join internal_valid_events
      on date_trunc(
        'week',
        (internal_valid_events.valid_at at time zone 'America/Chicago')
      )::date
        = weeks.bucket_date
    group by weeks.bucket_date
  ),
  time_to_first as (
    select
      song_metrics.*,
      case
        when song_metrics.first_valid_listen_at is null then null
        else extract(epoch from (song_metrics.first_valid_listen_at - song_metrics.created_at)) / 3600
      end as hours_to_first_listen
    from song_metrics
  ),
  time_to_first_summary as (
    select
      count(*) filter (where first_valid_listen_at is not null)::bigint as discovered_songs,
      count(*) filter (where first_valid_listen_at is null)::bigint as pending_first_listen_songs,
      round(coalesce(avg(hours_to_first_listen) filter (
        where hours_to_first_listen is not null
      ), 0)::numeric, 2) as average_hours_to_discovery,
      round(coalesce((
        percentile_cont(0.5) within group (order by hours_to_first_listen)
          filter (where hours_to_first_listen is not null)
      )::numeric, 0), 2) as median_hours_to_discovery
    from time_to_first
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'smartQueueStartedAt', smart_queue_started_at,
    'overview', (
      select jsonb_build_object(
        'activeSongs', active_songs,
        'internalPlayableSongs', internal_playable_songs,
        'externalOrNonInternalSongs', external_or_non_internal_songs,
        'totalValidListens', total_valid_listens,
        'songsReached', songs_reached,
        'zeroListenSongs', zero_listen_songs,
        'lowExposureSongs', low_exposure_songs,
        'validListensToday', valid_listens_today,
        'validListens24h', valid_listens_24h,
        'validListens7d', valid_listens_7d,
        'newlyDiscoveredToday', newly_discovered_today
      )
      from totals
    ),
    'topConcentration', (
      select jsonb_build_object(
        'top10ValidListens', concentration.top10_valid_listens,
        'top10ConcentrationPercent', case
          when totals.total_valid_listens = 0 then 0
          else round((concentration.top10_valid_listens * 100.0)
            / totals.total_valid_listens, 2)
        end,
        'beforeSmartQueuePercent', case
          when concentration.total_before_valid_listens = 0 then 0
          else round((concentration.top10_before_valid_listens * 100.0)
            / concentration.total_before_valid_listens, 2)
        end,
        'songs', coalesce((
          select jsonb_agg(jsonb_build_object(
            'songId', top10_current.id,
            'title', top10_current.title,
            'artist', top10_current.artist_name,
            'platform', top10_current.platform,
            'validListens', top10_current.valid_listens,
            'uniqueListeners', top10_current.unique_listeners
          ) order by top10_current.valid_listens desc, top10_current.unique_listeners desc)
          from top10_current
        ), '[]'::jsonb)
      )
      from totals, concentration
    ),
    'smartQueueImpact', (
      select jsonb_build_object(
        'cutoffAt', smart_queue_started_at,
        'postValidListens', coalesce(sum(valid_after_smart_queue), 0),
        'postSongsReached', count(*) filter (where valid_after_smart_queue > 0),
        'zeroToOneSongs', count(*) filter (
          where valid_before_smart_queue = 0 and valid_after_smart_queue > 0
        ),
        'lowExposureHits', count(*) filter (
          where valid_before_smart_queue <= 2 and valid_after_smart_queue > 0
        ),
        'lowExposureGraduated', count(*) filter (
          where valid_before_smart_queue <= 2 and valid_listens > 2
        ),
        'repeatRiskSongsStillAtZero', count(*) filter (where valid_listens = 0)
      )
      from song_metrics
    ),
    'discoverySpread', jsonb_build_object(
      'dailyTrend', coalesce((
        select jsonb_agg(jsonb_build_object(
          'date', daily_spread.bucket_date::text,
          'validListens', daily_spread.valid_listens,
          'songsReached', daily_spread.songs_reached
        ) order by daily_spread.bucket_date)
        from daily_spread
      ), '[]'::jsonb),
      'weeklyTrend', coalesce((
        select jsonb_agg(jsonb_build_object(
          'week', weekly_spread.bucket_date::text,
          'validListens', weekly_spread.valid_listens,
          'songsReached', weekly_spread.songs_reached
        ) order by weekly_spread.bucket_date)
        from weekly_spread
      ), '[]'::jsonb)
    ),
    'songsGainingExposure', coalesce((
      select jsonb_agg(jsonb_build_object(
        'songId', ranked.id,
        'title', ranked.title,
        'artist', ranked.artist_name,
        'platform', ranked.platform,
        'validListens7d', ranked.valid_7d,
        'validListens24h', ranked.valid_24h,
        'totalValidListens', ranked.valid_listens,
        'firstValidListenAt', ranked.first_valid_listen_at
      ) order by ranked.valid_7d desc, ranked.valid_24h desc, ranked.valid_listens asc)
      from (
        select *
        from song_metrics
        where valid_7d > 0
        order by valid_7d desc, valid_24h desc, valid_listens asc, created_at desc
        limit 12
      ) as ranked
    ), '[]'::jsonb),
    'songsAtRisk', coalesce((
      select jsonb_agg(jsonb_build_object(
        'songId', ranked.id,
        'title', ranked.title,
        'artist', ranked.artist_name,
        'platform', ranked.platform,
        'uploadDate', ranked.created_at,
        'validListens', ranked.valid_listens,
        'daysSinceUpload', floor(extract(epoch from (now() - ranked.created_at)) / 86400)::integer,
        'featured', ranked.featured
      ) order by ranked.valid_listens asc, ranked.created_at asc)
      from (
        select *
        from song_metrics
        where valid_listens <= 2
        order by valid_listens asc, created_at asc
        limit 25
      ) as ranked
    ), '[]'::jsonb),
    'discoveryWinners', coalesce((
      select jsonb_agg(jsonb_build_object(
        'songId', ranked.id,
        'title', ranked.title,
        'artist', ranked.artist_name,
        'platform', ranked.platform,
        'validAfterSmartQueue', ranked.valid_after_smart_queue,
        'validBeforeSmartQueue', ranked.valid_before_smart_queue,
        'totalValidListens', ranked.valid_listens,
        'uniqueListeners', ranked.unique_listeners
      ) order by ranked.valid_after_smart_queue desc, ranked.valid_listens asc)
      from (
        select *
        from song_metrics
        where valid_after_smart_queue > 0
        order by valid_after_smart_queue desc, valid_listens asc, created_at desc
        limit 12
      ) as ranked
    ), '[]'::jsonb),
    'timeToFirstListen', (
      select jsonb_build_object(
        'averageHoursToDiscovery', time_to_first_summary.average_hours_to_discovery,
        'medianHoursToDiscovery', time_to_first_summary.median_hours_to_discovery,
        'discoveredSongs', time_to_first_summary.discovered_songs,
        'pendingFirstListenSongs', time_to_first_summary.pending_first_listen_songs,
        'songs', coalesce((
          select jsonb_agg(jsonb_build_object(
            'songId', ranked.id,
            'title', ranked.title,
            'artist', ranked.artist_name,
            'platform', ranked.platform,
            'uploadDate', ranked.created_at,
            'firstValidListenAt', ranked.first_valid_listen_at,
            'hoursToFirstListen', case
              when ranked.hours_to_first_listen is null then null
              else round(ranked.hours_to_first_listen::numeric, 2)
            end
          ) order by ranked.first_valid_listen_at nulls first, ranked.created_at asc)
          from (
            select *
            from time_to_first
            order by first_valid_listen_at nulls first, created_at asc
            limit 20
          ) as ranked
        ), '[]'::jsonb)
      )
      from time_to_first_summary
    )
  )
  into report
  from totals, concentration;

  return report;
end;
$function$;

comment on function public.get_founder_discovery_analytics_report()
  is 'Founder-only read-only discovery health report for Workspace V2 Smart Queue impact, exposure fairness, and time to first listen.';

revoke all on function public.get_founder_discovery_analytics_report()
  from public, anon, authenticated;
grant execute on function public.get_founder_discovery_analytics_report()
  to authenticated, service_role;
