-- Content Classification Architecture Phase 1.
-- Passive metadata only: no playback, queue, discovery, reward, submission,
-- review, or metric behavior is changed by this migration.

create table if not exists public.content_categories (
  id uuid primary key default uuid_generate_v4(),
  slug text not null unique,
  label_en text not null,
  label_es text not null,
  content_type text not null,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_subcategories (
  id uuid primary key default uuid_generate_v4(),
  category_id uuid not null references public.content_categories(id) on delete cascade,
  slug text not null,
  label_en text not null,
  label_es text not null,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, slug)
);

alter table public.content_categories
  drop constraint if exists content_categories_slug_check;
alter table public.content_categories
  add constraint content_categories_slug_check
  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');

alter table public.content_categories
  drop constraint if exists content_categories_content_type_check;
alter table public.content_categories
  add constraint content_categories_content_type_check
  check (
    content_type in (
      'music',
      'music_video',
      'video',
      'podcast',
      'gaming',
      'tutorial',
      'comedy',
      'reaction',
      'vlog',
      'other'
    )
  );

alter table public.content_categories
  drop constraint if exists content_categories_label_en_check;
alter table public.content_categories
  add constraint content_categories_label_en_check
  check (char_length(trim(label_en)) between 1 and 80);

alter table public.content_categories
  drop constraint if exists content_categories_label_es_check;
alter table public.content_categories
  add constraint content_categories_label_es_check
  check (char_length(trim(label_es)) between 1 and 80);

alter table public.content_subcategories
  drop constraint if exists content_subcategories_slug_check;
alter table public.content_subcategories
  add constraint content_subcategories_slug_check
  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');

alter table public.content_subcategories
  drop constraint if exists content_subcategories_label_en_check;
alter table public.content_subcategories
  add constraint content_subcategories_label_en_check
  check (char_length(trim(label_en)) between 1 and 80);

alter table public.content_subcategories
  drop constraint if exists content_subcategories_label_es_check;
alter table public.content_subcategories
  add constraint content_subcategories_label_es_check
  check (char_length(trim(label_es)) between 1 and 80);

create index if not exists content_categories_active_order_idx
  on public.content_categories (is_active, sort_order, label_en);

create index if not exists content_subcategories_category_order_idx
  on public.content_subcategories (category_id, is_active, sort_order, label_en);

insert into public.content_categories (
  slug,
  label_en,
  label_es,
  content_type,
  sort_order
)
values
  ('music', 'Music', 'Musica', 'music', 10),
  ('music-video', 'Music Videos', 'Videos musicales', 'music_video', 20),
  ('video', 'General Videos', 'Videos generales', 'video', 30),
  ('podcast', 'Podcasts', 'Podcasts', 'podcast', 40),
  ('gaming', 'Gaming', 'Gaming', 'gaming', 50),
  ('tutorial', 'Tutorials', 'Tutoriales', 'tutorial', 60),
  ('comedy', 'Comedy', 'Comedia', 'comedy', 70),
  ('reaction', 'Reactions', 'Reacciones', 'reaction', 80),
  ('vlog', 'Vlogs', 'Vlogs', 'vlog', 90),
  ('other', 'Other', 'Otro', 'other', 100)
on conflict (slug) do update
set
  label_en = excluded.label_en,
  label_es = excluded.label_es,
  content_type = excluded.content_type,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.content_subcategories (
  category_id,
  slug,
  label_en,
  label_es,
  sort_order
)
select
  categories.id,
  subcategories.slug,
  subcategories.label_en,
  subcategories.label_es,
  subcategories.sort_order
from (
  values
    ('music', 'cumbia', 'Cumbia', 'Cumbia', 10),
    ('music', 'regional-mexicano', 'Regional Mexican', 'Regional Mexicano', 20),
    ('music', 'hip-hop', 'Hip-Hop', 'Hip-Hop', 30),
    ('music', 'bachata', 'Bachata', 'Bachata', 40),
    ('music', 'chilena', 'Chilena', 'Chilena', 50),
    ('music', 'reggaeton', 'Reggaeton', 'Reggaeton', 60),
    ('music', 'salsa', 'Salsa', 'Salsa', 70),
    ('music', 'pop', 'Pop', 'Pop', 80),
    ('music', 'rock', 'Rock', 'Rock', 90),
    ('music', 'edm', 'EDM', 'EDM', 100),
    ('music', 'country', 'Country', 'Country', 110),
    ('music', 'indie', 'Indie', 'Indie', 120),
    ('music', 'alternative', 'Alternative', 'Alternativo', 130),
    ('music', 'jazz', 'Jazz', 'Jazz', 140),
    ('music', 'classical', 'Classical', 'Clasica', 150),
    ('music', 'instrumental', 'Instrumental', 'Instrumental', 160),
    ('music', 'other', 'Other', 'Otro', 999),
    ('video', 'general', 'General', 'General', 10),
    ('podcast', 'general', 'General', 'General', 10),
    ('gaming', 'gameplay', 'Gameplay', 'Gameplay', 10),
    ('tutorial', 'general', 'General', 'General', 10),
    ('comedy', 'general', 'General', 'General', 10),
    ('reaction', 'general', 'General', 'General', 10),
    ('vlog', 'general', 'General', 'General', 10),
    ('other', 'other', 'Other', 'Otro', 999)
) as subcategories(category_slug, slug, label_en, label_es, sort_order)
join public.content_categories as categories
  on categories.slug = subcategories.category_slug
on conflict (category_id, slug) do update
set
  label_en = excluded.label_en,
  label_es = excluded.label_es,
  sort_order = excluded.sort_order,
  updated_at = now();

alter table public.songs
  add column if not exists content_type text,
  add column if not exists category text,
  add column if not exists subcategory text,
  add column if not exists playback_source text;

update public.songs
set
  content_type = coalesce(
    content_type,
    case
      when content_kind = 'music_video' then 'music_video'
      when media_vertical = 'video' then 'video'
      else 'music'
    end
  ),
  category = coalesce(
    category,
    case
      when media_vertical = 'video' and content_kind <> 'music_video'
        then 'video'
      else 'music'
    end
  ),
  subcategory = coalesce(
    subcategory,
    case
      when genre is null or trim(genre) = '' then null
      when lower(trim(genre)) = 'regional mexican' then 'regional-mexicano'
      when lower(trim(genre)) = 'hip hop' then 'hip-hop'
      when lower(trim(genre)) = 'instrumental only' then 'instrumental'
      else regexp_replace(
        regexp_replace(lower(trim(genre)), '[^a-z0-9]+', '-', 'g'),
        '(^-|-$)',
        '',
        'g'
      )
    end
  ),
  playback_source = coalesce(
    playback_source,
    case
      when content_classification = 'external' then 'external_only'
      when platform in ('youtube', 'youtube_music') then 'internal_playable'
      when platform = 'soundcloud' then 'embedded_unverified'
      else 'external_only'
    end
  );

alter table public.songs
  alter column content_type set default 'music',
  alter column content_type set not null,
  alter column category set default 'music',
  alter column category set not null,
  alter column playback_source set default 'internal_playable',
  alter column playback_source set not null;

alter table public.songs
  drop constraint if exists songs_content_type_check;
alter table public.songs
  add constraint songs_content_type_check
  check (
    content_type in (
      'music',
      'music_video',
      'video',
      'podcast',
      'gaming',
      'tutorial',
      'comedy',
      'reaction',
      'vlog',
      'other'
    )
  );

alter table public.songs
  drop constraint if exists songs_category_check;
alter table public.songs
  add constraint songs_category_check
  check (category ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');

alter table public.songs
  drop constraint if exists songs_subcategory_check;
alter table public.songs
  add constraint songs_subcategory_check
  check (
    subcategory is null
    or subcategory ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  );

alter table public.songs
  drop constraint if exists songs_playback_source_check;
alter table public.songs
  add constraint songs_playback_source_check
  check (
    playback_source in (
      'internal_playable',
      'external_only',
      'embedded_unverified',
      'unsupported'
    )
  );

create index if not exists songs_content_type_idx
  on public.songs (content_type);

create index if not exists songs_category_idx
  on public.songs (category);

create index if not exists songs_subcategory_idx
  on public.songs (subcategory);

create index if not exists songs_playback_source_idx
  on public.songs (playback_source);

create index if not exists songs_classification_discovery_idx
  on public.songs (
    content_type,
    category,
    subcategory,
    playback_source,
    is_active,
    created_at desc
  );
