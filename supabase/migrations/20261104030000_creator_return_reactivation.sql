-- Treat an authenticated return to First Listen as creator activity.
-- This keeps the inactivity lifecycle useful without requiring a creator to
-- publish or review content merely to restore their existing catalog.

create or replace function public.record_creator_return()
returns public.creator_activity_status
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  resulting_status public.creator_activity_status;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.profiles
  set
    last_contribution_at = greatest(
      coalesce(last_contribution_at, created_at),
      now()
    ),
    creator_activity_status = 'active',
    activity_status_changed_at = case
      when creator_activity_status <> 'active' then now()
      else activity_status_changed_at
    end,
    updated_at = now()
  where id = auth.uid()
    and account_status = 'active'
    and banned_at is null
  returning creator_activity_status into resulting_status;

  if resulting_status is null then
    select profiles.creator_activity_status
    into resulting_status
    from public.profiles
    where profiles.id = auth.uid();
  end if;

  return resulting_status;
end;
$$;

revoke all on function public.record_creator_return()
  from public, anon, authenticated;
grant execute on function public.record_creator_return()
  to authenticated;

-- Honor sign-ins that happened shortly before this repair was deployed.
-- This makes the accounts already checked by the owner visible again without
-- requiring another login.
update public.profiles as profiles
set
  last_contribution_at = greatest(
    coalesce(profiles.last_contribution_at, profiles.created_at),
    auth_users.last_sign_in_at
  ),
  creator_activity_status = 'active',
  activity_status_changed_at = case
    when profiles.creator_activity_status <> 'active' then now()
    else profiles.activity_status_changed_at
  end,
  updated_at = now()
from auth.users as auth_users
where profiles.id = auth_users.id
  and auth_users.last_sign_in_at is not null
  and auth_users.last_sign_in_at > now() - interval '14 days'
  and profiles.account_status = 'active'
  and profiles.banned_at is null;
