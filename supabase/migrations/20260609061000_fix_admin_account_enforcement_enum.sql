-- PostgreSQL does not implicitly cast CASE text output to the account_status
-- enum. Keep moderation actions executable by casting each branch explicitly.

create or replace function public.admin_enforce_account(
  target_user_id uuid,
  enforcement text,
  enforcement_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_role public.app_role;
begin
  if not public.is_staff() then raise exception 'Forbidden'; end if;
  if enforcement not in ('activate', 'suspend', 'ban') then
    raise exception 'Invalid enforcement action';
  end if;
  if enforcement <> 'activate' and char_length(trim(enforcement_reason)) < 3 then
    raise exception 'Enforcement reason is required';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'You cannot enforce your own account';
  end if;

  select role into target_role
  from public.profiles
  where id = target_user_id;
  if not found then raise exception 'User not found'; end if;
  if public.current_user_role() <> 'super_admin' and target_role <> 'user' then
    raise exception 'Only Super Admin can enforce staff accounts';
  end if;

  update public.profiles
  set
    account_status = case
      when enforcement = 'activate'
        then 'active'::public.account_status
      else 'suspended'::public.account_status
    end,
    banned_at = case when enforcement = 'ban' then now() else null end,
    banned_by = case when enforcement = 'ban' then auth.uid() else null end,
    ban_reason = case
      when enforcement = 'ban' then trim(enforcement_reason)
      else null
    end,
    updated_at = now()
  where id = target_user_id;

  insert into public.admin_audit_log (
    actor_id, action, target_type, target_id, details
  )
  values (
    auth.uid(),
    'enforce_account',
    'profile',
    target_user_id,
    jsonb_build_object(
      'enforcement', enforcement,
      'reason', trim(coalesce(enforcement_reason, ''))
    )
  );
end;
$$;

revoke all on function public.admin_enforce_account(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_enforce_account(uuid, text, text)
  to authenticated;
