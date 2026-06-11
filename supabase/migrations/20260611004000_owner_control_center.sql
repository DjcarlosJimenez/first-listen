-- Owner Control Center: spotlight pinning, scheduling, and owner-safe publish support.

alter table public.spotlight_slots
  drop constraint if exists spotlight_slots_slot_number_check;

alter table public.spotlight_slots
  add constraint spotlight_slots_slot_number_check
  check (slot_number in (1, 2, 3));

alter table public.spotlight_slots
  add column if not exists pinned boolean not null default false;

insert into public.spotlight_slots (slot_number)
values (1), (2), (3)
on conflict (slot_number) do nothing;

create index if not exists idx_spotlight_slots_schedule
  on public.spotlight_slots (active_from, active_until);

create or replace function public.default_platform_control_config()
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'theme', jsonb_build_object(
      'preset', 'first_listen_default',
      'backgroundColor', '#F3F4EE',
      'cardColor', '#FFFFFF',
      'textColor', '#151815',
      'accentColor', '#C8FF4F',
      'buttonColor', '#171A18',
      'linkColor', '#4F7110',
      'borderColor', '#D5D9D0',
      'primaryColor', '#171A18',
      'secondaryColor', '#4F7110',
      'hoverColor', '#96CF18',
      'customThemes', '[]'::jsonb
    ),
    'homepage', jsonb_build_object(
      'order', jsonb_build_array(
        'away_summary', 'spotlight', 'top_results', 'organic_rankings',
        'community_activity', 'review_queue', 'artist_spotlight',
        'trending', 'most_shared', 'most_supported', 'newest_songs'
      ),
      'visibility', jsonb_build_object(
        'away_summary', true, 'spotlight', true, 'top_results', true,
        'organic_rankings', true, 'community_activity', true,
        'review_queue', true, 'artist_spotlight', true, 'trending', true,
        'most_shared', true, 'most_supported', true, 'newest_songs', true
      )
    ),
    'discovery', jsonb_build_object(
      'songsPerPage', 20,
      'modules', jsonb_build_object(
        'spotlight', true, 'rankings', true, 'topResults', true,
        'organicRankings', true, 'trending', true, 'mostShared', true,
        'mostSupported', true, 'newestSongs', true
      )
    ),
    'spotlight', jsonb_build_array(
      jsonb_build_object(
        'slot', 1, 'songId', null, 'placement', 'editor_pick', 'label', '',
        'pinned', false, 'startsAt', null, 'endsAt', null
      ),
      jsonb_build_object(
        'slot', 2, 'songId', null, 'placement', 'editor_pick', 'label', '',
        'pinned', false, 'startsAt', null, 'endsAt', null
      ),
      jsonb_build_object(
        'slot', 3, 'songId', null, 'placement', 'editor_pick', 'label', '',
        'pinned', false, 'startsAt', null, 'endsAt', null
      )
    ),
    'artistProfile', jsonb_build_object(
      'order', jsonb_build_array('statistics', 'supporters', 'recentActivity', 'songs'),
      'visibility', jsonb_build_object(
        'followers', true, 'likes', true, 'comments', true, 'shares', true,
        'recentActivity', true, 'statistics', true, 'supporters', true,
        'giftTokens', false
      )
    ),
    'tokens', jsonb_build_object(
      'minutesPerToken', 120,
      'dailyListeningLimit', 180,
      'maxTokensPerDay', 3,
      'submissionCost', 1,
      'gifting', jsonb_build_object(
        'enabled', false, 'minimum', 1, 'maximum', 5,
        'dailyLimit', 10, 'cooldownMinutes', 60
      ),
      'bonuses', jsonb_build_object(
        'review', 0, 'mission', 0, 'spotlight', 0, 'contest', 0, 'referral', 0
      ),
      'engagement', jsonb_build_object(
        'enabled', false, 'likeRewards', false, 'commentRewards', false,
        'shareRewards', false, 'followRewards', false
      ),
      'emergency', jsonb_build_object(
        'pauseTokenGeneration', false, 'pauseGifting', false,
        'pauseMissions', false, 'pauseRewards', false, 'pauseSubmissions', false
      ),
      'futureSupport', jsonb_build_object(
        'voluntaryDonations', false, 'buyMeACoffee', false,
        'founderSupportBadge', false, 'communitySupportBanner', false
      )
    ),
    'permissions', jsonb_build_object(
      'founder', jsonb_build_object(
        'manageConfiguration', true, 'publishConfiguration', true,
        'emergencyRestore', true, 'managePermissions', true,
        'manageExperiments', true
      ),
      'super_admin', jsonb_build_object(
        'manageConfiguration', true, 'publishConfiguration', true,
        'emergencyRestore', false, 'managePermissions', false,
        'manageExperiments', false
      ),
      'moderator', jsonb_build_object('manageReports', true, 'removeInvalidSongs', true),
      'artist', jsonb_build_object('submitSongs', true, 'manageOwnSongs', true),
      'member', jsonb_build_object(
        'listen', true, 'review', true, 'participateInRankings', true
      ),
      'guest', jsonb_build_object(
        'listen', true, 'comment', true, 'follow', true, 'save', true
      )
    ),
    'experiments', jsonb_build_object(
      'experimentalFeatures', false, 'abTesting', false, 'layoutTesting', false,
      'themeTesting', false, 'newDiscoveryModules', false, 'betaFeatures', false
    ),
    'announcements', '[]'::jsonb
  );
$$;

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
    'trending', 'most_shared', 'most_supported', 'newest_songs'
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

create or replace function public.apply_platform_control_config(target_config jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  spotlight_item jsonb;
begin
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
    update public.spotlight_slots
    set
      song_id = nullif(spotlight_item->>'songId', '')::uuid,
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

create or replace function public.get_spotlight_songs()
returns table (
  slot_number smallint,
  badge text,
  song_id uuid,
  artist_id uuid,
  title text,
  artist_name text,
  cover_image_url text,
  music_url text,
  platform public.music_platform,
  genre text,
  song_language text,
  reviews_received integer,
  average_rating numeric,
  hook_score integer,
  total_listening_seconds bigint,
  completion_rate numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    slots.slot_number,
    coalesce(
      nullif(trim(slots.custom_label), ''),
      initcap(replace(slots.placement_kind::text, '_', ' '))
    ),
    songs.id,
    songs.user_id,
    songs.title,
    songs.artist_name,
    songs.cover_image_url,
    songs.music_url,
    songs.platform,
    songs.genre,
    songs.song_language,
    coalesce(metrics.reviews_received, 0),
    coalesce(metrics.average_rating, 0),
    coalesce(metrics.hook_score, 0),
    coalesce(metrics.total_listening_seconds, 0),
    coalesce(metrics.completion_rate, 0)
  from public.spotlight_slots as slots
  join public.songs on songs.id = slots.song_id
  join public.profiles as creators on creators.id = songs.user_id
  left join lateral (
    select
      count(*)::integer as reviews_received,
      round(avg(reviews.rating)::numeric, 2) as average_rating,
      round((
        avg(case when reviews.listen_full then 100 else 0 end) +
        avg(case when reviews.add_to_playlist then 100 else 0 end) +
        avg(case when reviews.grabbed_attention then 100 else 0 end) +
        avg(case when reviews.share_with_friend then 100 else 0 end)
      ) / 4, 0)::integer as hook_score,
      coalesce(sum(reviews.listening_seconds), 0)::bigint
        as total_listening_seconds,
      coalesce(round(avg(reviews.listening_completion_percent)::numeric, 2), 0)
        as completion_rate
    from public.reviews
    where reviews.song_id = songs.id
      and reviews.quality_passed
  ) metrics on true
  where public.is_active_user()
    and songs.is_active
    and songs.removed_at is null
    and songs.archived_at is null
    and songs.merged_into_song_id is null
    and songs.approval_status in ('auto_approved', 'approved')
    and creators.account_status = 'active'
    and creators.banned_at is null
    and coalesce(creators.last_contribution_at, creators.created_at)
      > now() - interval '14 days'
    and (slots.active_from is null or slots.active_from <= now())
    and (slots.active_until is null or slots.active_until > now())
    and (
      not songs.explicit_content
      or coalesce((
        select profiles.show_explicit_content
        from public.profiles
        where profiles.id = auth.uid()
      ), false)
    )
  order by slots.slot_number;
$$;
