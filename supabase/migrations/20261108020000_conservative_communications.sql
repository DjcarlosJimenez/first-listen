-- Conservative, consent-first communications for FirstListen.
-- Active members are served in-app. External contact is opt-in, rate limited,
-- quiet-hour aware, and deduplicated across email and future push delivery.

alter table public.user_notification_preferences
  add column if not exists in_app_music_updates_enabled boolean not null default true,
  add column if not exists email_music_digest_enabled boolean not null default false,
  add column if not exists push_music_updates_enabled boolean not null default false,
  add column if not exists digest_interval_days integer not null default 14,
  add column if not exists quiet_hours_start smallint not null default 21,
  add column if not exists quiet_hours_end smallint not null default 9,
  add column if not exists time_zone text not null default 'America/Chicago',
  add column if not exists preferred_genres text[] not null default array[]::text[],
  add column if not exists email_consent_at timestamptz,
  add column if not exists push_consent_at timestamptz,
  add column if not exists email_unsubscribed_at timestamptz,
  add column if not exists last_digest_sent_at timestamptz,
  add column if not exists last_external_contact_at timestamptz,
  add column if not exists in_app_last_seen_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_notification_digest_interval_check'
  ) then
    alter table public.user_notification_preferences
      add constraint user_notification_digest_interval_check
      check (digest_interval_days in (14, 30));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'user_notification_quiet_start_check'
  ) then
    alter table public.user_notification_preferences
      add constraint user_notification_quiet_start_check
      check (quiet_hours_start between 0 and 23);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'user_notification_quiet_end_check'
  ) then
    alter table public.user_notification_preferences
      add constraint user_notification_quiet_end_check
      check (quiet_hours_end between 0 and 23);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'user_notification_time_zone_check'
  ) then
    alter table public.user_notification_preferences
      add constraint user_notification_time_zone_check
      check (char_length(time_zone) between 1 and 80);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'user_notification_preferred_genres_check'
  ) then
    alter table public.user_notification_preferences
      add constraint user_notification_preferred_genres_check
      check (cardinality(preferred_genres) <= 12);
  end if;
end $$;

create table if not exists public.user_communication_deliveries (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_key text not null check (char_length(event_key) between 8 and 180),
  communication_kind text not null
    check (communication_kind in ('music_digest', 'inactive_reminder', 'artist_update')),
  channel text not null check (channel in ('in_app', 'email', 'push')),
  status text not null default 'processing'
    check (status in ('processing', 'sent', 'skipped', 'failed')),
  subject_song_ids uuid[] not null default array[]::uuid[],
  provider_message_id text,
  failure_code text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, event_key)
);

create index if not exists user_communication_deliveries_recent_idx
  on public.user_communication_deliveries (user_id, created_at desc);

alter table public.user_communication_deliveries enable row level security;
revoke all on table public.user_communication_deliveries
  from public, anon, authenticated;
grant all on table public.user_communication_deliveries to service_role;

drop function if exists public.get_my_communication_preferences();
create or replace function public.get_my_communication_preferences()
returns table (
  in_app_music_updates_enabled boolean,
  email_music_digest_enabled boolean,
  push_music_updates_enabled boolean,
  digest_interval_days integer,
  inactive_community_reminders boolean,
  reminder_interval_days integer,
  quiet_hours_start integer,
  quiet_hours_end integer,
  time_zone text,
  preferred_genres text[],
  email_consent_at timestamptz,
  push_consent_at timestamptz,
  email_unsubscribed_at timestamptz,
  last_external_contact_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    coalesce(preferences.in_app_music_updates_enabled, true),
    coalesce(preferences.email_music_digest_enabled, false),
    coalesce(preferences.push_music_updates_enabled, false),
    coalesce(preferences.digest_interval_days, 14),
    coalesce(preferences.inactive_community_reminders, false),
    coalesce(preferences.reminder_interval_days, 30),
    coalesce(preferences.quiet_hours_start, 21)::integer,
    coalesce(preferences.quiet_hours_end, 9)::integer,
    coalesce(preferences.time_zone, 'America/Chicago'),
    coalesce(preferences.preferred_genres, array[]::text[]),
    preferences.email_consent_at,
    preferences.push_consent_at,
    preferences.email_unsubscribed_at,
    preferences.last_external_contact_at
  from (select auth.uid() as user_id) viewer
  left join public.user_notification_preferences preferences
    on preferences.user_id = viewer.user_id
  where viewer.user_id is not null;
$$;

drop function if exists public.update_my_communication_preferences(
  boolean, boolean, boolean, integer, boolean, integer, integer, integer, text, text[]
);
create or replace function public.update_my_communication_preferences(
  in_app_enabled boolean,
  email_digest_enabled boolean,
  push_updates_enabled boolean,
  digest_days integer,
  inactivity_reminders_enabled boolean,
  inactivity_days integer,
  quiet_start_hour integer,
  quiet_end_hour integer,
  user_time_zone text,
  genres text[]
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  clean_genres text[];
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if digest_days not in (14, 30) then
    raise exception 'Digest interval must be 14 or 30 days';
  end if;
  if inactivity_days not between 14 and 90 then
    raise exception 'Reminder interval must be between 14 and 90 days';
  end if;
  if quiet_start_hour not between 0 and 23 or quiet_end_hour not between 0 and 23 then
    raise exception 'Quiet hours must be between 0 and 23';
  end if;
  if char_length(trim(coalesce(user_time_zone, ''))) not between 1 and 80 then
    raise exception 'A valid time zone is required';
  end if;

  select coalesce(array_agg(value order by value), array[]::text[])
  into clean_genres
  from (
    select distinct left(trim(value), 80) as value
    from unnest(coalesce(genres, array[]::text[])) value
    where trim(value) <> ''
    limit 12
  ) cleaned;

  insert into public.user_notification_preferences (
    user_id,
    in_app_music_updates_enabled,
    email_music_digest_enabled,
    push_music_updates_enabled,
    digest_interval_days,
    inactive_community_reminders,
    reminder_interval_days,
    quiet_hours_start,
    quiet_hours_end,
    time_zone,
    preferred_genres,
    email_consent_at,
    push_consent_at,
    email_unsubscribed_at,
    reminder_consent_at,
    updated_at
  ) values (
    auth.uid(),
    coalesce(in_app_enabled, true),
    coalesce(email_digest_enabled, false),
    false,
    digest_days,
    coalesce(inactivity_reminders_enabled, false),
    inactivity_days,
    quiet_start_hour,
    quiet_end_hour,
    trim(user_time_zone),
    clean_genres,
    case when coalesce(email_digest_enabled, false) then now() else null end,
    null,
    case when coalesce(email_digest_enabled, false) then null else now() end,
    case when coalesce(inactivity_reminders_enabled, false) then now() else null end,
    now()
  )
  on conflict (user_id) do update set
    in_app_music_updates_enabled = excluded.in_app_music_updates_enabled,
    email_music_digest_enabled = excluded.email_music_digest_enabled,
    push_music_updates_enabled = false,
    digest_interval_days = excluded.digest_interval_days,
    inactive_community_reminders = excluded.inactive_community_reminders,
    reminder_interval_days = excluded.reminder_interval_days,
    quiet_hours_start = excluded.quiet_hours_start,
    quiet_hours_end = excluded.quiet_hours_end,
    time_zone = excluded.time_zone,
    preferred_genres = excluded.preferred_genres,
    email_consent_at = case
      when excluded.email_music_digest_enabled then coalesce(
        public.user_notification_preferences.email_consent_at,
        now()
      )
      else null
    end,
    push_consent_at = null,
    email_unsubscribed_at = case
      when excluded.email_music_digest_enabled then null
      else coalesce(public.user_notification_preferences.email_unsubscribed_at, now())
    end,
    reminder_consent_at = case
      when excluded.inactive_community_reminders then coalesce(
        public.user_notification_preferences.reminder_consent_at,
        now()
      )
      else null
    end,
    updated_at = now();

  return true;
end;
$$;

create or replace function public.record_music_update_prompt_seen(prompt_choice text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then return false; end if;
  if prompt_choice not in ('yes', 'not-now', 'later') then
    raise exception 'Unsupported prompt choice';
  end if;

  insert into public.user_notification_preferences (
    user_id,
    in_app_music_updates_enabled,
    in_app_last_seen_at,
    updated_at
  ) values (
    auth.uid(),
    true,
    now(),
    now()
  )
  on conflict (user_id) do update set
    in_app_last_seen_at = now(),
    updated_at = now();
  return true;
end;
$$;

revoke all on function public.get_my_communication_preferences()
  from public, anon, authenticated;
revoke all on function public.update_my_communication_preferences(
  boolean, boolean, boolean, integer, boolean, integer, integer, integer, text, text[]
) from public, anon, authenticated;
revoke all on function public.record_music_update_prompt_seen(text)
  from public, anon, authenticated;

grant execute on function public.get_my_communication_preferences()
  to authenticated;
grant execute on function public.update_my_communication_preferences(
  boolean, boolean, boolean, integer, boolean, integer, integer, integer, text, text[]
) to authenticated;
grant execute on function public.record_music_update_prompt_seen(text)
  to authenticated;

comment on table public.user_communication_deliveries is
  'Server-only ledger. The unique user/event key guarantees one channel per event.';
comment on column public.user_notification_preferences.push_music_updates_enabled is
  'Reserved for a reviewed FCM implementation. The current Android release keeps system notifications disabled.';
