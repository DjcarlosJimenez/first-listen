-- Priority 25: founder-level platform control center.
-- Additive configuration, preview, publishing, snapshot, and emergency controls.

create table if not exists public.platform_control_state (
  id boolean primary key default true check (id),
  published_config jsonb not null,
  draft_config jsonb not null,
  stable_config jsonb not null,
  published_version integer not null default 1 check (published_version > 0),
  draft_revision integer not null default 1 check (draft_revision > 0),
  has_unpublished_changes boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  published_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  published_at timestamptz not null default now()
);

create table if not exists public.platform_configuration_snapshots (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 3 and 120),
  description text not null default ''
    check (char_length(description) <= 1000),
  snapshot_kind text not null default 'manual'
    check (snapshot_kind in ('initial', 'manual', 'automatic', 'emergency', 'import')),
  config jsonb not null,
  source_version integer not null check (source_version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists platform_configuration_snapshots_created_idx
  on public.platform_configuration_snapshots (created_at desc);

create table if not exists public.platform_preview_access (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  can_preview boolean not null default false,
  preview_enabled boolean not null default false,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.platform_control_state enable row level security;
alter table public.platform_configuration_snapshots enable row level security;
alter table public.platform_preview_access enable row level security;

revoke all on table public.platform_control_state from public, anon, authenticated;
revoke all on table public.platform_configuration_snapshots from public, anon, authenticated;
revoke all on table public.platform_preview_access from public, anon, authenticated;

alter table public.listening_reward_settings
  drop constraint if exists listening_reward_settings_minutes_per_credit_check;
alter table public.listening_reward_settings
  add constraint listening_reward_settings_minutes_per_credit_check
  check (minutes_per_credit between 15 and 1440);

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
      jsonb_build_object('slot', 1, 'songId', null, 'placement', 'editor_pick', 'label', ''),
      jsonb_build_object('slot', 2, 'songId', null, 'placement', 'editor_pick', 'label', ''),
      jsonb_build_object('slot', 3, 'songId', null, 'placement', 'editor_pick', 'label', '')
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

insert into public.platform_control_state (
  id, published_config, draft_config, stable_config
)
values (
  true,
  public.default_platform_control_config(),
  public.default_platform_control_config(),
  public.default_platform_control_config()
)
on conflict (id) do nothing;

do $$
declare
  imported_config jsonb;
begin
  select jsonb_set(
    jsonb_set(
      public.default_platform_control_config(),
      '{theme}',
      (public.default_platform_control_config()->'theme') || jsonb_build_object(
        'preset', theme.preset,
        'backgroundColor', theme.background_color,
        'cardColor', theme.card_color,
        'textColor', theme.text_color,
        'accentColor', theme.accent_color,
        'buttonColor', theme.button_color,
        'linkColor', theme.link_color,
        'borderColor', theme.border_color
      )
    ),
    '{tokens}',
    (public.default_platform_control_config()->'tokens') || jsonb_build_object(
      'minutesPerToken', rewards.minutes_per_credit,
      'dailyListeningLimit', rewards.daily_cap_minutes,
      'emergency',
        (public.default_platform_control_config()#>'{tokens,emergency}')
        || jsonb_build_object('pauseTokenGeneration', not rewards.enabled)
    )
  )
  into imported_config
  from public.platform_theme_settings theme
  cross join public.listening_reward_settings rewards
  where theme.id = true and rewards.id = true;

  if imported_config is not null then
    update public.platform_control_state
    set
      published_config = imported_config,
      draft_config = imported_config,
      stable_config = imported_config
    where id = true
      and published_version = 1
      and draft_revision = 1
      and has_unpublished_changes = false;
  end if;
end;
$$;

insert into public.platform_configuration_snapshots (
  name, description, snapshot_kind, config, source_version
)
select
  'Initial production configuration',
  'Automatic baseline captured when the Super Admin Control Center was installed.',
  'initial',
  state.published_config,
  state.published_version
from public.platform_control_state state
where state.id = true
  and not exists (
    select 1
    from public.platform_configuration_snapshots snapshot
    where snapshot.snapshot_kind = 'initial'
  );

create or replace function public.is_founder_controller(
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select coalesce((
    select profile.role::text = 'super_admin'
      and profile.founder_number = 1
      and profile.account_status = 'active'
      and profile.banned_at is null
    from public.profiles profile
    where profile.id = target_user_id
  ), false);
$$;

create or replace function public.can_manage_platform_control()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select coalesce(public.current_user_role()::text = 'super_admin', false);
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

  if jsonb_typeof(target_config->'announcements') <> 'array'
    or jsonb_array_length(target_config->'announcements') > 50
  then
    raise exception 'Announcements must be an array with at most 50 entries.';
  end if;
end;
$$;

create or replace function public.get_platform_runtime()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  state public.platform_control_state%rowtype;
  preview_allowed boolean := false;
  preview_active boolean := false;
begin
  select * into state
  from public.platform_control_state
  where id = true;

  if auth.uid() is not null then
    preview_allowed := public.can_manage_platform_control()
      or coalesce((
        select access.can_preview
        from public.platform_preview_access access
        where access.user_id = auth.uid()
      ), false);
    preview_active := preview_allowed and coalesce((
      select access.preview_enabled
      from public.platform_preview_access access
      where access.user_id = auth.uid()
    ), false);
  end if;

  return jsonb_build_object(
    'config', case when preview_active then state.draft_config else state.published_config end,
    'preview_active', preview_active,
    'published_version', state.published_version,
    'draft_revision', state.draft_revision
  );
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
      updated_by = auth.uid(),
      updated_at = now()
    where slot_number = (spotlight_item->>'slot')::smallint;
  end loop;
end;
$$;

revoke all on function public.apply_platform_control_config(jsonb) from public;

create or replace function public.admin_get_control_center()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  result jsonb;
begin
  if not public.can_manage_platform_control() then
    raise exception 'Super Admin access required.';
  end if;

  select jsonb_build_object(
    'state', jsonb_build_object(
      'published_config', state.published_config,
      'draft_config', state.draft_config,
      'stable_config', state.stable_config,
      'published_version', state.published_version,
      'draft_revision', state.draft_revision,
      'has_unpublished_changes', state.has_unpublished_changes,
      'updated_at', state.updated_at,
      'published_at', state.published_at
    ),
    'founder_controller', public.is_founder_controller(),
    'preview_enabled', coalesce((
      select access.preview_enabled
      from public.platform_preview_access access
      where access.user_id = auth.uid()
    ), false),
    'snapshots', coalesce((
      select jsonb_agg(to_jsonb(snapshot) order by snapshot.created_at desc)
      from (
        select id, name, description, snapshot_kind, source_version, created_by, created_at
        from public.platform_configuration_snapshots
        order by created_at desc
        limit 50
      ) snapshot
    ), '[]'::jsonb),
    'preview_access', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', access.user_id,
          'display_name', profile.display_name,
          'email', profile.email,
          'can_preview', access.can_preview,
          'preview_enabled', access.preview_enabled,
          'updated_at', access.updated_at
        )
        order by profile.display_name
      )
      from public.platform_preview_access access
      join public.profiles profile on profile.id = access.user_id
    ), '[]'::jsonb),
    'audit_history', coalesce((
      select jsonb_agg(to_jsonb(log) order by log.created_at desc)
      from (
        select id, actor_id, action, target_type, target_id, details, created_at
        from public.admin_audit_log
        where target_type in (
          'platform_control_state', 'platform_configuration_snapshot',
          'platform_preview_access'
        )
        order by created_at desc
        limit 100
      ) log
    ), '[]'::jsonb),
    'token_analytics', jsonb_build_object(
      'tokens_generated_today', coalesce((
        select sum(amount)
        from public.credit_transactions
        where amount > 0 and created_at >= date_trunc('day', now())
      ), 0),
      'tokens_gifted_today', coalesce((
        select sum(abs(amount))
        from public.credit_transactions
        where reason ilike '%gift%' and created_at >= date_trunc('day', now())
      ), 0),
      'tokens_spent_today', abs(coalesce((
        select sum(amount)
        from public.credit_transactions
        where amount < 0 and created_at >= date_trunc('day', now())
      ), 0)),
      'tokens_burned_today', abs(coalesce((
        select sum(amount)
        from public.credit_transactions
        where amount < 0
          and reason not ilike '%gift%'
          and created_at >= date_trunc('day', now())
      ), 0)),
      'tokens_in_circulation', coalesce((select sum(credits) from public.profiles), 0),
      'tokens_earned', coalesce((
        select sum(amount) from public.credit_transactions where amount > 0
      ), 0),
      'tokens_spent', abs(coalesce((
        select sum(amount) from public.credit_transactions where amount < 0
      ), 0)),
      'reward_claims', (select count(*) from public.listening_reward_claims),
      'average_balance', coalesce((
        select round(avg(credits)::numeric, 2) from public.profiles
      ), 0)
    ),
    'health', public.admin_get_community_health() || jsonb_build_object(
      'artists_online', (
        select count(distinct session.user_id)
        from public.listening_sessions session
        where session.last_heartbeat_at >= now() - interval '15 minutes'
          and exists (
            select 1 from public.songs song where song.user_id = session.user_id
          )
      ),
      'reviews_today', (
        select count(*) from public.reviews where created_at >= date_trunc('day', now())
      )
    ),
    'top_songs', coalesce((
      select jsonb_agg(to_jsonb(ranked))
      from (
        select song.id, song.title, song.artist_name,
          count(review.id)::integer as reviews
        from public.songs song
        left join public.reviews review on review.song_id = song.id
        where song.removed_at is null
        group by song.id
        order by count(review.id) desc, song.created_at desc
        limit 5
      ) ranked
    ), '[]'::jsonb),
    'top_artists', coalesce((
      select jsonb_agg(to_jsonb(ranked))
      from (
        select profile.id, profile.display_name,
          count(distinct song.id)::integer as songs,
          count(distinct follow.follower_id)::integer as followers
        from public.profiles profile
        left join public.songs song
          on song.user_id = profile.id and song.removed_at is null
        left join public.artist_follows follow on follow.artist_id = profile.id
        group by profile.id
        having count(distinct song.id) > 0
        order by count(distinct follow.follower_id) desc, count(distinct song.id) desc
        limit 5
      ) ranked
    ), '[]'::jsonb),
    'most_shared_songs', coalesce((
      select jsonb_agg(to_jsonb(ranked))
      from (
        select song.id, song.title, song.artist_name,
          count(share.id)::integer as total
        from public.songs song
        join public.song_shares share on share.song_id = song.id
        where song.removed_at is null
        group by song.id
        order by count(share.id) desc
        limit 5
      ) ranked
    ), '[]'::jsonb),
    'most_commented_songs', coalesce((
      select jsonb_agg(to_jsonb(ranked))
      from (
        select song.id, song.title, song.artist_name,
          count(comment.id)::integer as total
        from public.songs song
        join public.song_comments comment
          on comment.song_id = song.id and comment.removed_at is null
        where song.removed_at is null
        group by song.id
        order by count(comment.id) desc
        limit 5
      ) ranked
    ), '[]'::jsonb),
    'most_supported_artists', coalesce((
      select jsonb_agg(to_jsonb(ranked))
      from (
        select profile.id, profile.display_name,
          count(event.id)::integer as total
        from public.profiles profile
        join public.community_support_events event on event.artist_id = profile.id
        group by profile.id
        order by count(event.id) desc
        limit 5
      ) ranked
    ), '[]'::jsonb)
  )
  into result
  from public.platform_control_state state
  where state.id = true;

  return result;
end;
$$;

create or replace function public.admin_update_control_draft(
  section_key text,
  section_value jsonb,
  change_description text default ''
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
    'theme', 'homepage', 'discovery', 'spotlight', 'artistProfile',
    'tokens', 'permissions', 'experiments', 'announcements'
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

create or replace function public.admin_replace_control_draft(
  target_config jsonb,
  change_description text default 'Imported configuration'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.is_founder_controller() then
    raise exception 'Founder controller access required.';
  end if;
  perform public.validate_platform_control_config(target_config);

  update public.platform_control_state
  set
    draft_config = target_config,
    draft_revision = draft_revision + 1,
    has_unpublished_changes = target_config is distinct from published_config,
    updated_by = auth.uid(),
    updated_at = now()
  where id = true;

  insert into public.admin_audit_log (
    actor_id, action, target_type, details
  )
  values (
    auth.uid(), 'platform_control_draft_imported', 'platform_control_state',
    jsonb_build_object('description', left(coalesce(change_description, ''), 500))
  );

  return public.admin_get_control_center();
end;
$$;

create or replace function public.admin_reset_control_draft()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.can_manage_platform_control() then
    raise exception 'Super Admin access required.';
  end if;

  update public.platform_control_state
  set
    draft_config = published_config,
    draft_revision = draft_revision + 1,
    has_unpublished_changes = false,
    updated_by = auth.uid(),
    updated_at = now()
  where id = true;

  insert into public.admin_audit_log (
    actor_id, action, target_type, details
  )
  values (
    auth.uid(), 'platform_control_draft_reset', 'platform_control_state', '{}'::jsonb
  );

  return public.admin_get_control_center();
end;
$$;

create or replace function public.admin_publish_control_draft(
  change_description text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  state public.platform_control_state%rowtype;
begin
  if not public.can_manage_platform_control() then
    raise exception 'Super Admin access required.';
  end if;

  select * into state
  from public.platform_control_state
  where id = true
  for update;

  perform public.validate_platform_control_config(state.draft_config);

  insert into public.platform_configuration_snapshots (
    name, description, snapshot_kind, config, source_version, created_by
  )
  values (
    'Automatic backup before version ' || (state.published_version + 1),
    left(coalesce(change_description, ''), 1000),
    'automatic',
    state.published_config,
    state.published_version,
    auth.uid()
  );

  perform public.apply_platform_control_config(state.draft_config);

  update public.platform_control_state
  set
    stable_config = published_config,
    published_config = draft_config,
    published_version = published_version + 1,
    has_unpublished_changes = false,
    published_by = auth.uid(),
    updated_by = auth.uid(),
    published_at = now(),
    updated_at = now()
  where id = true;

  insert into public.admin_audit_log (
    actor_id, action, target_type, details
  )
  values (
    auth.uid(), 'platform_control_published', 'platform_control_state',
    jsonb_build_object(
      'from_version', state.published_version,
      'to_version', state.published_version + 1,
      'description', left(coalesce(change_description, ''), 500)
    )
  );

  return public.admin_get_control_center();
end;
$$;

create or replace function public.admin_create_control_snapshot(
  snapshot_name text,
  snapshot_description text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  state public.platform_control_state%rowtype;
begin
  if not public.can_manage_platform_control() then
    raise exception 'Super Admin access required.';
  end if;
  if char_length(trim(snapshot_name)) not between 3 and 120 then
    raise exception 'Snapshot name must contain 3 to 120 characters.';
  end if;

  select * into state from public.platform_control_state where id = true;
  insert into public.platform_configuration_snapshots (
    name, description, snapshot_kind, config, source_version, created_by
  )
  values (
    trim(snapshot_name), left(coalesce(snapshot_description, ''), 1000),
    'manual', state.draft_config, state.published_version, auth.uid()
  );

  insert into public.admin_audit_log (
    actor_id, action, target_type, details
  )
  values (
    auth.uid(), 'platform_control_snapshot_created',
    'platform_configuration_snapshot',
    jsonb_build_object('name', trim(snapshot_name))
  );

  return public.admin_get_control_center();
end;
$$;

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
    jsonb_build_object('restored_to', 'draft')
  );

  return public.admin_get_control_center();
end;
$$;

create or replace function public.admin_emergency_restore_platform()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  state public.platform_control_state%rowtype;
begin
  if not public.is_founder_controller() then
    raise exception 'Founder controller access required.';
  end if;

  select * into state
  from public.platform_control_state
  where id = true
  for update;

  insert into public.platform_configuration_snapshots (
    name, description, snapshot_kind, config, source_version, created_by
  )
  values (
    'Emergency backup of version ' || state.published_version,
    'Captured immediately before founder emergency restore.',
    'emergency', state.published_config, state.published_version, auth.uid()
  );

  perform public.apply_platform_control_config(state.stable_config);

  update public.platform_control_state
  set
    published_config = stable_config,
    draft_config = stable_config,
    published_version = published_version + 1,
    draft_revision = draft_revision + 1,
    has_unpublished_changes = false,
    published_by = auth.uid(),
    updated_by = auth.uid(),
    published_at = now(),
    updated_at = now()
  where id = true;

  insert into public.admin_audit_log (
    actor_id, action, target_type, details
  )
  values (
    auth.uid(), 'platform_control_emergency_restore',
    'platform_control_state',
    jsonb_build_object('restored_from_version', state.published_version)
  );

  return public.admin_get_control_center();
end;
$$;

create or replace function public.admin_set_platform_preview_access(
  target_user_id uuid,
  allowed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.is_founder_controller() then
    raise exception 'Founder controller access required.';
  end if;
  if not exists (select 1 from public.profiles where id = target_user_id) then
    raise exception 'User was not found.';
  end if;

  insert into public.platform_preview_access (
    user_id, can_preview, preview_enabled, granted_by, granted_at
  )
  values (
    target_user_id, allowed, false, auth.uid(),
    case when allowed then now() else null end
  )
  on conflict (user_id) do update
  set
    can_preview = excluded.can_preview,
    preview_enabled = case
      when excluded.can_preview then platform_preview_access.preview_enabled
      else false
    end,
    granted_by = auth.uid(),
    granted_at = case when excluded.can_preview then now() else null end,
    updated_at = now();

  insert into public.admin_audit_log (
    actor_id, action, target_type, target_id, details
  )
  values (
    auth.uid(), 'platform_preview_access_updated',
    'platform_preview_access', target_user_id,
    jsonb_build_object('allowed', allowed)
  );

  return public.admin_get_control_center();
end;
$$;

create or replace function public.set_my_platform_preview_mode(enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if not public.can_manage_platform_control()
    and not coalesce((
      select access.can_preview
      from public.platform_preview_access access
      where access.user_id = auth.uid()
    ), false)
  then
    raise exception 'Preview access has not been granted.';
  end if;

  insert into public.platform_preview_access (
    user_id, can_preview, preview_enabled, granted_by, granted_at
  )
  values (
    auth.uid(), true, enabled,
    case when public.is_founder_controller() then auth.uid() else null end,
    now()
  )
  on conflict (user_id) do update
  set preview_enabled = enabled, updated_at = now();

  return public.get_platform_runtime();
end;
$$;

create or replace function public.enforce_platform_emergency_controls()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  config jsonb;
  claimed_today integer;
begin
  select published_config into config
  from public.platform_control_state
  where id = true;

  if tg_table_name = 'listening_reward_claims' then
    if coalesce((config#>>'{tokens,emergency,pauseTokenGeneration}')::boolean, false)
      or coalesce((config#>>'{tokens,emergency,pauseRewards}')::boolean, false)
    then
      raise exception 'Listening rewards are temporarily paused.';
    end if;
    select count(*)::integer into claimed_today
    from public.listening_reward_claims claim
    where claim.user_id = new.user_id
      and claim.created_at >= date_trunc('day', now());
    if claimed_today >= coalesce(
      (config#>>'{tokens,maxTokensPerDay}')::integer, 3
    ) then
      raise exception 'Daily listening reward limit reached.';
    end if;
    return new;
  end if;

  if tg_table_name = 'songs' then
    if coalesce((config#>>'{tokens,emergency,pauseSubmissions}')::boolean, false)
    then
      raise exception 'Song submissions are temporarily paused.';
    end if;
    return new;
  end if;

  if tg_table_name = 'daily_mission_progress' then
    if new.claimed_at is not null
      and old.claimed_at is null
      and (
        coalesce((config#>>'{tokens,emergency,pauseMissions}')::boolean, false)
        or coalesce((config#>>'{tokens,emergency,pauseRewards}')::boolean, false)
      )
    then
      raise exception 'Mission rewards are temporarily paused.';
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_platform_song_submission_control on public.songs;
create trigger enforce_platform_song_submission_control
before insert on public.songs
for each row execute function public.enforce_platform_emergency_controls();

drop trigger if exists enforce_platform_listening_reward_control
  on public.listening_reward_claims;
create trigger enforce_platform_listening_reward_control
before insert on public.listening_reward_claims
for each row execute function public.enforce_platform_emergency_controls();

drop trigger if exists enforce_platform_mission_reward_control
  on public.daily_mission_progress;
create trigger enforce_platform_mission_reward_control
before update of claimed_at on public.daily_mission_progress
for each row execute function public.enforce_platform_emergency_controls();

create or replace function public.current_submission_token_cost(
  target_platform public.music_platform
)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (
      select (state.published_config#>>'{tokens,submissionCost}')::integer
      from public.platform_control_state state
      where state.id = true
    ),
    1
  );
$$;

do $$
declare
  discovery_function text;
begin
  select pg_get_functiondef(
    'public.get_public_discovery_feed(integer)'::regprocedure
  )
  into discovery_function;
  discovery_function := replace(
    discovery_function,
    'least(coalesce(feed_limit, 8), 20)',
    'least(coalesce(feed_limit, 8), 100)'
  );
  execute discovery_function;
end;
$$;

alter table public.spotlight_slots
  drop constraint if exists spotlight_slots_slot_number_check;
alter table public.spotlight_slots
  add constraint spotlight_slots_slot_number_check
  check (slot_number in (1, 2, 3));

insert into public.spotlight_slots (slot_number)
values (3)
on conflict (slot_number) do nothing;

create or replace function public.super_admin_control_center_health_report()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'healthy',
      to_regclass('public.platform_control_state') is not null
      and to_regclass('public.platform_configuration_snapshots') is not null
      and to_regclass('public.platform_preview_access') is not null
      and (select count(*) = 1 from public.platform_control_state where id = true)
      and (select count(*) >= 1 from public.platform_configuration_snapshots)
      and (select count(*) = 3 from public.spotlight_slots),
    'control_state_rows', (select count(*) from public.platform_control_state),
    'snapshot_rows', (select count(*) from public.platform_configuration_snapshots),
    'spotlight_slots', (select count(*) from public.spotlight_slots),
    'published_version', (
      select published_version from public.platform_control_state where id = true
    ),
    'draft_revision', (
      select draft_revision from public.platform_control_state where id = true
    ),
    'has_unpublished_changes', (
      select has_unpublished_changes from public.platform_control_state where id = true
    ),
    'runtime_function', to_regprocedure('public.get_platform_runtime()') is not null,
    'admin_function', to_regprocedure('public.admin_get_control_center()') is not null,
    'publish_function',
      to_regprocedure('public.admin_publish_control_draft(text)') is not null,
    'emergency_trigger_count', (
      select count(*)
      from pg_trigger
      where not tgisinternal
        and tgname in (
          'enforce_platform_song_submission_control',
          'enforce_platform_listening_reward_control',
          'enforce_platform_mission_reward_control'
        )
    )
  );
$$;

revoke all on function public.default_platform_control_config() from public;
revoke all on function public.is_founder_controller(uuid) from public;
revoke all on function public.can_manage_platform_control() from public;
revoke all on function public.validate_platform_control_config(jsonb) from public;
revoke all on function public.get_platform_runtime() from public;
revoke all on function public.admin_get_control_center() from public;
revoke all on function public.admin_update_control_draft(text, jsonb, text) from public;
revoke all on function public.admin_replace_control_draft(jsonb, text) from public;
revoke all on function public.admin_reset_control_draft() from public;
revoke all on function public.admin_publish_control_draft(text) from public;
revoke all on function public.admin_create_control_snapshot(text, text) from public;
revoke all on function public.admin_restore_control_snapshot(uuid) from public;
revoke all on function public.admin_emergency_restore_platform() from public;
revoke all on function public.admin_set_platform_preview_access(uuid, boolean) from public;
revoke all on function public.set_my_platform_preview_mode(boolean) from public;
revoke all on function public.super_admin_control_center_health_report() from public;

grant execute on function public.get_platform_runtime()
  to anon, authenticated, service_role;
grant execute on function public.set_my_platform_preview_mode(boolean)
  to authenticated, service_role;
grant execute on function public.admin_get_control_center()
  to authenticated, service_role;
grant execute on function public.admin_update_control_draft(text, jsonb, text)
  to authenticated, service_role;
grant execute on function public.admin_replace_control_draft(jsonb, text)
  to authenticated, service_role;
grant execute on function public.admin_reset_control_draft()
  to authenticated, service_role;
grant execute on function public.admin_publish_control_draft(text)
  to authenticated, service_role;
grant execute on function public.admin_create_control_snapshot(text, text)
  to authenticated, service_role;
grant execute on function public.admin_restore_control_snapshot(uuid)
  to authenticated, service_role;
grant execute on function public.admin_emergency_restore_platform()
  to authenticated, service_role;
grant execute on function public.admin_set_platform_preview_access(uuid, boolean)
  to authenticated, service_role;
grant execute on function public.super_admin_control_center_health_report()
  to authenticated, service_role;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'platform_control_state'
  ) then
    alter publication supabase_realtime add table public.platform_control_state;
  end if;
exception
  when insufficient_privilege then null;
end;
$$;
