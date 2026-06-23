-- Content taxonomy RLS hardening.
--
-- These tables are passive lookup metadata. Public clients may read active
-- categories and subcategories, but direct client writes should not be allowed.

alter table public.content_categories enable row level security;
alter table public.content_subcategories enable row level security;

drop policy if exists "public read active content categories"
  on public.content_categories;
create policy "public read active content categories"
  on public.content_categories
  for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists "public read active content subcategories"
  on public.content_subcategories;
create policy "public read active content subcategories"
  on public.content_subcategories
  for select
  to anon, authenticated
  using (
    is_active = true
    and exists (
      select 1
      from public.content_categories as category
      where category.id = content_subcategories.category_id
        and category.is_active = true
    )
  );

revoke insert, update, delete, truncate, references, trigger
  on table public.content_categories, public.content_subcategories
  from public, anon, authenticated;

grant select
  on table public.content_categories, public.content_subcategories
  to anon, authenticated;

grant all privileges
  on table public.content_categories, public.content_subcategories
  to service_role;
