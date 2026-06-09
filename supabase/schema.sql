-- GENERATED FILE. Edit supabase/migrations, then run npm run db:schema:sync.

-- This file represents the complete First Listen database from an empty project.



-- ============================================================
-- 202606080000_base_schema.sql
-- ============================================================

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

-- ============================================================
-- 202606080001_add_apple_music.sql
-- ============================================================

-- PostgreSQL enum values must be committed before later migrations use them.
alter type public.music_platform add value if not exists 'apple_music';

-- ============================================================
-- 202606080002_security_production.sql
-- ============================================================

-- First Listen production security migration.
-- Apply after supabase/schema.sql on existing or new projects.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('super_admin', 'admin', 'moderator', 'user');
  end if;
  if not exists (select 1 from pg_type where typname = 'account_status') then
    create type public.account_status as enum ('active', 'suspended');
  end if;
  if not exists (select 1 from pg_type where typname = 'report_reason') then
    create type public.report_reason as enum (
      'spam',
      'broken_link',
      'not_music',
      'illegal_content',
      'offensive_content'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'report_status') then
    create type public.report_status as enum ('open', 'reviewing', 'resolved', 'dismissed');
  end if;
end $$;

alter table public.profiles
  add column if not exists role public.app_role not null default 'user',
  add column if not exists account_status public.account_status not null default 'active',
  add column if not exists credits integer not null default 1,
  add column if not exists completed_reviews integer not null default 0,
  add column if not exists show_explicit_content boolean not null default true,
  add column if not exists force_password_change boolean not null default false,
  add column if not exists legal_accepted_at timestamptz,
  add column if not exists explicit_content_acknowledged_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update public.profiles
set credits = greatest(credits, coalesce(review_credits, 0), 1);

alter table public.profiles
  drop constraint if exists profiles_credits_check;
alter table public.profiles
  add constraint profiles_credits_check check (credits >= 0);

alter table public.songs
  add column if not exists explicit_content boolean not null default false,
  add column if not exists featured boolean not null default false,
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references public.profiles(id),
  add column if not exists updated_at timestamptz not null default now();

with duplicate_songs as (
  select
    id,
    row_number() over (
      partition by lower(trim(music_url))
      order by created_at, id
    ) as duplicate_rank
  from public.songs
  where removed_at is null
)
update public.songs
set
  is_active = false,
  removed_at = coalesce(removed_at, now()),
  updated_at = now()
where id in (
  select id from duplicate_songs where duplicate_rank > 1
);

drop index if exists public.songs_unique_music_url_idx;
create unique index songs_unique_music_url_idx
  on public.songs (lower(trim(music_url)))
  where removed_at is null;

create table if not exists public.founder_claims (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  founder_number integer not null unique check (founder_number between 1 and 50),
  claimed_at timestamptz not null default now()
);

insert into public.founder_claims (user_id, founder_number)
select id, founder_number
from public.profiles
where founder_number is not null
on conflict do nothing;

create table if not exists public.credit_transactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null check (amount <> 0),
  reason text not null check (char_length(reason) between 2 and 200),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.review_reward_awards (
  user_id uuid not null references public.profiles(id) on delete cascade,
  milestone integer not null check (milestone in (5, 10, 25, 50)),
  credits_awarded integer not null check (credits_awarded > 0),
  created_at timestamptz not null default now(),
  primary key (user_id, milestone)
);

create table if not exists public.song_reports (
  id uuid primary key default uuid_generate_v4(),
  song_id uuid not null references public.songs(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason public.report_reason not null,
  details text check (details is null or char_length(details) <= 1000),
  status public.report_status not null default 'open',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (song_id, reporter_id, reason)
);

create index if not exists song_reports_status_idx
  on public.song_reports (status, created_at);
create index if not exists credit_transactions_user_idx
  on public.credit_transactions (user_id, created_at desc);
create index if not exists songs_owner_idx
  on public.songs (user_id, created_at desc);

alter table public.founder_claims enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.review_reward_awards enable row level security;
alter table public.song_reports enable row level security;

drop policy if exists "profiles are publicly readable" on public.profiles;
drop policy if exists "songs are publicly readable" on public.songs;
drop policy if exists "users update their songs" on public.songs;
drop policy if exists "song owners can delete songs" on public.songs;

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select role
      from public.profiles
      where id = auth.uid()
        and account_status = 'active'
    ),
    'user'::public.app_role
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('super_admin', 'admin', 'moderator');
$$;

revoke all on function public.current_user_role() from public;
revoke all on function public.is_staff() from public;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_staff() to authenticated;

drop policy if exists "users read own profile or staff reads profiles" on public.profiles;
create policy "users read own profile or staff reads profiles"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.current_user_role() = 'super_admin');

drop policy if exists "authenticated users read eligible songs" on public.songs;
create policy "authenticated users read eligible songs"
  on public.songs for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_staff()
    or (
      is_active
      and removed_at is null
      and (
        not explicit_content
        or coalesce(
          (select show_explicit_content from public.profiles where id = auth.uid()),
          false
        )
      )
    )
  );

drop policy if exists "users read own founder claim or super admin reads claims" on public.founder_claims;
create policy "users read own founder claim or super admin reads claims"
  on public.founder_claims for select
  to authenticated
  using (user_id = auth.uid() or public.current_user_role() = 'super_admin');

drop policy if exists "users read own credit history or staff reads all" on public.credit_transactions;
create policy "users read own credit history or staff reads all"
  on public.credit_transactions for select
  to authenticated
  using (user_id = auth.uid() or public.current_user_role() = 'super_admin');

drop policy if exists "users read own rewards or staff reads all" on public.review_reward_awards;
create policy "users read own rewards or staff reads all"
  on public.review_reward_awards for select
  to authenticated
  using (user_id = auth.uid() or public.current_user_role() = 'super_admin');

drop policy if exists "users read own reports or staff reads reports" on public.song_reports;
create policy "users read own reports or staff reads reports"
  on public.song_reports for select
  to authenticated
  using (reporter_id = auth.uid() or public.is_staff());

drop policy if exists "users report eligible songs" on public.song_reports;
create policy "users report eligible songs"
  on public.song_reports for insert
  to authenticated
  with check (
    reporter_id = auth.uid()
    and exists (
      select 1 from public.songs
      where songs.id = song_id
        and songs.user_id <> auth.uid()
        and songs.removed_at is null
    )
  );

create or replace function public.music_url_matches_platform(
  music_url text,
  song_platform public.music_platform
)
returns boolean
language plpgsql
immutable
as $$
declare
  normalized text := lower(trim(music_url));
begin
  if song_platform = 'spotify' then
    return normalized ~ '^https://open\.spotify\.com/(intl-[a-z-]+/)?track/[a-z0-9]+';
  elsif song_platform = 'youtube_music' then
    return normalized ~ '^https://music\.youtube\.com/watch\?';
  elsif song_platform = 'youtube' then
    return normalized ~ '^https://(www\.)?(youtube\.com/watch\?|youtube\.com/shorts/|youtu\.be/)';
  elsif song_platform = 'soundcloud' then
    return normalized ~ '^https://(www\.)?soundcloud\.com/[^/]+/[^/]+';
  elsif song_platform = 'apple_music' then
    return normalized ~ '^https://music\.apple\.com/[a-z]{2}/(album|song)/';
  end if;
  return false;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  founder_spot integer;
  starting_credits integer := 1;
  accepted boolean := coalesce((new.raw_user_meta_data ->> 'legal_accepted')::boolean, false);
begin
  if not accepted then
    raise exception 'Legal terms must be accepted';
  end if;

  if not coalesce((new.raw_user_meta_data ->> 'system_bootstrap')::boolean, false) then
    update public.founder_program
    set claimed_count = claimed_count + 1
    where id = true and claimed_count < capacity
    returning claimed_count into founder_spot;
  end if;

  if founder_spot is not null then
    starting_credits := starting_credits + 10;
  end if;

  insert into public.profiles (
    id,
    display_name,
    avatar_url,
    founder_number,
    founder_free_submission_available,
    founder_premium_year_entitlement,
    credits,
    legal_accepted_at,
    explicit_content_acknowledged_at
  )
  values (
    new.id,
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
        'New artist'
      ),
      120
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    founder_spot,
    false,
    founder_spot is not null,
    starting_credits,
    now(),
    now()
  );

  insert into public.credit_transactions (user_id, amount, reason)
  values (new.id, 1, 'Registration credit');

  if founder_spot is not null then
    insert into public.founder_claims (user_id, founder_number)
    values (new.id, founder_spot);
    insert into public.credit_transactions (user_id, amount, reason)
    values (new.id, 10, 'Founding Artist bonus');
  end if;

  return new;
end;
$$;

revoke all on function public.claim_founder_spot() from public, anon, authenticated;

create or replace function public.complete_forced_password_change()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set force_password_change = false, updated_at = now()
  where id = auth.uid();
$$;
revoke all on function public.complete_forced_password_change() from public;
grant execute on function public.complete_forced_password_change() to authenticated;

create or replace function public.update_profile_preferences(
  profile_display_name text,
  profile_show_explicit_content boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(trim(profile_display_name)) not between 2 and 120 then
    raise exception 'Name must contain 2 to 120 characters';
  end if;
  update public.profiles
  set
    display_name = trim(profile_display_name),
    show_explicit_content = profile_show_explicit_content,
    updated_at = now()
  where id = auth.uid();
end;
$$;
revoke all on function public.update_profile_preferences(text, boolean) from public;
grant execute on function public.update_profile_preferences(text, boolean) to authenticated;

drop function if exists public.submit_song(
  text, text, text, text, public.music_platform, text, text, text[], text
);

create or replace function public.submit_song(
  song_title text,
  song_artist_name text,
  song_cover_image_url text,
  song_music_url text,
  song_platform public.music_platform,
  song_genre text,
  song_language text,
  song_feedback_focus text[],
  song_country text,
  song_explicit_content boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_song_id uuid;
  submitter_role public.app_role;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select role into submitter_role
  from public.profiles
  where id = auth.uid() and account_status = 'active';
  if not found then raise exception 'Active account required'; end if;

  if char_length(trim(song_title)) not between 1 and 120
    or char_length(trim(song_artist_name)) not between 1 and 120
    or char_length(trim(song_country)) not between 2 and 120
    or trim(song_cover_image_url) !~* '^https://'
    or char_length(trim(song_cover_image_url)) > 2000
    or char_length(trim(song_music_url)) > 2000
  then
    raise exception 'Required song metadata is invalid';
  end if;

  if song_genre not in (
    'Pop', 'Rock', 'Hip Hop', 'EDM', 'Country', 'Reggaeton',
    'Regional Mexican', 'Cumbia', 'Salsa', 'Bachata', 'Indie',
    'Alternative', 'Jazz', 'Classical', 'Instrumental', 'Other'
  ) then
    raise exception 'Unsupported genre';
  end if;

  if not public.music_url_matches_platform(song_music_url, song_platform) then
    raise exception 'Unsupported or invalid music link';
  end if;

  if exists (
    select 1 from public.songs
    where lower(trim(music_url)) = lower(trim(song_music_url))
  ) then
    raise exception 'This song link has already been submitted';
  end if;

  if submitter_role <> 'super_admin' then
    update public.profiles
    set credits = credits - 1, updated_at = now()
    where id = auth.uid() and credits >= 1;
    if not found then raise exception 'One credit is required'; end if;

    insert into public.credit_transactions (user_id, amount, reason)
    values (auth.uid(), -1, 'Song submission');
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
    explicit_content,
    submitted_with_founder_credit,
    is_active
  )
  values (
    auth.uid(),
    trim(song_title),
    trim(song_artist_name),
    trim(song_cover_image_url),
    trim(song_music_url),
    song_platform,
    song_genre,
    song_language,
    song_feedback_focus,
    trim(song_country),
    song_explicit_content,
    false,
    true
  )
  returning id into new_song_id;

  return new_song_id;
end;
$$;

revoke all on function public.submit_song(
  text, text, text, text, public.music_platform, text, text, text[], text, boolean
) from public;
grant execute on function public.submit_song(
  text, text, text, text, public.music_platform, text, text, text[], text, boolean
) to authenticated;

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
security definer
set search_path = public
as $$
declare
  normalized_comment text := public.normalize_feedback(review_comment);
  repeated_comment boolean;
  computed_score integer := 100;
  review_total integer;
  reward integer := 0;
  new_quality_score numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(trim(coalesce(review_comment, ''))) not between 30 and 1000 then
    return query select false, 0::smallint, false, 'Please provide useful feedback.'::text;
    return;
  end if;
  if review_rating not between 1 and 10 then raise exception 'Rating must be between 1 and 10'; end if;
  if not exists (
    select 1 from public.songs
    where id = reviewed_song_id
      and user_id <> auth.uid()
      and is_active
      and removed_at is null
  ) then
    raise exception 'Song is unavailable for review';
  end if;

  select exists (
    select 1 from public.reviews
    where reviewer_id = auth.uid()
      and public.normalize_feedback(comment) = normalized_comment
  ) into repeated_comment;

  if repeated_comment then computed_score := 20; end if;
  if review_pasted_comment_detected then computed_score := computed_score - 50; end if;
  if array_length(regexp_split_to_array(normalized_comment, '\s+'), 1) < 7 then
    computed_score := computed_score - 25;
  end if;
  computed_score := greatest(0, least(100, computed_score));
  if computed_score < 60 then
    return query select false, computed_score::smallint, false, 'Please provide useful feedback.'::text;
    return;
  end if;

  insert into public.reviews (
    song_id, reviewer_id, listen_full, add_to_playlist, grabbed_attention,
    share_with_friend, rating, comment, pasted_comment_detected, quality_score, quality_passed
  )
  values (
    reviewed_song_id, auth.uid(), review_listen_full, review_add_to_playlist,
    review_grabbed_attention, review_share_with_friend, review_rating,
    trim(review_comment), review_pasted_comment_detected, computed_score, true
  );

  update public.profiles
  set
    completed_reviews = completed_reviews + 1,
    updated_at = now()
  where id = auth.uid()
  returning completed_reviews into review_total;

  reward := case review_total
    when 5 then 1
    when 10 then 3
    when 25 then 8
    when 50 then 20
    else 0
  end;

  if reward > 0 then
    insert into public.review_reward_awards (user_id, milestone, credits_awarded)
    values (auth.uid(), review_total, reward)
    on conflict do nothing;
    if found then
      update public.profiles
      set
        credits = credits + reward,
        total_review_credits_earned = total_review_credits_earned + reward
      where id = auth.uid();
      insert into public.credit_transactions (user_id, amount, reason)
      values (auth.uid(), reward, review_total || ' completed reviews');
    else
      reward := 0;
    end if;
  end if;

  select round(avg(quality_score)::numeric, 2)
  into new_quality_score
  from public.reviews
  where reviewer_id = auth.uid();
  update public.profiles
  set review_quality_score = coalesce(new_quality_score, 100)
  where id = auth.uid();

  return query select true, computed_score::smallint, reward > 0, ''::text;
end;
$$;

drop function if exists public.get_smart_review_queue(integer);

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
    scored.id, scored.title, scored.artist_name, scored.cover_image_url,
    scored.music_url, scored.platform, scored.genre, scored.song_language,
    scored.feedback_focus, scored.country, scored.explicit_content, scored.created_at,
    scored.computed_match_score, scored.computed_match_reasons
  from scored
  order by scored.computed_match_score desc, scored.created_at asc
  limit greatest(1, least(queue_limit, 50));
$$;
revoke all on function public.get_smart_review_queue(integer) from public, anon;
grant execute on function public.get_smart_review_queue(integer) to authenticated;

create or replace function public.report_song(
  reported_song_id uuid,
  report_reason public.report_reason,
  report_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare report_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.songs
    where id = reported_song_id and user_id <> auth.uid() and removed_at is null
  ) then raise exception 'Song cannot be reported'; end if;

  insert into public.song_reports (song_id, reporter_id, reason, details)
  values (reported_song_id, auth.uid(), report_reason, nullif(trim(report_details), ''))
  returning id into report_id;
  return report_id;
end;
$$;
revoke all on function public.report_song(uuid, public.report_reason, text) from public;
grant execute on function public.report_song(uuid, public.report_reason, text) to authenticated;

create or replace function public.admin_adjust_credits(
  target_user_id uuid,
  credit_delta integer,
  adjustment_reason text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  balance integer;
  current_balance integer;
begin
  if public.current_user_role() <> 'super_admin' then raise exception 'Forbidden'; end if;
  if credit_delta = 0 or char_length(trim(adjustment_reason)) < 2 then
    raise exception 'Invalid credit adjustment';
  end if;

  select credits
  into current_balance
  from public.profiles
  where id = target_user_id
  for update;
  if not found then raise exception 'User not found'; end if;
  if current_balance + credit_delta < 0 then
    raise exception 'Credit balance cannot become negative';
  end if;

  update public.profiles
  set credits = credits + credit_delta, updated_at = now()
  where id = target_user_id
  returning credits into balance;
  insert into public.credit_transactions (user_id, amount, reason, created_by)
  values (target_user_id, credit_delta, trim(adjustment_reason), auth.uid());
  return balance;
end;
$$;

create or replace function public.admin_set_role(
  target_user_id uuid,
  new_role public.app_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'super_admin' then raise exception 'Forbidden'; end if;
  if target_user_id = auth.uid() and new_role <> 'super_admin' then
    raise exception 'Super Admin cannot demote the active account';
  end if;
  update public.profiles set role = new_role, updated_at = now() where id = target_user_id;
  if not found then raise exception 'User not found'; end if;
end;
$$;

create or replace function public.admin_set_account_status(
  target_user_id uuid,
  new_status public.account_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'super_admin' then raise exception 'Forbidden'; end if;
  if target_user_id = auth.uid() and new_status = 'suspended' then
    raise exception 'Super Admin cannot suspend the active account';
  end if;
  update public.profiles set account_status = new_status, updated_at = now()
  where id = target_user_id;
  if not found then raise exception 'User not found'; end if;
end;
$$;

create or replace function public.admin_set_song_state(
  target_song_id uuid,
  active boolean,
  feature boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('super_admin', 'admin', 'moderator') then
    raise exception 'Forbidden';
  end if;
  if public.current_user_role() = 'moderator' and feature then
    raise exception 'Moderators cannot feature songs';
  end if;
  update public.songs
  set
    is_active = active,
    featured = feature,
    removed_at = case when active then null else now() end,
    removed_by = case when active then null else auth.uid() end,
    updated_at = now()
  where id = target_song_id;
  if not found then raise exception 'Song not found'; end if;
end;
$$;

create or replace function public.admin_resolve_report(
  target_report_id uuid,
  new_status public.report_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Forbidden'; end if;
  update public.song_reports
  set status = new_status, reviewed_by = auth.uid(), reviewed_at = now()
  where id = target_report_id;
  if not found then raise exception 'Report not found'; end if;
end;
$$;

create or replace function public.admin_get_statistics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Forbidden';
  end if;
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'songs', (select count(*) from public.songs),
    'active_songs', (select count(*) from public.songs where is_active and removed_at is null),
    'open_reports', (select count(*) from public.song_reports where status = 'open'),
    'reviews', (select count(*) from public.reviews)
  );
end;
$$;

revoke all on function public.admin_adjust_credits(uuid, integer, text) from public;
revoke all on function public.admin_set_role(uuid, public.app_role) from public;
revoke all on function public.admin_set_account_status(uuid, public.account_status) from public;
revoke all on function public.admin_set_song_state(uuid, boolean, boolean) from public;
revoke all on function public.admin_resolve_report(uuid, public.report_status) from public;
revoke all on function public.admin_get_statistics() from public;
grant execute on function public.admin_adjust_credits(uuid, integer, text) to authenticated;
grant execute on function public.admin_set_role(uuid, public.app_role) to authenticated;
grant execute on function public.admin_set_account_status(uuid, public.account_status) to authenticated;
grant execute on function public.admin_set_song_state(uuid, boolean, boolean) to authenticated;
grant execute on function public.admin_resolve_report(uuid, public.report_status) to authenticated;
grant execute on function public.admin_get_statistics() to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'founder_program'
  ) and exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    alter publication supabase_realtime add table public.founder_program;
  end if;
end $$;

-- ============================================================
-- 202606080003_music_discovery.sql
-- ============================================================

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

drop policy if exists "users manage own follows" on public.artist_follows;
create policy "users manage own follows"
  on public.artist_follows for all
  to authenticated
  using (follower_id = auth.uid())
  with check (follower_id = auth.uid());

drop policy if exists "users manage own saved songs" on public.saved_songs;
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
    and (
      not songs.explicit_content
      or exists (
        select 1
        from public.profiles as viewer
        where viewer.id = auth.uid()
          and viewer.account_status = 'active'
          and viewer.show_explicit_content
      )
    )
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
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.account_status = 'active'
    )
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
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.account_status = 'active'
    )
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
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.account_status = 'active'
    )
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

-- ============================================================
-- 202606080004_recovery_hardening.sql
-- ============================================================

-- First Listen recovery, data reconciliation, and privilege hardening.
-- Apply after the base, security, and music discovery migrations.

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and account_status = 'active'
  );
$$;

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select role
      from public.profiles
      where id = auth.uid()
        and account_status = 'active'
    ),
    'user'::public.app_role
  );
$$;

insert into public.profiles (
  id,
  display_name,
  avatar_url,
  credits,
  legal_accepted_at,
  explicit_content_acknowledged_at
)
select
  users.id,
  left(
    coalesce(
      nullif(trim(users.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(users.email, ''), '@', 1), ''),
      'New artist'
    ),
    120
  ),
  nullif(trim(users.raw_user_meta_data ->> 'avatar_url'), ''),
  1,
  case
    when lower(coalesce(users.raw_user_meta_data ->> 'legal_accepted', 'false')) = 'true'
    then coalesce(users.created_at, now())
  end,
  case
    when lower(coalesce(users.raw_user_meta_data ->> 'explicit_content_acknowledged', 'false')) = 'true'
    then coalesce(users.created_at, now())
  end
from auth.users
where not exists (
  select 1 from public.profiles where profiles.id = users.id
);

update public.profiles
set display_name = left(
  coalesce(nullif(trim(display_name), ''), 'New artist'),
  120
);

insert into public.founder_claims (user_id, founder_number, claimed_at)
select
  profiles.id,
  profiles.founder_number,
  profiles.created_at
from public.profiles
where profiles.founder_number is not null
on conflict do nothing;

with available_numbers as (
  select
    numbers.founder_number,
    row_number() over (order by numbers.founder_number) as assignment_order
  from generate_series(1, 50) as numbers(founder_number)
  where not exists (
    select 1
    from public.founder_claims
    where founder_claims.founder_number = numbers.founder_number
  )
),
eligible_profiles as (
  select
    profiles.id,
    row_number() over (order by users.created_at, profiles.id) as assignment_order
  from public.profiles
  join auth.users on users.id = profiles.id
  where profiles.founder_number is null
    and lower(coalesce(users.raw_user_meta_data ->> 'system_bootstrap', 'false')) <> 'true'
),
assignments as (
  select
    eligible_profiles.id,
    available_numbers.founder_number
  from eligible_profiles
  join available_numbers using (assignment_order)
),
updated_profiles as (
  update public.profiles
  set
    founder_number = assignments.founder_number,
    founder_premium_year_entitlement = true,
    updated_at = now()
  from assignments
  where profiles.id = assignments.id
  returning profiles.id, profiles.founder_number
)
insert into public.founder_claims (user_id, founder_number)
select id, founder_number
from updated_profiles
on conflict do nothing;

insert into public.credit_transactions (user_id, amount, reason)
select profiles.id, 1, 'Registration credit'
from public.profiles
where not exists (
  select 1
  from public.credit_transactions
  where credit_transactions.user_id = profiles.id
    and credit_transactions.reason = 'Registration credit'
);

with missing_founder_bonus as materialized (
  select founder_claims.user_id
  from public.founder_claims
  where not exists (
    select 1
    from public.credit_transactions
    where credit_transactions.user_id = founder_claims.user_id
      and credit_transactions.reason = 'Founding Artist bonus'
  )
),
credited_profiles as (
  update public.profiles
  set
    credits = credits + 10,
    updated_at = now()
  where id in (select user_id from missing_founder_bonus)
  returning id
)
insert into public.credit_transactions (user_id, amount, reason)
select id, 10, 'Founding Artist bonus'
from credited_profiles;

update public.founder_program
set claimed_count = (
  select count(*)::integer from public.founder_claims
)
where id = true;

with review_counts as (
  select
    reviewer_id,
    count(*)::integer as completed_reviews
  from public.reviews
  where quality_passed
  group by reviewer_id
)
update public.profiles
set
  completed_reviews = greatest(profiles.completed_reviews, review_counts.completed_reviews),
  updated_at = now()
from review_counts
where profiles.id = review_counts.reviewer_id;

with quality_scores as (
  select
    reviewer_id,
    round(avg(quality_score)::numeric, 2) as review_quality_score
  from public.reviews
  group by reviewer_id
)
update public.profiles
set
  review_quality_score = quality_scores.review_quality_score,
  updated_at = now()
from quality_scores
where profiles.id = quality_scores.reviewer_id;

with milestones(milestone, credits_awarded) as (
  values (5, 1), (10, 3), (25, 8), (50, 20)
),
missing_awards as (
  select
    profiles.id as user_id,
    milestones.milestone,
    milestones.credits_awarded
  from public.profiles
  cross join milestones
  where profiles.completed_reviews >= milestones.milestone
    and not exists (
      select 1
      from public.review_reward_awards
      where review_reward_awards.user_id = profiles.id
        and review_reward_awards.milestone = milestones.milestone
    )
),
inserted_awards as (
  insert into public.review_reward_awards (user_id, milestone, credits_awarded)
  select user_id, milestone, credits_awarded
  from missing_awards
  on conflict do nothing
  returning user_id, milestone, credits_awarded
),
award_totals as (
  select user_id, sum(credits_awarded)::integer as credits_awarded
  from inserted_awards
  group by user_id
),
credited_reviewers as (
  update public.profiles
  set
    credits = credits + award_totals.credits_awarded,
    total_review_credits_earned =
      total_review_credits_earned + award_totals.credits_awarded,
    updated_at = now()
  from award_totals
  where profiles.id = award_totals.user_id
  returning profiles.id
)
insert into public.credit_transactions (user_id, amount, reason)
select
  inserted_awards.user_id,
  inserted_awards.credits_awarded,
  inserted_awards.milestone || ' completed reviews'
from inserted_awards;

create index if not exists song_reports_reporter_idx
  on public.song_reports (reporter_id, created_at desc);
create index if not exists song_reports_song_idx
  on public.song_reports (song_id, created_at desc);
create index if not exists saved_songs_song_idx
  on public.saved_songs (song_id);
create index if not exists reviews_song_quality_idx
  on public.reviews (song_id, quality_passed, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists songs_set_updated_at on public.songs;
create trigger songs_set_updated_at
  before update on public.songs
  for each row execute function public.set_updated_at();

create or replace function public.enforce_active_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_active_user() then
    raise exception 'Active account required';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_require_active_actor on public.profiles;
create trigger profiles_require_active_actor
  before insert or update or delete on public.profiles
  for each row execute function public.enforce_active_actor();

drop trigger if exists songs_require_active_actor on public.songs;
create trigger songs_require_active_actor
  before insert or update or delete on public.songs
  for each row execute function public.enforce_active_actor();

drop trigger if exists reviews_require_active_actor on public.reviews;
create trigger reviews_require_active_actor
  before insert or update or delete on public.reviews
  for each row execute function public.enforce_active_actor();

drop trigger if exists reports_require_active_actor on public.song_reports;
create trigger reports_require_active_actor
  before insert or update or delete on public.song_reports
  for each row execute function public.enforce_active_actor();

drop trigger if exists follows_require_active_actor on public.artist_follows;
create trigger follows_require_active_actor
  before insert or update or delete on public.artist_follows
  for each row execute function public.enforce_active_actor();

drop trigger if exists saved_songs_require_active_actor on public.saved_songs;
create trigger saved_songs_require_active_actor
  before insert or update or delete on public.saved_songs
  for each row execute function public.enforce_active_actor();

drop policy if exists "users read own profile or staff reads profiles" on public.profiles;
create policy "users read own profile or staff reads profiles"
  on public.profiles for select
  to authenticated
  using (
    public.is_active_user()
    and (id = auth.uid() or public.current_user_role() = 'super_admin')
  );

drop policy if exists "authenticated users read eligible songs" on public.songs;
create policy "authenticated users read eligible songs"
  on public.songs for select
  to authenticated
  using (
    public.is_active_user()
    and (
      user_id = auth.uid()
      or public.is_staff()
      or (
        is_active
        and removed_at is null
        and (
          not explicit_content
          or coalesce(
            (
              select show_explicit_content
              from public.profiles
              where id = auth.uid()
            ),
            false
          )
        )
      )
    )
  );

drop policy if exists "reviews are readable by reviewer or song owner" on public.reviews;
create policy "reviews are readable by reviewer or song owner"
  on public.reviews for select
  to authenticated
  using (
    public.is_active_user()
    and (
      reviewer_id = auth.uid()
      or public.is_staff()
      or exists (
        select 1
        from public.songs
        where songs.id = reviews.song_id
          and songs.user_id = auth.uid()
      )
    )
  );

drop policy if exists "users read own founder claim or super admin reads claims" on public.founder_claims;
create policy "users read own founder claim or super admin reads claims"
  on public.founder_claims for select
  to authenticated
  using (
    public.is_active_user()
    and (user_id = auth.uid() or public.current_user_role() = 'super_admin')
  );

drop policy if exists "users read own credit history or staff reads all" on public.credit_transactions;
create policy "users read own credit history or staff reads all"
  on public.credit_transactions for select
  to authenticated
  using (
    public.is_active_user()
    and (user_id = auth.uid() or public.current_user_role() = 'super_admin')
  );

drop policy if exists "users read own rewards or staff reads all" on public.review_reward_awards;
create policy "users read own rewards or staff reads all"
  on public.review_reward_awards for select
  to authenticated
  using (
    public.is_active_user()
    and (user_id = auth.uid() or public.current_user_role() = 'super_admin')
  );

drop policy if exists "users read own reports or staff reads reports" on public.song_reports;
create policy "users read own reports or staff reads reports"
  on public.song_reports for select
  to authenticated
  using (
    public.is_active_user()
    and (reporter_id = auth.uid() or public.is_staff())
  );

drop policy if exists "users report eligible songs" on public.song_reports;
create policy "users report eligible songs"
  on public.song_reports for insert
  to authenticated
  with check (
    public.is_active_user()
    and reporter_id = auth.uid()
    and exists (
      select 1
      from public.songs
      where songs.id = song_id
        and songs.user_id <> auth.uid()
        and songs.is_active
        and songs.removed_at is null
    )
  );

drop policy if exists "users manage own follows" on public.artist_follows;
create policy "users manage own follows"
  on public.artist_follows for all
  to authenticated
  using (public.is_active_user() and follower_id = auth.uid())
  with check (public.is_active_user() and follower_id = auth.uid());

drop policy if exists "users manage own saved songs" on public.saved_songs;
create policy "users manage own saved songs"
  on public.saved_songs for all
  to authenticated
  using (public.is_active_user() and user_id = auth.uid())
  with check (public.is_active_user() and user_id = auth.uid());

revoke create on schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;

revoke all on table public.founder_program from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.songs from anon, authenticated;
revoke all on table public.reviews from anon, authenticated;
revoke all on table public.waitlist from anon, authenticated;
revoke all on table public.founder_claims from anon, authenticated;
revoke all on table public.credit_transactions from anon, authenticated;
revoke all on table public.review_reward_awards from anon, authenticated;
revoke all on table public.song_reports from anon, authenticated;
revoke all on table public.artist_follows from anon, authenticated;
revoke all on table public.saved_songs from anon, authenticated;
revoke all on table public.song_analytics from anon, authenticated;

grant select on table public.founder_program to anon, authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.songs to authenticated;
grant select on table public.reviews to authenticated;
grant insert on table public.waitlist to anon, authenticated;
grant select on table public.founder_claims to authenticated;
grant select on table public.credit_transactions to authenticated;
grant select on table public.review_reward_awards to authenticated;
grant select, insert on table public.song_reports to authenticated;
grant select, insert, delete on table public.artist_follows to authenticated;
grant select, insert, delete on table public.saved_songs to authenticated;
grant select on table public.song_analytics to authenticated;

revoke all on function public.normalize_feedback(text) from public, anon, authenticated;
revoke all on function public.music_url_matches_platform(text, public.music_platform) from public, anon, authenticated;
revoke all on function public.claim_founder_spot() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.enforce_active_actor() from public, anon, authenticated;
revoke all on function public.is_active_user() from public, anon, authenticated;
revoke all on function public.current_user_role() from public, anon, authenticated;
revoke all on function public.is_staff() from public, anon, authenticated;
revoke all on function public.save_onboarding_preferences(text[], text[], text) from public, anon, authenticated;
revoke all on function public.set_interface_language(text) from public, anon, authenticated;
revoke all on function public.complete_forced_password_change() from public, anon, authenticated;
revoke all on function public.update_profile_preferences(text, boolean) from public, anon, authenticated;
revoke all on function public.submit_song(
  text, text, text, text, public.music_platform, text, text, text[], text, boolean
) from public, anon, authenticated;
revoke all on function public.submit_review(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean
) from public, anon, authenticated;
revoke all on function public.get_smart_review_queue(integer) from public, anon, authenticated;
revoke all on function public.report_song(uuid, public.report_reason, text) from public, anon, authenticated;
revoke all on function public.follow_artist(uuid) from public, anon, authenticated;
revoke all on function public.unfollow_artist(uuid) from public, anon, authenticated;
revoke all on function public.save_song_for_later(uuid) from public, anon, authenticated;
revoke all on function public.unsave_song(uuid) from public, anon, authenticated;
revoke all on function public.get_public_artist_profile(uuid) from public, anon, authenticated;
revoke all on function public.get_public_artist_songs(uuid) from public, anon, authenticated;
revoke all on function public.get_my_song_dashboard() from public, anon, authenticated;
revoke all on function public.get_my_song_comments(uuid) from public, anon, authenticated;
revoke all on function public.get_saved_songs() from public, anon, authenticated;
revoke all on function public.admin_adjust_credits(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.admin_set_role(uuid, public.app_role) from public, anon, authenticated;
revoke all on function public.admin_set_account_status(uuid, public.account_status) from public, anon, authenticated;
revoke all on function public.admin_set_song_state(uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public.admin_resolve_report(uuid, public.report_status) from public, anon, authenticated;
revoke all on function public.admin_get_statistics() from public, anon, authenticated;

grant execute on function public.is_active_user() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.save_onboarding_preferences(text[], text[], text) to authenticated;
grant execute on function public.set_interface_language(text) to authenticated;
grant execute on function public.complete_forced_password_change() to authenticated;
grant execute on function public.update_profile_preferences(text, boolean) to authenticated;
grant execute on function public.submit_song(
  text, text, text, text, public.music_platform, text, text, text[], text, boolean
) to authenticated;
grant execute on function public.submit_review(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean
) to authenticated;
grant execute on function public.get_smart_review_queue(integer) to authenticated;
grant execute on function public.report_song(uuid, public.report_reason, text) to authenticated;
grant execute on function public.follow_artist(uuid) to authenticated;
grant execute on function public.unfollow_artist(uuid) to authenticated;
grant execute on function public.save_song_for_later(uuid) to authenticated;
grant execute on function public.unsave_song(uuid) to authenticated;
grant execute on function public.get_public_artist_profile(uuid) to anon, authenticated;
grant execute on function public.get_public_artist_songs(uuid) to anon, authenticated;
grant execute on function public.get_my_song_dashboard() to authenticated;
grant execute on function public.get_my_song_comments(uuid) to authenticated;
grant execute on function public.get_saved_songs() to authenticated;
grant execute on function public.admin_adjust_credits(uuid, integer, text) to authenticated;
grant execute on function public.admin_set_role(uuid, public.app_role) to authenticated;
grant execute on function public.admin_set_account_status(uuid, public.account_status) to authenticated;
grant execute on function public.admin_set_song_state(uuid, boolean, boolean) to authenticated;
grant execute on function public.admin_resolve_report(uuid, public.report_status) to authenticated;
grant execute on function public.admin_get_statistics() to authenticated;

create or replace function public.database_health_report()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with expected_tables(name) as (
    values
      ('profiles'),
      ('songs'),
      ('reviews'),
      ('founder_program'),
      ('founder_claims'),
      ('credit_transactions'),
      ('review_reward_awards'),
      ('song_reports'),
      ('artist_follows'),
      ('saved_songs'),
      ('waitlist')
  ),
  expected_functions(name) as (
    values
      ('submit_song'),
      ('submit_review'),
      ('get_smart_review_queue'),
      ('follow_artist'),
      ('unfollow_artist'),
      ('save_song_for_later'),
      ('unsave_song'),
      ('get_saved_songs'),
      ('get_public_artist_profile'),
      ('get_public_artist_songs'),
      ('get_my_song_dashboard'),
      ('get_my_song_comments'),
      ('report_song')
  ),
  expected_indexes(name) as (
    values
      ('songs_queue_idx'),
      ('songs_unique_music_url_idx'),
      ('reviews_song_idx'),
      ('reviews_reviewer_idx'),
      ('song_reports_status_idx'),
      ('artist_follows_artist_idx'),
      ('saved_songs_user_idx')
  )
  select jsonb_build_object(
    'tables',
    (
      select jsonb_object_agg(
        expected_tables.name,
        to_regclass(format('public.%I', expected_tables.name)) is not null
      )
      from expected_tables
    ),
    'music_platform',
    (
      select coalesce(jsonb_agg(pg_enum.enumlabel order by pg_enum.enumsortorder), '[]'::jsonb)
      from pg_enum
      join pg_type on pg_type.oid = pg_enum.enumtypid
      join pg_namespace on pg_namespace.oid = pg_type.typnamespace
      where pg_namespace.nspname = 'public'
        and pg_type.typname = 'music_platform'
    ),
    'functions',
    (
      select jsonb_object_agg(
        expected_functions.name,
        exists (
          select 1
          from pg_proc
          join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
          where pg_namespace.nspname = 'public'
            and pg_proc.proname = expected_functions.name
        )
      )
      from expected_functions
    ),
    'indexes',
    (
      select jsonb_object_agg(
        expected_indexes.name,
        to_regclass(format('public.%I', expected_indexes.name)) is not null
      )
      from expected_indexes
    ),
    'rls',
    (
      select jsonb_object_agg(pg_class.relname, pg_class.relrowsecurity)
      from pg_class
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = 'public'
        and pg_class.relname in (select name from expected_tables)
        and pg_class.relkind = 'r'
    ),
    'policy_count',
    (
      select count(*)::integer
      from pg_policies
      where schemaname = 'public'
    ),
    'auth_users',
    (select count(*)::integer from auth.users),
    'profiles',
    (select count(*)::integer from public.profiles),
    'missing_profiles',
    (
      select count(*)::integer
      from auth.users
      where not exists (
        select 1 from public.profiles where profiles.id = users.id
      )
    ),
    'founder_claims',
    (select count(*)::integer from public.founder_claims),
    'founder_counter',
    (
      select claimed_count
      from public.founder_program
      where id = true
    ),
    'duplicate_active_song_urls',
    (
      select count(*)::integer
      from (
        select lower(trim(music_url))
        from public.songs
        where removed_at is null
        group by lower(trim(music_url))
        having count(*) > 1
      ) duplicates
    ),
    'orphan_reviews',
    (
      select count(*)::integer
      from public.reviews
      where not exists (
        select 1 from public.songs where songs.id = reviews.song_id
      )
      or not exists (
        select 1 from public.profiles where profiles.id = reviews.reviewer_id
      )
    )
  );
$$;

revoke all on function public.database_health_report() from public, anon, authenticated;
grant execute on function public.database_health_report() to service_role;

-- ============================================================
-- 202606080005_fix_submit_review_quality_score.sql
-- ============================================================

-- Qualify review columns that conflict with RETURNS TABLE output variables.
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
security definer
set search_path = public
as $$
declare
  normalized_comment text := public.normalize_feedback(review_comment);
  repeated_comment boolean;
  computed_score integer := 100;
  review_total integer;
  reward integer := 0;
  new_quality_score numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(trim(coalesce(review_comment, ''))) not between 30 and 1000 then
    return query select false, 0::smallint, false, 'Please provide useful feedback.'::text;
    return;
  end if;
  if review_rating not between 1 and 10 then raise exception 'Rating must be between 1 and 10'; end if;
  if not exists (
    select 1 from public.songs
    where id = reviewed_song_id
      and user_id <> auth.uid()
      and is_active
      and removed_at is null
  ) then
    raise exception 'Song is unavailable for review';
  end if;

  select exists (
    select 1 from public.reviews
    where reviewer_id = auth.uid()
      and public.normalize_feedback(comment) = normalized_comment
  ) into repeated_comment;

  if repeated_comment then computed_score := 20; end if;
  if review_pasted_comment_detected then computed_score := computed_score - 50; end if;
  if array_length(regexp_split_to_array(normalized_comment, '\s+'), 1) < 7 then
    computed_score := computed_score - 25;
  end if;
  computed_score := greatest(0, least(100, computed_score));
  if computed_score < 60 then
    return query select false, computed_score::smallint, false, 'Please provide useful feedback.'::text;
    return;
  end if;

  insert into public.reviews (
    song_id, reviewer_id, listen_full, add_to_playlist, grabbed_attention,
    share_with_friend, rating, comment, pasted_comment_detected, quality_score, quality_passed
  )
  values (
    reviewed_song_id, auth.uid(), review_listen_full, review_add_to_playlist,
    review_grabbed_attention, review_share_with_friend, review_rating,
    trim(review_comment), review_pasted_comment_detected, computed_score, true
  );

  update public.profiles
  set
    completed_reviews = completed_reviews + 1,
    updated_at = now()
  where id = auth.uid()
  returning completed_reviews into review_total;

  reward := case review_total
    when 5 then 1
    when 10 then 3
    when 25 then 8
    when 50 then 20
    else 0
  end;

  if reward > 0 then
    insert into public.review_reward_awards (user_id, milestone, credits_awarded)
    values (auth.uid(), review_total, reward)
    on conflict do nothing;
    if found then
      update public.profiles
      set
        credits = credits + reward,
        total_review_credits_earned = total_review_credits_earned + reward
      where id = auth.uid();
      insert into public.credit_transactions (user_id, amount, reason)
      values (auth.uid(), reward, review_total || ' completed reviews');
    else
      reward := 0;
    end if;
  end if;

  select round(avg(reviews.quality_score)::numeric, 2)
  into new_quality_score
  from public.reviews as reviews
  where reviews.reviewer_id = auth.uid();

  update public.profiles
  set review_quality_score = coalesce(new_quality_score, 100)
  where id = auth.uid();

  return query select true, computed_score::smallint, reward > 0, ''::text;
end;
$$;

revoke all on function public.submit_review(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean
) from public, anon;
grant execute on function public.submit_review(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean
) to authenticated;

-- ============================================================
-- 202606090000_phase_a_admin_auth.sql
-- ============================================================

create table if not exists public.admin_audit_log (
  id uuid primary key default uuid_generate_v4(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (char_length(trim(action)) between 3 and 80),
  target_type text not null check (char_length(trim(target_type)) between 3 and 80),
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_target_idx
  on public.admin_audit_log (target_type, target_id, created_at desc);

alter table public.admin_audit_log enable row level security;

drop policy if exists "super admins read admin audit log"
  on public.admin_audit_log;
create policy "super admins read admin audit log"
  on public.admin_audit_log
  for select
  to authenticated
  using (public.current_user_role() = 'super_admin');

revoke all on table public.admin_audit_log from public, anon, authenticated;
grant select on table public.admin_audit_log to authenticated;

create or replace function public.promote_founder_one_to_super_admin(
  target_user_id uuid,
  expected_email text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  target_profile public.profiles%rowtype;
  target_auth_user auth.users%rowtype;
begin
  if expected_email is null or lower(trim(expected_email)) = '' then
    raise exception 'Expected email is required';
  end if;

  select *
  into target_auth_user
  from auth.users
  where id = target_user_id
  for update;

  if not found then
    raise exception 'Auth user not found';
  end if;
  if lower(target_auth_user.email) <> lower(trim(expected_email)) then
    raise exception 'Auth email does not match the approved Founder account';
  end if;
  if target_auth_user.email_confirmed_at is null then
    raise exception 'Founder account email is not confirmed';
  end if;

  select *
  into target_profile
  from public.profiles
  where id = target_user_id
  for update;

  if not found then
    raise exception 'Founder profile not found';
  end if;
  if target_profile.founder_number <> 1 then
    raise exception 'Target account is not Founder #1';
  end if;
  if target_profile.account_status <> 'active' then
    raise exception 'Founder account is not active';
  end if;
  if target_profile.role <> 'user' then
    raise exception 'Founder account must have the user role before promotion';
  end if;
  if not exists (
    select 1
    from public.founder_claims
    where user_id = target_user_id
      and founder_number = 1
  ) then
    raise exception 'Founder #1 claim is missing';
  end if;
  if exists (
    select 1
    from public.admin_audit_log
    where action = 'bootstrap_super_admin'
      and target_id = target_user_id
  ) then
    raise exception 'Founder #1 bootstrap promotion has already been used';
  end if;

  update public.profiles
  set role = 'super_admin', updated_at = now()
  where id = target_user_id;

  insert into public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  )
  values (
    null,
    'bootstrap_super_admin',
    'profile',
    target_user_id,
    jsonb_build_object(
      'previous_role', target_profile.role,
      'new_role', 'super_admin',
      'founder_number', target_profile.founder_number,
      'source', 'phase_a_one_time_promotion'
    )
  );

  return jsonb_build_object(
    'user_id', target_user_id,
    'role', 'super_admin',
    'founder_number', 1
  );
end;
$$;

revoke all on function public.promote_founder_one_to_super_admin(uuid, text)
  from public, anon, authenticated;
grant execute on function public.promote_founder_one_to_super_admin(uuid, text)
  to service_role;

create or replace function public.admin_set_role(
  target_user_id uuid,
  new_role public.app_role
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_role public.app_role;
begin
  if public.current_user_role() <> 'super_admin' then
    raise exception 'Forbidden';
  end if;
  if target_user_id = auth.uid() and new_role <> 'super_admin' then
    raise exception 'Super Admin cannot demote the active account';
  end if;

  select role
  into previous_role
  from public.profiles
  where id = target_user_id
  for update;
  if not found then
    raise exception 'User not found';
  end if;

  update public.profiles
  set role = new_role, updated_at = now()
  where id = target_user_id;

  if previous_role is distinct from new_role then
    insert into public.admin_audit_log (
      actor_id,
      action,
      target_type,
      target_id,
      details
    )
    values (
      auth.uid(),
      'set_role',
      'profile',
      target_user_id,
      jsonb_build_object(
        'previous_role', previous_role,
        'new_role', new_role
      )
    );
  end if;
end;
$$;

create or replace function public.admin_set_account_status(
  target_user_id uuid,
  new_status public.account_status
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_status public.account_status;
begin
  if public.current_user_role() <> 'super_admin' then
    raise exception 'Forbidden';
  end if;
  if target_user_id = auth.uid() and new_status = 'suspended' then
    raise exception 'Super Admin cannot suspend the active account';
  end if;

  select account_status
  into previous_status
  from public.profiles
  where id = target_user_id
  for update;
  if not found then
    raise exception 'User not found';
  end if;

  update public.profiles
  set account_status = new_status, updated_at = now()
  where id = target_user_id;

  if previous_status is distinct from new_status then
    insert into public.admin_audit_log (
      actor_id,
      action,
      target_type,
      target_id,
      details
    )
    values (
      auth.uid(),
      'set_account_status',
      'profile',
      target_user_id,
      jsonb_build_object(
        'previous_status', previous_status,
        'new_status', new_status
      )
    );
  end if;
end;
$$;

revoke all on function public.admin_set_role(uuid, public.app_role)
  from public, anon, authenticated;
revoke all on function public.admin_set_account_status(uuid, public.account_status)
  from public, anon, authenticated;
grant execute on function public.admin_set_role(uuid, public.app_role)
  to authenticated;
grant execute on function public.admin_set_account_status(uuid, public.account_status)
  to authenticated;

-- ============================================================
-- 20260609014018_provider_playback_submission_diagnostics.sql
-- ============================================================

-- Align server-side submission validation with the supported provider URLs.
-- This migration is additive-only: it replaces function bodies and preserves data.

create or replace function public.music_url_matches_platform(
  music_url text,
  song_platform public.music_platform
)
returns boolean
language plpgsql
immutable
as $$
declare
  normalized text := lower(trim(music_url));
begin
  if song_platform = 'spotify' then
    return normalized ~ '^https://open\.spotify\.com/(intl-[a-z-]+/)?track/[a-z0-9]+';
  elsif song_platform = 'youtube_music' then
    return normalized ~ '^https://music\.youtube\.com/watch\?'
      and normalized ~ '[?&]v=[a-z0-9_-]+';
  elsif song_platform = 'youtube' then
    return (
      normalized ~ '^https://(www\.|m\.)?youtube\.com/watch\?'
      and normalized ~ '[?&]v=[a-z0-9_-]+'
    ) or normalized ~ '^https://(www\.|m\.)?youtube\.com/shorts/[a-z0-9_-]+'
      or normalized ~ '^https://youtu\.be/[a-z0-9_-]+';
  elsif song_platform = 'soundcloud' then
    return normalized ~ '^https://(www\.)?soundcloud\.com/[^/]+/[^/?]+';
  elsif song_platform = 'apple_music' then
    return normalized ~ '^https://music\.apple\.com/[a-z]{2}/(album|song)/';
  end if;
  return false;
end;
$$;

create or replace function public.submit_song(
  song_title text,
  song_artist_name text,
  song_cover_image_url text,
  song_music_url text,
  song_platform public.music_platform,
  song_genre text,
  song_language text,
  song_feedback_focus text[],
  song_country text,
  song_explicit_content boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_song_id uuid;
  submitter_role public.app_role;
  resolved_cover_image_url text := coalesce(
    nullif(trim(song_cover_image_url), ''),
    'https://www.firstlisten.net/covers/default-song.svg'
  );
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select role into submitter_role
  from public.profiles
  where id = auth.uid() and account_status = 'active';
  if not found then raise exception 'Active account required'; end if;

  if char_length(trim(song_title)) not between 1 and 120
    or char_length(trim(song_artist_name)) not between 1 and 120
    or char_length(trim(song_country)) not between 2 and 120
    or resolved_cover_image_url !~* '^https://'
    or char_length(resolved_cover_image_url) > 2000
    or char_length(trim(song_music_url)) > 2000
  then
    raise exception 'Required song metadata is invalid';
  end if;

  if song_genre not in (
    'Pop', 'Rock', 'Hip Hop', 'EDM', 'Country', 'Reggaeton',
    'Regional Mexican', 'Cumbia', 'Salsa', 'Bachata', 'Indie',
    'Alternative', 'Jazz', 'Classical', 'Instrumental', 'Other'
  ) then
    raise exception 'Unsupported genre';
  end if;

  if not public.music_url_matches_platform(song_music_url, song_platform) then
    raise exception 'Unsupported or invalid music link';
  end if;

  if exists (
    select 1 from public.songs
    where lower(trim(music_url)) = lower(trim(song_music_url))
  ) then
    raise exception 'This song link has already been submitted';
  end if;

  if submitter_role <> 'super_admin' then
    update public.profiles
    set credits = credits - 1, updated_at = now()
    where id = auth.uid() and credits >= 1;
    if not found then raise exception 'One credit is required'; end if;

    insert into public.credit_transactions (user_id, amount, reason)
    values (auth.uid(), -1, 'Song submission');
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
    explicit_content,
    submitted_with_founder_credit,
    is_active
  )
  values (
    auth.uid(),
    trim(song_title),
    trim(song_artist_name),
    resolved_cover_image_url,
    trim(song_music_url),
    song_platform,
    song_genre,
    song_language,
    song_feedback_focus,
    trim(song_country),
    song_explicit_content,
    false,
    true
  )
  returning id into new_song_id;

  return new_song_id;
end;
$$;

revoke all on function public.submit_song(
  text, text, text, text, public.music_platform, text, text, text[], text, boolean
) from public;
grant execute on function public.submit_song(
  text, text, text, text, public.music_platform, text, text, text[], text, boolean
) to authenticated;

-- ============================================================
-- 20260609030000_listen_to_earn_phase_one.sql
-- ============================================================

-- Listen-to-Earn Phase 1.
-- Verified playback is accumulated in pending sessions and only banked after
-- the matching review passes the existing server-side quality checks.

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'listening_session_status'
  ) then
    create type public.listening_session_status as enum (
      'active',
      'qualified',
      'abandoned'
    );
  end if;
end $$;

alter table public.profiles
  add column if not exists listening_bank_seconds bigint not null default 0,
  add column if not exists lifetime_listening_seconds bigint not null default 0,
  add column if not exists listening_reward_credits_earned integer not null default 0;

alter table public.profiles
  drop constraint if exists profiles_listening_bank_seconds_check;
alter table public.profiles
  add constraint profiles_listening_bank_seconds_check
  check (listening_bank_seconds >= 0);

alter table public.profiles
  drop constraint if exists profiles_lifetime_listening_seconds_check;
alter table public.profiles
  add constraint profiles_lifetime_listening_seconds_check
  check (lifetime_listening_seconds >= 0);

alter table public.profiles
  drop constraint if exists profiles_listening_reward_credits_earned_check;
alter table public.profiles
  add constraint profiles_listening_reward_credits_earned_check
  check (listening_reward_credits_earned >= 0);

create table if not exists public.listening_reward_settings (
  id boolean primary key default true check (id),
  minutes_per_credit integer not null default 120
    check (minutes_per_credit between 30 and 1440),
  daily_cap_minutes integer not null default 180
    check (daily_cap_minutes between 30 and 1440),
  heartbeat_interval_seconds integer not null default 15
    check (heartbeat_interval_seconds between 10 and 60),
  interaction_grace_seconds integer not null default 300
    check (interaction_grace_seconds between 60 and 900),
  enabled boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.listening_reward_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.listening_levels (
  level_number smallint primary key check (level_number between 1 and 20),
  level_name text not null unique check (char_length(level_name) between 2 and 80),
  minimum_minutes integer not null unique check (minimum_minutes >= 0)
);

insert into public.listening_levels (level_number, level_name, minimum_minutes)
values
  (1, 'Explorer', 0),
  (2, 'Discoverer', 120),
  (3, 'Talent Scout', 600),
  (4, 'Curator', 1800),
  (5, 'Elite Curator', 6000)
on conflict (level_number) do update
set
  level_name = excluded.level_name,
  minimum_minutes = excluded.minimum_minutes;

create table if not exists public.listening_sessions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  platform public.music_platform not null,
  status public.listening_session_status not null default 'active',
  telemetry_supported boolean not null default false,
  provider_duration_seconds numeric(10,3),
  last_position_seconds numeric(10,3),
  max_position_seconds numeric(10,3) not null default 0,
  verified_seconds integer not null default 0 check (verified_seconds >= 0),
  settled_seconds integer not null default 0 check (settled_seconds >= 0),
  rejected_heartbeats integer not null default 0 check (rejected_heartbeats >= 0),
  loop_count integer not null default 0 check (loop_count >= 0),
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz,
  qualified_at timestamptz,
  review_id uuid unique references public.reviews(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists listening_sessions_one_active_user_idx
  on public.listening_sessions (user_id)
  where status = 'active';
create index if not exists listening_sessions_user_day_idx
  on public.listening_sessions (user_id, qualified_at desc)
  where status = 'qualified';
create index if not exists listening_sessions_song_idx
  on public.listening_sessions (song_id, qualified_at desc)
  where status = 'qualified';

create table if not exists public.listening_reward_claims (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  minutes_spent integer not null check (minutes_spent > 0),
  credits_awarded integer not null default 1 check (credits_awarded > 0),
  exchange_rate_minutes integer not null check (exchange_rate_minutes > 0),
  created_at timestamptz not null default now()
);

create index if not exists listening_reward_claims_user_idx
  on public.listening_reward_claims (user_id, created_at desc);

alter table public.reviews
  add column if not exists listening_session_id uuid unique
    references public.listening_sessions(id) on delete set null,
  add column if not exists listening_seconds integer not null default 0,
  add column if not exists listening_duration_seconds integer,
  add column if not exists listening_completion_percent numeric(5,2);

alter table public.reviews
  drop constraint if exists reviews_listening_seconds_check;
alter table public.reviews
  add constraint reviews_listening_seconds_check check (listening_seconds >= 0);

alter table public.listening_reward_settings enable row level security;
alter table public.listening_levels enable row level security;
alter table public.listening_sessions enable row level security;
alter table public.listening_reward_claims enable row level security;

create or replace function public.start_listening_session(target_song_id uuid)
returns table (
  session_id uuid,
  earning_eligible boolean,
  heartbeat_interval_seconds integer,
  interaction_grace_seconds integer,
  daily_cap_seconds integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_platform public.music_platform;
  settings public.listening_reward_settings%rowtype;
  new_session_id uuid;
  existing_session_id uuid;
  supports_verified_audio boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_active_user() then raise exception 'Active account required'; end if;

  select songs.platform
  into target_platform
  from public.songs
  where songs.id = target_song_id
    and songs.user_id <> auth.uid()
    and songs.is_active
    and songs.removed_at is null;
  if not found then raise exception 'Song is unavailable for listening'; end if;

  select *
  into settings
  from public.listening_reward_settings
  where id = true;

  supports_verified_audio :=
    target_platform in ('youtube', 'youtube_music', 'soundcloud');

  select id
  into existing_session_id
  from public.listening_sessions
  where user_id = auth.uid()
    and song_id = target_song_id
    and status = 'active'
  limit 1;

  if existing_session_id is not null then
    return query
    select
      existing_session_id,
      settings.enabled and supports_verified_audio,
      settings.heartbeat_interval_seconds,
      settings.interaction_grace_seconds,
      settings.daily_cap_minutes * 60;
    return;
  end if;

  if (
    select count(*)
    from public.listening_sessions
    where user_id = auth.uid()
      and created_at >= now() - interval '1 minute'
  ) >= 6 then
    raise exception 'Please wait before starting another listening session';
  end if;

  update public.listening_sessions
  set status = 'abandoned', updated_at = now()
  where user_id = auth.uid()
    and status = 'active';

  insert into public.listening_sessions (
    user_id,
    song_id,
    platform,
    telemetry_supported
  )
  values (
    auth.uid(),
    target_song_id,
    target_platform,
    supports_verified_audio
  )
  returning id into new_session_id;

  return query
  select
    new_session_id,
    settings.enabled and supports_verified_audio,
    settings.heartbeat_interval_seconds,
    settings.interaction_grace_seconds,
    settings.daily_cap_minutes * 60;
end;
$$;

create or replace function public.record_listening_heartbeat(
  target_session_id uuid,
  playback_position_seconds numeric,
  playback_duration_seconds numeric,
  playback_state text,
  playback_muted boolean,
  playback_volume numeric,
  page_visible boolean,
  page_focused boolean,
  interaction_recent boolean
)
returns table (
  accepted boolean,
  seconds_counted integer,
  session_verified_seconds integer,
  daily_seconds_remaining integer,
  warning text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_session public.listening_sessions%rowtype;
  settings public.listening_reward_settings%rowtype;
  elapsed_seconds numeric;
  forward_seconds numeric;
  novel_seconds numeric;
  countable_seconds integer := 0;
  today_settled integer := 0;
  current_daily_remaining integer;
  heartbeat_valid boolean := false;
  warning_message text := '';
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select *
  into current_session
  from public.listening_sessions
  where id = target_session_id
    and user_id = auth.uid()
  for update;
  if not found then raise exception 'Listening session not found'; end if;

  select *
  into settings
  from public.listening_reward_settings
  where id = true;

  select coalesce(sum(settled_seconds), 0)::integer
  into today_settled
  from public.listening_sessions
  where user_id = auth.uid()
    and status = 'qualified'
    and qualified_at >= date_trunc('day', now());

  current_daily_remaining :=
    greatest(
      0,
      settings.daily_cap_minutes * 60 -
        today_settled -
        current_session.verified_seconds
    );

  if current_session.status <> 'active' then
    return query select false, 0, current_session.verified_seconds,
      current_daily_remaining, 'Listening session is no longer active.'::text;
    return;
  end if;

  elapsed_seconds := case
    when current_session.last_heartbeat_at is null then 0
    else extract(epoch from (now() - current_session.last_heartbeat_at))
  end;
  forward_seconds := case
    when current_session.last_position_seconds is null then 0
    else playback_position_seconds - current_session.last_position_seconds
  end;
  novel_seconds :=
    playback_position_seconds - current_session.max_position_seconds;

  if current_session.last_heartbeat_at is null then
    update public.listening_sessions
    set
      provider_duration_seconds = playback_duration_seconds,
      last_position_seconds = playback_position_seconds,
      max_position_seconds = greatest(max_position_seconds, playback_position_seconds),
      last_heartbeat_at = now(),
      updated_at = now()
    where id = target_session_id;

    return query select
      false,
      0,
      current_session.verified_seconds,
      current_daily_remaining,
      ''::text;
    return;
  end if;

  if elapsed_seconds < 5 then
    return query select
      false,
      0,
      current_session.verified_seconds,
      current_daily_remaining,
      'Heartbeat arrived too soon.'::text;
    return;
  end if;

  heartbeat_valid :=
    settings.enabled
    and current_session.telemetry_supported
    and current_daily_remaining > 0
    and playback_state = 'playing'
    and playback_muted is false
    and coalesce(playback_volume, 0) > 0
    and page_visible
    and page_focused
    and interaction_recent
    and playback_position_seconds >= 0
    and playback_duration_seconds between 15 and 7200
    and playback_position_seconds <= playback_duration_seconds + 5
    and elapsed_seconds between greatest(5, settings.heartbeat_interval_seconds - 5)
      and settings.heartbeat_interval_seconds + 20
    and forward_seconds between greatest(1, elapsed_seconds - 6)
      and elapsed_seconds + 6
    and novel_seconds > 0;

  if heartbeat_valid then
    countable_seconds := least(
      floor(elapsed_seconds)::integer,
      floor(forward_seconds)::integer,
      floor(novel_seconds)::integer,
      settings.heartbeat_interval_seconds + 5,
      current_daily_remaining
    );
  elsif current_daily_remaining = 0 then
    warning_message := 'You have reached today''s listening limit.';
  elsif not current_session.telemetry_supported then
    warning_message := 'This provider cannot verify reward-eligible playback.';
  elsif playback_state <> 'playing' then
    warning_message := 'Playback is not active.';
  elsif playback_muted or coalesce(playback_volume, 0) <= 0 then
    warning_message := 'Muted playback does not earn listening time.';
  elsif not page_visible or not page_focused then
    warning_message := 'Keep First Listen visible and active to earn time.';
  elsif not interaction_recent then
    warning_message := 'Interact with the session to continue earning time.';
  elsif novel_seconds <= 0 then
    warning_message := 'Replayed sections do not earn additional listening time.';
  else
    warning_message := 'Playback progress could not be verified.';
  end if;

  update public.listening_sessions
  set
    provider_duration_seconds = playback_duration_seconds,
    last_position_seconds = playback_position_seconds,
    max_position_seconds = greatest(max_position_seconds, playback_position_seconds),
    verified_seconds = verified_seconds + countable_seconds,
    rejected_heartbeats = rejected_heartbeats + case when heartbeat_valid then 0 else 1 end,
    loop_count = loop_count + case when forward_seconds < -3 then 1 else 0 end,
    last_heartbeat_at = now(),
    updated_at = now()
  where id = target_session_id
  returning verified_seconds into current_session.verified_seconds;

  return query
  select
    heartbeat_valid,
    countable_seconds,
    current_session.verified_seconds,
    greatest(0, current_daily_remaining - countable_seconds),
    warning_message;
end;
$$;

create or replace function public.submit_review_with_listening(
  reviewed_song_id uuid,
  review_listen_full boolean,
  review_add_to_playlist boolean,
  review_grabbed_attention boolean,
  review_share_with_friend boolean,
  review_rating smallint,
  review_comment text,
  review_pasted_comment_detected boolean default false,
  listening_session_id uuid default null
)
returns table (
  accepted boolean,
  quality_score smallint,
  credit_granted boolean,
  warning text,
  listening_seconds_banked integer,
  listening_bank_seconds bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_comment text := public.normalize_feedback(review_comment);
  repeated_comment boolean;
  computed_score integer := 100;
  new_quality_score numeric;
  new_review_id uuid;
  session_row public.listening_sessions%rowtype;
  settings public.listening_reward_settings%rowtype;
  today_settled integer := 0;
  seconds_to_settle integer := 0;
  completion numeric(5,2);
  new_bank bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(trim(coalesce(review_comment, ''))) not between 30 and 1000 then
    return query select false, 0::smallint, false,
      'Please provide useful feedback.'::text, 0, null::bigint;
    return;
  end if;
  if review_rating not between 1 and 10 then
    raise exception 'Rating must be between 1 and 10';
  end if;
  if not exists (
    select 1 from public.songs
    where id = reviewed_song_id
      and user_id <> auth.uid()
      and is_active
      and removed_at is null
  ) then
    raise exception 'Song is unavailable for review';
  end if;

  select exists (
    select 1 from public.reviews
    where reviewer_id = auth.uid()
      and public.normalize_feedback(comment) = normalized_comment
  ) into repeated_comment;

  if repeated_comment then computed_score := 20; end if;
  if review_pasted_comment_detected then computed_score := computed_score - 50; end if;
  if array_length(regexp_split_to_array(normalized_comment, '\s+'), 1) < 7 then
    computed_score := computed_score - 25;
  end if;
  computed_score := greatest(0, least(100, computed_score));

  if computed_score < 60 then
    return query select false, computed_score::smallint, false,
      'Please provide useful feedback.'::text, 0, null::bigint;
    return;
  end if;

  if listening_session_id is not null then
    select *
    into session_row
    from public.listening_sessions
    where id = listening_session_id
      and user_id = auth.uid()
      and song_id = reviewed_song_id
      and status = 'active'
    for update;
  end if;

  select *
  into settings
  from public.listening_reward_settings
  where id = true;

  if session_row.id is not null then
    select coalesce(sum(settled_seconds), 0)::integer
    into today_settled
    from public.listening_sessions
    where user_id = auth.uid()
      and status = 'qualified'
      and qualified_at >= date_trunc('day', now());

    seconds_to_settle := least(
      session_row.verified_seconds,
      greatest(0, settings.daily_cap_minutes * 60 - today_settled)
    );
    completion := case
      when coalesce(session_row.provider_duration_seconds, 0) > 0
      then least(
        100,
        round(
          (session_row.max_position_seconds / session_row.provider_duration_seconds) * 100,
          2
        )
      )
      else null
    end;
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
    quality_passed,
    listening_session_id,
    listening_seconds,
    listening_duration_seconds,
    listening_completion_percent
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
    true,
    session_row.id,
    seconds_to_settle,
    case
      when session_row.provider_duration_seconds is null then null
      else round(session_row.provider_duration_seconds)::integer
    end,
    completion
  )
  returning id into new_review_id;

  update public.profiles
  set
    completed_reviews = profiles.completed_reviews + 1,
    listening_bank_seconds =
      profiles.listening_bank_seconds + seconds_to_settle,
    lifetime_listening_seconds =
      profiles.lifetime_listening_seconds + seconds_to_settle,
    updated_at = now()
  where id = auth.uid()
  returning profiles.listening_bank_seconds into new_bank;

  if session_row.id is not null then
    update public.listening_sessions
    set
      status = 'qualified',
      settled_seconds = seconds_to_settle,
      qualified_at = now(),
      review_id = new_review_id,
      updated_at = now()
    where id = session_row.id;
  end if;

  select round(avg(reviews.quality_score)::numeric, 2)
  into new_quality_score
  from public.reviews as reviews
  where reviews.reviewer_id = auth.uid();

  update public.profiles
  set review_quality_score = coalesce(new_quality_score, 100)
  where id = auth.uid();

  return query select
    true,
    computed_score::smallint,
    false,
    case
      when session_row.id is null then
        'Review accepted. No verified listening session was available.'
      when seconds_to_settle = 0 and today_settled >= settings.daily_cap_minutes * 60 then
        'Review accepted. You have reached today''s listening limit.'
      else ''
    end,
    seconds_to_settle,
    new_bank;
end;
$$;

-- Compatibility wrapper. New reviews no longer grant automatic milestone
-- credits; verified minutes must be claimed manually.
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
language sql
security definer
set search_path = pg_catalog, public
as $$
  select
    result.accepted,
    result.quality_score,
    false,
    result.warning
  from public.submit_review_with_listening(
    reviewed_song_id,
    review_listen_full,
    review_add_to_playlist,
    review_grabbed_attention,
    review_share_with_friend,
    review_rating,
    review_comment,
    review_pasted_comment_detected,
    null
  ) as result;
$$;

create or replace function public.get_listening_bank_status()
returns table (
  bank_seconds bigint,
  lifetime_seconds bigint,
  today_seconds integer,
  available_reward_credits integer,
  seconds_to_next_credit integer,
  minutes_per_credit integer,
  daily_cap_minutes integer,
  level_number smallint,
  level_name text,
  rewards_enabled boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with settings as (
    select * from public.listening_reward_settings where id = true
  ),
  profile as (
    select
      profiles.listening_bank_seconds,
      profiles.lifetime_listening_seconds
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.account_status = 'active'
  ),
  today as (
    select coalesce(sum(settled_seconds), 0)::integer as seconds
    from public.listening_sessions
    where user_id = auth.uid()
      and status = 'qualified'
      and qualified_at >= date_trunc('day', now())
  )
  select
    profile.listening_bank_seconds,
    profile.lifetime_listening_seconds,
    today.seconds,
    floor(
      profile.listening_bank_seconds::numeric /
      (settings.minutes_per_credit * 60)
    )::integer,
    case
      when mod(profile.listening_bank_seconds, settings.minutes_per_credit * 60) = 0
        and profile.listening_bank_seconds >= settings.minutes_per_credit * 60
      then 0
      else (
        settings.minutes_per_credit * 60 -
        mod(profile.listening_bank_seconds, settings.minutes_per_credit * 60)
      )::integer
    end,
    settings.minutes_per_credit,
    settings.daily_cap_minutes,
    levels.level_number,
    levels.level_name,
    settings.enabled
  from profile
  cross join settings
  cross join today
  join lateral (
    select listening_levels.level_number, listening_levels.level_name
    from public.listening_levels
    where listening_levels.minimum_minutes <=
      floor(profile.lifetime_listening_seconds / 60)
    order by listening_levels.minimum_minutes desc
    limit 1
  ) levels on true;
$$;

create or replace function public.claim_listening_reward()
returns table (
  credits_awarded integer,
  credits_balance integer,
  bank_seconds bigint,
  available_reward_credits integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  settings public.listening_reward_settings%rowtype;
  exchange_seconds integer;
  updated_credits integer;
  updated_bank bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select *
  into settings
  from public.listening_reward_settings
  where id = true;
  if not settings.enabled then raise exception 'Listening rewards are currently paused'; end if;

  exchange_seconds := settings.minutes_per_credit * 60;

  update public.profiles
  set
    listening_bank_seconds = listening_bank_seconds - exchange_seconds,
    credits = credits + 1,
    listening_reward_credits_earned = listening_reward_credits_earned + 1,
    total_review_credits_earned = total_review_credits_earned + 1,
    updated_at = now()
  where id = auth.uid()
    and account_status = 'active'
    and listening_bank_seconds >= exchange_seconds
  returning profiles.credits, profiles.listening_bank_seconds
  into updated_credits, updated_bank;

  if not found then
    raise exception 'Not enough listening minutes are available';
  end if;

  insert into public.listening_reward_claims (
    user_id,
    minutes_spent,
    credits_awarded,
    exchange_rate_minutes
  )
  values (auth.uid(), settings.minutes_per_credit, 1, settings.minutes_per_credit);

  insert into public.credit_transactions (user_id, amount, reason)
  values (auth.uid(), 1, 'Listening Bank reward');

  return query select
    1,
    updated_credits,
    updated_bank,
    floor(updated_bank::numeric / exchange_seconds)::integer;
end;
$$;

create or replace function public.admin_update_listening_settings(
  new_minutes_per_credit integer,
  new_daily_cap_minutes integer,
  rewards_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_settings public.listening_reward_settings%rowtype;
begin
  if public.current_user_role() <> 'super_admin' then raise exception 'Forbidden'; end if;
  if new_minutes_per_credit not between 30 and 1440
    or new_daily_cap_minutes not between 30 and 1440
  then
    raise exception 'Listening settings are outside allowed limits';
  end if;

  select *
  into previous_settings
  from public.listening_reward_settings
  where id = true
  for update;

  update public.listening_reward_settings
  set
    minutes_per_credit = new_minutes_per_credit,
    daily_cap_minutes = new_daily_cap_minutes,
    enabled = rewards_enabled,
    updated_by = auth.uid(),
    updated_at = now()
  where id = true;

  insert into public.admin_audit_log (
    actor_id,
    action,
    target_type,
    details
  )
  values (
    auth.uid(),
    'update_listening_settings',
    'listening_reward_settings',
    jsonb_build_object(
      'previous_minutes_per_credit', previous_settings.minutes_per_credit,
      'new_minutes_per_credit', new_minutes_per_credit,
      'previous_daily_cap_minutes', previous_settings.daily_cap_minutes,
      'new_daily_cap_minutes', new_daily_cap_minutes,
      'previous_enabled', previous_settings.enabled,
      'new_enabled', rewards_enabled
    )
  );
end;
$$;

create or replace function public.get_my_song_dashboard_with_listening()
returns table (
  song_id uuid,
  title text,
  artist_name text,
  platform public.music_platform,
  submitted_at timestamptz,
  reviews_received integer,
  average_rating numeric,
  hook_score integer,
  report_count integer,
  total_listening_seconds bigint,
  average_listening_seconds numeric,
  completion_rate numeric,
  playlist_intent numeric,
  share_intent numeric,
  listener_retention numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public
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
    coalesce(report_counts.report_count, 0),
    coalesce(metrics.total_listening_seconds, 0),
    coalesce(metrics.average_listening_seconds, 0),
    coalesce(metrics.completion_rate, 0),
    coalesce(metrics.playlist_intent, 0),
    coalesce(metrics.share_intent, 0),
    coalesce(metrics.listener_retention, 0)
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
      ) / 4, 0)::integer as hook_score,
      coalesce(sum(reviews.listening_seconds), 0)::bigint as total_listening_seconds,
      round(
        (
          avg(reviews.listening_seconds)
            filter (where reviews.listening_seconds > 0)
        )::numeric,
        2
      ) as average_listening_seconds,
      round(
        (
          avg(
            case
              when reviews.listening_completion_percent >= 90 then 100
              else 0
            end
          ) filter (
            where reviews.listening_completion_percent is not null
          )
        )::numeric,
        2
      ) as completion_rate,
      round(avg(case when reviews.add_to_playlist then 100 else 0 end)::numeric, 2)
        as playlist_intent,
      round(avg(case when reviews.share_with_friend then 100 else 0 end)::numeric, 2)
        as share_intent,
      round(
        (
          avg(reviews.listening_completion_percent)
            filter (where reviews.listening_completion_percent is not null)
        )::numeric,
        2
      )
        as listener_retention
    from public.reviews
    where reviews.song_id = songs.id
      and reviews.quality_passed
  ) metrics on true
  left join lateral (
    select count(*)::integer as report_count
    from public.song_reports
    where song_reports.song_id = songs.id
  ) report_counts on true
  where songs.user_id = auth.uid()
    and public.is_active_user()
  order by songs.created_at desc;
$$;

create or replace function public.admin_get_statistics()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Forbidden';
  end if;
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'songs', (select count(*) from public.songs),
    'active_songs', (select count(*) from public.songs where is_active and removed_at is null),
    'open_reports', (select count(*) from public.song_reports where status = 'open'),
    'reviews', (select count(*) from public.reviews),
    'listening_minutes', (
      select floor(coalesce(sum(settled_seconds), 0) / 60)
      from public.listening_sessions
      where status = 'qualified'
    )
  );
end;
$$;

create or replace function public.listening_system_health_report()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'tables', jsonb_build_object(
      'listening_reward_settings', to_regclass('public.listening_reward_settings') is not null,
      'listening_levels', to_regclass('public.listening_levels') is not null,
      'listening_sessions', to_regclass('public.listening_sessions') is not null,
      'listening_reward_claims', to_regclass('public.listening_reward_claims') is not null
    ),
    'functions', jsonb_build_object(
      'start_listening_session', to_regprocedure('public.start_listening_session(uuid)') is not null,
      'record_listening_heartbeat', to_regprocedure(
        'public.record_listening_heartbeat(uuid,numeric,numeric,text,boolean,numeric,boolean,boolean,boolean)'
      ) is not null,
      'submit_review_with_listening', to_regprocedure(
        'public.submit_review_with_listening(uuid,boolean,boolean,boolean,boolean,smallint,text,boolean,uuid)'
      ) is not null,
      'get_listening_bank_status', to_regprocedure('public.get_listening_bank_status()') is not null,
      'claim_listening_reward', to_regprocedure('public.claim_listening_reward()') is not null,
      'admin_update_listening_settings', to_regprocedure(
        'public.admin_update_listening_settings(integer,integer,boolean)'
      ) is not null
    ),
    'settings_rows', (select count(*)::integer from public.listening_reward_settings),
    'levels', (select count(*)::integer from public.listening_levels),
    'active_session_duplicates', (
      select count(*)::integer
      from (
        select user_id
        from public.listening_sessions
        where status = 'active'
        group by user_id
        having count(*) > 1
      ) duplicates
    ),
    'orphan_sessions', (
      select count(*)::integer
      from public.listening_sessions
      where not exists (
        select 1 from public.profiles where profiles.id = listening_sessions.user_id
      )
      or not exists (
        select 1 from public.songs where songs.id = listening_sessions.song_id
      )
    ),
    'negative_balances', (
      select count(*)::integer
      from public.profiles
      where listening_bank_seconds < 0
        or lifetime_listening_seconds < 0
    ),
    'qualified_seconds', (
      select coalesce(sum(settled_seconds), 0)::bigint
      from public.listening_sessions
      where status = 'qualified'
    ),
    'claimed_credits', (
      select coalesce(sum(credits_awarded), 0)::bigint
      from public.listening_reward_claims
    )
  );
$$;

drop policy if exists "users read own listening sessions or super admin reads all"
  on public.listening_sessions;
create policy "users read own listening sessions or super admin reads all"
  on public.listening_sessions for select
  to authenticated
  using (
    public.is_active_user()
    and (user_id = auth.uid() or public.current_user_role() = 'super_admin')
  );

drop policy if exists "users read own listening rewards or super admin reads all"
  on public.listening_reward_claims;
create policy "users read own listening rewards or super admin reads all"
  on public.listening_reward_claims for select
  to authenticated
  using (
    public.is_active_user()
    and (user_id = auth.uid() or public.current_user_role() = 'super_admin')
  );

drop policy if exists "authenticated users read listening levels"
  on public.listening_levels;
create policy "authenticated users read listening levels"
  on public.listening_levels for select
  to authenticated
  using (public.is_active_user());

drop policy if exists "authenticated users read listening reward settings"
  on public.listening_reward_settings;
create policy "authenticated users read listening reward settings"
  on public.listening_reward_settings for select
  to authenticated
  using (public.is_active_user());

revoke all on table public.listening_reward_settings from public, anon, authenticated;
revoke all on table public.listening_levels from public, anon, authenticated;
revoke all on table public.listening_sessions from public, anon, authenticated;
revoke all on table public.listening_reward_claims from public, anon, authenticated;

grant select on table public.listening_reward_settings to authenticated;
grant select on table public.listening_levels to authenticated;
grant select on table public.listening_sessions to authenticated;
grant select on table public.listening_reward_claims to authenticated;

revoke all on function public.start_listening_session(uuid)
  from public, anon, authenticated;
revoke all on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) from public, anon, authenticated;
revoke all on function public.submit_review_with_listening(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean, uuid
) from public, anon, authenticated;
revoke all on function public.get_listening_bank_status()
  from public, anon, authenticated;
revoke all on function public.claim_listening_reward()
  from public, anon, authenticated;
revoke all on function public.admin_update_listening_settings(
  integer, integer, boolean
) from public, anon, authenticated;
revoke all on function public.get_my_song_dashboard_with_listening()
  from public, anon, authenticated;
revoke all on function public.listening_system_health_report()
  from public, anon, authenticated;

grant execute on function public.start_listening_session(uuid) to authenticated;
grant execute on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) to authenticated;
grant execute on function public.submit_review_with_listening(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean, uuid
) to authenticated;
grant execute on function public.get_listening_bank_status() to authenticated;
grant execute on function public.claim_listening_reward() to authenticated;
grant execute on function public.admin_update_listening_settings(
  integer, integer, boolean
) to authenticated;
grant execute on function public.get_my_song_dashboard_with_listening()
  to authenticated;
grant execute on function public.listening_system_health_report()
  to service_role;

-- ============================================================
-- 20260609031000_fix_listening_bank_ambiguity.sql
-- ============================================================

-- Qualify profile columns that conflict with RETURNS TABLE output variables.
create or replace function public.submit_review_with_listening(
  reviewed_song_id uuid,
  review_listen_full boolean,
  review_add_to_playlist boolean,
  review_grabbed_attention boolean,
  review_share_with_friend boolean,
  review_rating smallint,
  review_comment text,
  review_pasted_comment_detected boolean default false,
  listening_session_id uuid default null
)
returns table (
  accepted boolean,
  quality_score smallint,
  credit_granted boolean,
  warning text,
  listening_seconds_banked integer,
  listening_bank_seconds bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_comment text := public.normalize_feedback(review_comment);
  repeated_comment boolean;
  computed_score integer := 100;
  new_quality_score numeric;
  new_review_id uuid;
  session_row public.listening_sessions%rowtype;
  settings public.listening_reward_settings%rowtype;
  today_settled integer := 0;
  seconds_to_settle integer := 0;
  completion numeric(5,2);
  new_bank bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(trim(coalesce(review_comment, ''))) not between 30 and 1000 then
    return query select false, 0::smallint, false,
      'Please provide useful feedback.'::text, 0, null::bigint;
    return;
  end if;
  if review_rating not between 1 and 10 then
    raise exception 'Rating must be between 1 and 10';
  end if;
  if not exists (
    select 1 from public.songs
    where id = reviewed_song_id
      and user_id <> auth.uid()
      and is_active
      and removed_at is null
  ) then
    raise exception 'Song is unavailable for review';
  end if;

  select exists (
    select 1 from public.reviews
    where reviewer_id = auth.uid()
      and public.normalize_feedback(comment) = normalized_comment
  ) into repeated_comment;

  if repeated_comment then computed_score := 20; end if;
  if review_pasted_comment_detected then computed_score := computed_score - 50; end if;
  if array_length(regexp_split_to_array(normalized_comment, '\s+'), 1) < 7 then
    computed_score := computed_score - 25;
  end if;
  computed_score := greatest(0, least(100, computed_score));

  if computed_score < 60 then
    return query select false, computed_score::smallint, false,
      'Please provide useful feedback.'::text, 0, null::bigint;
    return;
  end if;

  if listening_session_id is not null then
    select *
    into session_row
    from public.listening_sessions
    where id = listening_session_id
      and user_id = auth.uid()
      and song_id = reviewed_song_id
      and status = 'active'
    for update;
  end if;

  select *
  into settings
  from public.listening_reward_settings
  where id = true;

  if session_row.id is not null then
    select coalesce(sum(settled_seconds), 0)::integer
    into today_settled
    from public.listening_sessions
    where user_id = auth.uid()
      and status = 'qualified'
      and qualified_at >= date_trunc('day', now());

    seconds_to_settle := least(
      session_row.verified_seconds,
      greatest(0, settings.daily_cap_minutes * 60 - today_settled)
    );
    completion := case
      when coalesce(session_row.provider_duration_seconds, 0) > 0
      then least(
        100,
        round(
          (session_row.max_position_seconds / session_row.provider_duration_seconds) * 100,
          2
        )
      )
      else null
    end;
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
    quality_passed,
    listening_session_id,
    listening_seconds,
    listening_duration_seconds,
    listening_completion_percent
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
    true,
    session_row.id,
    seconds_to_settle,
    case
      when session_row.provider_duration_seconds is null then null
      else round(session_row.provider_duration_seconds)::integer
    end,
    completion
  )
  returning id into new_review_id;

  update public.profiles
  set
    completed_reviews = profiles.completed_reviews + 1,
    listening_bank_seconds =
      profiles.listening_bank_seconds + seconds_to_settle,
    lifetime_listening_seconds =
      profiles.lifetime_listening_seconds + seconds_to_settle,
    updated_at = now()
  where id = auth.uid()
  returning profiles.listening_bank_seconds into new_bank;

  if session_row.id is not null then
    update public.listening_sessions
    set
      status = 'qualified',
      settled_seconds = seconds_to_settle,
      qualified_at = now(),
      review_id = new_review_id,
      updated_at = now()
    where id = session_row.id;
  end if;

  select round(avg(reviews.quality_score)::numeric, 2)
  into new_quality_score
  from public.reviews as reviews
  where reviews.reviewer_id = auth.uid();

  update public.profiles
  set review_quality_score = coalesce(new_quality_score, 100)
  where id = auth.uid();

  return query select
    true,
    computed_score::smallint,
    false,
    case
      when session_row.id is null then
        'Review accepted. No verified listening session was available.'
      when seconds_to_settle = 0 and today_settled >= settings.daily_cap_minutes * 60 then
        'Review accepted. You have reached today''s listening limit.'
      else ''
    end,
    seconds_to_settle,
    new_bank;
end;
$$;

revoke all on function public.submit_review_with_listening(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.submit_review_with_listening(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean, uuid
) to authenticated;

-- ============================================================
-- 20260609032000_prevent_looped_listening_rewards.sql
-- ============================================================

-- Count each provider position only once per listening session.
create or replace function public.record_listening_heartbeat(
  target_session_id uuid,
  playback_position_seconds numeric,
  playback_duration_seconds numeric,
  playback_state text,
  playback_muted boolean,
  playback_volume numeric,
  page_visible boolean,
  page_focused boolean,
  interaction_recent boolean
)
returns table (
  accepted boolean,
  seconds_counted integer,
  session_verified_seconds integer,
  daily_seconds_remaining integer,
  warning text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_session public.listening_sessions%rowtype;
  settings public.listening_reward_settings%rowtype;
  elapsed_seconds numeric;
  forward_seconds numeric;
  novel_seconds numeric;
  countable_seconds integer := 0;
  today_settled integer := 0;
  current_daily_remaining integer;
  heartbeat_valid boolean := false;
  warning_message text := '';
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select *
  into current_session
  from public.listening_sessions
  where id = target_session_id
    and user_id = auth.uid()
  for update;
  if not found then raise exception 'Listening session not found'; end if;

  select *
  into settings
  from public.listening_reward_settings
  where id = true;

  select coalesce(sum(settled_seconds), 0)::integer
  into today_settled
  from public.listening_sessions
  where user_id = auth.uid()
    and status = 'qualified'
    and qualified_at >= date_trunc('day', now());

  current_daily_remaining :=
    greatest(
      0,
      settings.daily_cap_minutes * 60 -
        today_settled -
        current_session.verified_seconds
    );

  if current_session.status <> 'active' then
    return query select false, 0, current_session.verified_seconds,
      current_daily_remaining, 'Listening session is no longer active.'::text;
    return;
  end if;

  elapsed_seconds := case
    when current_session.last_heartbeat_at is null then 0
    else extract(epoch from (now() - current_session.last_heartbeat_at))
  end;
  forward_seconds := case
    when current_session.last_position_seconds is null then 0
    else playback_position_seconds - current_session.last_position_seconds
  end;
  novel_seconds :=
    playback_position_seconds - current_session.max_position_seconds;

  if current_session.last_heartbeat_at is null then
    update public.listening_sessions
    set
      provider_duration_seconds = playback_duration_seconds,
      last_position_seconds = playback_position_seconds,
      max_position_seconds = greatest(max_position_seconds, playback_position_seconds),
      last_heartbeat_at = now(),
      updated_at = now()
    where id = target_session_id;

    return query select
      false,
      0,
      current_session.verified_seconds,
      current_daily_remaining,
      ''::text;
    return;
  end if;

  heartbeat_valid :=
    settings.enabled
    and current_session.telemetry_supported
    and current_daily_remaining > 0
    and playback_state = 'playing'
    and playback_muted is false
    and coalesce(playback_volume, 0) > 0
    and page_visible
    and page_focused
    and interaction_recent
    and playback_position_seconds >= 0
    and playback_duration_seconds between 15 and 7200
    and playback_position_seconds <= playback_duration_seconds + 5
    and elapsed_seconds between greatest(5, settings.heartbeat_interval_seconds - 5)
      and settings.heartbeat_interval_seconds + 20
    and forward_seconds between greatest(1, elapsed_seconds - 6)
      and elapsed_seconds + 6
    and novel_seconds > 0;

  if heartbeat_valid then
    countable_seconds := least(
      floor(elapsed_seconds)::integer,
      floor(forward_seconds)::integer,
      floor(novel_seconds)::integer,
      settings.heartbeat_interval_seconds + 5,
      current_daily_remaining
    );
  elsif current_daily_remaining = 0 then
    warning_message := 'You have reached today''s listening limit.';
  elsif not current_session.telemetry_supported then
    warning_message := 'This provider cannot verify reward-eligible playback.';
  elsif playback_state <> 'playing' then
    warning_message := 'Playback is not active.';
  elsif playback_muted or coalesce(playback_volume, 0) <= 0 then
    warning_message := 'Muted playback does not earn listening time.';
  elsif not page_visible or not page_focused then
    warning_message := 'Keep First Listen visible and active to earn time.';
  elsif not interaction_recent then
    warning_message := 'Interact with the session to continue earning time.';
  elsif novel_seconds <= 0 then
    warning_message := 'Replayed sections do not earn additional listening time.';
  else
    warning_message := 'Playback progress could not be verified.';
  end if;

  update public.listening_sessions
  set
    provider_duration_seconds = playback_duration_seconds,
    last_position_seconds = playback_position_seconds,
    max_position_seconds = greatest(max_position_seconds, playback_position_seconds),
    verified_seconds = verified_seconds + countable_seconds,
    rejected_heartbeats = rejected_heartbeats + case when heartbeat_valid then 0 else 1 end,
    loop_count = loop_count + case when forward_seconds < -3 then 1 else 0 end,
    last_heartbeat_at = now(),
    updated_at = now()
  where id = target_session_id
  returning verified_seconds into current_session.verified_seconds;

  return query
  select
    heartbeat_valid,
    countable_seconds,
    current_session.verified_seconds,
    greatest(0, current_daily_remaining - countable_seconds),
    warning_message;
end;
$$;

revoke all on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) to authenticated;

-- ============================================================
-- 20260609033000_fix_daily_listening_cap_progress.sql
-- ============================================================

-- Include the active session's pending time in daily-cap progress.
create or replace function public.record_listening_heartbeat(
  target_session_id uuid,
  playback_position_seconds numeric,
  playback_duration_seconds numeric,
  playback_state text,
  playback_muted boolean,
  playback_volume numeric,
  page_visible boolean,
  page_focused boolean,
  interaction_recent boolean
)
returns table (
  accepted boolean,
  seconds_counted integer,
  session_verified_seconds integer,
  daily_seconds_remaining integer,
  warning text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_session public.listening_sessions%rowtype;
  settings public.listening_reward_settings%rowtype;
  elapsed_seconds numeric;
  forward_seconds numeric;
  novel_seconds numeric;
  countable_seconds integer := 0;
  today_settled integer := 0;
  current_daily_remaining integer;
  heartbeat_valid boolean := false;
  warning_message text := '';
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select *
  into current_session
  from public.listening_sessions
  where id = target_session_id
    and user_id = auth.uid()
  for update;
  if not found then raise exception 'Listening session not found'; end if;

  select *
  into settings
  from public.listening_reward_settings
  where id = true;

  select coalesce(sum(settled_seconds), 0)::integer
  into today_settled
  from public.listening_sessions
  where user_id = auth.uid()
    and status = 'qualified'
    and qualified_at >= date_trunc('day', now());

  current_daily_remaining :=
    greatest(
      0,
      settings.daily_cap_minutes * 60 -
        today_settled -
        current_session.verified_seconds
    );

  if current_session.status <> 'active' then
    return query select false, 0, current_session.verified_seconds,
      current_daily_remaining, 'Listening session is no longer active.'::text;
    return;
  end if;

  elapsed_seconds := case
    when current_session.last_heartbeat_at is null then 0
    else extract(epoch from (now() - current_session.last_heartbeat_at))
  end;
  forward_seconds := case
    when current_session.last_position_seconds is null then 0
    else playback_position_seconds - current_session.last_position_seconds
  end;
  novel_seconds :=
    playback_position_seconds - current_session.max_position_seconds;

  if current_session.last_heartbeat_at is null then
    update public.listening_sessions
    set
      provider_duration_seconds = playback_duration_seconds,
      last_position_seconds = playback_position_seconds,
      max_position_seconds = greatest(max_position_seconds, playback_position_seconds),
      last_heartbeat_at = now(),
      updated_at = now()
    where id = target_session_id;

    return query select
      false,
      0,
      current_session.verified_seconds,
      current_daily_remaining,
      ''::text;
    return;
  end if;

  if elapsed_seconds < 5 then
    return query select
      false,
      0,
      current_session.verified_seconds,
      current_daily_remaining,
      'Heartbeat arrived too soon.'::text;
    return;
  end if;

  heartbeat_valid :=
    settings.enabled
    and current_session.telemetry_supported
    and current_daily_remaining > 0
    and playback_state = 'playing'
    and playback_muted is false
    and coalesce(playback_volume, 0) > 0
    and page_visible
    and page_focused
    and interaction_recent
    and playback_position_seconds >= 0
    and playback_duration_seconds between 15 and 7200
    and playback_position_seconds <= playback_duration_seconds + 5
    and elapsed_seconds between greatest(5, settings.heartbeat_interval_seconds - 5)
      and settings.heartbeat_interval_seconds + 20
    and forward_seconds between greatest(1, elapsed_seconds - 6)
      and elapsed_seconds + 6
    and novel_seconds > 0;

  if heartbeat_valid then
    countable_seconds := least(
      floor(elapsed_seconds)::integer,
      floor(forward_seconds)::integer,
      floor(novel_seconds)::integer,
      settings.heartbeat_interval_seconds + 5,
      current_daily_remaining
    );
  elsif current_daily_remaining = 0 then
    warning_message := 'You have reached today''s listening limit.';
  elsif not current_session.telemetry_supported then
    warning_message := 'This provider cannot verify reward-eligible playback.';
  elsif playback_state <> 'playing' then
    warning_message := 'Playback is not active.';
  elsif playback_muted or coalesce(playback_volume, 0) <= 0 then
    warning_message := 'Muted playback does not earn listening time.';
  elsif not page_visible or not page_focused then
    warning_message := 'Keep First Listen visible and active to earn time.';
  elsif not interaction_recent then
    warning_message := 'Interact with the session to continue earning time.';
  elsif novel_seconds <= 0 then
    warning_message := 'Replayed sections do not earn additional listening time.';
  else
    warning_message := 'Playback progress could not be verified.';
  end if;

  update public.listening_sessions
  set
    provider_duration_seconds = playback_duration_seconds,
    last_position_seconds = playback_position_seconds,
    max_position_seconds = greatest(max_position_seconds, playback_position_seconds),
    verified_seconds = verified_seconds + countable_seconds,
    rejected_heartbeats = rejected_heartbeats + case when heartbeat_valid then 0 else 1 end,
    loop_count = loop_count + case when forward_seconds < -3 then 1 else 0 end,
    last_heartbeat_at = now(),
    updated_at = now()
  where id = target_session_id
  returning verified_seconds into current_session.verified_seconds;

  return query
  select
    heartbeat_valid,
    countable_seconds,
    current_session.verified_seconds,
    greatest(0, current_daily_remaining - countable_seconds),
    warning_message;
end;
$$;

revoke all on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) to authenticated;

-- ============================================================
-- 20260609034000_listening_rpc_rate_limits.sql
-- ============================================================

-- Rate-limit listening writes and report artist metrics from verified sessions.
create or replace function public.start_listening_session(target_song_id uuid)
returns table (
  session_id uuid,
  earning_eligible boolean,
  heartbeat_interval_seconds integer,
  interaction_grace_seconds integer,
  daily_cap_seconds integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_platform public.music_platform;
  settings public.listening_reward_settings%rowtype;
  new_session_id uuid;
  existing_session_id uuid;
  supports_verified_audio boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_active_user() then raise exception 'Active account required'; end if;

  select songs.platform
  into target_platform
  from public.songs
  where songs.id = target_song_id
    and songs.user_id <> auth.uid()
    and songs.is_active
    and songs.removed_at is null
    and not exists (
      select 1
      from public.reviews
      where reviews.song_id = songs.id
        and reviews.reviewer_id = auth.uid()
    );
  if not found then raise exception 'Song is unavailable for listening'; end if;

  select *
  into settings
  from public.listening_reward_settings
  where id = true;

  supports_verified_audio :=
    target_platform in ('youtube', 'youtube_music', 'soundcloud');

  select id
  into existing_session_id
  from public.listening_sessions
  where user_id = auth.uid()
    and song_id = target_song_id
    and status = 'active'
  limit 1;

  if existing_session_id is not null then
    return query
    select
      existing_session_id,
      settings.enabled and supports_verified_audio,
      settings.heartbeat_interval_seconds,
      settings.interaction_grace_seconds,
      settings.daily_cap_minutes * 60;
    return;
  end if;

  if (
    select count(*)
    from public.listening_sessions
    where user_id = auth.uid()
      and created_at >= now() - interval '1 minute'
  ) >= 6 then
    raise exception 'Please wait before starting another listening session';
  end if;

  update public.listening_sessions
  set status = 'abandoned', updated_at = now()
  where user_id = auth.uid()
    and status = 'active';

  insert into public.listening_sessions (
    user_id,
    song_id,
    platform,
    telemetry_supported
  )
  values (
    auth.uid(),
    target_song_id,
    target_platform,
    supports_verified_audio
  )
  returning id into new_session_id;

  return query
  select
    new_session_id,
    settings.enabled and supports_verified_audio,
    settings.heartbeat_interval_seconds,
    settings.interaction_grace_seconds,
    settings.daily_cap_minutes * 60;
end;
$$;

create or replace function public.record_listening_heartbeat(
  target_session_id uuid,
  playback_position_seconds numeric,
  playback_duration_seconds numeric,
  playback_state text,
  playback_muted boolean,
  playback_volume numeric,
  page_visible boolean,
  page_focused boolean,
  interaction_recent boolean
)
returns table (
  accepted boolean,
  seconds_counted integer,
  session_verified_seconds integer,
  daily_seconds_remaining integer,
  warning text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_session public.listening_sessions%rowtype;
  settings public.listening_reward_settings%rowtype;
  elapsed_seconds numeric;
  forward_seconds numeric;
  novel_seconds numeric;
  countable_seconds integer := 0;
  today_settled integer := 0;
  current_daily_remaining integer;
  heartbeat_valid boolean := false;
  warning_message text := '';
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select *
  into current_session
  from public.listening_sessions
  where id = target_session_id
    and user_id = auth.uid()
  for update;
  if not found then raise exception 'Listening session not found'; end if;

  select *
  into settings
  from public.listening_reward_settings
  where id = true;

  select coalesce(sum(settled_seconds), 0)::integer
  into today_settled
  from public.listening_sessions
  where user_id = auth.uid()
    and status = 'qualified'
    and qualified_at >= date_trunc('day', now());

  current_daily_remaining :=
    greatest(
      0,
      settings.daily_cap_minutes * 60 -
        today_settled -
        current_session.verified_seconds
    );

  if current_session.status <> 'active' then
    return query select false, 0, current_session.verified_seconds,
      current_daily_remaining, 'Listening session is no longer active.'::text;
    return;
  end if;

  elapsed_seconds := case
    when current_session.last_heartbeat_at is null then 0
    else extract(epoch from (now() - current_session.last_heartbeat_at))
  end;
  forward_seconds := case
    when current_session.last_position_seconds is null then 0
    else playback_position_seconds - current_session.last_position_seconds
  end;
  novel_seconds :=
    playback_position_seconds - current_session.max_position_seconds;

  if current_session.last_heartbeat_at is null then
    update public.listening_sessions
    set
      provider_duration_seconds = playback_duration_seconds,
      last_position_seconds = playback_position_seconds,
      max_position_seconds = greatest(max_position_seconds, playback_position_seconds),
      last_heartbeat_at = now(),
      updated_at = now()
    where id = target_session_id;

    return query select
      false,
      0,
      current_session.verified_seconds,
      current_daily_remaining,
      ''::text;
    return;
  end if;

  if elapsed_seconds < 5 then
    return query select
      false,
      0,
      current_session.verified_seconds,
      current_daily_remaining,
      'Heartbeat arrived too soon.'::text;
    return;
  end if;

  heartbeat_valid :=
    settings.enabled
    and current_session.telemetry_supported
    and current_daily_remaining > 0
    and playback_state = 'playing'
    and playback_muted is false
    and coalesce(playback_volume, 0) > 0
    and page_visible
    and page_focused
    and interaction_recent
    and playback_position_seconds >= 0
    and playback_duration_seconds between 15 and 7200
    and playback_position_seconds <= playback_duration_seconds + 5
    and elapsed_seconds between greatest(5, settings.heartbeat_interval_seconds - 5)
      and settings.heartbeat_interval_seconds + 20
    and forward_seconds between greatest(1, elapsed_seconds - 6)
      and elapsed_seconds + 6
    and novel_seconds > 0;

  if heartbeat_valid then
    countable_seconds := least(
      floor(elapsed_seconds)::integer,
      floor(forward_seconds)::integer,
      floor(novel_seconds)::integer,
      settings.heartbeat_interval_seconds + 5,
      current_daily_remaining
    );
  elsif current_daily_remaining = 0 then
    warning_message := 'You have reached today''s listening limit.';
  elsif not current_session.telemetry_supported then
    warning_message := 'This provider cannot verify reward-eligible playback.';
  elsif playback_state <> 'playing' then
    warning_message := 'Playback is not active.';
  elsif playback_muted or coalesce(playback_volume, 0) <= 0 then
    warning_message := 'Muted playback does not earn listening time.';
  elsif not page_visible or not page_focused then
    warning_message := 'Keep First Listen visible and active to earn time.';
  elsif not interaction_recent then
    warning_message := 'Interact with the session to continue earning time.';
  elsif novel_seconds <= 0 then
    warning_message := 'Replayed sections do not earn additional listening time.';
  else
    warning_message := 'Playback progress could not be verified.';
  end if;

  update public.listening_sessions
  set
    provider_duration_seconds = playback_duration_seconds,
    last_position_seconds = playback_position_seconds,
    max_position_seconds = greatest(max_position_seconds, playback_position_seconds),
    verified_seconds = verified_seconds + countable_seconds,
    rejected_heartbeats = rejected_heartbeats + case when heartbeat_valid then 0 else 1 end,
    loop_count = loop_count + case when forward_seconds < -3 then 1 else 0 end,
    last_heartbeat_at = now(),
    updated_at = now()
  where id = target_session_id
  returning verified_seconds into current_session.verified_seconds;

  return query
  select
    heartbeat_valid,
    countable_seconds,
    current_session.verified_seconds,
    greatest(0, current_daily_remaining - countable_seconds),
    warning_message;
end;
$$;

create or replace function public.get_my_song_dashboard_with_listening()
returns table (
  song_id uuid,
  title text,
  artist_name text,
  platform public.music_platform,
  submitted_at timestamptz,
  reviews_received integer,
  average_rating numeric,
  hook_score integer,
  report_count integer,
  total_listening_seconds bigint,
  average_listening_seconds numeric,
  completion_rate numeric,
  playlist_intent numeric,
  share_intent numeric,
  listener_retention numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public
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
    coalesce(report_counts.report_count, 0),
    coalesce(metrics.total_listening_seconds, 0),
    coalesce(metrics.average_listening_seconds, 0),
    coalesce(metrics.completion_rate, 0),
    coalesce(metrics.playlist_intent, 0),
    coalesce(metrics.share_intent, 0),
    coalesce(metrics.listener_retention, 0)
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
      ) / 4, 0)::integer as hook_score,
      coalesce(sum(reviews.listening_seconds), 0)::bigint as total_listening_seconds,
      round(
        (
          avg(reviews.listening_seconds)
            filter (where reviews.listening_seconds > 0)
        )::numeric,
        2
      ) as average_listening_seconds,
      round(
        (
          avg(
            case
              when reviews.listening_completion_percent >= 90 then 100
              else 0
            end
          ) filter (
            where reviews.listening_completion_percent is not null
          )
        )::numeric,
        2
      ) as completion_rate,
      round(avg(case when reviews.add_to_playlist then 100 else 0 end)::numeric, 2)
        as playlist_intent,
      round(avg(case when reviews.share_with_friend then 100 else 0 end)::numeric, 2)
        as share_intent,
      round(
        (
          avg(reviews.listening_completion_percent)
            filter (where reviews.listening_completion_percent is not null)
        )::numeric,
        2
      ) as listener_retention
    from public.reviews
    where reviews.song_id = songs.id
      and reviews.quality_passed
  ) metrics on true
  left join lateral (
    select count(*)::integer as report_count
    from public.song_reports
    where song_reports.song_id = songs.id
  ) report_counts on true
  where songs.user_id = auth.uid()
    and public.is_active_user()
  order by songs.created_at desc;
$$;

revoke all on function public.start_listening_session(uuid)
  from public, anon, authenticated;
revoke all on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) from public, anon, authenticated;
revoke all on function public.get_my_song_dashboard_with_listening()
  from public, anon, authenticated;

grant execute on function public.start_listening_session(uuid) to authenticated;
grant execute on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) to authenticated;
grant execute on function public.get_my_song_dashboard_with_listening()
  to authenticated;

-- ============================================================
-- 20260609040000_discovery_community_foundation.sql
-- ============================================================

-- Discovery and community foundation.
-- Spotlight is editorial. Top 10 is calculated from organic listening and review
-- metrics only and intentionally has no administrative override.

do $$
begin
  create type public.spotlight_placement_kind as enum (
    'sponsored',
    'new_release',
    'founder_artist',
    'contest_winner',
    'special_event',
    'editor_pick'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.song_boost_status as enum (
    'pending',
    'approved',
    'rejected',
    'completed',
    'cancelled'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.community_program_status as enum (
    'draft',
    'active',
    'completed',
    'cancelled'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.mission_reward_kind as enum (
    'listening_minutes',
    'credit'
  );
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.discovery_settings (
  id boolean primary key default true check (id),
  boost_credit_cost integer not null default 1
    check (boost_credit_cost between 1 and 100),
  boost_duration_days integer not null default 7
    check (boost_duration_days between 1 and 90),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

insert into public.discovery_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.contests (
  id uuid primary key default uuid_generate_v4(),
  title text not null check (char_length(trim(title)) between 3 and 120),
  description text not null default ''
    check (char_length(description) <= 1000),
  genre text,
  status public.community_program_status not null default 'draft',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reward_description text not null default ''
    check (char_length(reward_description) <= 500),
  winner_song_id uuid references public.songs(id) on delete set null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.contest_entries (
  contest_id uuid not null references public.contests(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  entered_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contest_id, song_id)
);

create table if not exists public.special_events (
  id uuid primary key default uuid_generate_v4(),
  title text not null check (char_length(trim(title)) between 3 and 120),
  description text not null default ''
    check (char_length(description) <= 1000),
  status public.community_program_status not null default 'draft',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.spotlight_slots (
  slot_number smallint primary key check (slot_number in (1, 2)),
  song_id uuid unique references public.songs(id) on delete set null,
  placement_kind public.spotlight_placement_kind not null default 'editor_pick',
  custom_label text not null default ''
    check (char_length(custom_label) <= 80),
  contest_id uuid references public.contests(id) on delete set null,
  event_id uuid references public.special_events(id) on delete set null,
  active_from timestamptz,
  active_until timestamptz,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  check (
    active_from is null
    or active_until is null
    or active_until > active_from
  )
);

insert into public.spotlight_slots (slot_number)
values (1), (2)
on conflict (slot_number) do nothing;

with featured_candidates as (
  select
    songs.id,
    row_number() over (order by songs.updated_at desc, songs.created_at desc) as slot_number
  from public.songs
  where songs.featured
    and songs.is_active
    and songs.removed_at is null
  limit 2
)
update public.spotlight_slots
set
  song_id = featured_candidates.id,
  placement_kind = 'editor_pick',
  custom_label = 'Featured',
  updated_at = now()
from featured_candidates
where spotlight_slots.slot_number = featured_candidates.slot_number
  and spotlight_slots.song_id is null;

update public.songs
set featured = exists (
  select 1
  from public.spotlight_slots
  where spotlight_slots.song_id = songs.id
);

create table if not exists public.daily_missions (
  id uuid primary key default uuid_generate_v4(),
  mission_key text not null unique
    check (char_length(mission_key) between 3 and 80),
  title_en text not null,
  title_es text not null,
  description_en text not null,
  description_es text not null,
  target_count integer not null check (target_count between 1 and 100),
  reward_kind public.mission_reward_kind not null,
  reward_amount integer not null check (reward_amount between 1 and 1000),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or ends_at > starts_at)
);

insert into public.daily_missions (
  mission_key,
  title_en,
  title_es,
  description_en,
  description_es,
  target_count,
  reward_kind,
  reward_amount
)
values (
  'review_spotlight_songs',
  'Listen to 2 Spotlight songs',
  'Escucha 2 canciones Spotlight',
  'Complete useful reviews for two Spotlight songs today.',
  'Completa reviews utiles para dos canciones Spotlight hoy.',
  2,
  'listening_minutes',
  15
)
on conflict (mission_key) do nothing;

create table if not exists public.daily_mission_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  mission_id uuid not null references public.daily_missions(id) on delete cascade,
  mission_date date not null default current_date,
  progress_count integer not null default 0 check (progress_count >= 0),
  completed_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, mission_id, mission_date)
);

create table if not exists public.song_boosts (
  id uuid primary key default uuid_generate_v4(),
  song_id uuid not null references public.songs(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  credit_cost integer not null check (credit_cost > 0),
  status public.song_boost_status not null default 'pending',
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or ends_at > starts_at)
);

create unique index if not exists song_boosts_one_open_request_idx
  on public.song_boosts (song_id)
  where status in ('pending', 'approved');
create index if not exists song_boosts_status_idx
  on public.song_boosts (status, requested_at desc);
create index if not exists contest_entries_user_idx
  on public.contest_entries (entered_by, created_at desc);
create index if not exists community_contests_status_idx
  on public.contests (status, starts_at, ends_at);
create index if not exists community_events_status_idx
  on public.special_events (status, starts_at, ends_at);
create index if not exists mission_progress_user_day_idx
  on public.daily_mission_progress (user_id, mission_date desc);

alter table public.discovery_settings enable row level security;
alter table public.contests enable row level security;
alter table public.contest_entries enable row level security;
alter table public.special_events enable row level security;
alter table public.spotlight_slots enable row level security;
alter table public.daily_missions enable row level security;
alter table public.daily_mission_progress enable row level security;
alter table public.song_boosts enable row level security;

drop policy if exists "authenticated users read discovery settings"
  on public.discovery_settings;
create policy "authenticated users read discovery settings"
  on public.discovery_settings for select
  to authenticated
  using (public.is_active_user());

drop policy if exists "authenticated users read community contests"
  on public.contests;
create policy "authenticated users read community contests"
  on public.contests for select
  to authenticated
  using (
    public.is_active_user()
    and (
      status = 'active'
      or public.current_user_role() in ('super_admin', 'admin')
    )
  );

drop policy if exists "users read contest entries or staff reads all"
  on public.contest_entries;
create policy "users read contest entries or staff reads all"
  on public.contest_entries for select
  to authenticated
  using (
    public.is_active_user()
    and (
      entered_by = auth.uid()
      or public.current_user_role() in ('super_admin', 'admin')
    )
  );

drop policy if exists "authenticated users read special events"
  on public.special_events;
create policy "authenticated users read special events"
  on public.special_events for select
  to authenticated
  using (
    public.is_active_user()
    and (
      status = 'active'
      or public.current_user_role() in ('super_admin', 'admin')
    )
  );

drop policy if exists "authenticated users read spotlight slots"
  on public.spotlight_slots;
create policy "authenticated users read spotlight slots"
  on public.spotlight_slots for select
  to authenticated
  using (public.is_active_user());

drop policy if exists "authenticated users read active daily missions"
  on public.daily_missions;
create policy "authenticated users read active daily missions"
  on public.daily_missions for select
  to authenticated
  using (
    public.is_active_user()
    and (
      active
      or public.current_user_role() in ('super_admin', 'admin')
    )
  );

drop policy if exists "users read own mission progress"
  on public.daily_mission_progress;
create policy "users read own mission progress"
  on public.daily_mission_progress for select
  to authenticated
  using (
    public.is_active_user()
    and (
      user_id = auth.uid()
      or public.current_user_role() = 'super_admin'
    )
  );

drop policy if exists "users read own boosts or staff reads all"
  on public.song_boosts;
create policy "users read own boosts or staff reads all"
  on public.song_boosts for select
  to authenticated
  using (
    public.is_active_user()
    and (
      requested_by = auth.uid()
      or public.current_user_role() in ('super_admin', 'admin')
    )
  );

revoke all on table public.discovery_settings from public, anon, authenticated;
revoke all on table public.contests from public, anon, authenticated;
revoke all on table public.contest_entries from public, anon, authenticated;
revoke all on table public.special_events from public, anon, authenticated;
revoke all on table public.spotlight_slots from public, anon, authenticated;
revoke all on table public.daily_missions from public, anon, authenticated;
revoke all on table public.daily_mission_progress from public, anon, authenticated;
revoke all on table public.song_boosts from public, anon, authenticated;

grant select on table public.discovery_settings to authenticated;
grant select on table public.contests to authenticated;
grant select on table public.contest_entries to authenticated;
grant select on table public.special_events to authenticated;
grant select on table public.spotlight_slots to authenticated;
grant select on table public.daily_missions to authenticated;
grant select on table public.daily_mission_progress to authenticated;
grant select on table public.song_boosts to authenticated;

create or replace function public.get_listening_bank_status_v2()
returns table (
  bank_seconds bigint,
  pending_seconds bigint,
  lifetime_seconds bigint,
  today_seconds integer,
  available_reward_credits integer,
  seconds_to_next_credit integer,
  minutes_per_credit integer,
  daily_cap_minutes integer,
  level_number smallint,
  level_name text,
  rewards_enabled boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with settings as (
    select *
    from public.listening_reward_settings
    where id = true
  ),
  profile as (
    select
      profiles.listening_bank_seconds,
      profiles.lifetime_listening_seconds
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.account_status = 'active'
  ),
  pending as (
    select coalesce(sum(listening_sessions.verified_seconds), 0)::bigint as seconds
    from public.listening_sessions
    where listening_sessions.user_id = auth.uid()
      and listening_sessions.status = 'active'
  ),
  today as (
    select coalesce(sum(listening_sessions.settled_seconds), 0)::integer as seconds
    from public.listening_sessions
    where listening_sessions.user_id = auth.uid()
      and listening_sessions.status = 'qualified'
      and listening_sessions.qualified_at >= date_trunc('day', now())
  )
  select
    profile.listening_bank_seconds,
    pending.seconds,
    profile.lifetime_listening_seconds,
    today.seconds,
    floor(
      profile.listening_bank_seconds::numeric /
      (settings.minutes_per_credit * 60)
    )::integer,
    case
      when mod(profile.listening_bank_seconds, settings.minutes_per_credit * 60) = 0
        and profile.listening_bank_seconds >= settings.minutes_per_credit * 60
      then 0
      else (
        settings.minutes_per_credit * 60 -
        mod(profile.listening_bank_seconds, settings.minutes_per_credit * 60)
      )::integer
    end,
    settings.minutes_per_credit,
    settings.daily_cap_minutes,
    levels.level_number,
    levels.level_name,
    settings.enabled
  from profile
  cross join settings
  cross join pending
  cross join today
  join lateral (
    select listening_levels.level_number, listening_levels.level_name
    from public.listening_levels
    where listening_levels.minimum_minutes <=
      floor(profile.lifetime_listening_seconds / 60)
    order by listening_levels.minimum_minutes desc
    limit 1
  ) levels on true;
$$;

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
  completion_rate numeric
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
    coalesce(metrics.completion_rate, 0)
  from public.spotlight_slots as slots
  join public.songs on songs.id = slots.song_id
  left join lateral (
    select
      count(*)::integer as reviews_received,
      round(avg(reviews.rating)::numeric, 2) as average_rating,
      round((
        avg(case when reviews.listen_full then 100 else 0 end) +
        avg(case when reviews.add_to_playlist then 100 else 0 end) +
        avg(case when reviews.grabbed_attention then 100 else 0 end) +
        avg(case when reviews.share_with_friend then 100 else 0 end)
      ) / 4, 0)::integer as hook_score,
      coalesce(sum(reviews.listening_seconds), 0)::bigint
        as total_listening_seconds,
      round(
        (
          avg(
            case
              when reviews.listening_completion_percent >= 90 then 100
              else 0
            end
          ) filter (
            where reviews.listening_completion_percent is not null
          )
        )::numeric,
        2
      ) as completion_rate
    from public.reviews
    where reviews.song_id = songs.id
      and reviews.quality_passed
  ) metrics on true
  where public.is_active_user()
    and songs.is_active
    and songs.removed_at is null
    and (slots.active_from is null or slots.active_from <= now())
    and (slots.active_until is null or slots.active_until > now())
    and (
      not songs.explicit_content
      or coalesce(
        (
          select profiles.show_explicit_content
          from public.profiles
          where profiles.id = auth.uid()
        ),
        false
      )
    )
  order by slots.slot_number;
$$;

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
  completion_rate numeric
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
      coalesce(
        round(
          (
            avg(
              case
                when reviews.listening_completion_percent >= 90 then 100
                else 0
              end
            ) filter (
              where reviews.listening_completion_percent is not null
            )
          )::numeric,
          2
        ),
        0
      ) as completion_rate,
      coalesce(
        round(
          (
            avg(reviews.listening_completion_percent)
              filter (where reviews.listening_completion_percent is not null)
          )::numeric,
          2
        ),
        0
      ) as listener_retention
    from public.songs
    join public.reviews
      on reviews.song_id = songs.id
      and reviews.quality_passed
    where songs.is_active
      and songs.removed_at is null
      and (
        not songs.explicit_content
        or coalesce(
          (
            select profiles.show_explicit_content
            from public.profiles
            where profiles.id = auth.uid()
          ),
          false
        )
      )
    group by songs.id
  ),
  ranked as (
    select
      organic_metrics.*,
      round(
        (
          organic_metrics.hook_score * 0.45 +
          organic_metrics.average_rating * 10 * 0.25 +
          organic_metrics.completion_rate * 0.15 +
          organic_metrics.listener_retention * 0.10 +
          least(100, organic_metrics.reviews_received * 5) * 0.05
        )::numeric,
        2
      ) as organic_score
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
    ranked.completion_rate
  from ranked
  where public.is_active_user()
  order by
    ranked.organic_score desc,
    ranked.reviews_received desc,
    ranked.total_listening_seconds desc,
    ranked.song_id
  limit 10;
$$;

create or replace function public.get_daily_mission_status()
returns table (
  mission_id uuid,
  mission_key text,
  title_en text,
  title_es text,
  description_en text,
  description_es text,
  target_count integer,
  progress_count integer,
  reward_kind public.mission_reward_kind,
  reward_amount integer,
  completed boolean,
  claimed boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    missions.id,
    missions.mission_key,
    missions.title_en,
    missions.title_es,
    missions.description_en,
    missions.description_es,
    missions.target_count,
    least(
      missions.target_count,
      coalesce(progress.progress_count, 0)
    )::integer,
    missions.reward_kind,
    missions.reward_amount,
    coalesce(progress.progress_count, 0) >= missions.target_count,
    progress.claimed_at is not null
  from public.daily_missions as missions
  left join public.daily_mission_progress as progress
    on progress.mission_id = missions.id
    and progress.user_id = auth.uid()
    and progress.mission_date = current_date
  where public.is_active_user()
    and missions.active
    and (missions.starts_at is null or missions.starts_at <= now())
    and (missions.ends_at is null or missions.ends_at > now())
  order by missions.created_at
  limit 1;
$$;

create or replace function public.claim_daily_mission_reward(
  target_mission_id uuid
)
returns table (
  reward_kind public.mission_reward_kind,
  reward_amount integer,
  bank_seconds bigint,
  credits_balance integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  mission public.daily_missions%rowtype;
  progress public.daily_mission_progress%rowtype;
  next_bank bigint;
  next_credits integer;
begin
  if not public.is_active_user() then
    raise exception 'Active account required';
  end if;

  select *
  into mission
  from public.daily_missions
  where id = target_mission_id
    and active
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now());
  if not found then raise exception 'Mission is unavailable'; end if;

  select *
  into progress
  from public.daily_mission_progress
  where user_id = auth.uid()
    and mission_id = target_mission_id
    and mission_date = current_date
  for update;
  if not found or progress.progress_count < mission.target_count then
    raise exception 'Mission is not complete';
  end if;
  if progress.claimed_at is not null then
    raise exception 'Mission reward has already been claimed';
  end if;

  if mission.reward_kind = 'listening_minutes' then
    update public.profiles
    set
      listening_bank_seconds =
        profiles.listening_bank_seconds + mission.reward_amount * 60,
      updated_at = now()
    where id = auth.uid()
    returning profiles.listening_bank_seconds, profiles.credits
    into next_bank, next_credits;
  else
    update public.profiles
    set
      credits = profiles.credits + mission.reward_amount,
      total_review_credits_earned =
        profiles.total_review_credits_earned + mission.reward_amount,
      updated_at = now()
    where id = auth.uid()
    returning profiles.listening_bank_seconds, profiles.credits
    into next_bank, next_credits;

    insert into public.credit_transactions (user_id, amount, reason)
    values (
      auth.uid(),
      mission.reward_amount,
      'Daily mission reward'
    );
  end if;

  update public.daily_mission_progress
  set claimed_at = now(), updated_at = now()
  where user_id = auth.uid()
    and mission_id = target_mission_id
    and mission_date = current_date;

  return query
  select mission.reward_kind, mission.reward_amount, next_bank, next_credits;
end;
$$;

create or replace function public.advance_spotlight_daily_mission()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not new.quality_passed or not exists (
    select 1
    from public.spotlight_slots
    where spotlight_slots.song_id = new.song_id
      and (
        spotlight_slots.active_from is null
        or spotlight_slots.active_from <= now()
      )
      and (
        spotlight_slots.active_until is null
        or spotlight_slots.active_until > now()
      )
  ) then
    return new;
  end if;

  insert into public.daily_mission_progress (
    user_id,
    mission_id,
    mission_date,
    progress_count,
    completed_at,
    updated_at
  )
  select
    new.reviewer_id,
    missions.id,
    current_date,
    1,
    case when missions.target_count <= 1 then now() end,
    now()
  from public.daily_missions as missions
  where missions.mission_key = 'review_spotlight_songs'
    and missions.active
    and (missions.starts_at is null or missions.starts_at <= now())
    and (missions.ends_at is null or missions.ends_at > now())
  on conflict (user_id, mission_id, mission_date)
  do update set
    progress_count = least(
      (
        select daily_missions.target_count
        from public.daily_missions
        where daily_missions.id = excluded.mission_id
      ),
      daily_mission_progress.progress_count + 1
    ),
    completed_at = case
      when daily_mission_progress.progress_count + 1 >= (
        select daily_missions.target_count
        from public.daily_missions
        where daily_missions.id = excluded.mission_id
      )
      then coalesce(daily_mission_progress.completed_at, now())
      else daily_mission_progress.completed_at
    end,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists reviews_advance_spotlight_daily_mission
  on public.reviews;
create trigger reviews_advance_spotlight_daily_mission
after insert on public.reviews
for each row
execute function public.advance_spotlight_daily_mission();

create or replace function public.request_song_boost(target_song_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_boost_id uuid;
  boost_cost integer;
begin
  if not public.is_active_user() then
    raise exception 'Active account required';
  end if;
  if not exists (
    select 1
    from public.songs
    where songs.id = target_song_id
      and songs.user_id = auth.uid()
      and songs.is_active
      and songs.removed_at is null
  ) then
    raise exception 'Only an active song owner can request a boost';
  end if;

  select discovery_settings.boost_credit_cost
  into boost_cost
  from public.discovery_settings
  where id = true;

  insert into public.song_boosts (
    song_id,
    requested_by,
    credit_cost
  )
  values (
    target_song_id,
    auth.uid(),
    boost_cost
  )
  returning id into new_boost_id;

  return new_boost_id;
exception
  when unique_violation then
    raise exception 'This song already has a pending or active boost';
end;
$$;

create or replace function public.admin_review_song_boost(
  target_boost_id uuid,
  approve boolean,
  note text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  boost public.song_boosts%rowtype;
  settings public.discovery_settings%rowtype;
  requester_role public.app_role;
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Forbidden';
  end if;

  select *
  into boost
  from public.song_boosts
  where id = target_boost_id
  for update;
  if not found then raise exception 'Boost request not found'; end if;
  if boost.status <> 'pending' then
    raise exception 'Boost request has already been reviewed';
  end if;

  select *
  into settings
  from public.discovery_settings
  where id = true;

  if approve then
    select role
    into requester_role
    from public.profiles
    where id = boost.requested_by
      and account_status = 'active'
    for update;
    if not found then raise exception 'Requesting account is unavailable'; end if;

    if requester_role <> 'super_admin' then
      update public.profiles
      set credits = credits - boost.credit_cost, updated_at = now()
      where id = boost.requested_by
        and credits >= boost.credit_cost;
      if not found then raise exception 'Artist no longer has enough credits'; end if;

      insert into public.credit_transactions (
        user_id,
        amount,
        reason,
        created_by
      )
      values (
        boost.requested_by,
        -boost.credit_cost,
        'Approved song boost',
        auth.uid()
      );
    end if;

    update public.song_boosts
    set
      status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      starts_at = now(),
      ends_at = now() + make_interval(days => settings.boost_duration_days),
      review_note = nullif(trim(coalesce(note, '')), ''),
      updated_at = now()
    where id = target_boost_id;
  else
    update public.song_boosts
    set
      status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(trim(coalesce(note, '')), ''),
      updated_at = now()
    where id = target_boost_id;
  end if;
end;
$$;

create or replace function public.admin_set_spotlight_slot(
  target_slot smallint,
  target_song_id uuid,
  placement public.spotlight_placement_kind,
  label text default '',
  starts_at timestamptz default null,
  ends_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_song_id uuid;
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Forbidden';
  end if;
  if target_slot not in (1, 2) then
    raise exception 'Spotlight slot must be 1 or 2';
  end if;
  if char_length(coalesce(label, '')) > 80 then
    raise exception 'Spotlight label is too long';
  end if;
  if starts_at is not null and ends_at is not null and ends_at <= starts_at then
    raise exception 'Spotlight end time must be after its start time';
  end if;
  if target_song_id is not null and not exists (
    select 1
    from public.songs
    where songs.id = target_song_id
      and songs.is_active
      and songs.removed_at is null
  ) then
    raise exception 'Spotlight song is unavailable';
  end if;

  select song_id
  into previous_song_id
  from public.spotlight_slots
  where slot_number = target_slot
  for update;

  update public.spotlight_slots
  set
    song_id = target_song_id,
    placement_kind = placement,
    custom_label = trim(coalesce(label, '')),
    active_from = starts_at,
    active_until = ends_at,
    contest_id = null,
    event_id = null,
    updated_by = auth.uid(),
    updated_at = now()
  where slot_number = target_slot;

  if previous_song_id is not null then
    update public.songs
    set featured = exists (
      select 1
      from public.spotlight_slots
      where spotlight_slots.song_id = previous_song_id
    )
    where id = previous_song_id;
  end if;

  if target_song_id is not null then
    update public.songs
    set featured = true
    where id = target_song_id;
  end if;
exception
  when unique_violation then
    raise exception 'A song can occupy only one Spotlight slot';
end;
$$;

create or replace function public.admin_create_contest(
  contest_title text,
  contest_description text,
  contest_genre text,
  contest_starts_at timestamptz,
  contest_ends_at timestamptz,
  contest_reward_description text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  contest_id uuid;
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Forbidden';
  end if;
  insert into public.contests (
    title,
    description,
    genre,
    status,
    starts_at,
    ends_at,
    reward_description,
    created_by
  )
  values (
    trim(contest_title),
    trim(coalesce(contest_description, '')),
    nullif(trim(coalesce(contest_genre, '')), ''),
    'draft',
    contest_starts_at,
    contest_ends_at,
    trim(coalesce(contest_reward_description, '')),
    auth.uid()
  )
  returning id into contest_id;
  return contest_id;
end;
$$;

create or replace function public.admin_create_special_event(
  event_title text,
  event_description text,
  event_starts_at timestamptz,
  event_ends_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  event_id uuid;
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Forbidden';
  end if;
  insert into public.special_events (
    title,
    description,
    status,
    starts_at,
    ends_at,
    created_by
  )
  values (
    trim(event_title),
    trim(coalesce(event_description, '')),
    'draft',
    event_starts_at,
    event_ends_at,
    auth.uid()
  )
  returning id into event_id;
  return event_id;
end;
$$;

create or replace function public.enter_contest(
  target_contest_id uuid,
  target_song_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_active_user() then
    raise exception 'Active account required';
  end if;
  if not exists (
    select 1
    from public.contests
    where contests.id = target_contest_id
      and contests.status = 'active'
      and contests.starts_at <= now()
      and contests.ends_at > now()
  ) then
    raise exception 'Contest is not accepting entries';
  end if;
  if not exists (
    select 1
    from public.songs
    where songs.id = target_song_id
      and songs.user_id = auth.uid()
      and songs.is_active
      and songs.removed_at is null
  ) then
    raise exception 'Only your active songs can enter';
  end if;

  insert into public.contest_entries (contest_id, song_id, entered_by)
  values (target_contest_id, target_song_id, auth.uid())
  on conflict do nothing;
  return true;
end;
$$;

create or replace function public.get_active_community_programs()
returns table (
  program_kind text,
  program_id uuid,
  title text,
  description text,
  genre text,
  starts_at timestamptz,
  ends_at timestamptz,
  reward_description text,
  entry_count integer
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    'contest'::text,
    contests.id,
    contests.title,
    contests.description,
    contests.genre,
    contests.starts_at,
    contests.ends_at,
    contests.reward_description,
    (
      select count(*)::integer
      from public.contest_entries
      where contest_entries.contest_id = contests.id
    )
  from public.contests
  where public.is_active_user()
    and contests.status = 'active'
    and contests.starts_at <= now()
    and contests.ends_at > now()
  union all
  select
    'event'::text,
    special_events.id,
    special_events.title,
    special_events.description,
    null::text,
    special_events.starts_at,
    special_events.ends_at,
    ''::text,
    0
  from public.special_events
  where public.is_active_user()
    and special_events.status = 'active'
    and special_events.starts_at <= now()
    and special_events.ends_at > now()
  order by starts_at;
$$;

create or replace function public.get_my_song_dashboard_v2()
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
  submitted_at timestamptz,
  reviews_received integer,
  average_rating numeric,
  hook_score integer,
  report_count integer,
  total_listening_seconds bigint,
  average_listening_seconds numeric,
  completion_rate numeric,
  playlist_intent numeric,
  share_intent numeric,
  listener_retention numeric,
  boost_status text
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
    songs.song_language,
    songs.created_at,
    coalesce(metrics.reviews_received, 0),
    coalesce(metrics.average_rating, 0),
    coalesce(metrics.hook_score, 0),
    coalesce(report_counts.report_count, 0),
    coalesce(metrics.total_listening_seconds, 0),
    coalesce(metrics.average_listening_seconds, 0),
    coalesce(metrics.completion_rate, 0),
    coalesce(metrics.playlist_intent, 0),
    coalesce(metrics.share_intent, 0),
    coalesce(metrics.listener_retention, 0),
    boost_state.status::text
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
      ) / 4, 0)::integer as hook_score,
      coalesce(sum(reviews.listening_seconds), 0)::bigint
        as total_listening_seconds,
      round(
        (
          avg(reviews.listening_seconds)
            filter (where reviews.listening_seconds > 0)
        )::numeric,
        2
      ) as average_listening_seconds,
      round(
        (
          avg(
            case
              when reviews.listening_completion_percent >= 90 then 100
              else 0
            end
          ) filter (
            where reviews.listening_completion_percent is not null
          )
        )::numeric,
        2
      ) as completion_rate,
      round(avg(case when reviews.add_to_playlist then 100 else 0 end)::numeric, 2)
        as playlist_intent,
      round(avg(case when reviews.share_with_friend then 100 else 0 end)::numeric, 2)
        as share_intent,
      round(
        (
          avg(reviews.listening_completion_percent)
            filter (where reviews.listening_completion_percent is not null)
        )::numeric,
        2
      ) as listener_retention
    from public.reviews
    where reviews.song_id = songs.id
      and reviews.quality_passed
  ) metrics on true
  left join lateral (
    select count(*)::integer as report_count
    from public.song_reports
    where song_reports.song_id = songs.id
  ) report_counts on true
  left join lateral (
    select song_boosts.status
    from public.song_boosts
    where song_boosts.song_id = songs.id
      and song_boosts.status in ('pending', 'approved')
    order by song_boosts.requested_at desc
    limit 1
  ) boost_state on true
  where songs.user_id = auth.uid()
    and public.is_active_user()
  order by songs.created_at desc;
$$;

drop function if exists public.get_smart_review_queue(integer);

create function public.get_smart_review_queue(queue_limit integer default 20)
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
          )
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
        + least(
          20,
          floor(extract(epoch from (now() - songs.created_at)) / 86400)
        )::integer
        + case
          when exists (
            select 1
            from public.song_boosts
            where song_boosts.song_id = songs.id
              and song_boosts.status = 'approved'
              and song_boosts.starts_at <= now()
              and song_boosts.ends_at > now()
          )
          then 35
          else 0
        end
      ) as computed_match_score,
      array_remove(array[
        case
          when songs.song_language = 'Instrumental'
            or songs.song_language = any(reviewer.languages_understood)
          then songs.song_language
        end,
        case
          when songs.genre = any(reviewer.genre_preferences)
          then songs.genre
        end
      ], null) as computed_match_reasons
    from public.songs
    cross join reviewer
    where songs.is_active
      and songs.removed_at is null
      and songs.user_id <> auth.uid()
      and (not songs.explicit_content or reviewer.show_explicit_content)
      and not exists (
        select 1
        from public.reviews
        where reviews.song_id = songs.id
          and reviews.reviewer_id = auth.uid()
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
    scored.computed_match_score,
    scored.computed_match_reasons
  from scored
  order by scored.computed_match_score desc, scored.created_at asc
  limit greatest(1, least(queue_limit, 50));
$$;

create or replace function public.discovery_system_health_report()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'tables', jsonb_build_object(
      'spotlight_slots', to_regclass('public.spotlight_slots') is not null,
      'song_boosts', to_regclass('public.song_boosts') is not null,
      'daily_missions', to_regclass('public.daily_missions') is not null,
      'daily_mission_progress', to_regclass('public.daily_mission_progress') is not null,
      'contests', to_regclass('public.contests') is not null,
      'contest_entries', to_regclass('public.contest_entries') is not null,
      'special_events', to_regclass('public.special_events') is not null
    ),
    'spotlight_slots', (select count(*) from public.spotlight_slots),
    'active_spotlight_duplicates', (
      select count(*)
      from (
        select song_id
        from public.spotlight_slots
        where song_id is not null
        group by song_id
        having count(*) > 1
      ) duplicates
    ),
    'unclaimed_completed_missions', (
      select count(*)
      from public.daily_mission_progress
      join public.daily_missions
        on daily_missions.id = daily_mission_progress.mission_id
      where daily_mission_progress.progress_count >= daily_missions.target_count
        and daily_mission_progress.claimed_at is null
    ),
    'invalid_active_boosts', (
      select count(*)
      from public.song_boosts
      where status = 'approved'
        and (
          starts_at is null
          or ends_at is null
          or ends_at <= starts_at
        )
    ),
    'top_ten_is_organic', true
  );
$$;

revoke all on function public.get_listening_bank_status_v2()
  from public, anon, authenticated;
revoke all on function public.get_spotlight_songs()
  from public, anon, authenticated;
revoke all on function public.get_top_ten_songs()
  from public, anon, authenticated;
revoke all on function public.get_daily_mission_status()
  from public, anon, authenticated;
revoke all on function public.claim_daily_mission_reward(uuid)
  from public, anon, authenticated;
revoke all on function public.request_song_boost(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_review_song_boost(uuid, boolean, text)
  from public, anon, authenticated;
revoke all on function public.admin_set_spotlight_slot(
  smallint,
  uuid,
  public.spotlight_placement_kind,
  text,
  timestamptz,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_create_contest(
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  text
) from public, anon, authenticated;
revoke all on function public.admin_create_special_event(
  text,
  text,
  timestamptz,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.enter_contest(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_active_community_programs()
  from public, anon, authenticated;
revoke all on function public.get_my_song_dashboard_v2()
  from public, anon, authenticated;
revoke all on function public.get_smart_review_queue(integer)
  from public, anon, authenticated;
revoke all on function public.discovery_system_health_report()
  from public, anon, authenticated;

grant execute on function public.get_listening_bank_status_v2()
  to authenticated;
grant execute on function public.get_spotlight_songs()
  to authenticated;
grant execute on function public.get_top_ten_songs()
  to authenticated;
grant execute on function public.get_daily_mission_status()
  to authenticated;
grant execute on function public.claim_daily_mission_reward(uuid)
  to authenticated;
grant execute on function public.request_song_boost(uuid)
  to authenticated;
grant execute on function public.admin_review_song_boost(uuid, boolean, text)
  to authenticated;
grant execute on function public.admin_set_spotlight_slot(
  smallint,
  uuid,
  public.spotlight_placement_kind,
  text,
  timestamptz,
  timestamptz
) to authenticated;
grant execute on function public.admin_create_contest(
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  text
) to authenticated;
grant execute on function public.admin_create_special_event(
  text,
  text,
  timestamptz,
  timestamptz
) to authenticated;
grant execute on function public.enter_contest(uuid, uuid)
  to authenticated;
grant execute on function public.get_active_community_programs()
  to authenticated;
grant execute on function public.get_my_song_dashboard_v2()
  to authenticated;
grant execute on function public.get_smart_review_queue(integer)
  to authenticated;
grant execute on function public.discovery_system_health_report()
  to service_role;

-- ============================================================
-- 20260609041000_require_verified_listening_for_missions.sql
-- ============================================================

-- Daily listening missions require verified listening time in addition to an
-- accepted quality review.

create or replace function public.advance_spotlight_daily_mission()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not new.quality_passed
    or coalesce(new.listening_seconds, 0) <= 0
    or not exists (
      select 1
      from public.spotlight_slots
      where spotlight_slots.song_id = new.song_id
        and (
          spotlight_slots.active_from is null
          or spotlight_slots.active_from <= now()
        )
        and (
          spotlight_slots.active_until is null
          or spotlight_slots.active_until > now()
        )
    )
  then
    return new;
  end if;

  insert into public.daily_mission_progress (
    user_id,
    mission_id,
    mission_date,
    progress_count,
    completed_at,
    updated_at
  )
  select
    new.reviewer_id,
    missions.id,
    current_date,
    1,
    case when missions.target_count <= 1 then now() end,
    now()
  from public.daily_missions as missions
  where missions.mission_key = 'review_spotlight_songs'
    and missions.active
    and (missions.starts_at is null or missions.starts_at <= now())
    and (missions.ends_at is null or missions.ends_at > now())
  on conflict (user_id, mission_id, mission_date)
  do update set
    progress_count = least(
      (
        select daily_missions.target_count
        from public.daily_missions
        where daily_missions.id = excluded.mission_id
      ),
      daily_mission_progress.progress_count + 1
    ),
    completed_at = case
      when daily_mission_progress.progress_count + 1 >= (
        select daily_missions.target_count
        from public.daily_missions
        where daily_missions.id = excluded.mission_id
      )
      then coalesce(daily_mission_progress.completed_at, now())
      else daily_mission_progress.completed_at
    end,
    updated_at = now();

  return new;
end;
$$;

-- ============================================================
-- 20260609042000_keep_spotlight_slots_active.sql
-- ============================================================

-- Spotlight placements must always point to active songs.

create or replace function public.clear_inactive_spotlight_slot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not new.is_active or new.removed_at is not null then
    update public.spotlight_slots
    set
      song_id = null,
      custom_label = '',
      contest_id = null,
      event_id = null,
      active_from = null,
      active_until = null,
      updated_at = now()
    where song_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists songs_clear_inactive_spotlight_slot
  on public.songs;
create trigger songs_clear_inactive_spotlight_slot
after update of is_active, removed_at on public.songs
for each row
when (not new.is_active or new.removed_at is not null)
execute function public.clear_inactive_spotlight_slot();
