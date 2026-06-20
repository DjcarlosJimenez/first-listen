-- Owner Control publish guard
--
-- A stale Spotlight songId can block publishing unrelated Owner Control
-- changes. Keep publish resilient by clearing Spotlight references when the
-- referenced song no longer exists.

create or replace function public.owner_control_config_without_invalid_spotlight_refs(
  target_config jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when target_config is null
      or jsonb_typeof(target_config->'spotlight') <> 'array'
    then target_config
    else jsonb_set(
      target_config,
      '{spotlight}',
      coalesce((
        select jsonb_agg(
          case
            when nullif(spotlight_item->>'songId', '') is null then spotlight_item
            when not (
              (spotlight_item->>'songId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            ) then jsonb_set(spotlight_item, '{songId}', '""'::jsonb, true)
            when exists (
              select 1
              from public.songs song
              where song.id = (spotlight_item->>'songId')::uuid
            ) then spotlight_item
            else jsonb_set(spotlight_item, '{songId}', '""'::jsonb, true)
          end
          order by spotlight_order
        )
        from jsonb_array_elements(target_config->'spotlight')
          with ordinality as spotlight_items(spotlight_item, spotlight_order)
      ), '[]'::jsonb),
      true
    )
  end;
$$;

create or replace function public.apply_platform_control_config(target_config jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  spotlight_item jsonb;
  spotlight_song_id uuid;
begin
  target_config := public.owner_control_config_without_invalid_spotlight_refs(
    target_config
  );

  perform public.validate_platform_control_config(target_config);

  update public.platform_theme_settings
  set
    preset = case
      when target_config#>>'{theme,preset}' in (
        'first_listen_default', 'dark_studio', 'modern_dark',
        'midnight', 'community_green', 'custom'
      ) then target_config#>>'{theme,preset}'
      else 'custom'
    end,
    background_color = upper(target_config#>>'{theme,backgroundColor}'),
    card_color = upper(target_config#>>'{theme,cardColor}'),
    text_color = upper(target_config#>>'{theme,textColor}'),
    accent_color = upper(target_config#>>'{theme,accentColor}'),
    button_color = upper(target_config#>>'{theme,buttonColor}'),
    link_color = upper(target_config#>>'{theme,linkColor}'),
    border_color = upper(target_config#>>'{theme,borderColor}'),
    updated_by = auth.uid()
  where id = true;

  update public.listening_reward_settings
  set
    minutes_per_credit = (target_config#>>'{tokens,minutesPerToken}')::integer,
    daily_cap_minutes = (target_config#>>'{tokens,dailyListeningLimit}')::integer,
    enabled = not coalesce(
      (target_config#>>'{tokens,emergency,pauseTokenGeneration}')::boolean,
      false
    ),
    updated_by = auth.uid(),
    updated_at = now()
  where id = true;

  for spotlight_item in
    select spotlight_entry
    from jsonb_array_elements(
      target_config->'spotlight'
    ) as spotlight_entries(spotlight_entry)
  loop
    spotlight_song_id := null;

    if nullif(spotlight_item->>'songId', '') is not null
      and (spotlight_item->>'songId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      select song.id
      into spotlight_song_id
      from public.songs song
      where song.id = (spotlight_item->>'songId')::uuid;
    end if;

    update public.spotlight_slots
    set
      song_id = spotlight_song_id,
      placement_kind = (spotlight_item->>'placement')::public.spotlight_placement_kind,
      custom_label = left(coalesce(spotlight_item->>'label', ''), 80),
      pinned = coalesce((spotlight_item->>'pinned')::boolean, false),
      active_from = nullif(spotlight_item->>'startsAt', '')::timestamptz,
      active_until = nullif(spotlight_item->>'endsAt', '')::timestamptz,
      updated_by = auth.uid(),
      updated_at = now()
    where slot_number = (spotlight_item->>'slot')::smallint;
  end loop;

  update public.songs
  set featured = exists (
    select 1
    from public.spotlight_slots
    where spotlight_slots.song_id = songs.id
  )
  where songs.featured
     or exists (
       select 1
       from public.spotlight_slots
       where spotlight_slots.song_id = songs.id
     );
end;
$$;

with sanitized as (
  select
    id,
    public.owner_control_config_without_invalid_spotlight_refs(published_config)
      as next_published_config,
    public.owner_control_config_without_invalid_spotlight_refs(draft_config)
      as next_draft_config,
    public.owner_control_config_without_invalid_spotlight_refs(stable_config)
      as next_stable_config
  from public.platform_control_state
  where id = true
)
update public.platform_control_state as state
set
  published_config = sanitized.next_published_config,
  draft_config = sanitized.next_draft_config,
  stable_config = sanitized.next_stable_config,
  has_unpublished_changes =
    sanitized.next_draft_config is distinct from sanitized.next_published_config,
  updated_at = now()
from sanitized
where state.id = sanitized.id;

do $$
begin
  if to_regprocedure('public.sync_owner_control_economy_state()') is not null then
    perform public.sync_owner_control_economy_state();
  end if;
end;
$$;

revoke all on function public.owner_control_config_without_invalid_spotlight_refs(jsonb)
  from public, anon, authenticated;
