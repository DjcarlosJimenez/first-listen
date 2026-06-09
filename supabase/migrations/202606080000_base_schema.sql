create extension if not exists "uuid-ossp";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'music_platform') then
    create type public.music_platform as enum (
      'youtube',
      'spotify',
      'youtube_music',
      'soundcloud'
    );
  end if;
end $$;

create table if not exists public.founder_program (
  id boolean primary key default true check (id),
  capacity integer not null default 50 check (capacity = 50),
  claimed_count integer not null default 0 check (claimed_count between 0 and 50),
  created_at timestamptz not null default now()
);

insert into public.founder_program (id, capacity, claimed_count)
values (true, 50, 0)
on conflict (id) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  country text,
  review_credits integer not null default 0 check (review_credits >= 0),
  total_review_credits_earned integer not null default 0 check (total_review_credits_earned >= 0),
  founder_number integer unique check (founder_number between 1 and 50),
  founder_free_submission_available boolean not null default false,
  founder_premium_year_entitlement boolean not null default false,
  review_quality_score numeric(5,2) not null default 100,
  interface_language text not null default 'en' check (interface_language in ('en', 'es')),
  languages_understood text[] not null default array[]::text[],
  genre_preferences text[] not null default array[]::text[],
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.songs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  artist_name text not null check (char_length(artist_name) between 1 and 120),
  cover_image_url text not null,
  music_url text not null,
  platform public.music_platform not null,
  genre text not null,
  song_language text not null check (
    song_language in (
      'English',
      'Spanish',
      'Portuguese',
      'French',
      'German',
      'Italian',
      'Instrumental',
      'Other'
    )
  ),
  feedback_focus text[] not null check (cardinality(feedback_focus) > 0),
  country text not null,
  submitted_with_founder_credit boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default uuid_generate_v4(),
  song_id uuid not null references public.songs(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  listen_full boolean not null,
  add_to_playlist boolean not null,
  grabbed_attention boolean not null,
  share_with_friend boolean not null,
  rating smallint not null check (rating between 1 and 10),
  comment text not null check (char_length(comment) between 30 and 1000),
  pasted_comment_detected boolean not null default false,
  quality_score smallint not null default 100 check (quality_score between 0 and 100),
  quality_passed boolean not null default true,
  created_at timestamptz not null default now(),
  unique (song_id, reviewer_id)
);

create table if not exists public.waitlist (
  id uuid primary key default uuid_generate_v4(),
  email text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists songs_queue_idx on public.songs (is_active, created_at);
create index if not exists reviews_song_idx on public.reviews (song_id, created_at desc);
create index if not exists reviews_reviewer_idx on public.reviews (reviewer_id, created_at desc);
create index if not exists reviews_quality_idx on public.reviews (reviewer_id, quality_passed);

alter table public.founder_program enable row level security;
alter table public.profiles enable row level security;
alter table public.songs enable row level security;
alter table public.reviews enable row level security;
alter table public.waitlist enable row level security;

drop policy if exists "founder status is public" on public.founder_program;
create policy "founder status is public"
  on public.founder_program for select using (true);

drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable"
  on public.profiles for select using (true);

drop policy if exists "songs are publicly readable" on public.songs;
create policy "songs are publicly readable"
  on public.songs for select using (true);

drop policy if exists "users update their songs" on public.songs;
create policy "users update their songs"
  on public.songs for update using (auth.uid() = user_id);

drop policy if exists "song owners can delete songs" on public.songs;
create policy "song owners can delete songs"
  on public.songs for delete using (auth.uid() = user_id);

drop policy if exists "reviews are readable by reviewer or song owner" on public.reviews;
create policy "reviews are readable by reviewer or song owner"
  on public.reviews for select
  using (
    auth.uid() = reviewer_id
    or exists (
      select 1 from public.songs
      where songs.id = reviews.song_id
      and songs.user_id = auth.uid()
    )
  );

drop policy if exists "anyone can join waitlist" on public.waitlist;
create policy "anyone can join waitlist"
  on public.waitlist for insert with check (true);

create or replace function public.normalize_feedback(input text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', ' ', 'g'));
$$;

create or replace function public.music_url_matches_platform(
  music_url text,
  song_platform public.music_platform
)
returns boolean
language plpgsql
immutable
as $$
declare
  normalized text := lower(music_url);
begin
  if song_platform = 'spotify' then
    return normalized ~ '^https://open\.spotify\.com/(intl-[a-z-]+/)?track/[a-z0-9]+';
  elsif song_platform = 'youtube_music' then
    return normalized ~ '^https://music\.youtube\.com/watch\?';
  elsif song_platform = 'youtube' then
    return normalized ~ '^https://(www\.)?(youtube\.com/watch\?|youtube\.com/shorts/|youtu\.be/)';
  elsif song_platform = 'soundcloud' then
    return normalized ~ '^https://(www\.)?soundcloud\.com/[^/]+/[^/]+';
  end if;

  return false;
end;
$$;

create or replace function public.claim_founder_spot()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  founder_spot integer;
begin
  update public.founder_program
  set claimed_count = claimed_count + 1
  where id = true
    and claimed_count < capacity
  returning claimed_count into founder_spot;

  return founder_spot;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  founder_spot integer;
begin
  founder_spot := public.claim_founder_spot();

  insert into public.profiles (
    id,
    display_name,
    avatar_url,
    founder_number,
    founder_free_submission_available,
    founder_premium_year_entitlement
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', 'New artist'),
    new.raw_user_meta_data ->> 'avatar_url',
    founder_spot,
    founder_spot is not null,
    founder_spot is not null
  );

  return new;
end;
$$;

create or replace function public.save_onboarding_preferences(
  profile_languages text[],
  profile_genres text[],
  profile_interface_language text
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if cardinality(profile_languages) = 0
    or not profile_languages <@ array[
      'English',
      'Spanish',
      'Portuguese',
      'French',
      'German',
      'Italian',
      'Instrumental Only',
      'Other'
    ]::text[]
  then
    raise exception 'Select at least one supported listener language';
  end if;

  if cardinality(profile_genres) = 0
    or not profile_genres <@ array[
      'Pop',
      'Rock',
      'Hip Hop',
      'EDM',
      'Country',
      'Reggaeton',
      'Regional Mexican',
      'Cumbia',
      'Salsa',
      'Bachata',
      'Indie',
      'Alternative',
      'Jazz',
      'Classical',
      'Instrumental',
      'Other'
    ]::text[]
  then
    raise exception 'Select at least one supported genre';
  end if;

  if profile_interface_language not in ('en', 'es') then
    raise exception 'Unsupported interface language';
  end if;

  update public.profiles
  set
    languages_understood = profile_languages,
    genre_preferences = profile_genres,
    interface_language = profile_interface_language,
    onboarding_completed = true
  where id = auth.uid();
end;
$$;

grant execute on function public.save_onboarding_preferences(
  text[],
  text[],
  text
) to authenticated;

create or replace function public.set_interface_language(
  profile_interface_language text
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if profile_interface_language not in ('en', 'es') then
    raise exception 'Unsupported interface language';
  end if;

  update public.profiles
  set interface_language = profile_interface_language
  where id = auth.uid();
end;
$$;

grant execute on function public.set_interface_language(text) to authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.submit_review(
  reviewed_song_id uuid,
  review_listen_full boolean,
  review_add_to_playlist boolean,
  review_grabbed_attention boolean,
  review_share_with_friend boolean,
  review_rating smallint,
  review_comment text,
  review_pasted_comment_detected boolean default false
)
returns table (
  accepted boolean,
  quality_score smallint,
  credit_granted boolean,
  warning text
)
language plpgsql
security definer set search_path = public
as $$
declare
  normalized_comment text := public.normalize_feedback(review_comment);
  repeated_comment boolean;
  computed_score integer := 100;
  new_quality_score numeric;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if char_length(trim(coalesce(review_comment, ''))) < 30 then
    return query select false, 0::smallint, false, 'Please provide useful feedback.'::text;
    return;
  end if;

  if review_rating not between 1 and 10 then
    raise exception 'Rating must be between 1 and 10';
  end if;

  if exists (
    select 1 from public.songs
    where songs.id = reviewed_song_id
      and songs.user_id = auth.uid()
  ) then
    raise exception 'You cannot review your own song';
  end if;

  select exists (
    select 1 from public.reviews
    where reviewer_id = auth.uid()
      and public.normalize_feedback(comment) = normalized_comment
  ) into repeated_comment;

  if repeated_comment then
    computed_score := 20;
  end if;

  if review_pasted_comment_detected then
    computed_score := computed_score - 50;
  end if;

  if array_length(regexp_split_to_array(normalized_comment, '\s+'), 1) < 7 then
    computed_score := computed_score - 25;
  end if;

  computed_score := greatest(0, least(100, computed_score));

  if computed_score < 60 then
    return query select false, computed_score::smallint, false, 'Please provide useful feedback.'::text;
    return;
  end if;

  insert into public.reviews (
    song_id,
    reviewer_id,
    listen_full,
    add_to_playlist,
    grabbed_attention,
    share_with_friend,
    rating,
    comment,
    pasted_comment_detected,
    quality_score,
    quality_passed
  )
  values (
    reviewed_song_id,
    auth.uid(),
    review_listen_full,
    review_add_to_playlist,
    review_grabbed_attention,
    review_share_with_friend,
    review_rating,
    trim(review_comment),
    review_pasted_comment_detected,
    computed_score,
    true
  );

  update public.profiles
  set
    review_credits = review_credits + 1,
    total_review_credits_earned = total_review_credits_earned + 1
  where id = auth.uid();

  select round(avg(quality_score)::numeric, 2)
  into new_quality_score
  from public.reviews
  where reviewer_id = auth.uid();

  update public.profiles
  set review_quality_score = coalesce(new_quality_score, 100)
  where id = auth.uid();

  return query select true, computed_score::smallint, true, ''::text;
end;
$$;

grant execute on function public.submit_review(
  uuid,
  boolean,
  boolean,
  boolean,
  boolean,
  smallint,
  text,
  boolean
) to authenticated;

create or replace function public.submit_song(
  song_title text,
  song_artist_name text,
  song_cover_image_url text,
  song_music_url text,
  song_platform public.music_platform,
  song_genre text,
  song_language text,
  song_feedback_focus text[],
  song_country text
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  new_song_id uuid;
  used_founder_credit boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.music_url_matches_platform(song_music_url, song_platform) then
    raise exception 'Unsupported or invalid music link';
  end if;

  if song_language not in (
    'English',
    'Spanish',
    'Portuguese',
    'French',
    'German',
    'Italian',
    'Instrumental',
    'Other'
  ) then
    raise exception 'Unsupported song language';
  end if;

  if cardinality(song_feedback_focus) = 0
    or not song_feedback_focus <@ array[
      'Production',
      'Lyrics',
      'Mix',
      'Commercial Potential',
      'Hook Strength',
      'Arrangement',
      'General Feedback'
    ]::text[]
  then
    raise exception 'Select at least one supported feedback focus';
  end if;

  update public.profiles
  set founder_free_submission_available = false
  where id = auth.uid()
    and founder_free_submission_available = true;

  if found then
    used_founder_credit := true;
  else
    update public.profiles
    set review_credits = review_credits - 5
    where id = auth.uid()
      and review_credits >= 5;

    if not found then
      raise exception 'Five review credits are required';
    end if;
  end if;

  insert into public.songs (
    user_id,
    title,
    artist_name,
    cover_image_url,
    music_url,
    platform,
    genre,
    song_language,
    feedback_focus,
    country,
    submitted_with_founder_credit
  )
  values (
    auth.uid(),
    song_title,
    song_artist_name,
    song_cover_image_url,
    song_music_url,
    song_platform,
    song_genre,
    song_language,
    song_feedback_focus,
    song_country,
    used_founder_credit
  )
  returning id into new_song_id;

  return new_song_id;
end;
$$;

grant execute on function public.submit_song(
  text,
  text,
  text,
  text,
  public.music_platform,
  text,
  text,
  text[],
  text
) to authenticated;

create or replace function public.get_smart_review_queue(queue_limit integer default 20)
returns table (
  song_id uuid,
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
  match_score integer,
  match_reasons text[]
)
language sql
stable
security definer set search_path = public
as $$
  with reviewer as (
    select
      profiles.languages_understood,
      profiles.genre_preferences,
      least(25, profiles.total_review_credits_earned * 3) as activity_score
    from public.profiles
    where profiles.id = auth.uid()
  ),
  scored as (
    select
      songs.*,
      (
        case
          when songs.song_language = 'Instrumental'
            or songs.song_language = any(reviewer.languages_understood)
          then 100
          else 0
        end
        +
        case
          when songs.genre = any(reviewer.genre_preferences) then 70
          when songs.genre = any(array[
            'Reggaeton',
            'Regional Mexican',
            'Cumbia',
            'Salsa',
            'Bachata'
          ]::text[])
          and reviewer.genre_preferences && array[
            'Reggaeton',
            'Regional Mexican',
            'Cumbia',
            'Salsa',
            'Bachata'
          ]::text[]
          then 50
          else 0
        end
        + reviewer.activity_score
        + least(20, floor(extract(epoch from (now() - songs.created_at)) / 86400))::integer
      ) as computed_match_score,
      array_remove(array[
        case
          when songs.song_language = 'Instrumental'
            or songs.song_language = any(reviewer.languages_understood)
          then songs.song_language
        end,
        case
          when songs.genre = any(reviewer.genre_preferences)
            or (
              songs.genre = any(array[
                'Reggaeton',
                'Regional Mexican',
                'Cumbia',
                'Salsa',
                'Bachata'
              ]::text[])
              and reviewer.genre_preferences && array[
                'Reggaeton',
                'Regional Mexican',
                'Cumbia',
                'Salsa',
                'Bachata'
              ]::text[]
            )
          then songs.genre
        end
      ], null) as computed_match_reasons
    from public.songs
    cross join reviewer
    where songs.is_active
      and songs.user_id <> auth.uid()
      and not exists (
        select 1
        from public.reviews
        where reviews.song_id = songs.id
          and reviews.reviewer_id = auth.uid()
      )
  )
  select
    scored.id,
    scored.title,
    scored.artist_name,
    scored.cover_image_url,
    scored.music_url,
    scored.platform,
    scored.genre,
    scored.song_language,
    scored.feedback_focus,
    scored.country,
    scored.created_at,
    scored.computed_match_score,
    scored.computed_match_reasons
  from scored
  order by scored.computed_match_score desc, scored.created_at asc
  limit greatest(1, least(queue_limit, 50));
$$;

grant execute on function public.get_smart_review_queue(integer) to authenticated;

create or replace view public.song_analytics
with (security_invoker = true)
as
select
  songs.id as song_id,
  songs.user_id,
  count(reviews.id) as total_reviews,
  round(avg(reviews.rating)::numeric, 2) as average_rating,
  round(avg(case when reviews.listen_full then 100 else 0 end)::numeric, 0) as listen_full_percentage,
  round(avg(case when reviews.add_to_playlist then 100 else 0 end)::numeric, 0) as playlist_percentage,
  round(avg(case when reviews.grabbed_attention then 100 else 0 end)::numeric, 0) as attention_percentage,
  round(avg(case when reviews.share_with_friend then 100 else 0 end)::numeric, 0) as share_percentage,
  round((
    avg(case when reviews.listen_full then 100 else 0 end) +
    avg(case when reviews.add_to_playlist then 100 else 0 end) +
    avg(case when reviews.grabbed_attention then 100 else 0 end) +
    avg(case when reviews.share_with_friend then 100 else 0 end)
  ) / 4, 0) as hook_score
from public.songs
left join public.reviews on reviews.song_id = songs.id
group by songs.id, songs.user_id;
