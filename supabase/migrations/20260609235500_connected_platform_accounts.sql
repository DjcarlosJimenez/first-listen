-- Future-ready provider account metadata. OAuth credentials and provider
-- tokens are intentionally excluded until each connection flow is approved.

create table if not exists public.connected_platform_accounts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (
    platform in (
      'spotify',
      'apple_music',
      'youtube',
      'soundcloud',
      'tiktok'
    )
  ),
  connection_status text not null default 'not_connected' check (
    connection_status in (
      'not_connected',
      'pending',
      'connected',
      'needs_reauth',
      'revoked'
    )
  ),
  provider_account_id text,
  provider_username text,
  display_name text,
  profile_url text,
  avatar_url text,
  creator_account boolean not null default false,
  provider_verified boolean not null default false,
  follower_count bigint check (follower_count is null or follower_count >= 0),
  following_count bigint check (following_count is null or following_count >= 0),
  content_count bigint check (content_count is null or content_count >= 0),
  likes_count bigint check (likes_count is null or likes_count >= 0),
  show_on_public_profile boolean not null default true,
  scopes text[] not null default array[]::text[],
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  connected_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform)
);

create index if not exists connected_platform_accounts_user_status_idx
  on public.connected_platform_accounts (user_id, connection_status);

alter table public.connected_platform_accounts enable row level security;

revoke all on table public.connected_platform_accounts
  from public, anon, authenticated;
grant select on table public.connected_platform_accounts to authenticated;

create policy "users read own connected platforms"
  on public.connected_platform_accounts
  for select
  to authenticated
  using (user_id = auth.uid());

create trigger connected_platform_accounts_set_updated_at
  before update on public.connected_platform_accounts
  for each row execute function public.set_updated_at();

create or replace function public.connected_platforms_health_report()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'table_exists',
      to_regclass('public.connected_platform_accounts') is not null,
    'rls_enabled',
      coalesce((
        select relrowsecurity
        from pg_class
        where oid = 'public.connected_platform_accounts'::regclass
      ), false),
    'owner_read_policy', exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'connected_platform_accounts'
        and policyname = 'users read own connected platforms'
    ),
    'authenticated_select_only',
      has_table_privilege(
        'authenticated',
        'public.connected_platform_accounts',
        'SELECT'
      )
      and not has_table_privilege(
        'authenticated',
        'public.connected_platform_accounts',
        'INSERT'
      )
      and not has_table_privilege(
        'authenticated',
        'public.connected_platform_accounts',
        'UPDATE'
      )
      and not has_table_privilege(
        'authenticated',
        'public.connected_platform_accounts',
        'DELETE'
      ),
    'invalid_platforms', (
      select count(*)::integer
      from public.connected_platform_accounts
      where platform not in (
        'spotify',
        'apple_music',
        'youtube',
        'soundcloud',
        'tiktok'
      )
    ),
    'invalid_statuses', (
      select count(*)::integer
      from public.connected_platform_accounts
      where connection_status not in (
        'not_connected',
        'pending',
        'connected',
        'needs_reauth',
        'revoked'
      )
    ),
    'duplicate_accounts', (
      select count(*)::integer
      from (
        select user_id, platform
        from public.connected_platform_accounts
        group by user_id, platform
        having count(*) > 1
      ) duplicates
    ),
    'orphan_accounts', (
      select count(*)::integer
      from public.connected_platform_accounts as accounts
      left join public.profiles on profiles.id = accounts.user_id
      where profiles.id is null
    )
  );
$$;

revoke all on function public.connected_platforms_health_report()
  from public, anon, authenticated;
grant execute on function public.connected_platforms_health_report()
  to service_role;
