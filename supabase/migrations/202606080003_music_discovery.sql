-- First Listen music discovery additions.
-- Apply after 202606080002_security_production.sql.

create table if not exists public.artist_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, artist_id),
  check (follower_id <> artist_id)
);

create table if not exists public.saved_songs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, song_id)
);

create index if not exists artist_follows_artist_idx
  on public.artist_follows (artist_id, created_at desc);
create index if not exists saved_songs_user_idx
  on public.saved_songs (user_id, created_at desc);

alter table public.artist_follows enable row level security;
alter table public.saved_songs enable row level security;

create policy "users manage own follows"
  on public.artist_follows for all
  to authenticated
  using (follower_id = auth.uid())
  with check (follower_id = auth.uid());

create policy "users manage own saved songs"
  on public.saved_songs for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.follow_artist(target_artist_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if target_artist_id = auth.uid() then return false; end if;
  if not exists (
    select 1 from public.profiles
    where id = target_artist_id and account_status = 'active'
  ) then
    raise exception 'Artist not found';
  end if;

  insert into public.artist_follows (follower_id, artist_id)
  values (auth.uid(), target_artist_id)
  on conflict do nothing;

  return true;
end;
$$;

create or replace function public.unfollow_artist(target_artist_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.artist_follows
  where follower_id = auth.uid() and artist_id = target_artist_id;
$$;

create or replace function public.save_song_for_later(target_song_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1
    from public.songs
    where id = target_song_id and is_active and removed_at is null
  ) then
    raise exception 'Song not found';
  end if;

  insert into public.saved_songs (user_id, song_id)
  values (auth.uid(), target_song_id)
  on conflict do nothing;

  return true;
end;
$$;

create or replace function public.unsave_song(target_song_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.saved_songs
  where user_id = auth.uid() and song_id = target_song_id;
$$;

create or replace function public.get_public_artist_profile(target_artist_id uuid)
returns table (
  artist_id uuid,
  artist_name text,
  followers integer,
  songs_submitted integer,
  genres text[],
  languages text[],
  is_following boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    profiles.id,
    profiles.display_name,
    coalesce(follower_counts.followers, 0)::integer,
    coalesce(song_counts.songs_submitted, 0)::integer,
    coalesce(song_counts.genres, array[]::text[]),
    coalesce(song_counts.languages, array[]::text[]),
    exists (
      select 1 from public.artist_follows as follows
      where follows.follower_id = auth.uid() and follows.artist_id = profiles.id
    )
  from public.profiles
  left join lateral (
    select count(*)::integer as followers
    from public.artist_follows as follows
    where follows.artist_id = profiles.id
  ) follower_counts on true
  left join lateral (
    select
      count(*)::integer as songs_submitted,
      array_remove(array_agg(distinct songs.genre), null) as genres,
      array_remove(array_agg(distinct songs.song_language), null) as languages
    from public.songs
    where songs.user_id = profiles.id
      and songs.is_active
      and songs.removed_at is null
  ) song_counts on true
  where profiles.id = target_artist_id
    and profiles.account_status = 'active';
$$;

create or replace function public.get_public_artist_songs(target_artist_id uuid)
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
  hook_score integer
)
language sql
stable
security definer
set search_path = public
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
    coalesce(metrics.hook_score, 0)
  from public.songs
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
  ) metrics on true
  where songs.user_id = target_artist_id
    and songs.is_active
    and songs.removed_at is null
    and exists (
      select 1 from public.profiles
      where profiles.id = target_artist_id
        and profiles.account_status = 'active'
    )
  order by songs.created_at desc;
$$;

create or replace function public.get_my_song_dashboard()
returns table (
  song_id uuid,
  title text,
  artist_name text,
  platform public.music_platform,
  submitted_at timestamptz,
  reviews_received integer,
  average_rating numeric,
  hook_score integer,
  report_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    songs.id,
    songs.title,
    songs.artist_name,
    songs.platform,
    songs.created_at,
    coalesce(metrics.reviews_received, 0),
    coalesce(metrics.average_rating, 0),
    coalesce(metrics.hook_score, 0),
    coalesce(report_counts.report_count, 0)
  from public.songs
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
  ) metrics on true
  left join lateral (
    select count(*)::integer as report_count
    from public.song_reports
    where song_reports.song_id = songs.id
  ) report_counts on true
  where songs.user_id = auth.uid()
  order by songs.created_at desc;
$$;

create or replace function public.get_my_song_comments(target_song_id uuid default null)
returns table (
  review_id uuid,
  song_id uuid,
  song_title text,
  rating smallint,
  comment text,
  quality_score smallint,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    reviews.id,
    songs.id,
    songs.title,
    reviews.rating,
    reviews.comment,
    reviews.quality_score,
    reviews.created_at
  from public.reviews
  join public.songs on songs.id = reviews.song_id
  where songs.user_id = auth.uid()
    and (target_song_id is null or songs.id = target_song_id)
    and nullif(trim(reviews.comment), '') is not null
  order by reviews.created_at desc;
$$;

create or replace function public.get_saved_songs()
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
  saved_at timestamptz
)
language sql
stable
security definer
set search_path = public
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
    songs.song_language,
    saved_songs.created_at
  from public.saved_songs
  join public.songs on songs.id = saved_songs.song_id
  where saved_songs.user_id = auth.uid()
    and songs.removed_at is null
  order by saved_songs.created_at desc;
$$;

revoke all on function public.follow_artist(uuid) from public;
revoke all on function public.unfollow_artist(uuid) from public;
revoke all on function public.save_song_for_later(uuid) from public;
revoke all on function public.unsave_song(uuid) from public;
revoke all on function public.get_public_artist_profile(uuid) from public;
revoke all on function public.get_public_artist_songs(uuid) from public;
revoke all on function public.get_my_song_dashboard() from public;
revoke all on function public.get_my_song_comments(uuid) from public;
revoke all on function public.get_saved_songs() from public;

grant execute on function public.follow_artist(uuid) to authenticated;
grant execute on function public.unfollow_artist(uuid) to authenticated;
grant execute on function public.save_song_for_later(uuid) to authenticated;
grant execute on function public.unsave_song(uuid) to authenticated;
grant execute on function public.get_public_artist_profile(uuid) to anon, authenticated;
grant execute on function public.get_public_artist_songs(uuid) to anon, authenticated;
grant execute on function public.get_my_song_dashboard() to authenticated;
grant execute on function public.get_my_song_comments(uuid) to authenticated;
grant execute on function public.get_saved_songs() to authenticated;

drop function if exists public.get_smart_review_queue(integer);

create or replace function public.get_smart_review_queue(queue_limit integer default 20)
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
set search_path = public
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
  ),
  scored as (
    select
      songs.*,
      (
        case when songs.song_language = 'Instrumental'
          or songs.song_language = any(reviewer.languages_understood) then 100 else 0 end
        + case
          when songs.genre = any(reviewer.genre_preferences) then 70
          when songs.genre = any(array['Reggaeton','Regional Mexican','Cumbia','Salsa','Bachata']::text[])
            and reviewer.genre_preferences && array['Reggaeton','Regional Mexican','Cumbia','Salsa','Bachata']::text[]
          then 50 else 0 end
        + reviewer.activity_score
        + least(20, floor(extract(epoch from (now() - songs.created_at)) / 86400))::integer
      ) as computed_match_score,
      array_remove(array[
        case when songs.song_language = 'Instrumental'
          or songs.song_language = any(reviewer.languages_understood) then songs.song_language end,
        case when songs.genre = any(reviewer.genre_preferences) then songs.genre end
      ], null) as computed_match_reasons
    from public.songs
    cross join reviewer
    where songs.is_active
      and songs.removed_at is null
      and songs.user_id <> auth.uid()
      and (not songs.explicit_content or reviewer.show_explicit_content)
      and not exists (
        select 1 from public.reviews
        where reviews.song_id = songs.id and reviews.reviewer_id = auth.uid()
      )
  )
  select
    scored.id, scored.user_id, scored.title, scored.artist_name, scored.cover_image_url,
    scored.music_url, scored.platform, scored.genre, scored.song_language,
    scored.feedback_focus, scored.country, scored.explicit_content, scored.created_at,
    scored.computed_match_score, scored.computed_match_reasons
  from scored
  order by scored.computed_match_score desc, scored.created_at asc
  limit greatest(1, least(queue_limit, 50));
$$;

revoke all on function public.get_smart_review_queue(integer) from public, anon;
grant execute on function public.get_smart_review_queue(integer) to authenticated;
