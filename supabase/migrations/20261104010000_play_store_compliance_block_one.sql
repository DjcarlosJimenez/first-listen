-- Play Store readiness block 1:
-- self-service safety controls, profile reporting, blocking, and removal of
-- user-facing play-to-reward capabilities. Historical ledgers are preserved.

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_user_id),
  constraint user_blocks_no_self_block check (blocker_id <> blocked_user_id)
);

create index if not exists user_blocks_blocked_user_idx
  on public.user_blocks (blocked_user_id, created_at desc);

create table if not exists public.profile_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (
    reason in ('spam', 'harassment', 'impersonation', 'illegal_content', 'copyright', 'other')
  ),
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'open'
    check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  constraint profile_reports_no_self_report check (reporter_id <> reported_user_id)
);

create index if not exists profile_reports_status_idx
  on public.profile_reports (status, created_at desc);
create index if not exists profile_reports_reported_user_idx
  on public.profile_reports (reported_user_id, created_at desc);

alter table public.user_blocks enable row level security;
alter table public.profile_reports enable row level security;

drop policy if exists "users read own blocks" on public.user_blocks;
create policy "users read own blocks"
  on public.user_blocks for select to authenticated
  using (blocker_id = auth.uid());

drop policy if exists "staff read profile reports" on public.profile_reports;
create policy "staff read profile reports"
  on public.profile_reports for select to authenticated
  using (public.current_user_role() in ('super_admin', 'admin', 'moderator'));

revoke all on table public.user_blocks from public, anon, authenticated;
revoke all on table public.profile_reports from public, anon, authenticated;
grant select on table public.user_blocks to authenticated;
grant select on table public.profile_reports to authenticated;

create or replace function public.is_user_blocked(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.user_blocks
    where blocker_id = auth.uid()
      and blocked_user_id = target_user_id
  );
$$;

create or replace function public.set_user_block(
  target_user_id uuid,
  should_block boolean
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if target_user_id is null or target_user_id = auth.uid() then
    raise exception 'A different user is required';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = target_user_id
      and account_status = 'active'
      and banned_at is null
  ) then
    raise exception 'User not found';
  end if;

  if coalesce(should_block, false) then
    insert into public.user_blocks (blocker_id, blocked_user_id)
    values (auth.uid(), target_user_id)
    on conflict do nothing;

    delete from public.artist_follows
    where (follower_id = auth.uid() and artist_id = target_user_id)
       or (follower_id = target_user_id and artist_id = auth.uid());
    return true;
  end if;

  delete from public.user_blocks
  where blocker_id = auth.uid()
    and blocked_user_id = target_user_id;
  return false;
end;
$$;

create or replace function public.get_my_blocked_users()
returns table (
  blocked_user_id uuid,
  display_name text,
  blocked_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    blocks.blocked_user_id,
    profiles.display_name,
    blocks.created_at
  from public.user_blocks as blocks
  join public.profiles on profiles.id = blocks.blocked_user_id
  where blocks.blocker_id = auth.uid()
  order by blocks.created_at desc;
$$;

create or replace function public.report_user_profile(
  target_user_id uuid,
  report_reason text,
  report_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_report_id uuid;
  normalized_reason text := lower(trim(coalesce(report_reason, '')));
  normalized_details text := nullif(trim(coalesce(report_details, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if target_user_id is null or target_user_id = auth.uid() then
    raise exception 'This profile cannot be reported';
  end if;
  if normalized_reason not in (
    'spam', 'harassment', 'impersonation', 'illegal_content', 'copyright', 'other'
  ) then
    raise exception 'Unsupported report reason';
  end if;
  if char_length(coalesce(normalized_details, '')) > 1000 then
    raise exception 'Report details are too long';
  end if;
  if not exists (select 1 from public.profiles where id = target_user_id) then
    raise exception 'Profile not found';
  end if;
  if (
    select count(*)
    from public.profile_reports
    where reporter_id = auth.uid()
      and created_at >= now() - interval '24 hours'
  ) >= 10 then
    raise exception 'Daily profile report limit reached';
  end if;
  if exists (
    select 1
    from public.profile_reports
    where reporter_id = auth.uid()
      and reported_user_id = target_user_id
      and status in ('open', 'reviewing')
      and created_at >= now() - interval '24 hours'
  ) then
    raise exception 'You already reported this profile recently';
  end if;

  insert into public.profile_reports (
    reporter_id, reported_user_id, reason, details
  ) values (
    auth.uid(), target_user_id, normalized_reason, normalized_details
  )
  returning id into new_report_id;
  return new_report_id;
end;
$$;

create or replace function public.admin_resolve_profile_report(
  target_report_id uuid,
  new_status text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  reported_id uuid;
begin
  if public.current_user_role() not in ('super_admin', 'admin', 'moderator') then
    raise exception 'Moderator access required';
  end if;
  if new_status not in ('reviewing', 'resolved', 'dismissed') then
    raise exception 'Unsupported report status';
  end if;

  update public.profile_reports
  set
    status = new_status,
    resolved_at = case when new_status in ('resolved', 'dismissed') then now() else null end,
    resolved_by = case when new_status in ('resolved', 'dismissed') then auth.uid() else null end
  where id = target_report_id
  returning reported_user_id into reported_id;
  if reported_id is null then
    raise exception 'Profile report not found';
  end if;

  insert into public.admin_audit_log (
    actor_id, action, target_type, target_id, details
  ) values (
    auth.uid(), 'profile_report_status_changed', 'profile_report', target_report_id,
    jsonb_build_object('status', new_status, 'reported_user_id', reported_id)
  );
end;
$$;

create or replace function public.get_workspace_v2_safe_queue(
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
stable
security definer
set search_path = pg_catalog, public
as $$
  select queue.*
  from public.get_workspace_v2_smart_queue(100) as queue
  where not exists (
    select 1
    from public.user_blocks
    where (blocker_id = auth.uid() and blocked_user_id = queue.user_id)
       or (blocker_id = queue.user_id and blocked_user_id = auth.uid())
  )
  limit greatest(1, least(coalesce(queue_limit, 100), 100));
$$;

create or replace function public.toggle_follow_artist(
  target_artist_id uuid,
  guest_access_token uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  guest_id uuid;
  guest_name text;
begin
  if not exists (
    select 1 from public.profiles
    where id = target_artist_id
      and account_status = 'active'
      and banned_at is null
  ) then raise exception 'Artist not found'; end if;

  if auth.uid() is not null then
    if target_artist_id = auth.uid() then return false; end if;
    if exists (
      select 1 from public.user_blocks
      where (blocker_id = auth.uid() and blocked_user_id = target_artist_id)
         or (blocker_id = target_artist_id and blocked_user_id = auth.uid())
    ) then
      raise exception 'This follow is unavailable because one of these profiles is blocked';
    end if;

    delete from public.artist_follows
    where follower_id = auth.uid() and artist_id = target_artist_id;
    if found then return false; end if;

    insert into public.artist_follows (follower_id, artist_id)
    values (auth.uid(), target_artist_id)
    on conflict do nothing;
    return true;
  end if;

  guest_id := public.resolve_guest_session(guest_access_token);
  if guest_id is null then raise exception 'Guest profile required'; end if;

  delete from public.guest_artist_follows
  where guest_session_id = guest_id and artist_id = target_artist_id;
  if found then
    delete from public.community_support_events
    where guest_session_id = guest_id
      and artist_id = target_artist_id
      and event_type = 'follow';
    return false;
  end if;

  insert into public.guest_artist_follows (guest_session_id, artist_id)
  values (guest_id, target_artist_id);

  select nickname into guest_name
  from public.guest_sessions
  where id = guest_id;

  insert into public.community_notifications (
    recipient_id, actor_id, actor_display_name,
    event_type, actor_visibility, source_id
  ) values (
    target_artist_id, null, guest_name,
    'follow', 'public', guest_id
  )
  on conflict do nothing;

  insert into public.community_support_events (
    guest_session_id, actor_display_name, artist_id,
    event_type, visibility, source_id
  ) values (
    guest_id, guest_name, target_artist_id,
    'follow', 'public', guest_id
  )
  on conflict do nothing;

  return true;
end;
$$;

revoke all on function public.is_user_blocked(uuid) from public, anon, authenticated;
revoke all on function public.set_user_block(uuid, boolean) from public, anon, authenticated;
revoke all on function public.get_my_blocked_users() from public, anon, authenticated;
revoke all on function public.report_user_profile(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_resolve_profile_report(uuid, text) from public, anon, authenticated;
revoke all on function public.get_workspace_v2_safe_queue(integer) from public, anon, authenticated;
revoke all on function public.toggle_follow_artist(uuid, uuid) from public, anon, authenticated;

grant execute on function public.is_user_blocked(uuid) to authenticated;
grant execute on function public.set_user_block(uuid, boolean) to authenticated;
grant execute on function public.get_my_blocked_users() to authenticated;
grant execute on function public.report_user_profile(uuid, text, text) to authenticated;
grant execute on function public.admin_resolve_profile_report(uuid, text) to authenticated;
grant execute on function public.get_workspace_v2_safe_queue(integer) to authenticated, service_role;
grant execute on function public.toggle_follow_artist(uuid, uuid) to anon, authenticated;

update public.listening_reward_settings
set enabled = false
where id = true;

revoke all on function public.claim_listening_reward()
  from public, anon, authenticated;
revoke all on function public.gift_artist_tokens(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_listening_reward() to service_role;
grant execute on function public.gift_artist_tokens(uuid, integer) to service_role;
