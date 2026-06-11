-- Owner Control Center expansion: allow the External Discovery homepage module.

create or replace function public.validate_platform_control_config(target_config jsonb)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  color_value text;
  color_key text;
  spotlight_item jsonb;
  spotlight_start timestamptz;
  spotlight_end timestamptz;
  allowed_modules constant text[] := array[
    'away_summary', 'spotlight', 'top_results', 'organic_rankings',
    'community_activity', 'review_queue', 'artist_spotlight',
    'external_discovery', 'trending', 'most_shared', 'most_supported',
    'newest_songs'
  ];
begin
  if target_config is null or jsonb_typeof(target_config) <> 'object' then
    raise exception 'Platform configuration must be a JSON object.';
  end if;
  if pg_column_size(target_config) > 524288 then
    raise exception 'Platform configuration exceeds the 512 KB safety limit.';
  end if;
  if coalesce((target_config->>'schemaVersion')::integer, 0) <> 1 then
    raise exception 'Unsupported platform configuration schema version.';
  end if;

  foreach color_key in array array[
    'backgroundColor', 'cardColor', 'textColor', 'accentColor',
    'buttonColor', 'linkColor', 'borderColor', 'primaryColor',
    'secondaryColor', 'hoverColor'
  ] loop
    color_value := target_config#>>array['theme', color_key];
    if color_value is null or color_value !~ '^#[0-9A-Fa-f]{6}$' then
      raise exception 'Invalid theme color: %', color_key;
    end if;
  end loop;

  if coalesce((target_config#>>'{discovery,songsPerPage}')::integer, 0)
    not in (10, 20, 50, 100)
  then
    raise exception 'Songs per page must be 10, 20, 50, or 100.';
  end if;

  if jsonb_typeof(target_config#>'{homepage,order}') <> 'array'
    or exists (
      select 1
      from jsonb_array_elements_text(
        target_config#>'{homepage,order}'
      ) as modules(module_name)
      where module_name <> all(allowed_modules)
    )
  then
    raise exception 'Homepage module order is invalid.';
  end if;

  if coalesce((target_config#>>'{tokens,minutesPerToken}')::integer, 0)
      not between 15 and 1440
    or coalesce((target_config#>>'{tokens,dailyListeningLimit}')::integer, 0)
      not between 30 and 1440
    or coalesce((target_config#>>'{tokens,maxTokensPerDay}')::integer, 0)
      not between 1 and 100
    or coalesce((target_config#>>'{tokens,submissionCost}')::integer, -1)
      not between 0 and 100
  then
    raise exception 'Token economy settings are outside allowed limits.';
  end if;

  if jsonb_typeof(target_config->'spotlight') <> 'array'
    or jsonb_array_length(target_config->'spotlight') <> 3
  then
    raise exception 'Exactly three Spotlight slots are required.';
  end if;

  for spotlight_item in
    select item from jsonb_array_elements(target_config->'spotlight') as items(item)
  loop
    if coalesce((spotlight_item->>'slot')::integer, 0) not between 1 and 3 then
      raise exception 'Spotlight slot number is invalid.';
    end if;
    if char_length(coalesce(spotlight_item->>'label', '')) > 80 then
      raise exception 'Spotlight label is too long.';
    end if;
    if coalesce(spotlight_item->>'placement', '') not in (
      'editor_pick', 'new_release', 'founder_artist', 'sponsored',
      'contest_winner', 'special_event'
    ) then
      raise exception 'Spotlight placement is invalid.';
    end if;
    spotlight_start := nullif(spotlight_item->>'startsAt', '')::timestamptz;
    spotlight_end := nullif(spotlight_item->>'endsAt', '')::timestamptz;
    if spotlight_start is not null
      and spotlight_end is not null
      and spotlight_end <= spotlight_start
    then
      raise exception 'Spotlight end time must be after its start time.';
    end if;
  end loop;

  if exists (
    select 1
    from (
      select nullif(item->>'songId', '') as song_id
      from jsonb_array_elements(target_config->'spotlight') as items(item)
    ) spotlight_songs
    where song_id is not null
    group by song_id
    having count(*) > 1
  ) then
    raise exception 'A song can occupy only one Spotlight slot.';
  end if;

  if jsonb_typeof(target_config->'announcements') <> 'array'
    or jsonb_array_length(target_config->'announcements') > 50
  then
    raise exception 'Announcements must be an array with at most 50 entries.';
  end if;
end;
$$;
