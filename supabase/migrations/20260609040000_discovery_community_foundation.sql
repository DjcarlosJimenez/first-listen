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
