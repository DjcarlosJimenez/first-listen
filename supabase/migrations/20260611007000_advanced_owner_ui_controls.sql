-- Advanced Owner UI Control Center: allow the new UI configuration section.
-- Non-destructive. No tables, columns, records, policies, or triggers are removed.

create or replace function public.admin_update_control_draft(
  section_key text,
  section_value jsonb,
  change_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  previous_config jsonb;
  next_config jsonb;
begin
  if not public.can_manage_platform_control() then
    raise exception 'Super Admin access required.';
  end if;

  if section_key not in (
    'theme', 'homepage', 'ui', 'discovery', 'spotlight', 'artistProfile',
    'tokens', 'permissions', 'experiments', 'announcements'
  ) then
    raise exception 'Unsupported configuration section.';
  end if;

  if section_key in ('permissions', 'experiments')
    and not public.is_founder_controller()
  then
    raise exception 'Founder controller access required.';
  end if;

  select draft_config into previous_config
  from public.platform_control_state
  where id = true
  for update;

  next_config := jsonb_set(previous_config, array[section_key], section_value, true);
  perform public.validate_platform_control_config(next_config);

  update public.platform_control_state
  set
    draft_config = next_config,
    draft_revision = draft_revision + 1,
    has_unpublished_changes = next_config is distinct from published_config,
    updated_by = auth.uid(),
    updated_at = now()
  where id = true;

  insert into public.admin_audit_log (
    actor_id, action, target_type, details
  )
  values (
    auth.uid(),
    'platform_control_draft_updated',
    'platform_control_state',
    jsonb_build_object(
      'section', section_key,
      'description', left(coalesce(change_description, ''), 500)
    )
  );

  return public.admin_get_control_center();
end;
$$;

revoke all on function public.admin_update_control_draft(text, jsonb, text)
  from public, anon;
grant execute on function public.admin_update_control_draft(text, jsonb, text)
  to authenticated;
