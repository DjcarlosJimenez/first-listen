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
