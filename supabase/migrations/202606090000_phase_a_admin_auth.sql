create table if not exists public.admin_audit_log (
  id uuid primary key default uuid_generate_v4(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (char_length(trim(action)) between 3 and 80),
  target_type text not null check (char_length(trim(target_type)) between 3 and 80),
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_target_idx
  on public.admin_audit_log (target_type, target_id, created_at desc);

alter table public.admin_audit_log enable row level security;

drop policy if exists "super admins read admin audit log"
  on public.admin_audit_log;
create policy "super admins read admin audit log"
  on public.admin_audit_log
  for select
  to authenticated
  using (public.current_user_role() = 'super_admin');

revoke all on table public.admin_audit_log from public, anon, authenticated;
grant select on table public.admin_audit_log to authenticated;

create or replace function public.promote_founder_one_to_super_admin(
  target_user_id uuid,
  expected_email text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  target_profile public.profiles%rowtype;
  target_auth_user auth.users%rowtype;
begin
  if expected_email is null or lower(trim(expected_email)) = '' then
    raise exception 'Expected email is required';
  end if;

  select *
  into target_auth_user
  from auth.users
  where id = target_user_id
  for update;

  if not found then
    raise exception 'Auth user not found';
  end if;
  if lower(target_auth_user.email) <> lower(trim(expected_email)) then
    raise exception 'Auth email does not match the approved Founder account';
  end if;
  if target_auth_user.email_confirmed_at is null then
    raise exception 'Founder account email is not confirmed';
  end if;

  select *
  into target_profile
  from public.profiles
  where id = target_user_id
  for update;

  if not found then
    raise exception 'Founder profile not found';
  end if;
  if target_profile.founder_number <> 1 then
    raise exception 'Target account is not Founder #1';
  end if;
  if target_profile.account_status <> 'active' then
    raise exception 'Founder account is not active';
  end if;
  if target_profile.role <> 'user' then
    raise exception 'Founder account must have the user role before promotion';
  end if;
  if not exists (
    select 1
    from public.founder_claims
    where user_id = target_user_id
      and founder_number = 1
  ) then
    raise exception 'Founder #1 claim is missing';
  end if;
  if exists (
    select 1
    from public.admin_audit_log
    where action = 'bootstrap_super_admin'
      and target_id = target_user_id
  ) then
    raise exception 'Founder #1 bootstrap promotion has already been used';
  end if;

  update public.profiles
  set role = 'super_admin', updated_at = now()
  where id = target_user_id;

  insert into public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  )
  values (
    null,
    'bootstrap_super_admin',
    'profile',
    target_user_id,
    jsonb_build_object(
      'previous_role', target_profile.role,
      'new_role', 'super_admin',
      'founder_number', target_profile.founder_number,
      'source', 'phase_a_one_time_promotion'
    )
  );

  return jsonb_build_object(
    'user_id', target_user_id,
    'role', 'super_admin',
    'founder_number', 1
  );
end;
$$;

revoke all on function public.promote_founder_one_to_super_admin(uuid, text)
  from public, anon, authenticated;
grant execute on function public.promote_founder_one_to_super_admin(uuid, text)
  to service_role;

create or replace function public.admin_set_role(
  target_user_id uuid,
  new_role public.app_role
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_role public.app_role;
begin
  if public.current_user_role() <> 'super_admin' then
    raise exception 'Forbidden';
  end if;
  if target_user_id = auth.uid() and new_role <> 'super_admin' then
    raise exception 'Super Admin cannot demote the active account';
  end if;

  select role
  into previous_role
  from public.profiles
  where id = target_user_id
  for update;
  if not found then
    raise exception 'User not found';
  end if;

  update public.profiles
  set role = new_role, updated_at = now()
  where id = target_user_id;

  if previous_role is distinct from new_role then
    insert into public.admin_audit_log (
      actor_id,
      action,
      target_type,
      target_id,
      details
    )
    values (
      auth.uid(),
      'set_role',
      'profile',
      target_user_id,
      jsonb_build_object(
        'previous_role', previous_role,
        'new_role', new_role
      )
    );
  end if;
end;
$$;

create or replace function public.admin_set_account_status(
  target_user_id uuid,
  new_status public.account_status
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_status public.account_status;
begin
  if public.current_user_role() <> 'super_admin' then
    raise exception 'Forbidden';
  end if;
  if target_user_id = auth.uid() and new_status = 'suspended' then
    raise exception 'Super Admin cannot suspend the active account';
  end if;

  select account_status
  into previous_status
  from public.profiles
  where id = target_user_id
  for update;
  if not found then
    raise exception 'User not found';
  end if;

  update public.profiles
  set account_status = new_status, updated_at = now()
  where id = target_user_id;

  if previous_status is distinct from new_status then
    insert into public.admin_audit_log (
      actor_id,
      action,
      target_type,
      target_id,
      details
    )
    values (
      auth.uid(),
      'set_account_status',
      'profile',
      target_user_id,
      jsonb_build_object(
        'previous_status', previous_status,
        'new_status', new_status
      )
    );
  end if;
end;
$$;

revoke all on function public.admin_set_role(uuid, public.app_role)
  from public, anon, authenticated;
revoke all on function public.admin_set_account_status(uuid, public.account_status)
  from public, anon, authenticated;
grant execute on function public.admin_set_role(uuid, public.app_role)
  to authenticated;
grant execute on function public.admin_set_account_status(uuid, public.account_status)
  to authenticated;
