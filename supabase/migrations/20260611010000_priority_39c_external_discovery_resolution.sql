-- Priority 39C: External Discovery recovery and platform resolution.
--
-- This migration keeps creator-submitted URLs as the source of truth, enriches
-- song_platform_links with truthful resolution metadata, infers only the
-- YouTube <-> YouTube Music counterpart that can be derived from the same video
-- id, and exposes a real External Discovery feed.

alter table public.song_platform_links
  add column if not exists resolution_source text not null default 'submitted',
  add column if not exists confidence_score smallint not null default 100,
  add column if not exists last_resolved_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'song_platform_links_resolution_source_check'
      and conrelid = 'public.song_platform_links'::regclass
  ) then
    alter table public.song_platform_links
      add constraint song_platform_links_resolution_source_check
      check (resolution_source in ('submitted', 'inferred', 'manual'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'song_platform_links_confidence_score_check'
      and conrelid = 'public.song_platform_links'::regclass
  ) then
    alter table public.song_platform_links
      add constraint song_platform_links_confidence_score_check
      check (confidence_score between 0 and 100);
  end if;
end;
$$;

update public.song_platform_links
set
  resolution_source = case when is_primary then 'submitted' else resolution_source end,
  confidence_score = case when is_primary then 100 else confidence_score end,
  last_resolved_at = coalesce(last_resolved_at, now())
where resolution_source is null
   or confidence_score is null
   or last_resolved_at is null
   or is_primary;

create or replace function public.platform_resolution_priority(
  target_platform public.music_platform
)
returns integer
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case target_platform
    when 'youtube_music' then 1
    when 'youtube' then 2
    when 'spotify' then 3
    when 'apple_music' then 4
    when 'tiktok' then 5
    when 'soundcloud' then 6
    else 99
  end;
$$;

create or replace function public.youtube_video_id_from_url(target_url text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  trimmed text := trim(coalesce(target_url, ''));
  matches text[];
begin
  matches := regexp_match(
    trimmed,
    '^https://music\.youtube\.com/watch\?[^#]*[?&]v=([A-Za-z0-9_-]{6,})',
    'i'
  );
  if matches is not null then
    return matches[1];
  end if;

  matches := regexp_match(
    trimmed,
    '^https://(www\.|m\.)?youtube\.com/watch\?[^#]*[?&]v=([A-Za-z0-9_-]{6,})',
    'i'
  );
  if matches is not null then
    return matches[2];
  end if;

  matches := regexp_match(
    trimmed,
    '^https://(www\.|m\.)?youtube\.com/shorts/([A-Za-z0-9_-]{6,})',
    'i'
  );
  if matches is not null then
    return matches[2];
  end if;

  matches := regexp_match(
    trimmed,
    '^https://youtu\.be/([A-Za-z0-9_-]{6,})',
    'i'
  );
  if matches is not null then
    return matches[1];
  end if;

  return null;
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
        'confidence_score', links.confidence_score
      )
      order by
        public.platform_resolution_priority(links.platform),
        links.is_primary desc,
        links.created_at
    ),
    '[]'::jsonb
  )
  from public.song_platform_links links
  where links.song_id = target_song_id;
$$;

create or replace function public.recommended_song_platform(target_song_id uuid)
returns public.music_platform
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select links.platform
  from public.song_platform_links links
  where links.song_id = target_song_id
  order by
    public.platform_resolution_priority(links.platform),
    links.is_primary desc,
    links.confidence_score desc,
    links.created_at
  limit 1;
$$;

create or replace function public.resolve_song_platform_links(target_song_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  song_row public.songs%rowtype;
  video_id text;
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
    last_resolved_at
  )
  values (
    song_row.id,
    song_row.platform,
    trim(song_row.music_url),
    true,
    'submitted',
    100,
    now()
  )
  on conflict (song_id, platform) do update
  set
    music_url = excluded.music_url,
    is_primary = true,
    resolution_source = 'submitted',
    confidence_score = 100,
    last_resolved_at = now(),
    updated_at = now();

  video_id := public.youtube_video_id_from_url(song_row.music_url);

  if video_id is not null and song_row.platform = 'youtube_music' then
    insert into public.song_platform_links (
      song_id,
      platform,
      music_url,
      is_primary,
      resolution_source,
      confidence_score,
      last_resolved_at
    )
    values (
      song_row.id,
      'youtube',
      'https://www.youtube.com/watch?v=' || video_id,
      false,
      'inferred',
      90,
      now()
    )
    on conflict (song_id, platform) do update
    set
      music_url = excluded.music_url,
      resolution_source = case
        when public.song_platform_links.is_primary then public.song_platform_links.resolution_source
        else 'inferred'
      end,
      confidence_score = greatest(public.song_platform_links.confidence_score, 90),
      last_resolved_at = now(),
      updated_at = now();
  elsif video_id is not null and song_row.platform = 'youtube' then
    insert into public.song_platform_links (
      song_id,
      platform,
      music_url,
      is_primary,
      resolution_source,
      confidence_score,
      last_resolved_at
    )
    values (
      song_row.id,
      'youtube_music',
      'https://music.youtube.com/watch?v=' || video_id,
      false,
      'inferred',
      85,
      now()
    )
    on conflict (song_id, platform) do update
    set
      music_url = excluded.music_url,
      resolution_source = case
        when public.song_platform_links.is_primary then public.song_platform_links.resolution_source
        else 'inferred'
      end,
      confidence_score = greatest(public.song_platform_links.confidence_score, 85),
      last_resolved_at = now(),
      updated_at = now();
  end if;

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

drop trigger if exists sync_primary_song_platform_link
  on public.songs;
create trigger sync_primary_song_platform_link
after insert or update of platform, music_url
on public.songs
for each row execute function public.sync_primary_song_platform_link();

select public.resolve_song_platform_links(songs.id)
from public.songs
where songs.removed_at is null
  and songs.merged_into_song_id is null;

create or replace function public.external_discovery_metrics(
  target_song_id uuid
)
returns table (
  reviews_received integer,
  average_rating numeric,
  hook_score integer,
  total_listening_seconds bigint,
  completion_rate numeric,
  comments_count bigint,
  likes_count bigint,
  followers_count bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    coalesce(review_metrics.reviews_received, 0),
    coalesce(review_metrics.average_rating, 0),
    coalesce(review_metrics.hook_score, 0),
    coalesce(listen_metrics.total_listening_seconds, 0),
    coalesce(listen_metrics.completion_rate, 0),
    coalesce(comment_metrics.comments_count, 0),
    coalesce(like_metrics.likes_count, 0),
    coalesce(follower_metrics.followers_count, 0)
  from public.songs song
  left join lateral (
    select
      count(*)::integer as reviews_received,
      round(avg(review.rating)::numeric, 2) as average_rating,
      round((
        avg(case when review.listen_full then 100 else 0 end) +
        avg(case when review.add_to_playlist then 100 else 0 end) +
        avg(case when review.grabbed_attention then 100 else 0 end) +
        avg(case when review.share_with_friend then 100 else 0 end)
      ) / 4, 0)::integer as hook_score
    from public.reviews review
    where review.song_id = song.id
      and review.quality_passed
  ) review_metrics on true
  left join lateral (
    select
      coalesce(sum(session.settled_seconds), 0)::bigint
        as total_listening_seconds,
      coalesce(round(avg(
        least(
          100,
          session.max_position_seconds::numeric /
            nullif(session.provider_duration_seconds, 0) * 100
        )
      ) filter (
        where session.provider_duration_seconds > 0
          and session.valid_listen_at is not null
      ), 2), 0) as completion_rate
    from public.listening_sessions session
    where session.song_id = song.id
      and session.valid_listen_at is not null
  ) listen_metrics on true
  left join lateral (
    select count(*)::bigint as comments_count
    from public.song_comments comment
    where comment.song_id = song.id
  ) comment_metrics on true
  left join lateral (
    select count(*)::bigint as likes_count
    from public.song_likes song_like
    where song_like.song_id = song.id
  ) like_metrics on true
  left join lateral (
    select count(*)::bigint as followers_count
    from public.artist_follows artist_follow
    where artist_follow.artist_id = song.user_id
  ) follower_metrics on true
  where song.id = target_song_id;
$$;

drop function if exists public.get_external_discovery_feed(integer);
create or replace function public.get_external_discovery_feed(
  feed_limit integer default 24
)
returns table (
  feed_kind text,
  feed_position integer,
  badge text,
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
  submitted_at timestamptz,
  reviews_received integer,
  average_rating numeric,
  hook_score integer,
  total_listening_seconds bigint,
  completion_rate numeric,
  comments_count bigint,
  likes_count bigint,
  followers_count bigint,
  platform_links jsonb,
  recommended_platform public.music_platform
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with eligible as (
    select
      song.id as song_id,
      song.user_id as artist_id,
      song.title,
      song.artist_name,
      song.cover_image_url,
      song.music_url,
      song.platform,
      song.genre,
      song.song_language,
      coalesce(song.feedback_focus, array['General Feedback']::text[]) as feedback_focus,
      song.country,
      song.created_at as submitted_at,
      metrics.reviews_received,
      metrics.average_rating,
      metrics.hook_score,
      metrics.total_listening_seconds,
      metrics.completion_rate,
      metrics.comments_count,
      metrics.likes_count,
      metrics.followers_count,
      public.song_platform_links_json(song.id) as platform_links,
      public.recommended_song_platform(song.id) as recommended_platform,
      exists (
        select 1
        from public.song_platform_links link
        where link.song_id = song.id
          and link.platform in ('spotify', 'apple_music', 'tiktok', 'soundcloud')
      ) as has_external_link
    from public.songs song
    join public.profiles creator on creator.id = song.user_id
    cross join lateral public.external_discovery_metrics(song.id) metrics
    where song.is_active
      and song.removed_at is null
      and song.archived_at is null
      and song.merged_into_song_id is null
      and song.approval_status in ('auto_approved', 'approved')
      and creator.account_status = 'active'
      and creator.banned_at is null
      and (
        not song.explicit_content
        or coalesce((
          select profiles.show_explicit_content
          from public.profiles
          where profiles.id = auth.uid()
        ), false)
      )
  ),
  external_songs as (
    select
      'external_song'::text as feed_kind,
      row_number() over (
        order by
          case when item.platform in ('spotify', 'apple_music', 'tiktok', 'soundcloud') then 0 else 1 end,
          item.submitted_at desc
      )::integer as feed_position,
      'External Song'::text as badge,
      item.song_id,
      item.artist_id,
      item.title,
      item.artist_name,
      item.cover_image_url,
      item.music_url,
      item.platform,
      item.genre,
      item.song_language,
      item.feedback_focus,
      item.country,
      item.submitted_at,
      item.reviews_received,
      item.average_rating,
      item.hook_score,
      item.total_listening_seconds,
      item.completion_rate,
      item.comments_count,
      item.likes_count,
      item.followers_count,
      item.platform_links,
      item.recommended_platform
    from eligible item
    where item.has_external_link
    order by
      case when item.platform in ('spotify', 'apple_music', 'tiktok', 'soundcloud') then 0 else 1 end,
      item.submitted_at desc
    limit greatest(1, least(coalesce(feed_limit, 24), 100))
  ),
  trending_external as (
    select
      'trending_external'::text as feed_kind,
      row_number() over (
        order by
          (item.hook_score + least(item.likes_count, 50) + least(item.total_listening_seconds / 60, 100)) desc,
          item.submitted_at desc
      )::integer as feed_position,
      'Trending External'::text as badge,
      item.song_id,
      item.artist_id,
      item.title,
      item.artist_name,
      item.cover_image_url,
      item.music_url,
      item.platform,
      item.genre,
      item.song_language,
      item.feedback_focus,
      item.country,
      item.submitted_at,
      item.reviews_received,
      item.average_rating,
      item.hook_score,
      item.total_listening_seconds,
      item.completion_rate,
      item.comments_count,
      item.likes_count,
      item.followers_count,
      item.platform_links,
      item.recommended_platform
    from eligible item
    where item.has_external_link
    order by
      (item.hook_score + least(item.likes_count, 50) + least(item.total_listening_seconds / 60, 100)) desc,
      item.submitted_at desc
    limit greatest(1, least(coalesce(feed_limit, 24), 100))
  ),
  recent_releases as (
    select
      'recent_release'::text as feed_kind,
      row_number() over (order by item.submitted_at desc)::integer as feed_position,
      'Recent Release'::text as badge,
      item.song_id,
      item.artist_id,
      item.title,
      item.artist_name,
      item.cover_image_url,
      item.music_url,
      item.platform,
      item.genre,
      item.song_language,
      item.feedback_focus,
      item.country,
      item.submitted_at,
      item.reviews_received,
      item.average_rating,
      item.hook_score,
      item.total_listening_seconds,
      item.completion_rate,
      item.comments_count,
      item.likes_count,
      item.followers_count,
      item.platform_links,
      item.recommended_platform
    from eligible item
    order by item.submitted_at desc
    limit greatest(1, least(coalesce(feed_limit, 24), 100))
  ),
  external_artists as (
    select distinct on (item.artist_id)
      'external_artist'::text as feed_kind,
      row_number() over (
        order by item.followers_count desc, item.submitted_at desc
      )::integer as feed_position,
      'External Artist'::text as badge,
      item.song_id,
      item.artist_id,
      item.title,
      item.artist_name,
      item.cover_image_url,
      item.music_url,
      item.platform,
      item.genre,
      item.song_language,
      item.feedback_focus,
      item.country,
      item.submitted_at,
      item.reviews_received,
      item.average_rating,
      item.hook_score,
      item.total_listening_seconds,
      item.completion_rate,
      item.comments_count,
      item.likes_count,
      item.followers_count,
      item.platform_links,
      item.recommended_platform
    from eligible item
    where item.has_external_link
    order by item.artist_id, item.followers_count desc, item.submitted_at desc
  )
  select * from external_songs
  union all
  select * from external_artists
  union all
  select * from recent_releases
  union all
  select * from trending_external;
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
  match_reasons text[],
  platform_links jsonb,
  recommended_platform public.music_platform
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
      and songs.archived_at is null
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
    end,
    public.song_platform_links_json(scored.id),
    public.recommended_song_platform(scored.id)
  from scored
  order by
    scored.base_match_score + scored.connection_score desc,
    scored.created_at asc
  limit greatest(1, least(queue_limit, 50));
$$;

drop function if exists public.get_spotlight_songs();
create or replace function public.get_spotlight_songs()
returns table (
  slot_number smallint,
  badge text,
  song_id uuid,
  artist_id uuid,
  title text,
  artist_name text,
  cover_image_url text,
  music_url text,
  platform public.music_platform,
  genre text,
  song_language text,
  reviews_received integer,
  average_rating numeric,
  hook_score integer,
  total_listening_seconds bigint,
  completion_rate numeric,
  platform_links jsonb,
  recommended_platform public.music_platform
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    slots.slot_number,
    coalesce(
      nullif(trim(slots.custom_label), ''),
      initcap(replace(slots.placement_kind::text, '_', ' '))
    ),
    songs.id,
    songs.user_id,
    songs.title,
    songs.artist_name,
    songs.cover_image_url,
    songs.music_url,
    songs.platform,
    songs.genre,
    songs.song_language,
    coalesce(metrics.reviews_received, 0),
    coalesce(metrics.average_rating, 0),
    coalesce(metrics.hook_score, 0),
    coalesce(metrics.total_listening_seconds, 0),
    coalesce(metrics.completion_rate, 0),
    public.song_platform_links_json(songs.id),
    public.recommended_song_platform(songs.id)
  from public.spotlight_slots as slots
  join public.songs on songs.id = slots.song_id
  join public.profiles as creators on creators.id = songs.user_id
  left join lateral (
    select * from public.external_discovery_metrics(songs.id)
  ) metrics on true
  where public.is_active_user()
    and songs.is_active
    and songs.removed_at is null
    and songs.archived_at is null
    and songs.merged_into_song_id is null
    and songs.approval_status in ('auto_approved', 'approved')
    and creators.account_status = 'active'
    and creators.banned_at is null
    and coalesce(creators.last_contribution_at, creators.created_at)
      > now() - interval '14 days'
    and (slots.active_from is null or slots.active_from <= now())
    and (slots.active_until is null or slots.active_until > now())
    and (
      not songs.explicit_content
      or coalesce((
        select profiles.show_explicit_content
        from public.profiles
        where profiles.id = auth.uid()
      ), false)
    )
  order by slots.slot_number;
$$;

drop function if exists public.get_top_ten_songs();
create or replace function public.get_top_ten_songs()
returns table (
  rank integer,
  ranking_score numeric,
  song_id uuid,
  artist_id uuid,
  title text,
  artist_name text,
  cover_image_url text,
  music_url text,
  platform public.music_platform,
  genre text,
  song_language text,
  reviews_received integer,
  average_rating numeric,
  hook_score integer,
  total_listening_seconds bigint,
  completion_rate numeric,
  platform_links jsonb,
  recommended_platform public.music_platform
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with organic_metrics as (
    select
      songs.id as song_id,
      songs.user_id as artist_id,
      songs.title,
      songs.artist_name,
      songs.cover_image_url,
      songs.music_url,
      songs.platform,
      songs.genre,
      songs.song_language,
      count(reviews.id)::integer as reviews_received,
      round(avg(reviews.rating)::numeric, 2) as average_rating,
      round((
        avg(case when reviews.listen_full then 100 else 0 end) +
        avg(case when reviews.add_to_playlist then 100 else 0 end) +
        avg(case when reviews.grabbed_attention then 100 else 0 end) +
        avg(case when reviews.share_with_friend then 100 else 0 end)
      ) / 4, 0)::integer as hook_score,
      coalesce(sum(reviews.listening_seconds), 0)::bigint
        as total_listening_seconds,
      coalesce(round(avg(reviews.listening_completion_percent)::numeric, 2), 0)
        as completion_rate,
      coalesce(round(avg(reviews.listening_completion_percent)::numeric, 2), 0)
        as listener_retention
    from public.songs
    join public.profiles as creators on creators.id = songs.user_id
    join public.reviews
      on reviews.song_id = songs.id
      and reviews.quality_passed
    where songs.is_active
      and songs.removed_at is null
      and songs.archived_at is null
      and creators.account_status = 'active'
      and creators.banned_at is null
      and coalesce(creators.last_contribution_at, creators.created_at)
        > now() - interval '14 days'
      and (
        not songs.explicit_content
        or coalesce((
          select profiles.show_explicit_content
          from public.profiles
          where profiles.id = auth.uid()
        ), false)
      )
    group by songs.id
  ),
  ranked as (
    select
      organic_metrics.*,
      round((
        organic_metrics.hook_score * 0.45 +
        organic_metrics.average_rating * 10 * 0.25 +
        organic_metrics.completion_rate * 0.15 +
        organic_metrics.listener_retention * 0.10 +
        least(100, organic_metrics.reviews_received * 5) * 0.05
      )::numeric, 2) as organic_score
    from organic_metrics
  )
  select
    row_number() over (
      order by
        ranked.organic_score desc,
        ranked.reviews_received desc,
        ranked.total_listening_seconds desc,
        ranked.song_id
    )::integer,
    ranked.organic_score,
    ranked.song_id,
    ranked.artist_id,
    ranked.title,
    ranked.artist_name,
    ranked.cover_image_url,
    ranked.music_url,
    ranked.platform,
    ranked.genre,
    ranked.song_language,
    ranked.reviews_received,
    ranked.average_rating,
    ranked.hook_score,
    ranked.total_listening_seconds,
    ranked.completion_rate,
    public.song_platform_links_json(ranked.song_id),
    public.recommended_song_platform(ranked.song_id)
  from ranked
  where public.is_active_user()
  order by
    ranked.organic_score desc,
    ranked.reviews_received desc,
    ranked.total_listening_seconds desc,
    ranked.song_id
  limit 10;
$$;

drop function if exists public.get_previously_supported_songs(integer);
create or replace function public.get_previously_supported_songs(
  queue_limit integer default 8
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
  reviews_received integer,
  average_rating numeric,
  hook_score integer,
  total_listening_seconds bigint,
  completion_rate numeric,
  platform_links jsonb,
  recommended_platform public.music_platform
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with supported as (
    select
      songs.id,
      max(support_events.supported_at) as supported_at
    from public.songs
    join public.profiles as creators on creators.id = songs.user_id
    join lateral (
      select reviews.created_at as supported_at
      from public.reviews
      where reviews.song_id = songs.id
        and reviews.reviewer_id = auth.uid()
        and reviews.quality_passed
      union all
      select listening_sessions.valid_listen_at
      from public.listening_sessions
      where listening_sessions.song_id = songs.id
        and listening_sessions.user_id = auth.uid()
        and listening_sessions.valid_listen_at is not null
    ) support_events on true
    where public.is_active_user()
      and songs.is_active
      and songs.removed_at is null
      and songs.archived_at is null
      and creators.account_status = 'active'
      and creators.banned_at is null
      and coalesce(creators.last_contribution_at, creators.created_at)
        > now() - interval '14 days'
    group by songs.id
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
    coalesce(metrics.reviews_received, 0),
    coalesce(metrics.average_rating, 0),
    coalesce(metrics.hook_score, 0),
    coalesce(metrics.total_listening_seconds, 0),
    coalesce(metrics.completion_rate, 0),
    public.song_platform_links_json(songs.id),
    public.recommended_song_platform(songs.id)
  from supported
  join public.songs on songs.id = supported.id
  left join lateral (
    select * from public.external_discovery_metrics(songs.id)
  ) metrics on true
  order by supported.supported_at desc
  limit greatest(1, least(queue_limit, 24));
$$;

drop function if exists public.get_public_discovery_feed(integer);
create or replace function public.get_public_discovery_feed(feed_limit integer default 8)
returns table (
  feed_kind text,
  feed_position integer,
  badge text,
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
  submitted_at timestamptz,
  reviews_received bigint,
  average_rating numeric,
  hook_score numeric,
  total_listening_seconds bigint,
  completion_rate numeric,
  comments_count bigint,
  likes_count bigint,
  followers_count bigint,
  platform_links jsonb,
  recommended_platform public.music_platform
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with eligible as (
    select
      song.id as song_id,
      song.user_id as artist_id,
      song.title,
      song.artist_name,
      song.cover_image_url,
      song.music_url,
      song.platform,
      song.genre,
      song.song_language,
      coalesce(song.feedback_focus, array['General Feedback']::text[]) as feedback_focus,
      song.country,
      song.created_at as submitted_at,
      coalesce(metrics.reviews_received, 0)::bigint as reviews_received,
      coalesce(metrics.average_rating, 0)::numeric as average_rating,
      coalesce(metrics.hook_score, 0)::numeric as hook_score,
      coalesce(metrics.total_listening_seconds, 0)::bigint as total_listening_seconds,
      coalesce(metrics.completion_rate, 0)::numeric as completion_rate,
      coalesce(metrics.comments_count, 0)::bigint as comments_count,
      coalesce(metrics.likes_count, 0)::bigint as likes_count,
      coalesce(metrics.followers_count, 0)::bigint as followers_count,
      public.song_platform_links_json(song.id) as platform_links,
      public.recommended_song_platform(song.id) as recommended_platform
    from public.songs song
    join public.profiles creator on creator.id = song.user_id
    cross join lateral public.external_discovery_metrics(song.id) metrics
    where song.is_active = true
      and song.removed_at is null
      and song.archived_at is null
      and song.merged_into_song_id is null
      and coalesce(song.explicit_content, false) = false
      and creator.account_status = 'active'
      and creator.banned_at is null
  ),
  spotlight as (
    select
      'spotlight'::text as feed_kind,
      slot.slot_number::integer as feed_position,
      coalesce(
        nullif(trim(slot.custom_label), ''),
        initcap(replace(slot.placement_kind::text, '_', ' '))
      ) as badge,
      item.*
    from public.spotlight_slots slot
    join eligible item on item.song_id = slot.song_id
    where (slot.active_from is null or slot.active_from <= now())
      and (slot.active_until is null or slot.active_until > now())
    order by slot.slot_number
    limit greatest(1, least(coalesce(feed_limit, 8), 20))
  ),
  top_ranked as (
    select
      'top'::text as feed_kind,
      row_number() over (
        order by
          (
            item.hook_score * 0.45
            + item.average_rating * 5.0 * 0.20
            + item.completion_rate * 0.20
            + least(item.total_listening_seconds / 60.0, 100) * 0.10
            + least(item.likes_count, 50) * 0.10
          ) desc,
          item.reviews_received desc,
          item.submitted_at desc
      )::integer as feed_position,
      'Community Top 10'::text as badge,
      item.*
    from eligible item
    order by
      (
        item.hook_score * 0.45
        + item.average_rating * 5.0 * 0.20
        + item.completion_rate * 0.20
        + least(item.total_listening_seconds / 60.0, 100) * 0.10
        + least(item.likes_count, 50) * 0.10
      ) desc,
      item.reviews_received desc,
      item.submitted_at desc
    limit least(greatest(coalesce(feed_limit, 8), 1), 10)
  ),
  recent as (
    select
      'recent'::text as feed_kind,
      row_number() over (order by item.submitted_at desc)::integer as feed_position,
      'Recently Active'::text as badge,
      item.*
    from eligible item
    order by item.submitted_at desc
    limit greatest(1, least(coalesce(feed_limit, 8), 20))
  )
  select * from spotlight
  union all
  select * from top_ranked
  union all
  select * from recent;
$$;

create or replace function public.ensure_priority39c_platform_config(
  target_config jsonb
)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_set(
    jsonb_set(
      case
        when target_config ? 'discovery' then target_config
        else jsonb_set(target_config, '{discovery}', '{}'::jsonb, true)
      end,
      '{discovery,platformResolution}',
      coalesce(target_config#>'{discovery,platformResolution}', '{
        "engineMode": "recommend",
        "preferredPlatformOrder": [
          "youtube_music",
          "youtube",
          "spotify",
          "apple_music",
          "tiktok",
          "soundcloud"
        ],
        "showPlatformRecommendations": true,
        "showSecondaryPlatforms": true
      }'::jsonb),
      true
    ),
    '{discovery,externalDiscovery}',
    coalesce(target_config#>'{discovery,externalDiscovery}', '{
      "showExternalSongs": true,
      "showExternalArtists": true,
      "showRecentReleases": true,
      "showTrendingExternalContent": true
    }'::jsonb),
    true
  );
$$;

update public.platform_control_state
set
  draft_config = public.ensure_priority39c_platform_config(draft_config),
  published_config = public.ensure_priority39c_platform_config(published_config),
  stable_config = public.ensure_priority39c_platform_config(stable_config),
  updated_at = now()
where id = true;

revoke all on function public.platform_resolution_priority(public.music_platform) from public, anon, authenticated;
revoke all on function public.youtube_video_id_from_url(text) from public, anon, authenticated;
revoke all on function public.song_platform_links_json(uuid) from public, anon;
revoke all on function public.recommended_song_platform(uuid) from public, anon;
revoke all on function public.resolve_song_platform_links(uuid) from public, anon, authenticated;
revoke all on function public.external_discovery_metrics(uuid) from public, anon;
revoke all on function public.get_external_discovery_feed(integer) from public;
revoke all on function public.get_smart_review_queue(integer) from public, anon, authenticated;
revoke all on function public.get_spotlight_songs() from public, anon, authenticated;
revoke all on function public.get_top_ten_songs() from public, anon, authenticated;
revoke all on function public.get_previously_supported_songs(integer) from public, anon, authenticated;
revoke all on function public.get_public_discovery_feed(integer) from public;
revoke all on function public.ensure_priority39c_platform_config(jsonb) from public, anon, authenticated;

grant execute on function public.song_platform_links_json(uuid) to authenticated, service_role;
grant execute on function public.recommended_song_platform(uuid) to authenticated, service_role;
grant execute on function public.external_discovery_metrics(uuid) to authenticated, service_role;
grant execute on function public.get_external_discovery_feed(integer) to anon, authenticated, service_role;
grant execute on function public.get_smart_review_queue(integer) to authenticated, service_role;
grant execute on function public.get_spotlight_songs() to authenticated, service_role;
grant execute on function public.get_top_ten_songs() to authenticated, service_role;
grant execute on function public.get_previously_supported_songs(integer) to authenticated, service_role;
grant execute on function public.get_public_discovery_feed(integer) to anon, authenticated, service_role;
grant execute on function public.resolve_song_platform_links(uuid) to service_role;
grant execute on function public.ensure_priority39c_platform_config(jsonb) to service_role;
