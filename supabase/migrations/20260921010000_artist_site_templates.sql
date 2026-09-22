-- Owner-created artist sites. The DJ Carlos site stays on its existing storage
-- and routes; these records are for additional independently managed pages.

create table if not exists public.artist_sites (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,61}$'),
  slug_key text generated always as (lower(slug)) stored,
  name text not null check (char_length(trim(name)) between 2 and 120),
  owner_user_id uuid references auth.users(id) on delete set null,
  published boolean not null default false,
  published_at timestamptz,
  sort_order integer not null default 0,
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 1048576),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artist_sites_reserved_slug check (
    slug_key <> all (array[
      '_next', '__visual-discovery', 'admin', 'api', 'artist', 'artist-template-preview',
      'artists', 'auth',
      'change-password', 'dashboard', 'discover', 'djcarlosjimenez',
      'explicit-content', 'forgot-password', 'guest', 'guidelines',
      'help', 'home', 'legacy', 'login', 'offline', 'owner',
      'paginas-de-artistas', 'player-test', 'ppm-preview', 'privacy', 'profile',
      'qa-discovery', 'reset-password',
      'review', 'signup', 'submit', 'terms', 'verify-email',
      'workspace-v2', 'workspace-v2-preview'
    ])
  )
);

create unique index if not exists artist_sites_slug_key_unique
  on public.artist_sites (slug_key);
create index if not exists artist_sites_directory_order
  on public.artist_sites (sort_order, created_at)
  where published;
create index if not exists artist_sites_owner_idx
  on public.artist_sites (owner_user_id);

alter table public.artist_sites enable row level security;

create policy "published artist sites are public"
  on public.artist_sites for select to anon, authenticated
  using (published);
create policy "assigned artist or owner reads drafts"
  on public.artist_sites for select to authenticated
  using (
    public.is_active_user()
    and (
      owner_user_id = auth.uid()
      or public.current_user_role() = 'super_admin'
    )
  );

revoke all on public.artist_sites from public, anon, authenticated;
grant select (id, slug, slug_key, name, published, sort_order, config, created_at, updated_at)
  on public.artist_sites to anon;
grant select on public.artist_sites to authenticated;

create or replace function public.admin_create_artist_site(
  site_name text,
  site_slug text,
  owner_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  assigned_user_id uuid;
  new_site_id uuid;
begin
  if not public.is_active_user()
    or public.current_user_role() <> 'super_admin' then
    raise exception 'Forbidden';
  end if;

  if nullif(trim(coalesce(owner_email, '')), '') is not null then
    select auth_users.id into assigned_user_id
    from auth.users as auth_users
    join public.profiles on profiles.id = auth_users.id
    where lower(auth_users.email) = lower(trim(owner_email))
      and profiles.account_status = 'active'
      and profiles.banned_at is null
      and auth_users.email_confirmed_at is not null;
    if assigned_user_id is null then
      raise exception 'Artist account not found or email not verified';
    end if;
  end if;

  insert into public.artist_sites (name, slug, owner_user_id)
  values (trim(site_name), trim(site_slug), assigned_user_id)
  returning id into new_site_id;
  return new_site_id;
end;
$$;

create or replace function public.admin_reorder_artist_sites(site_ids uuid[])
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_active_user()
    or public.current_user_role() <> 'super_admin' then
    raise exception 'Forbidden';
  end if;
  if site_ids is null
    or array_length(site_ids, 1) is distinct from
      (select count(*)::integer from public.artist_sites)
    or (select count(distinct listed.id) from unnest(site_ids) as listed(id)) is distinct from
      (select count(*) from public.artist_sites)
    or exists (
      select 1 from unnest(site_ids) as listed(id)
      left join public.artist_sites as sites on sites.id = listed.id
      where sites.id is null
    ) then
    raise exception 'Invalid artist order';
  end if;

  update public.artist_sites as sites
  set sort_order = ordered.position - 1,
      updated_at = now()
  from unnest(site_ids) with ordinality as ordered(id, position)
  where sites.id = ordered.id;
  if not found and array_length(site_ids, 1) > 0 then
    raise exception 'Invalid artist order';
  end if;
end;
$$;

create or replace function public.admin_update_artist_site(
  site_id uuid,
  site_name text,
  site_slug text,
  owner_email text,
  site_published boolean,
  site_sort_order integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  assigned_user_id uuid;
begin
  if not public.is_active_user()
    or public.current_user_role() <> 'super_admin' then
    raise exception 'Forbidden';
  end if;

  if exists (
    select 1 from public.artist_sites as sites
    where sites.id = site_id
      and sites.published_at is not null
      and sites.slug <> trim(site_slug)
  ) then
    raise exception 'A published artist URL cannot be changed';
  end if;

  if nullif(trim(coalesce(owner_email, '')), '') is not null then
    select auth_users.id into assigned_user_id
    from auth.users as auth_users
    join public.profiles on profiles.id = auth_users.id
    where lower(auth_users.email) = lower(trim(owner_email))
      and profiles.account_status = 'active'
      and profiles.banned_at is null
      and auth_users.email_confirmed_at is not null;
    if assigned_user_id is null then
      raise exception 'Artist account not found or email not verified';
    end if;
  end if;

  update public.artist_sites
  set name = trim(site_name),
      slug = trim(site_slug),
      owner_user_id = assigned_user_id,
      published = site_published,
      published_at = case
        when site_published then coalesce(published_at, now())
        else published_at
      end,
      sort_order = site_sort_order,
      updated_at = now()
  where id = site_id;
  if not found then raise exception 'Artist site not found'; end if;
end;
$$;

create or replace function public.admin_list_artist_sites()
returns table (
  id uuid,
  slug text,
  name text,
  owner_user_id uuid,
  owner_email text,
  published boolean,
  slug_locked boolean,
  sort_order integer,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.is_active_user()
    or public.current_user_role() <> 'super_admin' then
    raise exception 'Forbidden';
  end if;

  return query
  select sites.id, sites.slug, sites.name, sites.owner_user_id,
    auth_users.email::text, sites.published,
    sites.published_at is not null, sites.sort_order,
    sites.updated_at
  from public.artist_sites as sites
  left join auth.users as auth_users on auth_users.id = sites.owner_user_id
  order by sites.sort_order, sites.created_at;
end;
$$;

create or replace function public.artist_save_site_config(
  site_id uuid,
  site_config jsonb
)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  saved_at timestamptz;
begin
  if not public.is_active_user() then raise exception 'Forbidden'; end if;
  if site_config is null
    or jsonb_typeof(site_config) <> 'object'
    or octet_length(site_config::text) > 1048576 then
    raise exception 'Invalid artist site content';
  end if;

  update public.artist_sites
  set config = site_config,
      updated_at = now()
  where id = site_id
    and (
      owner_user_id = auth.uid()
      or public.current_user_role() = 'super_admin'
    )
  returning updated_at into saved_at;
  if saved_at is null then raise exception 'Forbidden'; end if;
  return saved_at;
end;
$$;

revoke all on function public.admin_create_artist_site(text, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_update_artist_site(uuid, text, text, text, boolean, integer)
  from public, anon, authenticated;
revoke all on function public.admin_list_artist_sites()
  from public, anon, authenticated;
revoke all on function public.admin_reorder_artist_sites(uuid[])
  from public, anon, authenticated;
revoke all on function public.artist_save_site_config(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_create_artist_site(text, text, text)
  to authenticated;
grant execute on function public.admin_update_artist_site(uuid, text, text, text, boolean, integer)
  to authenticated;
grant execute on function public.admin_list_artist_sites()
  to authenticated;
grant execute on function public.admin_reorder_artist_sites(uuid[])
  to authenticated;
grant execute on function public.artist_save_site_config(uuid, jsonb)
  to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'artist-site-assets', 'artist-site-assets', true, 20971520,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy "artist site owner uploads own assets"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'artist-site-assets'
    and public.is_active_user()
    and exists (
      select 1 from public.artist_sites as sites
      where sites.id::text = split_part(name, '/', 1)
        and (
          sites.owner_user_id = auth.uid()
          or public.current_user_role() = 'super_admin'
        )
    )
  );

create policy "artist site owner removes own assets"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'artist-site-assets'
    and public.is_active_user()
    and exists (
      select 1 from public.artist_sites as sites
      where sites.id::text = split_part(name, '/', 1)
        and (
          sites.owner_user_id = auth.uid()
          or public.current_user_role() = 'super_admin'
        )
    )
  );
