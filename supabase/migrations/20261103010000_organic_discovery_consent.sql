-- Organic discovery foundation.
-- Keeps listening analytics while separating user consent and artist-fair
-- ordering from the legacy reward economy.

alter table public.profiles
  add column if not exists continuous_playback_opt_in boolean not null default false,
  add column if not exists continuous_playback_consent_at timestamptz,
  add column if not exists discovery_prompt_choice text,
  add column if not exists discovery_prompt_snoozed_until timestamptz,
  add column if not exists playback_consent_version smallint not null default 1;

alter table public.guest_sessions
  add column if not exists continuous_playback_opt_in boolean not null default false,
  add column if not exists continuous_playback_consent_at timestamptz,
  add column if not exists discovery_prompt_choice text,
  add column if not exists discovery_prompt_snoozed_until timestamptz,
  add column if not exists playback_consent_version smallint not null default 1;

alter table public.profiles
  drop constraint if exists profiles_discovery_prompt_choice_check;
alter table public.profiles
  add constraint profiles_discovery_prompt_choice_check
  check (
    discovery_prompt_choice is null
    or discovery_prompt_choice in ('yes', 'not-now', 'later')
  );

alter table public.guest_sessions
  drop constraint if exists guest_sessions_discovery_prompt_choice_check;
alter table public.guest_sessions
  add constraint guest_sessions_discovery_prompt_choice_check
  check (
    discovery_prompt_choice is null
    or discovery_prompt_choice in ('yes', 'not-now', 'later')
  );

create table if not exists public.discovery_interactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade,
  guest_session_id uuid references public.guest_sessions(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  artist_id uuid not null references public.profiles(id) on delete cascade,
  interaction_type text not null check (
    interaction_type in (
      'started',
      'skip',
      'not_for_me',
      'valid_listen',
      'completed'
    )
  ),
  listened_seconds integer not null default 0 check (listened_seconds >= 0),
  hidden_until timestamptz,
  created_at timestamptz not null default now(),
  check ((user_id is null) <> (guest_session_id is null))
);

create index if not exists discovery_interactions_user_idx
  on public.discovery_interactions (user_id, created_at desc)
  where user_id is not null;
create index if not exists discovery_interactions_guest_idx
  on public.discovery_interactions (guest_session_id, created_at desc)
  where guest_session_id is not null;
create index if not exists discovery_interactions_song_idx
  on public.discovery_interactions (song_id, interaction_type, created_at desc);

alter table public.discovery_interactions enable row level security;
revoke all on table public.discovery_interactions
  from public, anon, authenticated;

create or replace function public.save_discovery_prompt_choice(
  prompt_choice text,
  continuous_playback boolean,
  snoozed_until timestamptz,
  consent_version smallint default 1
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if prompt_choice not in ('yes', 'not-now', 'later') then
    raise exception 'Invalid discovery prompt choice';
  end if;

  update public.profiles
  set
    continuous_playback_opt_in = continuous_playback,
    continuous_playback_consent_at = case
      when continuous_playback then now()
      else continuous_playback_consent_at
    end,
    discovery_prompt_choice = prompt_choice,
    discovery_prompt_snoozed_until = snoozed_until,
    playback_consent_version = greatest(1, consent_version)
  where id = auth.uid();
end;
$$;

create or replace function public.save_guest_discovery_prompt_choice(
  guest_access_token uuid,
  prompt_choice text,
  continuous_playback boolean,
  snoozed_until timestamptz,
  consent_version smallint default 1
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  active_guest_id uuid;
begin
  if prompt_choice not in ('yes', 'not-now', 'later') then
    raise exception 'Invalid discovery prompt choice';
  end if;

  active_guest_id := public.resolve_guest_session(guest_access_token);
  if active_guest_id is null then
    raise exception 'Guest session unavailable';
  end if;

  update public.guest_sessions
  set
    continuous_playback_opt_in = continuous_playback,
    continuous_playback_consent_at = case
      when continuous_playback then now()
      else continuous_playback_consent_at
    end,
    discovery_prompt_choice = prompt_choice,
    discovery_prompt_snoozed_until = snoozed_until,
    playback_consent_version = greatest(1, consent_version),
    last_seen_at = now()
  where id = active_guest_id;
end;
$$;

create or replace function public.record_discovery_interaction(
  target_song_id uuid,
  interaction text,
  listened_seconds integer default 0
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_artist_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if interaction not in ('started', 'skip', 'not_for_me', 'valid_listen', 'completed') then
    raise exception 'Invalid discovery interaction';
  end if;

  select songs.user_id
  into target_artist_id
  from public.songs
  where songs.id = target_song_id
    and songs.is_active;
  if target_artist_id is null then
    raise exception 'Song unavailable';
  end if;

  insert into public.discovery_interactions (
    user_id,
    song_id,
    artist_id,
    interaction_type,
    listened_seconds,
    hidden_until
  )
  values (
    auth.uid(),
    target_song_id,
    target_artist_id,
    interaction,
    greatest(0, listened_seconds),
    case when interaction = 'not_for_me' then now() + interval '30 days' end
  );
end;
$$;

create or replace function public.record_guest_discovery_interaction(
  guest_access_token uuid,
  target_song_id uuid,
  interaction text,
  listened_seconds integer default 0
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  active_guest_id uuid;
  target_artist_id uuid;
begin
  if interaction not in ('started', 'skip', 'not_for_me', 'valid_listen', 'completed') then
    raise exception 'Invalid discovery interaction';
  end if;
  active_guest_id := public.resolve_guest_session(guest_access_token);
  if active_guest_id is null then
    raise exception 'Guest session unavailable';
  end if;

  select songs.user_id
  into target_artist_id
  from public.songs
  where songs.id = target_song_id
    and songs.is_active;
  if target_artist_id is null then
    raise exception 'Song unavailable';
  end if;

  insert into public.discovery_interactions (
    guest_session_id,
    song_id,
    artist_id,
    interaction_type,
    listened_seconds,
    hidden_until
  )
  values (
    active_guest_id,
    target_song_id,
    target_artist_id,
    interaction,
    greatest(0, listened_seconds),
    case when interaction = 'not_for_me' then now() + interval '30 days' end
  );
end;
$$;

revoke all on function public.save_discovery_prompt_choice(text, boolean, timestamptz, smallint)
  from public, anon, authenticated;
revoke all on function public.save_guest_discovery_prompt_choice(uuid, text, boolean, timestamptz, smallint)
  from public, anon, authenticated;
revoke all on function public.record_discovery_interaction(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.record_guest_discovery_interaction(uuid, uuid, text, integer)
  from public, anon, authenticated;

grant execute on function public.save_discovery_prompt_choice(text, boolean, timestamptz, smallint)
  to authenticated;
grant execute on function public.save_guest_discovery_prompt_choice(uuid, text, boolean, timestamptz, smallint)
  to anon, authenticated;
grant execute on function public.record_discovery_interaction(uuid, text, integer)
  to authenticated;
grant execute on function public.record_guest_discovery_interaction(uuid, uuid, text, integer)
  to anon, authenticated;

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
  member_exposure as (
    select
      listening_sessions.song_id,
      count(*) filter (where listening_sessions.valid_listen_at is not null)
        as member_valid_listens,
      coalesce(sum(listening_sessions.verified_seconds), 0)
        as member_verified_seconds
    from public.listening_sessions
    group by listening_sessions.song_id
  ),
  guest_exposure as (
    select
      guest_listening_sessions.song_id,
      count(*) filter (where guest_listening_sessions.valid_listen_at is not null)
        as guest_valid_listens,
      coalesce(sum(guest_listening_sessions.verified_seconds), 0)
        as guest_verified_seconds
    from public.guest_listening_sessions
    group by guest_listening_sessions.song_id
  ),
  user_history as (
    select
      listening_sessions.song_id,
      count(*) filter (where listening_sessions.valid_listen_at is not null)
        as user_valid_listens,
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
      coalesce(member_exposure.member_verified_seconds, 0)
        + coalesce(guest_exposure.guest_verified_seconds, 0) as global_verified_seconds,
      coalesce(user_history.user_valid_listens, 0) as user_valid_listens,
      user_history.last_heard_at
    from public.songs
    join public.profiles as creators on creators.id = songs.user_id
    cross join viewer
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
      and (
        songs.first_publish_trial_expires_at is null
        or songs.first_publish_trial_claimed_at is not null
        or songs.first_publish_trial_expires_at > now()
      )
      and creators.account_status = 'active'
      and creators.banned_at is null
      and creators.creator_activity_status = 'active'
      and (not coalesce(songs.explicit_content, false) or viewer.show_explicit_content)
      and not exists (
        select 1
        from public.discovery_interactions as hidden
        where hidden.user_id = auth.uid()
          and hidden.song_id = songs.id
          and hidden.interaction_type = 'not_for_me'
          and hidden.hidden_until > now()
      )
  ),
  scored as (
    select
      candidates.*,
      (
        case when candidates.user_valid_listens = 0 then 12000 else 0 end
        + case
            when candidates.last_heard_at is null then 2500
            when candidates.last_heard_at < now() - interval '24 hours' then 1500
            else -25000
          end
        + case when candidates.global_valid_listens = 0 then 3500 else 0 end
        + greatest(0, 6000 - (candidates.global_valid_listens * 500))
        + greatest(0, 1500 - floor(candidates.global_verified_seconds / 60) * 20)
        - (candidates.user_valid_listens * 1500)
        - (candidates.global_valid_listens * 80)
      )::numeric as smart_score
    from candidates
  ),
  artist_rounds as (
    select
      scored.*,
      row_number() over (
        partition by scored.user_id
        order by
          case when scored.last_heard_at >= now() - interval '24 hours' then 1 else 0 end,
          case when scored.user_valid_listens = 0 then 0 else 1 end,
          scored.smart_score desc,
          scored.created_at asc,
          scored.id
      ) as artist_song_round,
      max(scored.smart_score) over (partition by scored.user_id)
        as artist_priority
    from scored
  )
  select
    artist_rounds.id,
    artist_rounds.user_id,
    artist_rounds.title,
    artist_rounds.artist_name,
    artist_rounds.cover_image_url,
    artist_rounds.music_url,
    artist_rounds.platform,
    artist_rounds.content_duration_seconds,
    artist_rounds.featured,
    artist_rounds.created_at,
    artist_rounds.global_valid_listens::numeric as exposure_score,
    artist_rounds.last_heard_at,
    artist_rounds.global_valid_listens,
    artist_rounds.user_valid_listens,
    artist_rounds.smart_score
  from artist_rounds
  order by
    artist_rounds.artist_song_round,
    artist_rounds.artist_priority desc,
    artist_rounds.user_id,
    artist_rounds.smart_score desc
  limit greatest(1, least(coalesce(queue_limit, 100), 100));
$function$;

revoke all on function public.get_workspace_v2_smart_queue(integer)
  from public, anon, authenticated;
grant execute on function public.get_workspace_v2_smart_queue(integer)
  to authenticated, service_role;

drop function if exists public.get_guest_song_queue(uuid, integer);

create or replace function public.get_guest_song_queue(
  guest_access_token uuid,
  queue_limit integer default 200
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
  featured boolean,
  submitted_at timestamptz
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  with active_guest as (
    select public.resolve_guest_session(guest_access_token) as id
  ),
  member_exposure as (
    select
      listening_sessions.song_id,
      count(*) filter (where listening_sessions.valid_listen_at is not null)
        as valid_listens
    from public.listening_sessions
    group by listening_sessions.song_id
  ),
  guest_exposure as (
    select
      guest_listening_sessions.song_id,
      count(*) filter (where guest_listening_sessions.valid_listen_at is not null)
        as valid_listens
    from public.guest_listening_sessions
    group by guest_listening_sessions.song_id
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
      songs.genre,
      songs.song_language,
      songs.feedback_focus,
      songs.country,
      songs.explicit_content,
      coalesce(songs.featured, false) as featured,
      songs.created_at,
      coalesce(member_exposure.valid_listens, 0)
        + coalesce(guest_exposure.valid_listens, 0) as valid_listens,
      exists (
        select 1
        from public.guest_listening_sessions as listens
        where listens.guest_session_id = active_guest.id
          and listens.song_id = songs.id
          and listens.created_at >= now() - interval '24 hours'
      ) as heard_recently
    from public.songs
    join public.profiles as creators on creators.id = songs.user_id
    cross join active_guest
    left join member_exposure on member_exposure.song_id = songs.id
    left join guest_exposure on guest_exposure.song_id = songs.id
    where active_guest.id is not null
      and songs.is_active
      and songs.removed_at is null
      and songs.archived_at is null
      and songs.merged_into_song_id is null
      and not songs.explicit_content
      and songs.approval_status in ('auto_approved', 'approved')
      and songs.queue_tier in ('public', 'sponsored')
      and songs.platform in ('youtube', 'youtube_music', 'soundcloud')
      and (
        songs.first_publish_trial_expires_at is null
        or songs.first_publish_trial_claimed_at is not null
        or songs.first_publish_trial_expires_at > now()
      )
      and creators.account_status = 'active'
      and creators.banned_at is null
      and creators.creator_activity_status = 'active'
      and not exists (
        select 1
        from public.discovery_interactions as hidden
        where hidden.guest_session_id = active_guest.id
          and hidden.song_id = songs.id
          and hidden.interaction_type = 'not_for_me'
          and hidden.hidden_until > now()
      )
  ),
  artist_rounds as (
    select
      candidates.*,
      row_number() over (
        partition by candidates.user_id
        order by
          candidates.heard_recently,
          candidates.valid_listens,
          candidates.created_at asc,
          candidates.id
      ) as artist_song_round,
      min(candidates.valid_listens) over (partition by candidates.user_id)
        as artist_exposure
    from candidates
  )
  select
    artist_rounds.id,
    artist_rounds.user_id,
    artist_rounds.title,
    artist_rounds.artist_name,
    artist_rounds.cover_image_url,
    artist_rounds.music_url,
    artist_rounds.platform,
    artist_rounds.genre,
    artist_rounds.song_language,
    artist_rounds.feedback_focus,
    artist_rounds.country,
    artist_rounds.explicit_content,
    artist_rounds.featured,
    artist_rounds.created_at
  from artist_rounds
  order by
    artist_rounds.artist_song_round,
    artist_rounds.artist_exposure,
    artist_rounds.user_id,
    artist_rounds.valid_listens,
    artist_rounds.created_at
  limit greatest(1, least(queue_limit, 200));
$$;

revoke all on function public.get_guest_song_queue(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.get_guest_song_queue(uuid, integer)
  to anon, authenticated;

comment on function public.get_workspace_v2_smart_queue(integer)
  is 'Organic discovery queue: every artist receives one turn before the same artist repeats.';
comment on function public.get_guest_song_queue(uuid, integer)
  is 'Guest organic discovery queue with artist-level round-robin ordering.';
comment on table public.discovery_interactions
  is 'Private listener choices and verified discovery events; never exposed as public dislikes.';
