-- Priority 39: membership tier foundation and artist token support.
-- Non-destructive: no tables, columns, policies, functions, or records are removed.

create table if not exists public.artist_token_gifts (
  id uuid primary key default uuid_generate_v4(),
  giver_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null check (amount > 0),
  giver_balance_after integer not null check (giver_balance_after >= 0),
  artist_balance_after integer not null check (artist_balance_after >= 0),
  created_at timestamptz not null default now(),
  check (giver_id <> artist_id)
);

alter table public.profiles
  add column if not exists membership_tier text not null default 'registeredMember';

alter table public.profiles
  drop constraint if exists profiles_membership_tier_check;

alter table public.profiles
  add constraint profiles_membership_tier_check
  check (
    membership_tier in (
      'registeredMember',
      'creator',
      'communitySupporter',
      'founderCircle'
    )
  );

create index if not exists artist_token_gifts_giver_idx
  on public.artist_token_gifts (giver_id, created_at desc);

create index if not exists artist_token_gifts_artist_idx
  on public.artist_token_gifts (artist_id, created_at desc);

alter table public.artist_token_gifts enable row level security;

drop policy if exists "users read own artist token gifts or staff reads all"
  on public.artist_token_gifts;
create policy "users read own artist token gifts or staff reads all"
  on public.artist_token_gifts
  for select
  using (
    auth.uid() = giver_id
    or auth.uid() = artist_id
    or public.is_staff()
  );

create or replace function public.default_membership_control_config()
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'previewTier', 'guestListener',
    'supportWall', jsonb_build_object(
      'enabled', false,
      'showCommunitySupporters', true,
      'showFounderCircleMembers', true,
      'showTopArtistSupporters', true
    ),
    'donations', jsonb_build_object(
      'enabled', false,
      'monthlySupportEnabled', false
    ),
    'tiers', jsonb_build_object(
      'guestListener', jsonb_build_object(
        'enabled', true,
        'name', 'Guest Listener',
        'description', 'Free listening access for guests. Guests can listen, react, follow, save, and share.',
        'visibility', 'public',
        'badge', jsonb_build_object(
          'name', 'Guest Listener',
          'color', '#C8FF4F',
          'icon', 'Guest Listener',
          'visible', true,
          'placement', 'profile_header'
        ),
        'profileAppearance', jsonb_build_object(
          'customFrame', false,
          'customTheme', false,
          'customBanner', false,
          'profileAccent', '#C8FF4F',
          'recognitionStyling', false
        ),
        'permissions', jsonb_build_object(
          'canListen', true, 'canComment', true, 'canLike', true,
          'canFollowArtists', true, 'canSaveSongs', true, 'canShareSongs', true,
          'canEarnTokens', false, 'canGiftTokens', false,
          'canUploadSongs', false, 'canCreateArtistProfiles', false,
          'canReceiveFollowers', false, 'canAccessStatistics', false,
          'canCustomizeProfile', false, 'canCreatePlaylists', false,
          'canAppearInRankings', false, 'canParticipateInContests', false,
          'canAccessPremiumFeatures', false, 'canSupportArtists', false,
          'canReceiveSupport', false, 'canDisplayBadges', false
        )
      ),
      'registeredMember', jsonb_build_object(
        'enabled', true,
        'name', 'Registered Member',
        'description', 'Free member account with history, earned tokens, artist support, and song submission access.',
        'visibility', 'public',
        'badge', jsonb_build_object(
          'name', 'Registered Member',
          'color', '#4F7110',
          'icon', 'Registered Member',
          'visible', true,
          'placement', 'profile_header'
        ),
        'profileAppearance', jsonb_build_object(
          'customFrame', false,
          'customTheme', false,
          'customBanner', false,
          'profileAccent', '#4F7110',
          'recognitionStyling', false
        ),
        'permissions', jsonb_build_object(
          'canListen', true, 'canComment', true, 'canLike', true,
          'canFollowArtists', true, 'canSaveSongs', true, 'canShareSongs', true,
          'canEarnTokens', true, 'canGiftTokens', true,
          'canUploadSongs', true, 'canCreateArtistProfiles', true,
          'canReceiveFollowers', true, 'canAccessStatistics', true,
          'canCustomizeProfile', false, 'canCreatePlaylists', false,
          'canAppearInRankings', false, 'canParticipateInContests', false,
          'canAccessPremiumFeatures', false, 'canSupportArtists', true,
          'canReceiveSupport', true, 'canDisplayBadges', true
        )
      ),
      'creator', jsonb_build_object(
        'enabled', false,
        'name', 'Creator',
        'description', 'Prepared future creator tier for artist profiles, song catalog tools, statistics, and customizations.',
        'visibility', 'hidden',
        'badge', jsonb_build_object(
          'name', 'Creator',
          'color', '#7AA511',
          'icon', 'Creator',
          'visible', false,
          'placement', 'hidden'
        ),
        'profileAppearance', jsonb_build_object(
          'customFrame', false,
          'customTheme', false,
          'customBanner', false,
          'profileAccent', '#7AA511',
          'recognitionStyling', false
        ),
        'permissions', jsonb_build_object(
          'canListen', true, 'canComment', true, 'canLike', true,
          'canFollowArtists', true, 'canSaveSongs', true, 'canShareSongs', true,
          'canEarnTokens', true, 'canGiftTokens', true,
          'canUploadSongs', true, 'canCreateArtistProfiles', true,
          'canReceiveFollowers', true, 'canAccessStatistics', true,
          'canCustomizeProfile', true, 'canCreatePlaylists', false,
          'canAppearInRankings', false, 'canParticipateInContests', false,
          'canAccessPremiumFeatures', false, 'canSupportArtists', true,
          'canReceiveSupport', true, 'canDisplayBadges', true
        )
      ),
      'communitySupporter', jsonb_build_object(
        'enabled', false,
        'name', 'Community Supporter',
        'description', 'Prepared future recognition tier for voluntary community support with no competitive advantages.',
        'visibility', 'hidden',
        'badge', jsonb_build_object(
          'name', 'Community Supporter',
          'color', '#2F8F5B',
          'icon', 'Community Supporter',
          'visible', false,
          'placement', 'hidden'
        ),
        'profileAppearance', jsonb_build_object(
          'customFrame', false,
          'customTheme', false,
          'customBanner', false,
          'profileAccent', '#2F8F5B',
          'recognitionStyling', false
        ),
        'permissions', jsonb_build_object(
          'canListen', true, 'canComment', true, 'canLike', true,
          'canFollowArtists', true, 'canSaveSongs', true, 'canShareSongs', true,
          'canEarnTokens', false, 'canGiftTokens', false,
          'canUploadSongs', false, 'canCreateArtistProfiles', false,
          'canReceiveFollowers', false, 'canAccessStatistics', false,
          'canCustomizeProfile', false, 'canCreatePlaylists', false,
          'canAppearInRankings', false, 'canParticipateInContests', false,
          'canAccessPremiumFeatures', false, 'canSupportArtists', true,
          'canReceiveSupport', false, 'canDisplayBadges', true
        )
      ),
      'founderCircle', jsonb_build_object(
        'enabled', false,
        'name', 'Founder Circle',
        'description', 'Prepared future monthly support tier for permanent recognition with no queue, ranking, token, or visibility advantages.',
        'visibility', 'hidden',
        'badge', jsonb_build_object(
          'name', 'Founder Circle',
          'color', '#C9A227',
          'icon', 'Founder Circle',
          'visible', false,
          'placement', 'hidden'
        ),
        'profileAppearance', jsonb_build_object(
          'customFrame', false,
          'customTheme', false,
          'customBanner', false,
          'profileAccent', '#C9A227',
          'recognitionStyling', true
        ),
        'permissions', jsonb_build_object(
          'canListen', true, 'canComment', true, 'canLike', true,
          'canFollowArtists', true, 'canSaveSongs', true, 'canShareSongs', true,
          'canEarnTokens', false, 'canGiftTokens', false,
          'canUploadSongs', false, 'canCreateArtistProfiles', false,
          'canReceiveFollowers', false, 'canAccessStatistics', false,
          'canCustomizeProfile', true, 'canCreatePlaylists', false,
          'canAppearInRankings', false, 'canParticipateInContests', false,
          'canAccessPremiumFeatures', false, 'canSupportArtists', true,
          'canReceiveSupport', false, 'canDisplayBadges', true
        )
      )
    )
  );
$$;

create or replace function public.ensure_priority39_platform_config(target_config jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $$
  select jsonb_set(
    jsonb_set(
      case
        when target_config ? 'membership' then target_config
        else jsonb_set(
          target_config,
          '{membership}',
          public.default_membership_control_config(),
          true
        )
      end,
      '{tokens,gifting,enabled}',
      'true'::jsonb,
      true
    ),
    '{tokens,gifting,maximum}',
    to_jsonb(greatest(coalesce((target_config#>>'{tokens,gifting,maximum}')::integer, 0), 10)),
    true
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
  membership_tier text;
  permission_key text;
  allowed_modules constant text[] := array[
    'away_summary', 'spotlight', 'top_results', 'organic_rankings',
    'community_activity', 'review_queue', 'artist_spotlight',
    'external_discovery', 'trending', 'most_shared', 'most_supported',
    'newest_songs'
  ];
  allowed_membership_tiers constant text[] := array[
    'guestListener', 'registeredMember', 'creator',
    'communitySupporter', 'founderCircle'
  ];
  allowed_membership_permissions constant text[] := array[
    'canListen', 'canComment', 'canLike', 'canFollowArtists',
    'canSaveSongs', 'canShareSongs', 'canEarnTokens', 'canGiftTokens',
    'canUploadSongs', 'canCreateArtistProfiles', 'canReceiveFollowers',
    'canAccessStatistics', 'canCustomizeProfile', 'canCreatePlaylists',
    'canAppearInRankings', 'canParticipateInContests',
    'canAccessPremiumFeatures', 'canSupportArtists', 'canReceiveSupport',
    'canDisplayBadges'
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

  if target_config ? 'membership' then
    if coalesce(target_config#>>'{membership,previewTier}', '')
      <> all(allowed_membership_tiers)
    then
      raise exception 'Membership preview tier is invalid.';
    end if;

    if jsonb_typeof(target_config#>'{membership,tiers}')
      is distinct from 'object'
    then
      raise exception 'Membership tiers must be a JSON object.';
    end if;

    foreach membership_tier in array allowed_membership_tiers loop
      if jsonb_typeof(
        target_config#>array['membership', 'tiers', membership_tier]
      ) is distinct from 'object' then
        raise exception 'Membership tier is missing: %', membership_tier;
      end if;

      if jsonb_typeof(
        target_config#>array['membership', 'tiers', membership_tier, 'enabled']
      ) is distinct from 'boolean' then
        raise exception 'Membership tier enabled flag is invalid: %', membership_tier;
      end if;

      if char_length(coalesce(
        target_config#>>array['membership', 'tiers', membership_tier, 'name'],
        ''
      )) = 0
        or char_length(coalesce(
          target_config#>>array['membership', 'tiers', membership_tier, 'name'],
          ''
        )) > 80
      then
        raise exception 'Membership tier name is invalid: %', membership_tier;
      end if;

      if char_length(coalesce(
        target_config#>>array['membership', 'tiers', membership_tier, 'description'],
        ''
      )) > 400
      then
        raise exception 'Membership tier description is too long: %', membership_tier;
      end if;

      if coalesce(
        target_config#>>array['membership', 'tiers', membership_tier, 'visibility'],
        ''
      ) not in ('public', 'private', 'hidden') then
        raise exception 'Membership tier visibility is invalid: %', membership_tier;
      end if;

      if coalesce(
        target_config#>>array['membership', 'tiers', membership_tier, 'badge', 'color'],
        ''
      ) !~ '^#[0-9A-Fa-f]{6}$' then
        raise exception 'Membership badge color is invalid: %', membership_tier;
      end if;

      if coalesce(
        target_config#>>array['membership', 'tiers', membership_tier, 'badge', 'placement'],
        ''
      ) not in ('profile_header', 'profile_card', 'support_wall', 'hidden') then
        raise exception 'Membership badge placement is invalid: %', membership_tier;
      end if;

      if jsonb_typeof(
        target_config#>array['membership', 'tiers', membership_tier, 'badge', 'visible']
      ) is distinct from 'boolean' then
        raise exception 'Membership badge visibility is invalid: %', membership_tier;
      end if;

      if coalesce(
        target_config#>>array['membership', 'tiers', membership_tier, 'profileAppearance', 'profileAccent'],
        ''
      ) !~ '^#[0-9A-Fa-f]{6}$' then
        raise exception 'Membership profile accent is invalid: %', membership_tier;
      end if;

      if jsonb_typeof(
        target_config#>array['membership', 'tiers', membership_tier, 'permissions']
      ) is distinct from 'object' then
        raise exception 'Membership permissions are invalid: %', membership_tier;
      end if;

      foreach permission_key in array allowed_membership_permissions loop
        if jsonb_typeof(
          target_config#>array[
            'membership', 'tiers', membership_tier,
            'permissions', permission_key
          ]
        ) is distinct from 'boolean' then
          raise exception 'Membership permission is invalid: %.%',
            membership_tier,
            permission_key;
        end if;
      end loop;
    end loop;

    foreach permission_key in array array[
      'enabled', 'showCommunitySupporters',
      'showFounderCircleMembers', 'showTopArtistSupporters'
    ] loop
      if jsonb_typeof(
        target_config#>array['membership', 'supportWall', permission_key]
      ) is distinct from 'boolean' then
        raise exception 'Membership support wall setting is invalid: %',
          permission_key;
      end if;
    end loop;

    foreach permission_key in array array['enabled', 'monthlySupportEnabled'] loop
      if jsonb_typeof(
        target_config#>array['membership', 'donations', permission_key]
      ) is distinct from 'boolean' then
        raise exception 'Membership donation setting is invalid: %',
          permission_key;
      end if;
    end loop;
  end if;

  if jsonb_typeof(target_config->'announcements') <> 'array'
    or jsonb_array_length(target_config->'announcements') > 50
  then
    raise exception 'Announcements must be an array with at most 50 entries.';
  end if;
end;
$$;

update public.platform_control_state
set
  draft_config = public.ensure_priority39_platform_config(draft_config),
  published_config = public.ensure_priority39_platform_config(published_config),
  stable_config = public.ensure_priority39_platform_config(stable_config),
  updated_at = now()
where id = true;

create or replace function public.admin_update_control_draft(
  section_key text,
  section_value jsonb,
  change_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  previous_config jsonb;
  next_config jsonb;
begin
  if not public.can_manage_platform_control() then
    raise exception 'Super Admin access required.';
  end if;

  if section_key not in (
    'theme', 'homepage', 'ui', 'discovery', 'spotlight', 'artistProfile',
    'membership', 'tokens', 'permissions', 'experiments', 'announcements'
  ) then
    raise exception 'Unsupported configuration section.';
  end if;

  if section_key in ('permissions', 'experiments')
    and not public.is_founder_controller()
  then
    raise exception 'Founder controller access required.';
  end if;

  select draft_config into previous_config
  from public.platform_control_state
  where id = true
  for update;

  next_config := jsonb_set(previous_config, array[section_key], section_value, true);
  perform public.validate_platform_control_config(next_config);

  update public.platform_control_state
  set
    draft_config = next_config,
    draft_revision = draft_revision + 1,
    has_unpublished_changes = next_config is distinct from published_config,
    updated_by = auth.uid(),
    updated_at = now()
  where id = true;

  insert into public.admin_audit_log (
    actor_id, action, target_type, details
  )
  values (
    auth.uid(),
    'platform_control_draft_updated',
    'platform_control_state',
    jsonb_build_object(
      'section', section_key,
      'description', left(coalesce(change_description, ''), 500)
    )
  );

  return public.admin_get_control_center();
end;
$$;

revoke all on function public.admin_update_control_draft(text, jsonb, text)
  from public, anon;
grant execute on function public.admin_update_control_draft(text, jsonb, text)
  to authenticated;

create or replace function public.admin_replace_control_draft(
  target_config jsonb,
  change_description text default 'Imported configuration'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  repaired_config jsonb;
begin
  if not public.is_founder_controller() then
    raise exception 'Founder controller access required.';
  end if;

  repaired_config := public.ensure_priority39_platform_config(target_config);
  perform public.validate_platform_control_config(repaired_config);

  update public.platform_control_state
  set
    draft_config = repaired_config,
    draft_revision = draft_revision + 1,
    has_unpublished_changes = repaired_config is distinct from published_config,
    updated_by = auth.uid(),
    updated_at = now()
  where id = true;

  insert into public.admin_audit_log (
    actor_id, action, target_type, details
  )
  values (
    auth.uid(), 'platform_control_draft_imported', 'platform_control_state',
    jsonb_build_object(
      'description', left(coalesce(change_description, ''), 500),
      'priority39_membership_repaired', true
    )
  );

  return public.admin_get_control_center();
end;
$$;

revoke all on function public.admin_replace_control_draft(jsonb, text)
  from public, anon;
grant execute on function public.admin_replace_control_draft(jsonb, text)
  to authenticated;

create or replace function public.admin_restore_control_snapshot(
  snapshot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  snapshot_config jsonb;
begin
  if not public.can_manage_platform_control() then
    raise exception 'Super Admin access required.';
  end if;

  select config into snapshot_config
  from public.platform_configuration_snapshots snapshot
  where snapshot.id = snapshot_id;
  if snapshot_config is null then
    raise exception 'Configuration snapshot was not found.';
  end if;

  snapshot_config := public.ensure_priority39_platform_config(snapshot_config);
  perform public.validate_platform_control_config(snapshot_config);

  update public.platform_control_state
  set
    draft_config = snapshot_config,
    draft_revision = draft_revision + 1,
    has_unpublished_changes = snapshot_config is distinct from published_config,
    updated_by = auth.uid(),
    updated_at = now()
  where id = true;

  insert into public.admin_audit_log (
    actor_id, action, target_type, target_id, details
  )
  values (
    auth.uid(), 'platform_control_snapshot_restored',
    'platform_configuration_snapshot', snapshot_id,
    jsonb_build_object(
      'restored_to', 'draft',
      'priority39_membership_repaired', true
    )
  );

  return public.admin_get_control_center();
end;
$$;

revoke all on function public.admin_restore_control_snapshot(uuid)
  from public, anon;
grant execute on function public.admin_restore_control_snapshot(uuid)
  to authenticated;

create or replace function public.gift_artist_tokens(
  target_artist_id uuid,
  token_amount integer
)
returns table (
  gift_id uuid,
  gifted_tokens integer,
  sender_balance integer,
  artist_balance integer,
  earned_tokens_available integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  sender_id uuid := auth.uid();
  sender_name text;
  artist_name text;
  sender_tier text;
  artist_tier text;
  sender_balance_before integer;
  sender_balance_after integer;
  artist_balance_after integer;
  earned_positive integer;
  non_gift_debits integer;
  prior_gifted integer;
  giftable_earned integer;
  config jsonb;
  gifting_enabled boolean;
  pause_gifting boolean;
  min_gift integer;
  max_gift integer;
  daily_limit integer;
  cooldown_minutes integer;
  gifted_today integer;
  created_gift_id uuid;
  sender_tier_enabled boolean;
  sender_can_gift boolean;
  sender_can_support boolean;
  artist_tier_enabled boolean;
  artist_can_receive_support boolean;
begin
  if sender_id is null then
    raise exception 'Authentication required';
  end if;
  if target_artist_id is null then
    raise exception 'Artist is required';
  end if;
  if sender_id = target_artist_id then
    raise exception 'You cannot gift tokens to yourself';
  end if;
  if token_amount is null or token_amount < 1 then
    raise exception 'Gift amount must be at least 1 token';
  end if;

  select published_config
  into config
  from public.platform_control_state
  where id = true;

  gifting_enabled := coalesce((config#>>'{tokens,gifting,enabled}')::boolean, true);
  pause_gifting := coalesce((config#>>'{tokens,emergency,pauseGifting}')::boolean, false);
  min_gift := greatest(1, coalesce((config#>>'{tokens,gifting,minimum}')::integer, 1));
  max_gift := greatest(min_gift, coalesce((config#>>'{tokens,gifting,maximum}')::integer, 10));
  daily_limit := greatest(1, coalesce((config#>>'{tokens,gifting,dailyLimit}')::integer, 10));
  cooldown_minutes := greatest(0, coalesce((config#>>'{tokens,gifting,cooldownMinutes}')::integer, 0));

  if not gifting_enabled or pause_gifting then
    raise exception 'Token gifting is currently disabled';
  end if;
  if token_amount < min_gift or token_amount > max_gift then
    raise exception 'Gift amount must be between % and % tokens', min_gift, max_gift;
  end if;

  select coalesce(sum(amount), 0)::integer
  into gifted_today
  from public.artist_token_gifts
  where giver_id = sender_id
    and created_at >= date_trunc('day', now());

  if gifted_today + token_amount > daily_limit then
    raise exception 'Daily token gifting limit reached';
  end if;

  if cooldown_minutes > 0 and exists (
    select 1
    from public.artist_token_gifts
    where giver_id = sender_id
      and created_at > now() - make_interval(mins => cooldown_minutes)
  ) then
    raise exception 'Please wait before gifting tokens again';
  end if;

  select display_name, credits, membership_tier
  into sender_name, sender_balance_before, sender_tier
  from public.profiles
  where id = sender_id
    and account_status = 'active'
  for update;

  if not found then
    raise exception 'Active sender profile was not found';
  end if;

  sender_tier := coalesce(sender_tier, 'registeredMember');
  sender_tier_enabled := coalesce(
    (config#>>array['membership', 'tiers', sender_tier, 'enabled'])::boolean,
    sender_tier = 'registeredMember'
  );
  sender_can_gift := coalesce(
    (config#>>array['membership', 'tiers', sender_tier, 'permissions', 'canGiftTokens'])::boolean,
    sender_tier = 'registeredMember'
  );
  sender_can_support := coalesce(
    (config#>>array['membership', 'tiers', sender_tier, 'permissions', 'canSupportArtists'])::boolean,
    sender_tier = 'registeredMember'
  );

  if not sender_tier_enabled then
    raise exception 'Your membership tier is not active';
  end if;
  if not sender_can_gift or not sender_can_support then
    raise exception 'Your membership tier cannot gift tokens to artists';
  end if;

  select display_name, membership_tier
  into artist_name, artist_tier
  from public.profiles
  where id = target_artist_id
    and account_status = 'active'
  for update;

  if not found then
    raise exception 'Artist profile was not found';
  end if;

  artist_tier := coalesce(artist_tier, 'registeredMember');
  artist_tier_enabled := coalesce(
    (config#>>array['membership', 'tiers', artist_tier, 'enabled'])::boolean,
    artist_tier = 'registeredMember'
  );
  artist_can_receive_support := coalesce(
    (config#>>array['membership', 'tiers', artist_tier, 'permissions', 'canReceiveSupport'])::boolean,
    artist_tier = 'registeredMember'
  );
  if not artist_tier_enabled then
    raise exception 'This artist membership tier is not active';
  end if;
  if not artist_can_receive_support then
    raise exception 'This artist cannot receive token support right now';
  end if;

  select coalesce(sum(amount), 0)::integer
  into earned_positive
  from public.credit_transactions
  where user_id = sender_id
    and amount > 0
    and reason not in (
      'Registration credit',
      'Founding Artist bonus',
      'Artist token gift received'
    )
    and reason not ilike 'Admin%';

  select coalesce(sum(abs(amount)), 0)::integer
  into non_gift_debits
  from public.credit_transactions
  where user_id = sender_id
    and amount < 0
    and reason <> 'Artist token gift sent';

  select coalesce(sum(amount), 0)::integer
  into prior_gifted
  from public.artist_token_gifts
  where giver_id = sender_id;

  giftable_earned := greatest(0, earned_positive - non_gift_debits - prior_gifted);

  if token_amount > giftable_earned then
    raise exception 'Only earned tokens may be gifted';
  end if;
  if token_amount > sender_balance_before then
    raise exception 'Not enough tokens available';
  end if;

  update public.profiles
  set credits = credits - token_amount, updated_at = now()
  where id = sender_id
  returning credits into sender_balance_after;

  update public.profiles
  set credits = credits + token_amount, updated_at = now()
  where id = target_artist_id
  returning credits into artist_balance_after;

  insert into public.artist_token_gifts (
    giver_id,
    artist_id,
    amount,
    giver_balance_after,
    artist_balance_after
  )
  values (
    sender_id,
    target_artist_id,
    token_amount,
    sender_balance_after,
    artist_balance_after
  )
  returning id into created_gift_id;

  insert into public.credit_transactions (user_id, amount, reason, created_by)
  values
    (sender_id, -token_amount, 'Artist token gift sent', sender_id),
    (target_artist_id, token_amount, 'Artist token gift received', sender_id);

  return query select
    created_gift_id,
    token_amount,
    sender_balance_after,
    artist_balance_after,
    greatest(0, giftable_earned - token_amount);
end;
$$;

revoke all on function public.gift_artist_tokens(uuid, integer)
  from public, anon;
grant execute on function public.gift_artist_tokens(uuid, integer)
  to authenticated;
