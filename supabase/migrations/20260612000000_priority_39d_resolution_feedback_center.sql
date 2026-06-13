-- Priority 39D: Cross Platform Resolution Engine + Feedback & Support Center.
--
-- This migration is additive. It preserves existing songs, reviews, profiles,
-- token balances, and platform links. Automatic resolution remains truthful:
-- Basic mode infers only YouTube <-> YouTube Music links from the same video id.
-- Advanced mode also supports creator/staff supplied verified platform links.

alter table public.song_platform_links
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.profiles(id) on delete set null,
  add column if not exists verification_note text;

alter table public.song_platform_links
  drop constraint if exists song_platform_links_resolution_source_check;
alter table public.song_platform_links
  add constraint song_platform_links_resolution_source_check
  check (resolution_source in ('submitted', 'inferred', 'manual', 'verified'));

update public.song_platform_links
set
  verified_at = coalesce(verified_at, created_at, now()),
  verification_note = coalesce(
    nullif(verification_note, ''),
    case
      when resolution_source = 'submitted' then 'Creator submitted primary link'
      when resolution_source = 'inferred' then 'Derived from matching YouTube video id'
      else 'Previously stored platform link'
    end
  )
where verified_at is null
   or verification_note is null;

create index if not exists song_platform_links_verified_idx
  on public.song_platform_links (song_id, resolution_source, verified_at desc);

create table if not exists public.feedback_submissions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete set null,
  category text not null check (
    category in (
      'report_problem',
      'suggest_improvement',
      'ask_question',
      'general_feedback'
    )
  ),
  status text not null default 'open' check (
    status in ('open', 'in_progress', 'resolved', 'archived', 'spam_deleted')
  ),
  subject text not null check (char_length(trim(subject)) between 3 and 160),
  message text not null check (char_length(trim(message)) between 10 and 4000),
  screenshot_url text check (
    screenshot_url is null
    or (
      screenshot_url ~* '^https://'
      and char_length(screenshot_url) <= 2000
    )
  ),
  page_url text check (page_url is null or char_length(page_url) <= 2000),
  contact_email text check (
    contact_email is null
    or (
      contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
      and char_length(contact_email) <= 254
    )
  ),
  notify_by_email boolean not null default false,
  user_agent text,
  founder_reply text,
  replied_by uuid references public.profiles(id) on delete set null,
  replied_at timestamptz,
  resolved_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feedback_submissions_status_idx
  on public.feedback_submissions (status, created_at desc);
create index if not exists feedback_submissions_user_idx
  on public.feedback_submissions (user_id, created_at desc)
  where user_id is not null;

alter table public.feedback_submissions enable row level security;
revoke all on table public.feedback_submissions from public, anon, authenticated;

drop policy if exists "users read own feedback or staff reads feedback"
  on public.feedback_submissions;
create policy "users read own feedback or staff reads feedback"
  on public.feedback_submissions
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_staff()
  );

create or replace function public.ensure_priority39d_platform_config(
  target_config jsonb
)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  with base as (
    select case
      when target_config ? 'discovery' then target_config
      else jsonb_set(target_config, '{discovery}', '{}'::jsonb, true)
    end as config
  ),
  normalized as (
    select jsonb_set(
      config,
      '{discovery,platformResolution}',
      coalesce(config#>'{discovery,platformResolution}', '{}'::jsonb)
      || jsonb_build_object(
        'engineMode',
          case coalesce(config#>>'{discovery,platformResolution,engineMode}', 'basic')
            when 'off' then 'off'
            when 'automatic' then 'advanced'
            when 'recommend' then 'basic'
            when 'basic' then 'basic'
            when 'advanced' then 'advanced'
            else 'basic'
          end,
        'recommendationMode',
          case coalesce(
            config#>>'{discovery,platformResolution,recommendationMode}',
            config#>>'{discovery,platformResolution,engineMode}',
            'recommend'
          )
            when 'off' then 'off'
            when 'automatic' then 'automatic'
            else 'recommend'
          end,
        'preferredPlatformOrder',
          coalesce(config#>'{discovery,platformResolution,preferredPlatformOrder}', '[
            "youtube_music",
            "youtube",
            "spotify",
            "apple_music",
            "tiktok",
            "soundcloud"
          ]'::jsonb),
        'showPlatformRecommendations',
          coalesce((config#>>'{discovery,platformResolution,showPlatformRecommendations}')::boolean, true),
        'showSecondaryPlatforms',
          coalesce((config#>>'{discovery,platformResolution,showSecondaryPlatforms}')::boolean, true),
        'allowCreatorVerifiedLinks',
          coalesce((config#>>'{discovery,platformResolution,allowCreatorVerifiedLinks}')::boolean, true)
      ),
      true
    ) as config
    from base
  )
  select jsonb_set(
    config,
    '{support}',
    coalesce(config#>'{support}', '{}'::jsonb)
    || jsonb_build_object(
      'supportEmail',
        coalesce(nullif(config#>>'{support,supportEmail}', ''), 'support@firstlisten.net'),
      'showNeedHelpLinks',
        coalesce((config#>>'{support,showNeedHelpLinks}')::boolean, true),
      'feedbackCenterEnabled',
        coalesce((config#>>'{support,feedbackCenterEnabled}')::boolean, true),
      'emailNotificationsPrepared',
        coalesce((config#>>'{support,emailNotificationsPrepared}')::boolean, true)
    ),
    true
  )
  from normalized;
$$;

update public.platform_control_state
set
  draft_config = public.ensure_priority39d_platform_config(draft_config),
  published_config = public.ensure_priority39d_platform_config(published_config),
  stable_config = public.ensure_priority39d_platform_config(stable_config),
  updated_at = now()
where id = true;

create or replace function public.platform_resolution_engine_mode()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case coalesce(
    public.ensure_priority39d_platform_config(state.published_config)
      #>> '{discovery,platformResolution,engineMode}',
    'basic'
  )
    when 'off' then 'off'
    when 'advanced' then 'advanced'
    else 'basic'
  end
  from public.platform_control_state state
  where state.id = true;
$$;

create or replace function public.platform_recommendation_engine_mode()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case coalesce(
    public.ensure_priority39d_platform_config(state.published_config)
      #>> '{discovery,platformResolution,recommendationMode}',
    'recommend'
  )
    when 'off' then 'off'
    when 'automatic' then 'automatic'
    else 'recommend'
  end
  from public.platform_control_state state
  where state.id = true;
$$;

create or replace function public.platform_resolution_priority(
  target_platform public.music_platform
)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with configured as (
    select array_agg(value order by ordinality) as preferred_order
    from public.platform_control_state state,
      jsonb_array_elements_text(
        coalesce(
          public.ensure_priority39d_platform_config(state.published_config)
            #> '{discovery,platformResolution,preferredPlatformOrder}',
          '["youtube_music","youtube","spotify","apple_music","tiktok","soundcloud"]'::jsonb
        )
      ) with ordinality as items(value, ordinality)
    where state.id = true
  ),
  fallback as (
    select array[
      'youtube_music',
      'youtube',
      'spotify',
      'apple_music',
      'tiktok',
      'soundcloud'
    ]::text[] as preferred_order
  )
  select coalesce(
    array_position(
      coalesce(configured.preferred_order, fallback.preferred_order),
      target_platform::text
    ),
    99
  )
  from configured
  full join fallback on true;
$$;

create or replace function public.song_platform_links_json(target_song_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with config as (
    select
      public.platform_resolution_engine_mode() as engine_mode,
      coalesce(
        (
          public.ensure_priority39d_platform_config(state.published_config)
            #>> '{discovery,platformResolution,showSecondaryPlatforms}'
        )::boolean,
        true
      ) as show_secondary
    from public.platform_control_state state
    where state.id = true
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'platform', links.platform,
        'music_url', links.music_url,
        'is_primary', links.is_primary,
        'resolution_source', links.resolution_source,
        'confidence_score', links.confidence_score,
        'verified_at', links.verified_at,
        'verification_note', links.verification_note
      )
      order by
        public.platform_resolution_priority(links.platform),
        links.is_primary desc,
        links.confidence_score desc,
        links.created_at
    ),
    '[]'::jsonb
  )
  from public.song_platform_links links
  cross join config
  where links.song_id = target_song_id
    and (
      links.is_primary
      or (
        config.engine_mode <> 'off'
        and config.show_secondary
      )
    );
$$;

create or replace function public.recommended_song_platform(target_song_id uuid)
returns public.music_platform
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when public.platform_recommendation_engine_mode() = 'off' then songs.platform
    else coalesce(
      (
        select links.platform
        from public.song_platform_links links
        where links.song_id = target_song_id
        order by
          public.platform_resolution_priority(links.platform),
          links.is_primary desc,
          links.confidence_score desc,
          links.created_at
        limit 1
      ),
      songs.platform
    )
  end
  from public.songs
  where songs.id = target_song_id;
$$;

create or replace function public.resolve_song_platform_links(target_song_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  song_row public.songs%rowtype;
  video_id text;
  engine_mode text := public.platform_resolution_engine_mode();
begin
  select *
  into song_row
  from public.songs
  where id = target_song_id;

  if not found then
    raise exception 'Song not found';
  end if;

  if not public.music_url_matches_platform(song_row.music_url, song_row.platform) then
    raise exception 'The song URL does not match its platform';
  end if;

  update public.song_platform_links
  set is_primary = false, updated_at = now()
  where song_id = song_row.id
    and is_primary
    and platform <> song_row.platform;

  insert into public.song_platform_links (
    song_id,
    platform,
    music_url,
    is_primary,
    resolution_source,
    confidence_score,
    verified_at,
    verification_note,
    last_resolved_at
  )
  values (
    song_row.id,
    song_row.platform,
    trim(song_row.music_url),
    true,
    'submitted',
    100,
    now(),
    'Creator submitted primary link',
    now()
  )
  on conflict (song_id, platform) do update
  set
    music_url = excluded.music_url,
    is_primary = true,
    resolution_source = 'submitted',
    confidence_score = 100,
    verified_at = coalesce(public.song_platform_links.verified_at, excluded.verified_at),
    verification_note = excluded.verification_note,
    last_resolved_at = now(),
    updated_at = now();

  if engine_mode = 'off' then
    return (
      select count(*)::integer
      from public.song_platform_links
      where song_id = song_row.id
    );
  end if;

  video_id := public.youtube_video_id_from_url(song_row.music_url);

  if video_id is not null and song_row.platform = 'youtube_music' then
    insert into public.song_platform_links (
      song_id,
      platform,
      music_url,
      is_primary,
      resolution_source,
      confidence_score,
      verified_at,
      verification_note,
      last_resolved_at
    )
    values (
      song_row.id,
      'youtube',
      'https://www.youtube.com/watch?v=' || video_id,
      false,
      'inferred',
      90,
      now(),
      'Derived from matching YouTube Music video id',
      now()
    )
    on conflict (song_id, platform) do update
    set
      music_url = excluded.music_url,
      resolution_source = case
        when public.song_platform_links.is_primary then public.song_platform_links.resolution_source
        else 'inferred'
      end,
      confidence_score = greatest(public.song_platform_links.confidence_score, 90),
      verified_at = coalesce(public.song_platform_links.verified_at, excluded.verified_at),
      verification_note = case
        when public.song_platform_links.is_primary then public.song_platform_links.verification_note
        else excluded.verification_note
      end,
      last_resolved_at = now(),
      updated_at = now();
  elsif video_id is not null and song_row.platform = 'youtube' then
    insert into public.song_platform_links (
      song_id,
      platform,
      music_url,
      is_primary,
      resolution_source,
      confidence_score,
      verified_at,
      verification_note,
      last_resolved_at
    )
    values (
      song_row.id,
      'youtube_music',
      'https://music.youtube.com/watch?v=' || video_id,
      false,
      'inferred',
      85,
      now(),
      'Derived from matching YouTube video id',
      now()
    )
    on conflict (song_id, platform) do update
    set
      music_url = excluded.music_url,
      resolution_source = case
        when public.song_platform_links.is_primary then public.song_platform_links.resolution_source
        else 'inferred'
      end,
      confidence_score = greatest(public.song_platform_links.confidence_score, 85),
      verified_at = coalesce(public.song_platform_links.verified_at, excluded.verified_at),
      verification_note = case
        when public.song_platform_links.is_primary then public.song_platform_links.verification_note
        else excluded.verification_note
      end,
      last_resolved_at = now(),
      updated_at = now();
  end if;

  return (
    select count(*)::integer
    from public.song_platform_links
    where song_id = song_row.id
  );
end;
$$;

create or replace function public.upsert_verified_song_platform_link(
  target_song_id uuid,
  target_platform public.music_platform,
  target_music_url text,
  verification_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  song_row public.songs%rowtype;
  actor_role public.app_role;
  saved_link public.song_platform_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into song_row
  from public.songs
  where id = target_song_id
    and removed_at is null
    and merged_into_song_id is null;
  if not found then
    raise exception 'Song not found';
  end if;

  select role into actor_role
  from public.profiles
  where id = auth.uid()
    and account_status = 'active'
    and banned_at is null;
  if not found then
    raise exception 'Active account required';
  end if;

  if song_row.user_id <> auth.uid()
    and actor_role not in ('super_admin', 'admin', 'moderator')
  then
    raise exception 'Only the creator or staff can manage verified platform links';
  end if;

  if target_platform = song_row.platform then
    raise exception 'This platform is already the primary submitted link';
  end if;

  if not public.music_url_matches_platform(target_music_url, target_platform) then
    raise exception 'Verified link does not match the selected platform';
  end if;

  insert into public.song_platform_links (
    song_id,
    platform,
    music_url,
    is_primary,
    resolution_source,
    confidence_score,
    verified_at,
    verified_by,
    verification_note,
    last_resolved_at
  )
  values (
    target_song_id,
    target_platform,
    trim(target_music_url),
    false,
    'verified',
    100,
    now(),
    auth.uid(),
    left(coalesce(nullif(trim(verification_note), ''), 'Creator verified external platform link'), 240),
    now()
  )
  on conflict (song_id, platform) do update
  set
    music_url = excluded.music_url,
    is_primary = false,
    resolution_source = 'verified',
    confidence_score = 100,
    verified_at = now(),
    verified_by = auth.uid(),
    verification_note = excluded.verification_note,
    last_resolved_at = now(),
    updated_at = now()
  returning * into saved_link;

  return jsonb_build_object(
    'platform', saved_link.platform,
    'music_url', saved_link.music_url,
    'is_primary', saved_link.is_primary,
    'resolution_source', saved_link.resolution_source,
    'confidence_score', saved_link.confidence_score
  );
end;
$$;

create or replace function public.remove_verified_song_platform_link(
  target_song_id uuid,
  target_platform public.music_platform
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  song_row public.songs%rowtype;
  actor_role public.app_role;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into song_row
  from public.songs
  where id = target_song_id;
  if not found then
    raise exception 'Song not found';
  end if;

  select role into actor_role
  from public.profiles
  where id = auth.uid()
    and account_status = 'active'
    and banned_at is null;
  if not found then
    raise exception 'Active account required';
  end if;

  if song_row.user_id <> auth.uid()
    and actor_role not in ('super_admin', 'admin', 'moderator')
  then
    raise exception 'Only the creator or staff can manage verified platform links';
  end if;

  delete from public.song_platform_links
  where song_id = target_song_id
    and platform = target_platform
    and not is_primary
    and resolution_source in ('verified', 'manual');

  return found;
end;
$$;

create or replace function public.submit_feedback(
  feedback_category text,
  feedback_subject text,
  feedback_message text,
  screenshot_url text default null,
  page_url text default null,
  contact_email text default null,
  notify_by_email boolean default false,
  user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_feedback_id uuid;
  normalized_screenshot text := nullif(trim(coalesce(screenshot_url, '')), '');
  normalized_page text := nullif(trim(coalesce(page_url, '')), '');
  normalized_email text := nullif(lower(trim(coalesce(contact_email, ''))), '');
begin
  if feedback_category not in (
    'report_problem',
    'suggest_improvement',
    'ask_question',
    'general_feedback'
  ) then
    raise exception 'Unsupported feedback category';
  end if;

  if char_length(trim(coalesce(feedback_subject, ''))) not between 3 and 160 then
    raise exception 'Feedback subject must be between 3 and 160 characters';
  end if;

  if char_length(trim(coalesce(feedback_message, ''))) not between 10 and 4000 then
    raise exception 'Feedback message must be between 10 and 4000 characters';
  end if;

  if normalized_screenshot is not null
    and (normalized_screenshot !~* '^https://' or char_length(normalized_screenshot) > 2000)
  then
    raise exception 'Screenshot must be an https:// URL';
  end if;

  if normalized_email is not null
    and normalized_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  then
    raise exception 'Contact email is invalid';
  end if;

  insert into public.feedback_submissions (
    user_id,
    category,
    subject,
    message,
    screenshot_url,
    page_url,
    contact_email,
    notify_by_email,
    user_agent
  )
  values (
    auth.uid(),
    feedback_category,
    trim(feedback_subject),
    trim(feedback_message),
    normalized_screenshot,
    normalized_page,
    normalized_email,
    coalesce(notify_by_email, false),
    left(nullif(trim(coalesce(user_agent, '')), ''), 500)
  )
  returning id into new_feedback_id;

  return new_feedback_id;
end;
$$;

create or replace function public.admin_list_feedback(
  feedback_status text default null,
  result_limit integer default 100
)
returns table (
  id uuid,
  user_id uuid,
  submitter_name text,
  submitter_email text,
  category text,
  status text,
  subject text,
  message text,
  screenshot_url text,
  page_url text,
  contact_email text,
  notify_by_email boolean,
  founder_reply text,
  replied_at timestamptz,
  resolved_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff access required';
  end if;

  return query
  select
    feedback.id,
    feedback.user_id,
    coalesce(profile.display_name, 'Guest Listener') as submitter_name,
    coalesce(auth_user.email, feedback.contact_email) as submitter_email,
    feedback.category,
    feedback.status,
    feedback.subject,
    feedback.message,
    feedback.screenshot_url,
    feedback.page_url,
    feedback.contact_email,
    feedback.notify_by_email,
    feedback.founder_reply,
    feedback.replied_at,
    feedback.resolved_at,
    feedback.archived_at,
    feedback.created_at,
    feedback.updated_at
  from public.feedback_submissions feedback
  left join public.profiles profile on profile.id = feedback.user_id
  left join auth.users auth_user on auth_user.id = feedback.user_id
  where (
      feedback_status is null
      or feedback_status = 'all'
      or feedback.status = feedback_status
    )
    and feedback.status <> 'spam_deleted'
  order by
    case feedback.status
      when 'open' then 1
      when 'in_progress' then 2
      when 'resolved' then 3
      when 'archived' then 4
      else 5
    end,
    feedback.created_at desc
  limit greatest(1, least(coalesce(result_limit, 100), 500));
end;
$$;

create or replace function public.admin_update_feedback(
  feedback_id uuid,
  next_status text default null,
  reply_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  updated_feedback public.feedback_submissions%rowtype;
begin
  if not public.is_staff() then
    raise exception 'Staff access required';
  end if;

  if next_status is not null
    and next_status not in ('open', 'in_progress', 'resolved', 'archived')
  then
    raise exception 'Unsupported feedback status';
  end if;

  update public.feedback_submissions
  set
    status = coalesce(next_status, status),
    founder_reply = case
      when reply_message is null then founder_reply
      else nullif(trim(reply_message), '')
    end,
    replied_by = case
      when reply_message is null then replied_by
      else auth.uid()
    end,
    replied_at = case
      when reply_message is null then replied_at
      else now()
    end,
    resolved_at = case
      when next_status = 'resolved' then coalesce(resolved_at, now())
      when next_status is not null and next_status <> 'resolved' then null
      else resolved_at
    end,
    archived_at = case
      when next_status = 'archived' then coalesce(archived_at, now())
      when next_status is not null and next_status <> 'archived' then null
      else archived_at
    end,
    updated_at = now()
  where id = feedback_id
    and status <> 'spam_deleted'
  returning * into updated_feedback;

  if not found then
    raise exception 'Feedback item not found';
  end if;

  return jsonb_build_object(
    'id', updated_feedback.id,
    'status', updated_feedback.status,
    'founder_reply', updated_feedback.founder_reply,
    'updated_at', updated_feedback.updated_at
  );
end;
$$;

create or replace function public.admin_delete_feedback_spam(feedback_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if public.current_user_role() <> 'super_admin' then
    raise exception 'Super admin access required';
  end if;

  update public.feedback_submissions
  set
    status = 'spam_deleted',
    archived_at = now(),
    updated_at = now()
  where id = feedback_id;

  return found;
end;
$$;

revoke all on function public.ensure_priority39d_platform_config(jsonb) from public, anon, authenticated;
revoke all on function public.platform_resolution_engine_mode() from public, anon, authenticated;
revoke all on function public.platform_recommendation_engine_mode() from public, anon, authenticated;
revoke all on function public.platform_resolution_priority(public.music_platform) from public, anon, authenticated;
revoke all on function public.recommended_song_platform(uuid) from public, anon, authenticated;
revoke all on function public.resolve_song_platform_links(uuid) from public, anon, authenticated;
revoke all on function public.upsert_verified_song_platform_link(uuid, public.music_platform, text, text) from public, anon, authenticated;
revoke all on function public.remove_verified_song_platform_link(uuid, public.music_platform) from public, anon, authenticated;
revoke all on function public.submit_feedback(text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.admin_list_feedback(text, integer) from public, anon, authenticated;
revoke all on function public.admin_update_feedback(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_delete_feedback_spam(uuid) from public, anon, authenticated;

grant execute on function public.song_platform_links_json(uuid) to authenticated, service_role;
grant execute on function public.recommended_song_platform(uuid) to authenticated, service_role;
grant execute on function public.resolve_song_platform_links(uuid) to service_role;
grant execute on function public.upsert_verified_song_platform_link(uuid, public.music_platform, text, text) to authenticated;
grant execute on function public.remove_verified_song_platform_link(uuid, public.music_platform) to authenticated;
grant execute on function public.submit_feedback(text, text, text, text, text, text, boolean, text) to anon, authenticated;
grant execute on function public.admin_list_feedback(text, integer) to authenticated;
grant execute on function public.admin_update_feedback(uuid, text, text) to authenticated;
grant execute on function public.admin_delete_feedback_spam(uuid) to authenticated;
grant execute on function public.ensure_priority39d_platform_config(jsonb) to service_role;

select public.resolve_song_platform_links(songs.id)
from public.songs
where songs.removed_at is null
  and songs.merged_into_song_id is null;
