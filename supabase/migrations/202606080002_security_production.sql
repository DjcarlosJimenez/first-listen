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
