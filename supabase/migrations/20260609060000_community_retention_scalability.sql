-- Community activity lifecycle, retention surfaces, complete-listen analytics,
-- and one reward-eligible listening ledger per listener/song.

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'creator_activity_status'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.creator_activity_status as enum (
      'active',
      'paused',
      'archived'
    );
  end if;
end
$$;

alter table public.profiles
  add column if not exists creator_activity_status
    public.creator_activity_status not null default 'active',
  add column if not exists last_contribution_at timestamptz,
  add column if not exists activity_status_changed_at timestamptz
    not null default now(),
  add column if not exists complete_listens integer not null default 0;

alter table public.profiles
  drop constraint if exists profiles_complete_listens_check;
alter table public.profiles
  add constraint profiles_complete_listens_check check (complete_listens >= 0);

alter table public.listening_sessions
  add column if not exists engaged_seconds integer not null default 0,
  add column if not exists complete_listen_at timestamptz,
  add column if not exists reward_eligible boolean not null default true;

alter table public.listening_sessions
  drop constraint if exists listening_sessions_engaged_seconds_check;
alter table public.listening_sessions
  add constraint listening_sessions_engaged_seconds_check
  check (engaged_seconds >= 0);

update public.listening_sessions
set engaged_seconds = greatest(engaged_seconds, verified_seconds);

with ranked_sessions as (
  select
    id,
    row_number() over (
      partition by user_id, song_id
      order by
        (valid_listen_at is not null) desc,
        settled_seconds desc,
        created_at asc,
        id
    ) as reward_order
  from public.listening_sessions
)
update public.listening_sessions as sessions
set reward_eligible = ranked_sessions.reward_order = 1
from ranked_sessions
where ranked_sessions.id = sessions.id
  and sessions.reward_eligible is distinct from
    (ranked_sessions.reward_order = 1);

create unique index if not exists listening_sessions_one_reward_ledger_idx
  on public.listening_sessions (user_id, song_id)
  where reward_eligible;

create index if not exists profiles_creator_activity_idx
  on public.profiles (creator_activity_status, last_contribution_at);

create index if not exists listening_sessions_complete_listen_idx
  on public.listening_sessions (user_id, complete_listen_at desc)
  where complete_listen_at is not null;

update public.listening_sessions
set complete_listen_at = coalesce(complete_listen_at, finished_at, updated_at)
where complete_listen_at is null
  and provider_duration_seconds between 15 and 43200
  and engaged_seconds >= ceil(provider_duration_seconds * 0.90);

update public.profiles as profiles
set complete_listens = (
  select count(*)::integer
  from public.listening_sessions
  where listening_sessions.user_id = profiles.id
    and listening_sessions.complete_listen_at is not null
    and listening_sessions.reward_eligible
);

update public.profiles as profiles
set last_contribution_at = greatest(
  profiles.created_at,
  coalesce((
    select max(reviews.created_at)
    from public.reviews
    where reviews.reviewer_id = profiles.id
      and reviews.quality_passed
  ), profiles.created_at),
  coalesce((
    select max(listening_sessions.valid_listen_at)
    from public.listening_sessions
    where listening_sessions.user_id = profiles.id
      and listening_sessions.valid_listen_at is not null
  ), profiles.created_at),
  coalesce((
    select max(listening_sessions.complete_listen_at)
    from public.listening_sessions
    where listening_sessions.user_id = profiles.id
      and listening_sessions.complete_listen_at is not null
  ), profiles.created_at)
)
where profiles.last_contribution_at is null;

create or replace function public.record_creator_contribution(
  target_user_id uuid,
  contribution_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.profiles
  set
    last_contribution_at = greatest(
      coalesce(last_contribution_at, created_at),
      contribution_at
    ),
    creator_activity_status = 'active',
    activity_status_changed_at = case
      when creator_activity_status <> 'active' then now()
      else activity_status_changed_at
    end,
    updated_at = now()
  where id = target_user_id
    and account_status = 'active'
    and banned_at is null;
end;
$$;

revoke all on function public.record_creator_contribution(uuid, timestamptz)
  from public, anon, authenticated;

create or replace function public.refresh_creator_activity_status(
  target_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  changed_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if target_user_id is null
    and public.current_user_role() not in ('super_admin', 'admin')
  then
    raise exception 'Administrator access required';
  end if;

  if target_user_id is not null
    and target_user_id <> auth.uid()
    and public.current_user_role() not in ('super_admin', 'admin')
  then
    raise exception 'You cannot refresh another user';
  end if;

  with effective_status as (
    select
      profiles.id,
      case
        when coalesce(
          profiles.last_contribution_at,
          profiles.created_at
        ) <= now() - interval '60 days'
          then 'archived'::public.creator_activity_status
        when coalesce(
          profiles.last_contribution_at,
          profiles.created_at
        ) <= now() - interval '14 days'
          then 'paused'::public.creator_activity_status
        else 'active'::public.creator_activity_status
      end as next_status
    from public.profiles
    where target_user_id is null or profiles.id = target_user_id
  )
  update public.profiles as profiles
  set
    creator_activity_status = effective_status.next_status,
    activity_status_changed_at = now(),
    updated_at = now()
  from effective_status
  where profiles.id = effective_status.id
    and profiles.creator_activity_status <> effective_status.next_status;

  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

revoke all on function public.refresh_creator_activity_status(uuid)
  from public, anon, authenticated;
grant execute on function public.refresh_creator_activity_status(uuid)
  to authenticated;

create table if not exists public.creator_activity_reminders (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reminder_stage text not null
    check (reminder_stage in ('120_day', '180_day')),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'cancelled')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (user_id, reminder_stage)
);

alter table public.creator_activity_reminders enable row level security;
revoke all on table public.creator_activity_reminders
  from public, anon, authenticated;

create or replace function public.enqueue_creator_activity_reminders()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  inserted_count integer;
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Administrator access required';
  end if;

  insert into public.creator_activity_reminders (user_id, reminder_stage)
  select
    profiles.id,
    stages.reminder_stage
  from public.profiles
  cross join lateral (
    values
      ('120_day'::text, interval '120 days'),
      ('180_day'::text, interval '180 days')
  ) as stages(reminder_stage, inactivity_interval)
  where profiles.creator_activity_status = 'archived'
    and coalesce(profiles.last_contribution_at, profiles.created_at)
      <= now() - stages.inactivity_interval
  on conflict (user_id, reminder_stage) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.enqueue_creator_activity_reminders()
  from public, anon, authenticated;
grant execute on function public.enqueue_creator_activity_reminders()
  to authenticated;

create or replace function public.activate_creator_from_review()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.quality_passed then
    perform public.record_creator_contribution(new.reviewer_id, new.created_at);
  end if;
  return new;
end;
$$;

drop trigger if exists activate_creator_from_review
  on public.reviews;
create trigger activate_creator_from_review
after insert on public.reviews
for each row execute function public.activate_creator_from_review();

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
  join public.profiles as creators on creators.id = songs.user_id
  where songs.id = target_song_id
    and songs.user_id <> auth.uid()
    and songs.is_active
    and songs.removed_at is null
    and creators.account_status = 'active'
    and creators.banned_at is null
    and coalesce(creators.last_contribution_at, creators.created_at)
      > now() - interval '14 days'
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
    and reward_eligible
    and valid_listen_at is null
  order by created_at
  limit 1;

  if existing_session_id is not null then
    update public.listening_sessions
    set
      status = 'qualified',
      qualified_at = coalesce(qualified_at, now()),
      finished_at = coalesce(finished_at, now()),
      updated_at = now()
    where user_id = auth.uid()
      and status = 'active'
      and id <> existing_session_id;

    update public.listening_sessions
    set
      status = 'active',
      finished_at = null,
      updated_at = now()
    where id = existing_session_id;

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
  set
    status = 'qualified',
    qualified_at = coalesce(qualified_at, now()),
    finished_at = coalesce(finished_at, now()),
    updated_at = now()
  where user_id = auth.uid()
    and status = 'active';

  begin
    insert into public.listening_sessions (
      user_id,
      song_id,
      platform,
      telemetry_supported,
      reward_eligible
    )
    values (
      auth.uid(),
      target_song_id,
      target_platform,
      supports_verified_audio,
      true
    )
    returning id into new_session_id;
  exception
    when unique_violation then
      select id
      into new_session_id
      from public.listening_sessions
      where user_id = auth.uid()
        and song_id = target_song_id
        and reward_eligible
      order by created_at
      limit 1;

      update public.listening_sessions
      set status = 'active', finished_at = null, updated_at = now()
      where id = new_session_id;
  end;

  return query
  select
    new_session_id,
    settings.enabled and supports_verified_audio,
    settings.heartbeat_interval_seconds,
    settings.interaction_grace_seconds,
    settings.daily_cap_minutes * 60;
end;
$$;

drop function if exists public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
);

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
  valid_listen_recorded boolean,
  complete_listen_recorded boolean,
  valid_requirement_seconds integer,
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
  engagement_seconds integer := 0;
  countable_seconds integer := 0;
  today_other_seconds integer := 0;
  current_daily_remaining integer;
  engagement_valid boolean := false;
  heartbeat_valid boolean := false;
  warning_message text := '';
  requirement_seconds integer;
  became_valid boolean := false;
  became_complete boolean := false;
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
  into today_other_seconds
  from public.listening_sessions
  where user_id = auth.uid()
    and id <> target_session_id
    and created_at >= date_trunc('day', now());

  current_daily_remaining := greatest(
    0,
    settings.daily_cap_minutes * 60 -
      today_other_seconds -
      current_session.settled_seconds
  );

  requirement_seconds := case
    when playback_duration_seconds between 15 and 43200
      then least(120, greatest(30, ceil(playback_duration_seconds * 0.25)::integer))
    else coalesce(current_session.valid_requirement_seconds, 30)
  end;

  if current_session.status <> 'active' then
    return query select
      false,
      0,
      current_session.verified_seconds,
      current_daily_remaining,
      current_session.valid_listen_at is not null,
      current_session.complete_listen_at is not null,
      coalesce(current_session.valid_requirement_seconds, requirement_seconds),
      'Listening session is no longer active.'::text;
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
  novel_seconds := playback_position_seconds - current_session.max_position_seconds;

  if current_session.last_heartbeat_at is null then
    update public.listening_sessions
    set
      provider_duration_seconds = playback_duration_seconds,
      valid_requirement_seconds = requirement_seconds,
      last_position_seconds = playback_position_seconds,
      max_position_seconds = greatest(max_position_seconds, playback_position_seconds),
      last_heartbeat_at = now(),
      updated_at = now()
    where id = target_session_id;

    update public.songs
    set observed_duration_seconds = round(playback_duration_seconds)::integer
    where songs.id = current_session.song_id
      and playback_duration_seconds between 15 and 43200
      and (
        songs.observed_duration_seconds is null
        or abs(songs.observed_duration_seconds - playback_duration_seconds) <= 5
      );

    return query select
      false,
      0,
      current_session.verified_seconds,
      current_daily_remaining,
      current_session.valid_listen_at is not null,
      current_session.complete_listen_at is not null,
      requirement_seconds,
      ''::text;
    return;
  end if;

  engagement_valid :=
    settings.enabled
    and current_session.telemetry_supported
    and current_session.reward_eligible
    and playback_state = 'playing'
    and playback_muted is false
    and coalesce(playback_volume, 0) > 0
    and page_visible
    and page_focused
    and interaction_recent
    and playback_position_seconds >= 0
    and playback_duration_seconds between 15 and 43200
    and playback_position_seconds <= playback_duration_seconds + 5
    and elapsed_seconds between 1 and settings.heartbeat_interval_seconds + 20
    and forward_seconds between 1 and elapsed_seconds + 6
    and novel_seconds > 0;

  if engagement_valid then
    engagement_seconds := greatest(
      0,
      least(
        floor(elapsed_seconds)::integer,
        floor(forward_seconds)::integer,
        floor(novel_seconds)::integer,
        settings.heartbeat_interval_seconds + 5
      )
    );
    countable_seconds := least(engagement_seconds, current_daily_remaining);
    heartbeat_valid := countable_seconds > 0;
  end if;

  if current_daily_remaining = 0 and engagement_valid then
    warning_message := 'You have reached today''s listening limit.';
  elsif not current_session.reward_eligible then
    warning_message := 'This song has already generated its listening reward.';
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
  elsif not engagement_valid then
    warning_message := 'Playback progress could not be verified.';
  end if;

  update public.listening_sessions
  set
    provider_duration_seconds = playback_duration_seconds,
    valid_requirement_seconds = requirement_seconds,
    last_position_seconds = playback_position_seconds,
    max_position_seconds = greatest(max_position_seconds, playback_position_seconds),
    engaged_seconds = engaged_seconds + engagement_seconds,
    verified_seconds = verified_seconds + countable_seconds,
    settled_seconds = settled_seconds + countable_seconds,
    rejected_heartbeats = rejected_heartbeats + case when engagement_valid then 0 else 1 end,
    loop_count = loop_count + case when forward_seconds < -3 then 1 else 0 end,
    last_heartbeat_at = now(),
    updated_at = now()
  where id = target_session_id
  returning * into current_session;

  if countable_seconds > 0 then
    update public.profiles
    set
      listening_bank_seconds = listening_bank_seconds + countable_seconds,
      lifetime_listening_seconds = lifetime_listening_seconds + countable_seconds,
      updated_at = now()
    where id = auth.uid();
  end if;

  if current_session.valid_listen_at is null
    and current_session.engaged_seconds >= requirement_seconds
  then
    update public.listening_sessions
    set
      valid_listen_at = now(),
      community_point_awarded = true,
      updated_at = now()
    where id = target_session_id;

    update public.profiles
    set valid_listens = valid_listens + 1, updated_at = now()
    where id = auth.uid();

    perform public.award_community_points(
      auth.uid(),
      1,
      'Valid listen',
      'listening_session',
      target_session_id,
      null
    );
    perform public.record_creator_contribution(auth.uid(), now());
    became_valid := true;
  end if;

  if current_session.complete_listen_at is null
    and playback_duration_seconds between 15 and 43200
    and current_session.engaged_seconds >= ceil(playback_duration_seconds * 0.90)
  then
    update public.listening_sessions
    set complete_listen_at = now(), updated_at = now()
    where id = target_session_id;

    update public.profiles
    set complete_listens = complete_listens + 1, updated_at = now()
    where id = auth.uid();

    perform public.record_creator_contribution(auth.uid(), now());
    became_complete := true;
  end if;

  return query
  select
    heartbeat_valid,
    countable_seconds,
    current_session.verified_seconds,
    greatest(0, current_daily_remaining - countable_seconds),
    became_valid or current_session.valid_listen_at is not null,
    became_complete or current_session.complete_listen_at is not null,
    requirement_seconds,
    warning_message;
end;
$$;

drop function if exists public.get_listening_bank_status_v2();

create or replace function public.get_listening_bank_status_v2()
returns table (
  bank_seconds bigint,
  pending_seconds bigint,
  lifetime_seconds bigint,
  today_seconds integer,
  weekly_seconds bigint,
  monthly_seconds bigint,
  available_reward_credits integer,
  seconds_to_next_credit integer,
  minutes_per_credit integer,
  daily_cap_minutes integer,
  level_number smallint,
  level_name text,
  rewards_enabled boolean,
  community_points integer,
  community_rank text,
  valid_listens integer,
  complete_listens integer,
  today_valid_listens integer,
  today_complete_listens integer,
  today_average_completion_rate numeric
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
      profiles.lifetime_listening_seconds,
      profiles.community_points,
      profiles.valid_listens,
      profiles.complete_listens
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.account_status = 'active'
      and profiles.banned_at is null
  ),
  periods as (
    select
      coalesce(sum(settled_seconds) filter (
        where created_at >= date_trunc('day', now())
      ), 0)::integer as today_seconds,
      coalesce(sum(settled_seconds) filter (
        where created_at >= date_trunc('week', now())
      ), 0)::bigint as weekly_seconds,
      coalesce(sum(settled_seconds) filter (
        where created_at >= date_trunc('month', now())
      ), 0)::bigint as monthly_seconds,
      count(*) filter (
        where valid_listen_at >= date_trunc('day', now())
      )::integer as today_valid_listens,
      count(*) filter (
        where complete_listen_at >= date_trunc('day', now())
      )::integer as today_complete_listens,
      coalesce(round(avg(
        least(
          100,
          engaged_seconds::numeric /
            nullif(provider_duration_seconds, 0) * 100
        )
      ) filter (
        where created_at >= date_trunc('day', now())
          and provider_duration_seconds > 0
          and engaged_seconds > 0
      ), 1), 0) as today_average_completion_rate
    from public.listening_sessions
    where user_id = auth.uid()
      and reward_eligible
  )
  select
    profile.listening_bank_seconds,
    0::bigint,
    profile.lifetime_listening_seconds,
    periods.today_seconds,
    periods.weekly_seconds,
    periods.monthly_seconds,
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
    settings.enabled,
    profile.community_points,
    public.community_rank_name(profile.community_points),
    profile.valid_listens,
    profile.complete_listens,
    periods.today_valid_listens,
    periods.today_complete_listens,
    periods.today_average_completion_rate
  from profile
  cross join settings
  cross join periods
  join lateral (
    select listening_levels.level_number, listening_levels.level_name
    from public.listening_levels
    where listening_levels.minimum_minutes <=
      floor(profile.lifetime_listening_seconds / 60)
    order by listening_levels.minimum_minutes desc
    limit 1
  ) levels on true;
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
      (
        case
          when songs.song_language = 'Instrumental'
            or songs.song_language = any(reviewer.languages_understood)
          then 100 else 0
        end
        + case
          when songs.genre = any(reviewer.genre_preferences) then 70
          when songs.genre = any(
            array['Reggaeton','Regional Mexican','Cumbia','Salsa','Bachata']::text[]
          ) and reviewer.genre_preferences && array[
            'Reggaeton','Regional Mexican','Cumbia','Salsa','Bachata'
          ]::text[] then 50
          else 0
        end
        + reviewer.activity_score
        + least(
          20,
          floor(extract(epoch from (now() - songs.created_at)) / 86400)
        )::integer
        + case when active_boosts.song_id is null then 0 else 35 end
      ) as computed_match_score,
      array_remove(array[
        case
          when songs.song_language = 'Instrumental'
            or songs.song_language = any(reviewer.languages_understood)
          then songs.song_language
        end,
        case when songs.genre = any(reviewer.genre_preferences) then songs.genre end,
        case when active_boosts.song_id is not null then 'Boosted visibility' end
      ], null) as computed_match_reasons
    from public.songs
    join public.profiles as creators on creators.id = songs.user_id
    cross join reviewer
    left join active_boosts on active_boosts.song_id = songs.id
    where songs.is_active
      and songs.removed_at is null
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

drop function if exists public.get_public_artist_profile(uuid);

create or replace function public.get_public_artist_profile(target_artist_id uuid)
returns table (
  artist_id uuid,
  artist_name text,
  followers integer,
  songs_submitted integer,
  genres text[],
  languages text[],
  is_following boolean,
  average_rating numeric,
  listening_hours_received numeric,
  valid_listens_received integer,
  complete_listens_received integer,
  community_rank text,
  activity_status public.creator_activity_status
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    profiles.id,
    profiles.display_name,
    coalesce(follower_counts.followers, 0)::integer,
    coalesce(song_counts.songs_submitted, 0)::integer,
    coalesce(song_counts.genres, array[]::text[]),
    coalesce(song_counts.languages, array[]::text[]),
    exists (
      select 1
      from public.artist_follows as follows
      where follows.follower_id = auth.uid()
        and follows.artist_id = profiles.id
    ),
    coalesce(artist_metrics.average_rating, 0),
    round(coalesce(artist_metrics.listening_seconds, 0)::numeric / 3600, 2),
    coalesce(artist_metrics.valid_listens_received, 0)::integer,
    coalesce(artist_metrics.complete_listens_received, 0)::integer,
    public.community_rank_name(profiles.community_points),
    case
      when coalesce(profiles.last_contribution_at, profiles.created_at)
        <= now() - interval '60 days'
        then 'archived'::public.creator_activity_status
      when coalesce(profiles.last_contribution_at, profiles.created_at)
        <= now() - interval '14 days'
        then 'paused'::public.creator_activity_status
      else 'active'::public.creator_activity_status
    end
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
      and songs.removed_at is null
  ) song_counts on true
  left join lateral (
    select
      (
        select round(avg(reviews.rating)::numeric, 2)
        from public.reviews
        join public.songs on songs.id = reviews.song_id
        where songs.user_id = profiles.id
          and reviews.quality_passed
      ) as average_rating,
      coalesce(sum(listening_sessions.settled_seconds), 0)::bigint
        as listening_seconds,
      count(*) filter (
        where listening_sessions.valid_listen_at is not null
      )::integer as valid_listens_received,
      count(*) filter (
        where listening_sessions.complete_listen_at is not null
      )::integer as complete_listens_received
    from public.listening_sessions
    join public.songs on songs.id = listening_sessions.song_id
    where songs.user_id = profiles.id
      and listening_sessions.reward_eligible
  ) artist_metrics on true
  where profiles.id = target_artist_id
    and profiles.account_status = 'active'
    and profiles.banned_at is null;
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
set search_path = pg_catalog, public
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
  join public.profiles as creators on creators.id = songs.user_id
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
      and reviews.quality_passed
  ) metrics on true
  where songs.user_id = target_artist_id
    and songs.is_active
    and songs.removed_at is null
    and creators.account_status = 'active'
    and creators.banned_at is null
    and coalesce(creators.last_contribution_at, creators.created_at)
      > now() - interval '14 days'
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
  order by songs.created_at desc;
$$;

create or replace function public.get_followed_artists(queue_limit integer default 8)
returns table (
  artist_id uuid,
  artist_name text,
  followers integer,
  songs_submitted integer,
  average_rating numeric,
  community_rank text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    artists.id,
    artists.display_name,
    (
      select count(*)::integer
      from public.artist_follows
      where artist_follows.artist_id = artists.id
    ),
    (
      select count(*)::integer
      from public.songs
      where songs.user_id = artists.id
        and songs.is_active
        and songs.removed_at is null
    ),
    coalesce((
      select round(avg(reviews.rating)::numeric, 2)
      from public.reviews
      join public.songs on songs.id = reviews.song_id
      where songs.user_id = artists.id
        and reviews.quality_passed
    ), 0),
    public.community_rank_name(artists.community_points)
  from public.artist_follows
  join public.profiles as artists
    on artists.id = artist_follows.artist_id
  where artist_follows.follower_id = auth.uid()
    and public.is_active_user()
    and artists.account_status = 'active'
    and artists.banned_at is null
    and coalesce(artists.last_contribution_at, artists.created_at)
      > now() - interval '14 days'
  order by artist_follows.created_at desc
  limit greatest(1, least(queue_limit, 24));
$$;

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
  completion_rate numeric
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
    coalesce(metrics.completion_rate, 0)
  from supported
  join public.songs on songs.id = supported.id
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
      coalesce(round(avg(reviews.listening_completion_percent)::numeric, 2), 0)
        as completion_rate
    from public.reviews
    where reviews.song_id = songs.id
      and reviews.quality_passed
  ) metrics on true
  order by supported.supported_at desc
  limit greatest(1, least(queue_limit, 24));
$$;

create or replace function public.get_today_support_summary()
returns table (
  songs_reviewed_today integer,
  creators_supported integer,
  listening_seconds_today integer,
  community_rank text,
  valid_listens_today integer,
  complete_listens_today integer,
  average_completion_rate numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    (
      select count(*)::integer
      from public.reviews
      where reviews.reviewer_id = auth.uid()
        and reviews.quality_passed
        and reviews.created_at >= date_trunc('day', now())
    ),
    (
      select count(distinct songs.user_id)::integer
      from public.songs
      where songs.id in (
        select reviews.song_id
        from public.reviews
        where reviews.reviewer_id = auth.uid()
          and reviews.quality_passed
          and reviews.created_at >= date_trunc('day', now())
        union
        select listening_sessions.song_id
        from public.listening_sessions
        where listening_sessions.user_id = auth.uid()
          and listening_sessions.valid_listen_at >= date_trunc('day', now())
      )
    ),
    coalesce((
      select sum(listening_sessions.settled_seconds)::integer
      from public.listening_sessions
      where listening_sessions.user_id = auth.uid()
        and listening_sessions.created_at >= date_trunc('day', now())
        and listening_sessions.reward_eligible
    ), 0),
    public.community_rank_name(profiles.community_points),
    (
      select count(*)::integer
      from public.listening_sessions
      where listening_sessions.user_id = auth.uid()
        and listening_sessions.valid_listen_at >= date_trunc('day', now())
        and listening_sessions.reward_eligible
    ),
    (
      select count(*)::integer
      from public.listening_sessions
      where listening_sessions.user_id = auth.uid()
        and listening_sessions.complete_listen_at >= date_trunc('day', now())
        and listening_sessions.reward_eligible
    ),
    coalesce((
      select round(avg(
        least(
          100,
          listening_sessions.engaged_seconds::numeric /
            nullif(listening_sessions.provider_duration_seconds, 0) * 100
        )
      ), 1)
      from public.listening_sessions
      where listening_sessions.user_id = auth.uid()
        and listening_sessions.created_at >= date_trunc('day', now())
        and listening_sessions.provider_duration_seconds > 0
        and listening_sessions.engaged_seconds > 0
        and listening_sessions.reward_eligible
    ), 0)
  from public.profiles
  where profiles.id = auth.uid()
    and public.is_active_user();
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
  join public.profiles as creators on creators.id = songs.user_id
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
      coalesce(round(avg(reviews.listening_completion_percent)::numeric, 2), 0)
        as completion_rate
    from public.reviews
    where reviews.song_id = songs.id
      and reviews.quality_passed
  ) metrics on true
  where public.is_active_user()
    and songs.is_active
    and songs.removed_at is null
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

revoke all on function public.start_listening_session(uuid)
  from public, anon, authenticated;
revoke all on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) from public, anon, authenticated;
revoke all on function public.get_listening_bank_status_v2()
  from public, anon, authenticated;
revoke all on function public.get_smart_review_queue(integer)
  from public, anon, authenticated;
revoke all on function public.get_followed_artists(integer)
  from public, anon, authenticated;
revoke all on function public.get_previously_supported_songs(integer)
  from public, anon, authenticated;
revoke all on function public.get_today_support_summary()
  from public, anon, authenticated;
revoke all on function public.get_spotlight_songs()
  from public, anon, authenticated;
revoke all on function public.get_top_ten_songs()
  from public, anon, authenticated;
revoke all on function public.get_public_artist_profile(uuid)
  from public, anon, authenticated;
revoke all on function public.get_public_artist_songs(uuid)
  from public, anon, authenticated;

grant execute on function public.start_listening_session(uuid)
  to authenticated;
grant execute on function public.record_listening_heartbeat(
  uuid, numeric, numeric, text, boolean, numeric, boolean, boolean, boolean
) to authenticated;
grant execute on function public.get_listening_bank_status_v2()
  to authenticated;
grant execute on function public.get_smart_review_queue(integer)
  to authenticated;
grant execute on function public.get_followed_artists(integer)
  to authenticated;
grant execute on function public.get_previously_supported_songs(integer)
  to authenticated;
grant execute on function public.get_today_support_summary()
  to authenticated;
grant execute on function public.get_spotlight_songs()
  to authenticated;
grant execute on function public.get_top_ten_songs()
  to authenticated;
grant execute on function public.get_public_artist_profile(uuid)
  to anon, authenticated;
grant execute on function public.get_public_artist_songs(uuid)
  to anon, authenticated;
