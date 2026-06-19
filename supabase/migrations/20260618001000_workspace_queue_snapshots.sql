-- Phase 1 listening continuity: passive Workspace V2 queue resume snapshots.
-- This stores only queue/playback position metadata. It does not affect
-- playback validation, Time Bank, rewards, reviews, or discovery ranking.

create table if not exists public.workspace_queue_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  guest_session_id uuid references public.guest_sessions(id) on delete cascade,
  queue_id text not null,
  queue_mode text not null,
  queue_source text not null,
  queue_title text not null,
  song_ids uuid[] not null default '{}',
  current_song_id uuid not null references public.songs(id) on delete cascade,
  current_index integer not null default 0 check (current_index >= 0),
  playback_position_seconds numeric not null default 0 check (playback_position_seconds >= 0),
  duration_seconds numeric check (duration_seconds is null or duration_seconds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  constraint workspace_queue_snapshot_single_owner check (
    (user_id is not null and guest_session_id is null)
    or (user_id is null and guest_session_id is not null)
  ),
  constraint workspace_queue_snapshot_current_in_queue check (
    current_song_id = any(song_ids)
  )
);

create unique index if not exists workspace_queue_snapshots_user_idx
  on public.workspace_queue_snapshots(user_id)
  where user_id is not null;

create unique index if not exists workspace_queue_snapshots_guest_idx
  on public.workspace_queue_snapshots(guest_session_id)
  where guest_session_id is not null;

create index if not exists workspace_queue_snapshots_expires_idx
  on public.workspace_queue_snapshots(expires_at);

alter table public.workspace_queue_snapshots enable row level security;

drop policy if exists "workspace queue snapshots are user readable"
  on public.workspace_queue_snapshots;
create policy "workspace queue snapshots are user readable"
  on public.workspace_queue_snapshots for select
  using (auth.uid() = user_id);

revoke all on table public.workspace_queue_snapshots from public, anon, authenticated;
grant select on table public.workspace_queue_snapshots to authenticated;

create or replace function public.save_workspace_queue_snapshot(
  snapshot_queue_id text,
  snapshot_queue_mode text,
  snapshot_queue_source text,
  snapshot_queue_title text,
  snapshot_song_ids uuid[],
  snapshot_current_song_id uuid,
  snapshot_current_index integer,
  snapshot_playback_position_seconds numeric default 0,
  snapshot_duration_seconds numeric default null
)
returns table(saved boolean, snapshot_id uuid, updated_at timestamptz)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  saved_snapshot_id uuid;
  saved_updated_at timestamptz;
  normalized_song_ids uuid[] := coalesce(snapshot_song_ids, '{}');
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_active_user() then
    raise exception 'Active account required';
  end if;

  if coalesce(array_length(normalized_song_ids, 1), 0) = 0 then
    raise exception 'Queue snapshot requires at least one song';
  end if;

  if snapshot_current_song_id is null
    or not snapshot_current_song_id = any(normalized_song_ids)
  then
    raise exception 'Current song must be included in queue snapshot';
  end if;

  insert into public.workspace_queue_snapshots (
    user_id,
    queue_id,
    queue_mode,
    queue_source,
    queue_title,
    song_ids,
    current_song_id,
    current_index,
    playback_position_seconds,
    duration_seconds,
    expires_at
  )
  values (
    auth.uid(),
    left(coalesce(nullif(trim(snapshot_queue_id), ''), 'workspace-v2'), 120),
    left(coalesce(nullif(trim(snapshot_queue_mode), ''), 'discovery'), 40),
    left(coalesce(nullif(trim(snapshot_queue_source), ''), 'manual'), 60),
    left(coalesce(nullif(trim(snapshot_queue_title), ''), 'First Listen'), 160),
    normalized_song_ids,
    snapshot_current_song_id,
    greatest(0, snapshot_current_index),
    greatest(0, coalesce(snapshot_playback_position_seconds, 0)),
    case
      when snapshot_duration_seconds is null then null
      else greatest(0, snapshot_duration_seconds)
    end,
    now() + interval '7 days'
  )
  on conflict (user_id) where user_id is not null
  do update set
    queue_id = excluded.queue_id,
    queue_mode = excluded.queue_mode,
    queue_source = excluded.queue_source,
    queue_title = excluded.queue_title,
    song_ids = excluded.song_ids,
    current_song_id = excluded.current_song_id,
    current_index = excluded.current_index,
    playback_position_seconds = excluded.playback_position_seconds,
    duration_seconds = excluded.duration_seconds,
    updated_at = now(),
    expires_at = excluded.expires_at
  returning id, workspace_queue_snapshots.updated_at
  into saved_snapshot_id, saved_updated_at;

  return query select true, saved_snapshot_id, saved_updated_at;
end;
$function$;

create or replace function public.get_workspace_queue_snapshot()
returns table(
  snapshot_id uuid,
  queue_id text,
  queue_mode text,
  queue_source text,
  queue_title text,
  song_ids uuid[],
  current_song_id uuid,
  current_index integer,
  playback_position_seconds numeric,
  duration_seconds numeric,
  updated_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select
    snapshots.id,
    snapshots.queue_id,
    snapshots.queue_mode,
    snapshots.queue_source,
    snapshots.queue_title,
    snapshots.song_ids,
    snapshots.current_song_id,
    snapshots.current_index,
    snapshots.playback_position_seconds,
    snapshots.duration_seconds,
    snapshots.updated_at,
    snapshots.expires_at
  from public.workspace_queue_snapshots as snapshots
  where snapshots.user_id = auth.uid()
    and snapshots.expires_at > now()
  limit 1;
$function$;

create or replace function public.clear_workspace_queue_snapshot()
returns table(cleared boolean)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  delete from public.workspace_queue_snapshots
  where user_id = auth.uid();

  return query select true;
end;
$function$;

create or replace function public.save_guest_workspace_queue_snapshot(
  guest_access_token uuid,
  snapshot_queue_id text,
  snapshot_queue_mode text,
  snapshot_queue_source text,
  snapshot_queue_title text,
  snapshot_song_ids uuid[],
  snapshot_current_song_id uuid,
  snapshot_current_index integer,
  snapshot_playback_position_seconds numeric default 0,
  snapshot_duration_seconds numeric default null
)
returns table(saved boolean, snapshot_id uuid, updated_at timestamptz)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  resolved_guest_id uuid;
  saved_snapshot_id uuid;
  saved_updated_at timestamptz;
  normalized_song_ids uuid[] := coalesce(snapshot_song_ids, '{}');
begin
  resolved_guest_id := public.resolve_guest_session(guest_access_token);
  if resolved_guest_id is null then
    raise exception 'Guest session not found';
  end if;

  if coalesce(array_length(normalized_song_ids, 1), 0) = 0 then
    raise exception 'Queue snapshot requires at least one song';
  end if;

  if snapshot_current_song_id is null
    or not snapshot_current_song_id = any(normalized_song_ids)
  then
    raise exception 'Current song must be included in queue snapshot';
  end if;

  insert into public.workspace_queue_snapshots (
    guest_session_id,
    queue_id,
    queue_mode,
    queue_source,
    queue_title,
    song_ids,
    current_song_id,
    current_index,
    playback_position_seconds,
    duration_seconds,
    expires_at
  )
  values (
    resolved_guest_id,
    left(coalesce(nullif(trim(snapshot_queue_id), ''), 'workspace-v2-guest'), 120),
    left(coalesce(nullif(trim(snapshot_queue_mode), ''), 'discovery'), 40),
    left(coalesce(nullif(trim(snapshot_queue_source), ''), 'random'), 60),
    left(coalesce(nullif(trim(snapshot_queue_title), ''), 'Guest Discovery'), 160),
    normalized_song_ids,
    snapshot_current_song_id,
    greatest(0, snapshot_current_index),
    greatest(0, coalesce(snapshot_playback_position_seconds, 0)),
    case
      when snapshot_duration_seconds is null then null
      else greatest(0, snapshot_duration_seconds)
    end,
    now() + interval '7 days'
  )
  on conflict (guest_session_id) where guest_session_id is not null
  do update set
    queue_id = excluded.queue_id,
    queue_mode = excluded.queue_mode,
    queue_source = excluded.queue_source,
    queue_title = excluded.queue_title,
    song_ids = excluded.song_ids,
    current_song_id = excluded.current_song_id,
    current_index = excluded.current_index,
    playback_position_seconds = excluded.playback_position_seconds,
    duration_seconds = excluded.duration_seconds,
    updated_at = now(),
    expires_at = excluded.expires_at
  returning id, workspace_queue_snapshots.updated_at
  into saved_snapshot_id, saved_updated_at;

  return query select true, saved_snapshot_id, saved_updated_at;
end;
$function$;

create or replace function public.get_guest_workspace_queue_snapshot(
  guest_access_token uuid
)
returns table(
  snapshot_id uuid,
  queue_id text,
  queue_mode text,
  queue_source text,
  queue_title text,
  song_ids uuid[],
  current_song_id uuid,
  current_index integer,
  playback_position_seconds numeric,
  duration_seconds numeric,
  updated_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  with active_guest as (
    select public.resolve_guest_session(guest_access_token) as id
  )
  select
    snapshots.id,
    snapshots.queue_id,
    snapshots.queue_mode,
    snapshots.queue_source,
    snapshots.queue_title,
    snapshots.song_ids,
    snapshots.current_song_id,
    snapshots.current_index,
    snapshots.playback_position_seconds,
    snapshots.duration_seconds,
    snapshots.updated_at,
    snapshots.expires_at
  from public.workspace_queue_snapshots as snapshots
  cross join active_guest
  where snapshots.guest_session_id = active_guest.id
    and snapshots.expires_at > now()
  limit 1;
$function$;

create or replace function public.clear_guest_workspace_queue_snapshot(
  guest_access_token uuid
)
returns table(cleared boolean)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  resolved_guest_id uuid;
begin
  resolved_guest_id := public.resolve_guest_session(guest_access_token);
  if resolved_guest_id is null then
    raise exception 'Guest session not found';
  end if;

  delete from public.workspace_queue_snapshots
  where guest_session_id = resolved_guest_id;

  return query select true;
end;
$function$;

revoke all on function public.save_workspace_queue_snapshot(
  text, text, text, text, uuid[], uuid, integer, numeric, numeric
) from public, anon, authenticated;
revoke all on function public.get_workspace_queue_snapshot()
  from public, anon, authenticated;
revoke all on function public.clear_workspace_queue_snapshot()
  from public, anon, authenticated;
revoke all on function public.save_guest_workspace_queue_snapshot(
  uuid, text, text, text, text, uuid[], uuid, integer, numeric, numeric
) from public, anon, authenticated;
revoke all on function public.get_guest_workspace_queue_snapshot(uuid)
  from public, anon, authenticated;
revoke all on function public.clear_guest_workspace_queue_snapshot(uuid)
  from public, anon, authenticated;

grant execute on function public.save_workspace_queue_snapshot(
  text, text, text, text, uuid[], uuid, integer, numeric, numeric
) to authenticated;
grant execute on function public.get_workspace_queue_snapshot()
  to authenticated;
grant execute on function public.clear_workspace_queue_snapshot()
  to authenticated;

grant execute on function public.save_guest_workspace_queue_snapshot(
  uuid, text, text, text, text, uuid[], uuid, integer, numeric, numeric
) to anon, authenticated;
grant execute on function public.get_guest_workspace_queue_snapshot(uuid)
  to anon, authenticated;
grant execute on function public.clear_guest_workspace_queue_snapshot(uuid)
  to anon, authenticated;
