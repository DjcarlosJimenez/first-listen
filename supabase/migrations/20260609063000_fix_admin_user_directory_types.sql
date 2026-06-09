-- Match auth.users varchar columns to the RPC's stable text contract.

create or replace function public.admin_list_users(result_limit integer default 1000)
returns table (
  id uuid,
  display_name text,
  email text,
  username text,
  role public.app_role,
  account_status public.account_status,
  creator_activity_status public.creator_activity_status,
  founder_number integer,
  banned_at timestamptz,
  warning_count integer,
  credits integer,
  completed_reviews integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.is_staff() then
    raise exception 'Forbidden';
  end if;

  return query
  select
    profiles.id,
    profiles.display_name,
    coalesce(auth_users.email, '')::text,
    coalesce(
      nullif(auth_users.raw_user_meta_data ->> 'username', ''),
      split_part(coalesce(auth_users.email, ''), '@', 1)
    )::text,
    profiles.role,
    profiles.account_status,
    profiles.creator_activity_status,
    profiles.founder_number,
    profiles.banned_at,
    profiles.warning_count,
    profiles.credits,
    profiles.completed_reviews,
    profiles.created_at
  from public.profiles
  join auth.users as auth_users on auth_users.id = profiles.id
  order by profiles.created_at desc
  limit greatest(1, least(result_limit, 1000));
end;
$$;

revoke all on function public.admin_list_users(integer)
  from public, anon, authenticated;
grant execute on function public.admin_list_users(integer)
  to authenticated;
