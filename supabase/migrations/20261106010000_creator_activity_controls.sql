-- Make creator inactivity an owner/admin controlled policy instead of a
-- hard-coded catalog visibility rule. The policy starts disabled so the
-- complete eligible catalog remains available while FirstListen grows.

create table if not exists public.creator_activity_settings (
  id boolean primary key default true check (id),
  inactivity_enabled boolean not null default false,
  paused_after_days integer not null default 14
    check (paused_after_days between 1 and 3649),
  archived_after_days integer not null default 60
    check (archived_after_days between 2 and 3650),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  check (archived_after_days > paused_after_days)
);

insert into public.creator_activity_settings (id, inactivity_enabled)
values (true, false)
on conflict (id) do nothing;

alter table public.creator_activity_settings enable row level security;
revoke all on table public.creator_activity_settings
  from public, anon, authenticated;

create or replace function public.admin_get_creator_activity_settings()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  settings public.creator_activity_settings%rowtype;
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Administrator access required';
  end if;

  select * into settings
  from public.creator_activity_settings
  where id = true;

  return jsonb_build_object(
    'inactivity_enabled', settings.inactivity_enabled,
    'paused_after_days', settings.paused_after_days,
    'archived_after_days', settings.archived_after_days,
    'updated_at', settings.updated_at,
    'updated_by', settings.updated_by
  );
end;
$$;

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
  settings public.creator_activity_settings%rowtype;
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

  select * into settings
  from public.creator_activity_settings
  where id = true;

  with effective_status as (
    select
      profiles.id,
      case
        when not settings.inactivity_enabled
          then 'active'::public.creator_activity_status
        when coalesce(profiles.last_contribution_at, profiles.created_at)
          <= now() - make_interval(days => settings.archived_after_days)
          then 'archived'::public.creator_activity_status
        when coalesce(profiles.last_contribution_at, profiles.created_at)
          <= now() - make_interval(days => settings.paused_after_days)
          then 'paused'::public.creator_activity_status
        else 'active'::public.creator_activity_status
      end as next_status
    from public.profiles
    where (target_user_id is null or profiles.id = target_user_id)
      and profiles.account_status = 'active'
      and profiles.banned_at is null
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

create or replace function public.admin_update_creator_activity_settings(
  activity_enabled boolean,
  pause_after_days integer,
  archive_after_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_settings public.creator_activity_settings%rowtype;
  next_settings public.creator_activity_settings%rowtype;
  refreshed_profiles integer := 0;
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Administrator access required';
  end if;

  if activity_enabled is null then
    raise exception 'Activity policy state is required';
  end if;
  if pause_after_days not between 1 and 3649 then
    raise exception 'Pause days must be between 1 and 3649';
  end if;
  if archive_after_days not between 2 and 3650
    or archive_after_days <= pause_after_days
  then
    raise exception 'Archive days must be greater than pause days';
  end if;

  select * into previous_settings
  from public.creator_activity_settings
  where id = true
  for update;

  update public.creator_activity_settings
  set
    inactivity_enabled = activity_enabled,
    paused_after_days = pause_after_days,
    archived_after_days = archive_after_days,
    updated_at = now(),
    updated_by = auth.uid()
  where id = true
  returning * into next_settings;

  refreshed_profiles := public.refresh_creator_activity_status(null);

  insert into public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  )
  values (
    auth.uid(),
    'update_creator_activity_policy',
    'platform_setting',
    null,
    jsonb_build_object(
      'previous_enabled', previous_settings.inactivity_enabled,
      'enabled', next_settings.inactivity_enabled,
      'previous_paused_after_days', previous_settings.paused_after_days,
      'paused_after_days', next_settings.paused_after_days,
      'previous_archived_after_days', previous_settings.archived_after_days,
      'archived_after_days', next_settings.archived_after_days,
      'profiles_refreshed', refreshed_profiles
    )
  );

  return jsonb_build_object(
    'inactivity_enabled', next_settings.inactivity_enabled,
    'paused_after_days', next_settings.paused_after_days,
    'archived_after_days', next_settings.archived_after_days,
    'updated_at', next_settings.updated_at,
    'updated_by', next_settings.updated_by,
    'profiles_refreshed', refreshed_profiles
  );
end;
$$;

-- The policy is intentionally disabled at launch. Restore all eligible
-- profiles immediately so their existing public songs return to rotation.
update public.profiles
set
  creator_activity_status = 'active',
  activity_status_changed_at = now(),
  updated_at = now()
where account_status = 'active'
  and banned_at is null
  and creator_activity_status <> 'active';

revoke all on function public.admin_get_creator_activity_settings()
  from public, anon, authenticated;
revoke all on function public.refresh_creator_activity_status(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_update_creator_activity_settings(
  boolean,
  integer,
  integer
) from public, anon, authenticated;

grant execute on function public.admin_get_creator_activity_settings()
  to authenticated;
grant execute on function public.refresh_creator_activity_status(uuid)
  to authenticated;
grant execute on function public.admin_update_creator_activity_settings(
  boolean,
  integer,
  integer
) to authenticated;
