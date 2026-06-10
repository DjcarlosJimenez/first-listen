-- Internal/external content classification, scheduled external pricing,
-- grandfathered submission costs, and redirect preferences.

alter table public.profiles
  add column if not exists external_redirect_notice_disabled boolean
  not null default false;

alter table public.songs
  add column if not exists content_classification text,
  add column if not exists submission_token_cost smallint;

update public.songs
set
  content_classification = case
    when platform in ('youtube', 'youtube_music', 'soundcloud')
      then 'internal'
    else 'external'
  end,
  submission_token_cost = case
    when submitted_with_founder_credit then 0
    else 1
  end
where content_classification is null
   or submission_token_cost is null;

alter table public.songs
  alter column content_classification set default 'internal',
  alter column content_classification set not null,
  alter column submission_token_cost set default 1,
  alter column submission_token_cost set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'songs_content_classification_check'
      and conrelid = 'public.songs'::regclass
  ) then
    alter table public.songs
      add constraint songs_content_classification_check
      check (content_classification in ('internal', 'external'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'songs_submission_token_cost_check'
      and conrelid = 'public.songs'::regclass
  ) then
    alter table public.songs
      add constraint songs_submission_token_cost_check
      check (submission_token_cost between 0 and 1000);
  end if;
end;
$$;

create table if not exists public.external_content_pricing (
  platform public.music_platform primary key,
  current_token_cost smallint not null default 1
    check (current_token_cost between 1 and 1000),
  scheduled_token_cost smallint not null default 8
    check (scheduled_token_cost between 1 and 1000),
  activation_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (platform in ('spotify', 'apple_music', 'tiktok'))
);

insert into public.external_content_pricing (
  platform,
  current_token_cost,
  scheduled_token_cost
)
values
  ('spotify', 1, 8),
  ('apple_music', 1, 8),
  ('tiktok', 1, 8)
on conflict (platform) do nothing;

create trigger external_content_pricing_set_updated_at
  before update on public.external_content_pricing
  for each row execute function public.set_updated_at();

alter table public.external_content_pricing enable row level security;
revoke all on table public.external_content_pricing
  from public, anon, authenticated;

create or replace function public.content_classification_for_platform(
  target_platform public.music_platform
)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when target_platform in ('youtube', 'youtube_music', 'soundcloud')
      then 'internal'
    else 'external'
  end;
$$;

create or replace function public.current_submission_token_cost(
  target_platform public.music_platform
)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when public.content_classification_for_platform(target_platform) = 'internal'
      then 1
    else coalesce((
      select case
        when pricing.activation_at is not null
          and now() >= pricing.activation_at
          then pricing.scheduled_token_cost
        else pricing.current_token_cost
      end
      from public.external_content_pricing as pricing
      where pricing.platform = target_platform
    ), 1)
  end;
$$;

create or replace function public.get_content_economy_settings()
returns table (
  platform public.music_platform,
  classification text,
  compatibility_status text,
  current_token_cost integer,
  scheduled_token_cost integer,
  activation_at timestamptz,
  effective_token_cost integer,
  activation_pending boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with providers(platform, compatibility_status) as (
    values
      ('youtube'::public.music_platform, 'Partially Supported'::text),
      ('youtube_music'::public.music_platform, 'Partially Supported'::text),
      ('soundcloud'::public.music_platform, 'Not Recommended'::text),
      ('spotify'::public.music_platform, 'Discovery Only'::text),
      ('apple_music'::public.music_platform, 'Discovery Only'::text),
      ('tiktok'::public.music_platform, 'Discovery Only'::text)
  )
  select
    providers.platform,
    public.content_classification_for_platform(providers.platform),
    providers.compatibility_status,
    coalesce(pricing.current_token_cost, 1)::integer,
    coalesce(pricing.scheduled_token_cost, 1)::integer,
    pricing.activation_at,
    public.current_submission_token_cost(providers.platform),
    pricing.activation_at is not null and now() < pricing.activation_at
  from providers
  left join public.external_content_pricing as pricing
    on pricing.platform = providers.platform
  order by case providers.platform
    when 'youtube' then 1
    when 'youtube_music' then 2
    when 'soundcloud' then 3
    when 'spotify' then 4
    when 'apple_music' then 5
    when 'tiktok' then 6
  end;
$$;

create or replace function public.update_external_redirect_preference(
  notice_disabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  update public.profiles
  set
    external_redirect_notice_disabled = notice_disabled,
    updated_at = now()
  where id = auth.uid()
    and account_status = 'active'
    and banned_at is null;

  if not found then raise exception 'Active account required'; end if;
  return notice_disabled;
end;
$$;

create or replace function public.admin_update_external_content_pricing(
  target_platform public.music_platform,
  new_current_token_cost integer,
  new_scheduled_token_cost integer,
  new_activation_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_row public.external_content_pricing%rowtype;
begin
  if public.current_user_role() <> 'super_admin' then
    raise exception 'Super Admin access required';
  end if;
  if target_platform not in ('spotify', 'apple_music', 'tiktok') then
    raise exception 'Only external content pricing can be configured';
  end if;
  if new_current_token_cost not between 1 and 1000
    or new_scheduled_token_cost not between 1 and 1000
  then
    raise exception 'Token prices must be between 1 and 1000';
  end if;

  select *
  into previous_row
  from public.external_content_pricing
  where platform = target_platform
  for update;

  insert into public.external_content_pricing (
    platform,
    current_token_cost,
    scheduled_token_cost,
    activation_at,
    updated_by
  )
  values (
    target_platform,
    new_current_token_cost,
    new_scheduled_token_cost,
    new_activation_at,
    auth.uid()
  )
  on conflict (platform) do update set
    current_token_cost = excluded.current_token_cost,
    scheduled_token_cost = excluded.scheduled_token_cost,
    activation_at = excluded.activation_at,
    updated_by = auth.uid(),
    updated_at = now();

  insert into public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  )
  values (
    auth.uid(),
    'update_external_content_pricing',
    'music_platform',
    null,
    jsonb_build_object(
      'platform', target_platform,
      'previous_current_token_cost', previous_row.current_token_cost,
      'new_current_token_cost', new_current_token_cost,
      'previous_scheduled_token_cost', previous_row.scheduled_token_cost,
      'new_scheduled_token_cost', new_scheduled_token_cost,
      'previous_activation_at', previous_row.activation_at,
      'new_activation_at', new_activation_at
    )
  );
end;
$$;

create or replace function public.music_url_matches_platform(
  music_url text,
  song_platform public.music_platform
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  normalized text := lower(trim(music_url));
begin
  if char_length(normalized) > 2000 or normalized !~ '^https://' then
    return false;
  end if;

  if song_platform = 'spotify' then
    return normalized ~ '^https://open\.spotify\.com/(intl-[a-z-]+/)?track/[a-z0-9]+';
  elsif song_platform = 'youtube_music' then
    return normalized ~ '^https://music\.youtube\.com/watch\?'
      and normalized ~ '([?&])v=[a-z0-9_-]{6,}';
  elsif song_platform = 'youtube' then
    return normalized ~ '^https://(www\.|m\.)?youtube\.com/(watch\?|shorts/)'
      or normalized ~ '^https://youtu\.be/[a-z0-9_-]{6,}';
  elsif song_platform = 'soundcloud' then
    return normalized ~ '^https://(www\.)?soundcloud\.com/[^/]+/[^/?]+';
  elsif song_platform = 'apple_music' then
    return normalized ~ '^https://music\.apple\.com/[a-z]{2}/(album|song)/';
  elsif song_platform = 'tiktok' then
    return normalized ~ '^https://(www\.)?tiktok\.com/@[^/]+/video/[0-9]+'
      or normalized ~ '^https://(vm|vt)\.tiktok\.com/[a-z0-9]+';
  end if;
  return false;
end;
$$;

create or replace function public.submit_song(
  song_title text,
  song_artist_name text,
  song_cover_image_url text,
  song_music_url text,
  song_platform public.music_platform,
  song_genre text,
  song_language text,
  song_feedback_focus text[],
  song_country text,
  song_explicit_content boolean default false,
  song_content_kind text default 'song',
  song_duration_seconds integer default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_song_id uuid;
  submitter_role public.app_role;
  founder_remaining smallint;
  used_founder_submission boolean := false;
  charged_token_cost integer := 0;
  quoted_token_cost integer;
  next_queue_tier text := 'public';
  next_approval_status text := 'auto_approved';
  next_active boolean := true;
  normalized_cover text;
  next_classification text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select role, founder_free_submissions_remaining
  into submitter_role, founder_remaining
  from public.profiles
  where id = auth.uid()
    and account_status = 'active'
    and banned_at is null
  for update;
  if not found then raise exception 'Active account required'; end if;

  normalized_cover := coalesce(
    nullif(trim(song_cover_image_url), ''),
    'https://www.firstlisten.net/covers/default-song.svg'
  );

  if char_length(trim(song_title)) not between 1 and 120
    or char_length(trim(song_artist_name)) not between 1 and 120
    or char_length(trim(song_country)) not between 2 and 120
    or normalized_cover !~* '^https://'
    or char_length(normalized_cover) > 2000
    or char_length(trim(song_music_url)) > 2000
  then
    raise exception 'Required song metadata is invalid';
  end if;

  if song_genre not in (
    'Pop', 'Rock', 'Hip Hop', 'EDM', 'Country', 'Reggaeton',
    'Regional Mexican', 'Cumbia', 'Salsa', 'Bachata', 'Indie',
    'Alternative', 'Jazz', 'Classical', 'Instrumental', 'Other'
  ) then
    raise exception 'Unsupported genre';
  end if;

  if song_content_kind not in (
    'song', 'music_video', 'remix', 'live_session', 'performance', 'long_form'
  ) then
    raise exception 'Unsupported content type';
  end if;

  if song_duration_seconds is not null
    and song_duration_seconds not between 15 and 43200
  then
    raise exception 'Content duration is invalid';
  end if;

  if not public.music_url_matches_platform(song_music_url, song_platform) then
    raise exception 'Unsupported or invalid music link';
  end if;

  if exists (
    select 1
    from public.songs
    where lower(trim(music_url)) = lower(trim(song_music_url))
  ) then
    raise exception 'This song link has already been submitted';
  end if;

  if coalesce(song_duration_seconds, 0) > 480 or song_content_kind = 'long_form' then
    next_queue_tier := 'manual_review';
    next_approval_status := 'pending';
    next_active := false;
  end if;

  next_classification :=
    public.content_classification_for_platform(song_platform);
  quoted_token_cost := public.current_submission_token_cost(song_platform);

  if submitter_role <> 'super_admin' then
    if founder_remaining > 0 then
      update public.profiles
      set
        founder_free_submissions_remaining =
          founder_free_submissions_remaining - 1,
        founder_free_submission_available =
          founder_free_submissions_remaining - 1 > 0,
        updated_at = now()
      where id = auth.uid();
      used_founder_submission := true;
    else
      update public.profiles
      set credits = credits - quoted_token_cost, updated_at = now()
      where id = auth.uid() and credits >= quoted_token_cost;
      if not found then
        raise exception '% tokens are required', quoted_token_cost;
      end if;
      charged_token_cost := quoted_token_cost;

      insert into public.credit_transactions (user_id, amount, reason)
      values (
        auth.uid(),
        -quoted_token_cost,
        format('%s content submission: %s', initcap(next_classification), song_platform)
      );
    end if;
  end if;

  insert into public.songs (
    user_id,
    title,
    artist_name,
    cover_image_url,
    music_url,
    platform,
    genre,
    song_language,
    feedback_focus,
    country,
    explicit_content,
    submitted_with_founder_credit,
    is_active,
    media_vertical,
    content_kind,
    content_duration_seconds,
    queue_tier,
    approval_status,
    content_classification,
    submission_token_cost
  )
  values (
    auth.uid(),
    trim(song_title),
    trim(song_artist_name),
    normalized_cover,
    trim(song_music_url),
    song_platform,
    song_genre,
    song_language,
    song_feedback_focus,
    trim(song_country),
    song_explicit_content,
    used_founder_submission,
    next_active,
    'music',
    song_content_kind,
    song_duration_seconds,
    next_queue_tier,
    next_approval_status,
    next_classification,
    charged_token_cost
  )
  returning id into new_song_id;

  return new_song_id;
end;
$$;

create or replace function public.content_economy_health_report()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'pricing_table',
      to_regclass('public.external_content_pricing') is not null,
    'pricing_rows', (
      select count(*)::integer from public.external_content_pricing
    ),
    'external_platforms', (
      select coalesce(jsonb_agg(platform order by platform), '[]'::jsonb)
      from public.external_content_pricing
    ),
    'invalid_classifications', (
      select count(*)::integer
      from public.songs
      where content_classification <>
        public.content_classification_for_platform(platform)
    ),
    'invalid_submission_costs', (
      select count(*)::integer
      from public.songs
      where submission_token_cost < 0
    ),
    'tiktok_enum_available', exists (
      select 1
      from unnest(enum_range(null::public.music_platform)) as platform_value
      where platform_value::text = 'tiktok'
    ),
    'functions', jsonb_build_object(
      'get_content_economy_settings',
        to_regprocedure('public.get_content_economy_settings()') is not null,
      'current_submission_token_cost',
        to_regprocedure(
          'public.current_submission_token_cost(public.music_platform)'
        ) is not null,
      'update_external_redirect_preference',
        to_regprocedure(
          'public.update_external_redirect_preference(boolean)'
        ) is not null,
      'admin_update_external_content_pricing',
        to_regprocedure(
          'public.admin_update_external_content_pricing(public.music_platform,integer,integer,timestamp with time zone)'
        ) is not null
    )
  );
$$;

revoke all on function public.content_classification_for_platform(
  public.music_platform
) from public, anon, authenticated;
revoke all on function public.current_submission_token_cost(
  public.music_platform
) from public, anon, authenticated;
revoke all on function public.get_content_economy_settings()
  from public, anon, authenticated;
revoke all on function public.update_external_redirect_preference(boolean)
  from public, anon, authenticated;
revoke all on function public.admin_update_external_content_pricing(
  public.music_platform, integer, integer, timestamptz
) from public, anon, authenticated;
revoke all on function public.content_economy_health_report()
  from public, anon, authenticated;

grant execute on function public.get_content_economy_settings()
  to anon, authenticated;
grant execute on function public.update_external_redirect_preference(boolean)
  to authenticated;
grant execute on function public.admin_update_external_content_pricing(
  public.music_platform, integer, integer, timestamptz
) to authenticated;
grant execute on function public.content_economy_health_report()
  to service_role;
