-- Follow-up for the live Priority 25 release:
-- preview mode is opt-in for Founder/Super Admin, and discovery accepts 100 rows.

create or replace function public.get_platform_runtime()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  state public.platform_control_state%rowtype;
  preview_allowed boolean := false;
  preview_active boolean := false;
begin
  select * into state
  from public.platform_control_state
  where id = true;

  if auth.uid() is not null then
    preview_allowed := public.can_manage_platform_control()
      or coalesce((
        select access.can_preview
        from public.platform_preview_access access
        where access.user_id = auth.uid()
      ), false);
    preview_active := preview_allowed and coalesce((
      select access.preview_enabled
      from public.platform_preview_access access
      where access.user_id = auth.uid()
    ), false);
  end if;

  return jsonb_build_object(
    'config', case when preview_active then state.draft_config else state.published_config end,
    'preview_active', preview_active,
    'published_version', state.published_version,
    'draft_revision', state.draft_revision
  );
end;
$$;

create or replace function public.set_my_platform_preview_mode(enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if not public.can_manage_platform_control()
    and not coalesce((
      select access.can_preview
      from public.platform_preview_access access
      where access.user_id = auth.uid()
    ), false)
  then
    raise exception 'Preview access has not been granted.';
  end if;

  insert into public.platform_preview_access (
    user_id, can_preview, preview_enabled, granted_by, granted_at
  )
  values (
    auth.uid(), true, enabled,
    case when public.can_manage_platform_control() then auth.uid() else null end,
    now()
  )
  on conflict (user_id) do update
  set preview_enabled = enabled, updated_at = now();

  return public.get_platform_runtime();
end;
$$;

do $$
declare
  discovery_function text;
begin
  select pg_get_functiondef(
    'public.get_public_discovery_feed(integer)'::regprocedure
  )
  into discovery_function;
  discovery_function := replace(
    discovery_function,
    'least(coalesce(feed_limit, 8), 20)',
    'least(coalesce(feed_limit, 8), 100)'
  );
  execute discovery_function;
end;
$$;

revoke all on function public.get_platform_runtime() from public;
revoke all on function public.set_my_platform_preview_mode(boolean) from public;
grant execute on function public.get_platform_runtime()
  to anon, authenticated, service_role;
grant execute on function public.set_my_platform_preview_mode(boolean)
  to authenticated, service_role;
