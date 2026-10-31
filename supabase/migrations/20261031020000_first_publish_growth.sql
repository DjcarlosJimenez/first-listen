-- Growth tools for the verified first-publication experience.

alter table public.first_publish_trials
  add column if not exists reminder_email_id text,
  add column if not exists reminder_scheduled_at timestamptz,
  add column if not exists reminder_cancelled_at timestamptz;

create table if not exists public.first_publish_reactions (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs(id) on delete cascade,
  reaction text not null check (
    reaction in ('liked', 'good_voice', 'good_rhythm', 'listen_again')
  ),
  device_hash text not null check (device_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (song_id, reaction, device_hash)
);

create index if not exists first_publish_reactions_song_idx
  on public.first_publish_reactions (song_id, created_at desc);

alter table public.first_publish_reactions enable row level security;
revoke all on table public.first_publish_reactions
  from public, anon, authenticated;
grant all on table public.first_publish_reactions to service_role;

create or replace function public.get_first_publish_live_song(
  target_song_id uuid
)
returns table (
  song_id uuid,
  title text,
  artist_name text,
  cover_image_url text,
  music_url text,
  platform public.music_platform,
  genre text,
  content_kind text,
  publication_expires_at timestamptz,
  retained boolean,
  viewer_owns boolean,
  liked_count integer,
  good_voice_count integer,
  good_rhythm_count integer,
  listen_again_count integer
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    songs.id,
    songs.title,
    songs.artist_name,
    songs.cover_image_url,
    songs.music_url,
    songs.platform,
    songs.genre,
    songs.content_kind,
    songs.first_publish_trial_expires_at,
    songs.first_publish_trial_claimed_at is not null,
    auth.uid() is not null and songs.user_id = auth.uid(),
    count(*) filter (where reactions.reaction = 'liked')::integer,
    count(*) filter (where reactions.reaction = 'good_voice')::integer,
    count(*) filter (where reactions.reaction = 'good_rhythm')::integer,
    count(*) filter (where reactions.reaction = 'listen_again')::integer
  from public.songs as songs
  left join public.first_publish_reactions as reactions
    on reactions.song_id = songs.id
  where songs.id = target_song_id
    and songs.is_active
    and songs.removed_at is null
    and songs.archived_at is null
    and songs.merged_into_song_id is null
    and songs.approval_status in ('auto_approved', 'approved')
    and (
      songs.first_publish_trial_expires_at is not null
      or songs.first_publish_trial_claimed_at is not null
    )
    and (
      songs.first_publish_trial_claimed_at is not null
      or songs.first_publish_trial_expires_at > now()
    )
  group by songs.id;
$$;

create or replace function public.add_first_publish_reaction(
  target_song_id uuid,
  submitted_reaction text,
  submitted_device_hash text
)
returns table (
  accepted boolean,
  liked_count integer,
  good_voice_count integer,
  good_rhythm_count integer,
  listen_again_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  inserted_count integer := 0;
begin
  if submitted_reaction not in (
    'liked', 'good_voice', 'good_rhythm', 'listen_again'
  ) then
    raise exception 'Unsupported reaction.';
  end if;
  if submitted_device_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid listener identifier.';
  end if;
  if not exists (
    select 1
    from public.songs as songs
    where songs.id = target_song_id
      and songs.is_active
      and songs.removed_at is null
      and songs.archived_at is null
      and songs.merged_into_song_id is null
      and (
        songs.first_publish_trial_claimed_at is not null
        or songs.first_publish_trial_expires_at > now()
      )
      and (
        songs.first_publish_trial_expires_at is not null
        or songs.first_publish_trial_claimed_at is not null
      )
  ) then
    raise exception 'Publication is not available.';
  end if;

  insert into public.first_publish_reactions (song_id, reaction, device_hash)
  values (target_song_id, submitted_reaction, submitted_device_hash)
  on conflict (song_id, reaction, device_hash) do nothing;
  get diagnostics inserted_count = row_count;

  return query
    select
      inserted_count > 0,
      count(*) filter (where reactions.reaction = 'liked')::integer,
      count(*) filter (where reactions.reaction = 'good_voice')::integer,
      count(*) filter (where reactions.reaction = 'good_rhythm')::integer,
      count(*) filter (where reactions.reaction = 'listen_again')::integer
    from public.first_publish_reactions as reactions
    where reactions.song_id = target_song_id;
end;
$$;

create or replace function public.get_first_publish_funnel(
  period_days integer default 30
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with filtered as (
    select events.*
    from public.site_analytics_events as events
    where events.scope = 'platform'
      and (period_days = 0 or events.created_at >= now() - make_interval(days => period_days))
  ),
  stages(position, key, label, event_label) as (
    values
      (1, 'visited', 'Abrieron Publicar gratis', null::text),
      (2, 'link_ready', 'Pegaron un enlace válido', 'Primer flujo · enlace listo'),
      (3, 'form_sent', 'Enviaron el formulario', 'Primer flujo · formulario enviado'),
      (4, 'email_sent', 'Recibieron el correo', 'Primer flujo · correo enviado'),
      (5, 'published', 'Confirmaron y publicaron', 'Primer flujo · publicación confirmada'),
      (6, 'retained', 'Conservaron la canción', 'Primer flujo · conservada'),
      (7, 'shared', 'Compartieron la publicación', 'Primer flujo · compartida')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', stages.key,
    'label', stages.label,
    'visitors', (
      select count(distinct events.visitor_hash)::integer
      from filtered as events
      where (
        stages.key = 'visited'
        and events.event_type = 'page_view'
        and events.path = '/first-publish'
      ) or (
        stages.key <> 'visited'
        and events.event_type = 'action'
        and events.content_label = stages.event_label
      )
    )
  ) order by stages.position), '[]'::jsonb)
  from stages;
$$;

revoke all on function public.get_first_publish_live_song(uuid)
  from public, anon, authenticated;
revoke all on function public.add_first_publish_reaction(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.get_first_publish_funnel(integer)
  from public, anon, authenticated;
grant execute on function public.get_first_publish_live_song(uuid)
  to anon, authenticated;
grant execute on function public.add_first_publish_reaction(uuid, text, text)
  to anon, authenticated;
grant execute on function public.get_first_publish_funnel(integer)
  to service_role;

comment on table public.first_publish_reactions is
  'Anonymous, device-limited quick reactions for verified first publications.';
comment on function public.get_first_publish_live_song(uuid) is
  'Returns only active, unexpired first-publication fields safe for public display.';
comment on function public.add_first_publish_reaction(uuid, text, text) is
  'Adds each supported reaction at most once per device and publication.';
comment on function public.get_first_publish_funnel(integer) is
  'Returns privacy-preserving unique visitor counts for the first-publication funnel.';
