-- First publication trial:
-- lets a new artist verify an email and publish one playable song/video
-- for seven days before explicitly retaining it with a free account.

create table if not exists public.first_publish_trials (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  artist_name text not null check (char_length(artist_name) between 1 and 120),
  title text not null check (char_length(title) between 1 and 120),
  cover_image_url text not null,
  music_url text not null,
  platform public.music_platform not null,
  genre text not null,
  song_language text not null check (
    song_language in (
      'English', 'Spanish', 'Portuguese', 'French', 'German',
      'Italian', 'Instrumental', 'Other'
    )
  ),
  feedback_focus text[] not null default array['General Feedback']::text[],
  country text not null,
  explicit_content boolean not null default false,
  content_kind text not null default 'song' check (
    content_kind in ('song', 'music_video')
  ),
  duration_seconds integer not null check (duration_seconds between 15 and 480),
  claim_token_hash text not null unique,
  source_ip_hash text,
  device_hash text,
  status text not null default 'pending_email' check (
    status in ('pending_email', 'published', 'retained', 'expired', 'cancelled')
  ),
  verification_expires_at timestamptz not null default (now() + interval '1 hour'),
  publication_expires_at timestamptz,
  user_id uuid references public.profiles(id) on delete set null,
  song_id uuid references public.songs(id) on delete set null,
  verified_at timestamptz,
  published_at timestamptz,
  retained_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.first_publish_trials enable row level security;

revoke all on table public.first_publish_trials
  from public, anon, authenticated;

create index if not exists first_publish_trials_email_idx
  on public.first_publish_trials (lower(email), created_at desc);

create index if not exists first_publish_trials_ip_idx
  on public.first_publish_trials (source_ip_hash, created_at desc)
  where source_ip_hash is not null;

create index if not exists first_publish_trials_device_idx
  on public.first_publish_trials (device_hash, created_at desc)
  where device_hash is not null;

create unique index if not exists first_publish_trials_one_completed_email_idx
  on public.first_publish_trials (lower(email))
  where status in ('published', 'retained');

alter table public.songs
  add column if not exists first_publish_trial_expires_at timestamptz,
  add column if not exists first_publish_trial_claimed_at timestamptz;

create index if not exists songs_first_publish_trial_expiry_idx
  on public.songs (first_publish_trial_expires_at)
  where first_publish_trial_expires_at is not null
    and first_publish_trial_claimed_at is null;

create or replace function public.claim_first_publish_trial(
  trial_token_hash text
)
returns table (
  published_song_id uuid,
  publication_expires_at timestamptz,
  retained boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_trial public.first_publish_trials%rowtype;
  new_song_id uuid;
  next_expiration timestamptz;
  authenticated_email text;
  next_classification text;
begin
  if auth.uid() is null then
    raise exception 'Email verification is required.';
  end if;

  authenticated_email := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  if authenticated_email = '' then
    raise exception 'Verified email is required.';
  end if;

  select *
  into target_trial
  from public.first_publish_trials
  where claim_token_hash = trial_token_hash
  for update;

  if not found then
    raise exception 'This publication link is invalid or expired.';
  end if;

  if lower(trim(target_trial.email)) <> authenticated_email then
    raise exception 'Open the link with the same email used for this publication.';
  end if;

  if target_trial.status in ('published', 'retained') then
    if target_trial.user_id <> auth.uid() then
      raise exception 'This publication belongs to another account.';
    end if;
    return query
      select
        target_trial.song_id,
        target_trial.publication_expires_at,
        target_trial.status = 'retained';
    return;
  end if;

  if target_trial.status <> 'pending_email'
    or target_trial.verification_expires_at <= now()
  then
    update public.first_publish_trials
    set status = 'expired', updated_at = now()
    where id = target_trial.id and status = 'pending_email';
    raise exception 'This publication link is invalid or expired.';
  end if;

  if target_trial.platform not in (
    'youtube'::public.music_platform,
    'youtube_music'::public.music_platform,
    'soundcloud'::public.music_platform
  ) then
    raise exception 'Use a YouTube, YouTube Music, or SoundCloud link.';
  end if;

  if exists (
    select 1
    from public.songs
    where user_id = auth.uid()
  ) then
    raise exception 'The free trial is available only for your first publication.';
  end if;

  if exists (
    select 1
    from public.songs
    where lower(trim(music_url)) = lower(trim(target_trial.music_url))
      and removed_at is null
      and archived_at is null
  ) then
    raise exception 'This song has already been published.';
  end if;

  if not public.music_url_matches_platform(
    target_trial.music_url,
    target_trial.platform
  ) then
    raise exception 'Unsupported or invalid music link.';
  end if;

  next_expiration := now() + interval '7 days';
  next_classification :=
    public.content_classification_for_platform(target_trial.platform);

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
    is_active,
    media_vertical,
    content_kind,
    content_duration_seconds,
    queue_tier,
    approval_status,
    content_classification,
    submission_token_cost,
    first_publish_trial_expires_at,
    first_publish_trial_claimed_at
  )
  values (
    auth.uid(),
    trim(target_trial.title),
    trim(target_trial.artist_name),
    trim(target_trial.cover_image_url),
    trim(target_trial.music_url),
    target_trial.platform,
    target_trial.genre,
    target_trial.song_language,
    target_trial.feedback_focus,
    trim(target_trial.country),
    target_trial.explicit_content,
    false,
    true,
    'music',
    target_trial.content_kind,
    target_trial.duration_seconds,
    'public',
    'auto_approved',
    next_classification,
    0,
    next_expiration,
    null
  )
  returning id into new_song_id;

  update public.first_publish_trials
  set
    status = 'published',
    user_id = auth.uid(),
    song_id = new_song_id,
    verified_at = now(),
    published_at = now(),
    publication_expires_at = next_expiration,
    updated_at = now()
  where id = target_trial.id;

  return query select new_song_id, next_expiration, false;
end;
$$;

create or replace function public.retain_first_publish_trial(
  target_song_id uuid
)
returns table (
  retained_song_id uuid,
  retained_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  retained_time timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  update public.songs
  set
    first_publish_trial_claimed_at = coalesce(
      first_publish_trial_claimed_at,
      retained_time
    ),
    first_publish_trial_expires_at = null,
    is_active = true
  where id = target_song_id
    and user_id = auth.uid()
    and (
      first_publish_trial_expires_at is not null
      or first_publish_trial_claimed_at is not null
    );

  if not found then
    raise exception 'Publication not found for this account.';
  end if;

  update public.first_publish_trials as trials
  set
    status = 'retained',
    retained_at = coalesce(trials.retained_at, retained_time),
    publication_expires_at = null,
    updated_at = retained_time
  where trials.song_id = target_song_id
    and trials.user_id = auth.uid();

  return query select target_song_id, retained_time;
end;
$$;

revoke all on function public.claim_first_publish_trial(text)
  from public, anon, authenticated;
revoke all on function public.retain_first_publish_trial(uuid)
  from public, anon, authenticated;

grant execute on function public.claim_first_publish_trial(text)
  to authenticated;
grant execute on function public.retain_first_publish_trial(uuid)
  to authenticated;

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
    songs.feedback_focus,
    songs.country,
    songs.explicit_content,
    coalesce(songs.featured, false),
    songs.created_at
  from public.songs
  join public.profiles as creators on creators.id = songs.user_id
  cross join active_guest
  left join public.spotlight_slots as slots
    on slots.song_id = songs.id
    and (slots.active_from is null or slots.active_from <= now())
    and (slots.active_until is null or slots.active_until > now())
  where active_guest.id is not null
    and songs.is_active
    and songs.removed_at is null
    and songs.archived_at is null
    and songs.merged_into_song_id is null
    and not songs.explicit_content
    and songs.approval_status in ('auto_approved', 'approved')
    and songs.queue_tier in ('public', 'sponsored')
    and (
      songs.first_publish_trial_expires_at is null
      or songs.first_publish_trial_claimed_at is not null
      or songs.first_publish_trial_expires_at > now()
    )
    and creators.account_status = 'active'
    and creators.banned_at is null
  order by
    exists (
      select 1
      from public.guest_listening_sessions as listens
      where listens.guest_session_id = active_guest.id
        and listens.song_id = songs.id
        and listens.created_at >= now() - interval '24 hours'
    ),
    coalesce(songs.featured, false) desc,
    slots.slot_number nulls last,
    songs.created_at asc
  limit greatest(1, least(queue_limit, 200));
$$;

revoke all on function public.get_guest_song_queue(uuid, integer)
  from public, anon, authenticated;

grant execute on function public.get_guest_song_queue(uuid, integer)
  to anon, authenticated;

comment on table public.first_publish_trials is
  'Private staging records for verified first-publication trials.';
comment on function public.claim_first_publish_trial(text) is
  'Atomically publishes a verified first song or video for seven days.';
comment on function public.retain_first_publish_trial(uuid) is
  'Retains the authenticated artist first publication without an expiration.';
