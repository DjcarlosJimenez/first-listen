-- Priority 15-21: unified review landing, administrator-managed appearance,
-- announcements, public community discovery, and community health reporting.

create table if not exists public.platform_theme_settings (
  id boolean primary key default true check (id),
  preset text not null default 'first_listen_default'
    check (preset in (
      'first_listen_default',
      'dark_studio',
      'modern_dark',
      'midnight',
      'community_green',
      'custom'
    )),
  background_color text not null default '#F3F4EE'
    check (background_color ~ '^#[0-9A-Fa-f]{6}$'),
  card_color text not null default '#FFFFFF'
    check (card_color ~ '^#[0-9A-Fa-f]{6}$'),
  text_color text not null default '#151815'
    check (text_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text not null default '#C8FF4F'
    check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  button_color text not null default '#171A18'
    check (button_color ~ '^#[0-9A-Fa-f]{6}$'),
  link_color text not null default '#4F7110'
    check (link_color ~ '^#[0-9A-Fa-f]{6}$'),
  border_color text not null default '#D5D9D0'
    check (border_color ~ '^#[0-9A-Fa-f]{6}$'),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.platform_theme_settings (id)
values (true)
on conflict (id) do nothing;

alter table public.platform_theme_settings enable row level security;
revoke all on table public.platform_theme_settings from public, anon, authenticated;
grant select on table public.platform_theme_settings to anon, authenticated;

drop policy if exists platform_theme_settings_public_read on public.platform_theme_settings;
create policy platform_theme_settings_public_read
on public.platform_theme_settings
for select
to anon, authenticated
using (true);

create or replace function public.set_platform_theme_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_platform_theme_updated_at on public.platform_theme_settings;
create trigger set_platform_theme_updated_at
before update on public.platform_theme_settings
for each row execute function public.set_platform_theme_updated_at();

create or replace function public.get_platform_theme()
returns table (
  preset text,
  background_color text,
  card_color text,
  text_color text,
  accent_color text,
  button_color text,
  link_color text,
  border_color text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    settings.preset,
    settings.background_color,
    settings.card_color,
    settings.text_color,
    settings.accent_color,
    settings.button_color,
    settings.link_color,
    settings.border_color,
    settings.updated_at
  from public.platform_theme_settings settings
  where settings.id = true;
$$;

revoke all on function public.get_platform_theme() from public;
grant execute on function public.get_platform_theme() to anon, authenticated, service_role;

create or replace function public.admin_update_platform_theme(
  target_preset text,
  target_background_color text,
  target_card_color text,
  target_text_color text,
  target_accent_color text,
  target_button_color text,
  target_link_color text,
  target_border_color text
)
returns public.platform_theme_settings
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  updated_theme public.platform_theme_settings;
  normalized_colors text[] := array[
    upper(trim(target_background_color)),
    upper(trim(target_card_color)),
    upper(trim(target_text_color)),
    upper(trim(target_accent_color)),
    upper(trim(target_button_color)),
    upper(trim(target_link_color)),
    upper(trim(target_border_color))
  ];
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Administrator access required.';
  end if;

  if target_preset not in (
    'first_listen_default',
    'dark_studio',
    'modern_dark',
    'midnight',
    'community_green',
    'custom'
  ) then
    raise exception 'Unsupported theme preset.';
  end if;

  if exists (
    select 1
    from unnest(normalized_colors) as color
    where color !~ '^#[0-9A-F]{6}$'
  ) then
    raise exception 'Theme colors must use six-digit hexadecimal values.';
  end if;

  insert into public.platform_theme_settings (
    id,
    preset,
    background_color,
    card_color,
    text_color,
    accent_color,
    button_color,
    link_color,
    border_color,
    updated_by
  )
  values (
    true,
    target_preset,
    normalized_colors[1],
    normalized_colors[2],
    normalized_colors[3],
    normalized_colors[4],
    normalized_colors[5],
    normalized_colors[6],
    normalized_colors[7],
    auth.uid()
  )
  on conflict (id) do update
  set
    preset = excluded.preset,
    background_color = excluded.background_color,
    card_color = excluded.card_color,
    text_color = excluded.text_color,
    accent_color = excluded.accent_color,
    button_color = excluded.button_color,
    link_color = excluded.link_color,
    border_color = excluded.border_color,
    updated_by = auth.uid()
  returning * into updated_theme;

  insert into public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  )
  values (
    auth.uid(),
    'platform_theme_updated',
    'platform_theme_settings',
    null,
    jsonb_build_object(
      'preset', updated_theme.preset,
      'background_color', updated_theme.background_color,
      'card_color', updated_theme.card_color,
      'text_color', updated_theme.text_color,
      'accent_color', updated_theme.accent_color,
      'button_color', updated_theme.button_color,
      'link_color', updated_theme.link_color,
      'border_color', updated_theme.border_color
    )
  );

  return updated_theme;
end;
$$;

revoke all on function public.admin_update_platform_theme(text, text, text, text, text, text, text, text) from public;
grant execute on function public.admin_update_platform_theme(text, text, text, text, text, text, text, text)
to authenticated, service_role;

create or replace function public.admin_restore_platform_theme()
returns public.platform_theme_settings
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  return public.admin_update_platform_theme(
    'first_listen_default',
    '#F3F4EE',
    '#FFFFFF',
    '#151815',
    '#C8FF4F',
    '#171A18',
    '#4F7110',
    '#D5D9D0'
  );
end;
$$;

revoke all on function public.admin_restore_platform_theme() from public;
grant execute on function public.admin_restore_platform_theme() to authenticated, service_role;

create table if not exists public.platform_announcements (
  id uuid primary key default gen_random_uuid(),
  announcement_type text not null
    check (announcement_type in (
      'platform_update',
      'scheduled_change',
      'contest',
      'community_news',
      'maintenance',
      'special_event'
    )),
  title text not null check (char_length(trim(title)) between 3 and 120),
  message text not null check (char_length(trim(message)) between 3 and 1000),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  priority smallint not null default 3 check (priority between 1 and 5),
  audience text not null default 'everyone'
    check (audience in ('guests', 'members', 'creators', 'everyone')),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create index if not exists platform_announcements_active_schedule_idx
on public.platform_announcements (is_active, starts_at, ends_at, priority desc);

alter table public.platform_announcements enable row level security;
revoke all on table public.platform_announcements from public, anon, authenticated;

create or replace function public.set_platform_announcement_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_platform_announcement_updated_at on public.platform_announcements;
create trigger set_platform_announcement_updated_at
before update on public.platform_announcements
for each row execute function public.set_platform_announcement_updated_at();

create or replace function public.get_active_platform_announcements()
returns table (
  id uuid,
  announcement_type text,
  title text,
  message text,
  starts_at timestamptz,
  ends_at timestamptz,
  priority smallint,
  audience text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    announcement.id,
    announcement.announcement_type,
    announcement.title,
    announcement.message,
    announcement.starts_at,
    announcement.ends_at,
    announcement.priority,
    announcement.audience
  from public.platform_announcements announcement
  where announcement.is_active = true
    and announcement.starts_at <= now()
    and (announcement.ends_at is null or announcement.ends_at > now())
    and (
      announcement.audience = 'everyone'
      or (announcement.audience = 'guests' and auth.uid() is null)
      or (announcement.audience = 'members' and auth.uid() is not null)
      or (
        announcement.audience = 'creators'
        and auth.uid() is not null
        and exists (
          select 1
          from public.songs song
          where song.user_id = auth.uid()
        )
      )
    )
  order by announcement.priority desc, announcement.starts_at desc;
$$;

revoke all on function public.get_active_platform_announcements() from public;
grant execute on function public.get_active_platform_announcements() to anon, authenticated, service_role;

create or replace function public.admin_list_platform_announcements()
returns setof public.platform_announcements
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Administrator access required.';
  end if;

  return query
  select *
  from public.platform_announcements
  order by is_active desc, priority desc, starts_at desc;
end;
$$;

revoke all on function public.admin_list_platform_announcements() from public;
grant execute on function public.admin_list_platform_announcements() to authenticated, service_role;

create or replace function public.admin_save_platform_announcement(
  target_id uuid,
  target_type text,
  target_title text,
  target_message text,
  target_starts_at timestamptz,
  target_ends_at timestamptz,
  target_priority smallint,
  target_audience text,
  target_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  saved_id uuid;
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Administrator access required.';
  end if;

  if target_type not in (
    'platform_update',
    'scheduled_change',
    'contest',
    'community_news',
    'maintenance',
    'special_event'
  ) then
    raise exception 'Unsupported announcement type.';
  end if;

  if target_audience not in ('guests', 'members', 'creators', 'everyone') then
    raise exception 'Unsupported announcement audience.';
  end if;

  if char_length(trim(target_title)) not between 3 and 120
    or char_length(trim(target_message)) not between 3 and 1000 then
    raise exception 'Announcement title or message length is invalid.';
  end if;

  if target_priority not between 1 and 5 then
    raise exception 'Announcement priority must be between 1 and 5.';
  end if;

  if target_ends_at is not null and target_ends_at <= target_starts_at then
    raise exception 'Announcement end time must be after its start time.';
  end if;

  if target_id is null then
    insert into public.platform_announcements (
      announcement_type,
      title,
      message,
      starts_at,
      ends_at,
      priority,
      audience,
      is_active,
      created_by,
      updated_by
    )
    values (
      target_type,
      trim(target_title),
      trim(target_message),
      target_starts_at,
      target_ends_at,
      target_priority,
      target_audience,
      target_is_active,
      auth.uid(),
      auth.uid()
    )
    returning id into saved_id;
  else
    update public.platform_announcements
    set
      announcement_type = target_type,
      title = trim(target_title),
      message = trim(target_message),
      starts_at = target_starts_at,
      ends_at = target_ends_at,
      priority = target_priority,
      audience = target_audience,
      is_active = target_is_active,
      updated_by = auth.uid()
    where id = target_id
    returning id into saved_id;

    if saved_id is null then
      raise exception 'Announcement not found.';
    end if;
  end if;

  insert into public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  )
  values (
    auth.uid(),
    case when target_id is null then 'announcement_created' else 'announcement_updated' end,
    'platform_announcements',
    saved_id,
    jsonb_build_object(
      'type', target_type,
      'audience', target_audience,
      'priority', target_priority,
      'is_active', target_is_active
    )
  );

  return saved_id;
end;
$$;

revoke all on function public.admin_save_platform_announcement(
  uuid, text, text, text, timestamptz, timestamptz, smallint, text, boolean
) from public;
grant execute on function public.admin_save_platform_announcement(
  uuid, text, text, text, timestamptz, timestamptz, smallint, text, boolean
) to authenticated, service_role;

create or replace function public.admin_remove_platform_announcement(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Administrator access required.';
  end if;

  update public.platform_announcements
  set is_active = false, updated_by = auth.uid()
  where id = target_id;

  if not found then
    raise exception 'Announcement not found.';
  end if;

  insert into public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  )
  values (
    auth.uid(),
    'announcement_deactivated',
    'platform_announcements',
    target_id,
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.admin_remove_platform_announcement(uuid) from public;
grant execute on function public.admin_remove_platform_announcement(uuid) to authenticated, service_role;

create or replace function public.get_public_discovery_feed(feed_limit integer default 8)
returns table (
  feed_kind text,
  feed_position integer,
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
  feedback_focus text[],
  country text,
  submitted_at timestamptz,
  reviews_received bigint,
  average_rating numeric,
  hook_score numeric,
  total_listening_seconds bigint,
  completion_rate numeric,
  comments_count bigint,
  likes_count bigint,
  followers_count bigint
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with eligible as (
    select
      song.id as song_id,
      song.user_id as artist_id,
      song.title,
      song.artist_name,
      song.cover_image_url,
      song.music_url,
      song.platform,
      song.genre,
      song.song_language,
      coalesce(song.feedback_focus, array['General Feedback']::text[]) as feedback_focus,
      song.country,
      song.created_at as submitted_at,
      coalesce(review_metrics.reviews_received, 0)::bigint as reviews_received,
      coalesce(review_metrics.average_rating, 0)::numeric as average_rating,
      coalesce(review_metrics.hook_score, 0)::numeric as hook_score,
      coalesce(listen_metrics.total_listening_seconds, 0)::bigint as total_listening_seconds,
      coalesce(listen_metrics.completion_rate, 0)::numeric as completion_rate,
      coalesce(comment_metrics.comments_count, 0)::bigint as comments_count,
      coalesce(like_metrics.likes_count, 0)::bigint as likes_count,
      coalesce(follower_metrics.followers_count, 0)::bigint as followers_count
    from public.songs song
    join public.profiles creator on creator.id = song.user_id
    left join lateral (
      select
        count(*)::bigint as reviews_received,
        round(avg(review.rating)::numeric, 1) as average_rating,
        round(
          (
            avg(case when review.listen_full then 100 else 0 end)
            + avg(case when review.add_to_playlist then 100 else 0 end)
            + avg(case when review.grabbed_attention then 100 else 0 end)
            + avg(case when review.share_with_friend then 100 else 0 end)
          ) / 4.0,
          0
        ) as hook_score
      from public.reviews review
      where review.song_id = song.id
    ) review_metrics on true
    left join lateral (
      select
        sum(listens.seconds)::bigint as total_listening_seconds,
        round(
          100.0 * count(*) filter (where listens.completion_rate >= 90)
          / nullif(count(*), 0),
          1
        ) as completion_rate
      from (
        select
          greatest(coalesce(session.settled_seconds, session.verified_seconds, 0), 0)::bigint as seconds,
          case
            when coalesce(session.provider_duration_seconds, 0) > 0 then
              least(
                100,
                100.0 * coalesce(session.max_position_seconds, 0)
                  / session.provider_duration_seconds
              )
            else 0
          end::numeric as completion_rate
        from public.listening_sessions session
        where session.song_id = song.id
          and session.valid_listen_at is not null
        union all
        select
          greatest(coalesce(guest_session.verified_seconds, 0), 0)::bigint as seconds,
          case
            when coalesce(guest_session.provider_duration_seconds, 0) > 0 then
              least(
                100,
                100.0 * coalesce(guest_session.max_position_seconds, 0)
                  / guest_session.provider_duration_seconds
              )
            else 0
          end::numeric as completion_rate
        from public.guest_listening_sessions guest_session
        where guest_session.song_id = song.id
          and guest_session.valid_listen_at is not null
      ) listens
    ) listen_metrics on true
    left join lateral (
      select count(*)::bigint as comments_count
      from public.song_comments comment
      where comment.song_id = song.id
    ) comment_metrics on true
    left join lateral (
      select count(*)::bigint as likes_count
      from public.song_likes song_like
      where song_like.song_id = song.id
    ) like_metrics on true
    left join lateral (
      select count(*)::bigint as followers_count
      from public.artist_follows artist_follow
      where artist_follow.artist_id = song.user_id
    ) follower_metrics on true
    where song.is_active = true
      and song.removed_at is null
      and song.archived_at is null
      and song.merged_into_song_id is null
      and coalesce(song.explicit_content, false) = false
      and creator.account_status = 'active'
      and creator.banned_at is null
  ),
  spotlight as (
    select
      'spotlight'::text as feed_kind,
      slot.slot_number::integer as feed_position,
      coalesce(
        nullif(trim(slot.custom_label), ''),
        initcap(replace(slot.placement_kind::text, '_', ' '))
      ) as badge,
      item.*
    from public.spotlight_slots slot
    join eligible item on item.song_id = slot.song_id
    where (slot.active_from is null or slot.active_from <= now())
      and (slot.active_until is null or slot.active_until > now())
    order by slot.slot_number
    limit greatest(1, least(coalesce(feed_limit, 8), 20))
  ),
  top_ranked as (
    select
      'top'::text as feed_kind,
      row_number() over (
        order by
          (
            item.hook_score * 0.45
            + item.average_rating * 5.0 * 0.20
            + item.completion_rate * 0.20
            + least(item.total_listening_seconds / 60.0, 100) * 0.10
            + least(item.likes_count, 50) * 0.10
          ) desc,
          item.reviews_received desc,
          item.submitted_at desc
      )::integer as feed_position,
      'Community Top 10'::text as badge,
      item.*
    from eligible item
    order by
      (
        item.hook_score * 0.45
        + item.average_rating * 5.0 * 0.20
        + item.completion_rate * 0.20
        + least(item.total_listening_seconds / 60.0, 100) * 0.10
        + least(item.likes_count, 50) * 0.10
      ) desc,
      item.reviews_received desc,
      item.submitted_at desc
    limit least(greatest(coalesce(feed_limit, 8), 1), 10)
  ),
  recent as (
    select
      'recent'::text as feed_kind,
      row_number() over (order by item.submitted_at desc)::integer as feed_position,
      'Recently Active'::text as badge,
      item.*
    from eligible item
    order by item.submitted_at desc
    limit greatest(1, least(coalesce(feed_limit, 8), 20))
  )
  select * from spotlight
  union all
  select * from top_ranked
  union all
  select * from recent;
$$;

revoke all on function public.get_public_discovery_feed(integer) from public;
grant execute on function public.get_public_discovery_feed(integer) to anon, authenticated, service_role;

create or replace function public.get_public_community_activity(activity_limit integer default 12)
returns table (
  event_id uuid,
  event_type text,
  actor_name text,
  artist_id uuid,
  artist_name text,
  song_id uuid,
  song_title text,
  event_value numeric,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    event.id as event_id,
    event.event_type,
    case
      when event.guest_session_id is not null then
        coalesce(event.actor_display_name, guest.nickname, 'Guest Listener')
      when event.event_type = 'follow'
        or (
          event.visibility = 'public'
          and coalesce(supporter.community_visibility, 'anonymous') = 'public'
        )
        then coalesce(supporter.display_name, 'First Listen member')
      else 'Anonymous Listener'
    end as actor_name,
    event.artist_id,
    coalesce(artist.display_name, song.artist_name, 'First Listen artist') as artist_name,
    event.song_id,
    song.title as song_title,
    null::numeric as event_value,
    event.created_at
  from public.community_support_events event
  left join public.profiles supporter on supporter.id = event.supporter_id
  left join public.guest_sessions guest on guest.id = event.guest_session_id
  join public.profiles artist on artist.id = event.artist_id
  left join public.songs song on song.id = event.song_id
  where event.visibility = 'public'
    and artist.account_status = 'active'
    and artist.banned_at is null
    and (
      event.guest_session_id is not null
      or (
        coalesce(supporter.community_visibility, 'public') = 'public'
        and supporter.account_status = 'active'
        and supporter.banned_at is null
      )
    )
    and (
      song.id is null
      or (
        song.is_active = true
        and song.removed_at is null
        and song.archived_at is null
        and song.merged_into_song_id is null
        and coalesce(song.explicit_content, false) = false
      )
    )
  order by event.created_at desc
  limit greatest(1, least(coalesce(activity_limit, 12), 50));
$$;

revoke all on function public.get_public_community_activity(integer) from public;
grant execute on function public.get_public_community_activity(integer) to anon, authenticated, service_role;

create or replace function public.admin_get_community_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  local_day_start timestamptz := date_trunc('day', now() at time zone 'America/Chicago') at time zone 'America/Chicago';
  result jsonb;
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Administrator access required.';
  end if;

  with
  active_guests as (
    select guest.id
    from public.guest_sessions guest
    where guest.last_seen_at >= now() - interval '15 minutes'
    union
    select session.guest_session_id
    from public.guest_listening_sessions session
    where session.last_heartbeat_at >= now() - interval '15 minutes'
  ),
  active_members as (
    select session.user_id
    from public.listening_sessions session
    where session.last_heartbeat_at >= now() - interval '15 minutes'
    union
    select event.supporter_id
    from public.community_support_events event
    where event.supporter_id is not null
      and event.created_at >= now() - interval '15 minutes'
    union
    select review.reviewer_id
    from public.reviews review
    where review.created_at >= now() - interval '15 minutes'
  ),
  valid_listens as (
    select count(*)::bigint as total
    from public.listening_sessions session
    where session.valid_listen_at >= local_day_start
    union all
    select count(*)::bigint
    from public.guest_listening_sessions session
    where session.valid_listen_at >= local_day_start
  ),
  listening_seconds as (
    select coalesce(sum(greatest(coalesce(session.settled_seconds, session.verified_seconds, 0), 0)), 0)::bigint as total
    from public.listening_sessions session
    where session.created_at >= local_day_start
    union all
    select coalesce(sum(greatest(coalesce(session.verified_seconds, 0), 0)), 0)::bigint
    from public.guest_listening_sessions session
    where session.created_at >= local_day_start
  ),
  guest_conversion as (
    select
      count(*)::bigint as total_guests,
      count(*) filter (where converted_to_user_id is not null)::bigint as converted_guests
    from public.guest_sessions
  )
  select jsonb_build_object(
    'generated_at', now(),
    'active_guests', (select count(*) from active_guests),
    'active_members', (select count(*) from active_members),
    'valid_listens_today', (select coalesce(sum(total), 0) from valid_listens),
    'listening_hours_today', round((select coalesce(sum(total), 0) from listening_seconds) / 3600.0, 2),
    'comments_today', (select count(*) from public.song_comments where created_at >= local_day_start),
    'likes_today', (select count(*) from public.song_likes where created_at >= local_day_start),
    'followers_today', (
      (select count(*) from public.artist_follows where created_at >= local_day_start)
      + (select count(*) from public.guest_artist_follows where created_at >= local_day_start)
    ),
    'shares_today', (select count(*) from public.song_shares where created_at >= local_day_start),
    'songs_submitted_today', (select count(*) from public.songs where created_at >= local_day_start),
    'songs_archived_today', (select count(*) from public.songs where archived_at >= local_day_start),
    'new_guest_profiles_today', (select count(*) from public.guest_sessions where created_at >= local_day_start),
    'new_accounts_today', (select count(*) from public.profiles where created_at >= local_day_start),
    'total_guest_profiles', (select total_guests from guest_conversion),
    'converted_guest_profiles', (select converted_guests from guest_conversion),
    'guest_to_member_conversion_rate',
      coalesce(
        round(
          100.0 * (select converted_guests from guest_conversion)
          / nullif((select total_guests from guest_conversion), 0),
          1
        ),
        0
      )
  )
  into result;

  return result;
end;
$$;

revoke all on function public.admin_get_community_health() from public;
grant execute on function public.admin_get_community_health() to authenticated, service_role;

create or replace function public.unified_landing_health_report()
returns jsonb
language sql
stable
security definer
set search_path = public, auth, pg_catalog
as $$
  select jsonb_build_object(
    'checked_at', now(),
    'theme_row_present', exists (
      select 1 from public.platform_theme_settings where id = true
    ),
    'announcement_table_present', to_regclass('public.platform_announcements') is not null,
    'theme_rls_enabled', coalesce((
      select relrowsecurity
      from pg_class
      where oid = 'public.platform_theme_settings'::regclass
    ), false),
    'announcements_rls_enabled', coalesce((
      select relrowsecurity
      from pg_class
      where oid = 'public.platform_announcements'::regclass
    ), false),
    'public_discovery_function_present',
      to_regprocedure('public.get_public_discovery_feed(integer)') is not null,
    'public_activity_function_present',
      to_regprocedure('public.get_public_community_activity(integer)') is not null,
    'admin_health_function_present',
      to_regprocedure('public.admin_get_community_health()') is not null
  );
$$;

revoke all on function public.unified_landing_health_report() from public;
grant execute on function public.unified_landing_health_report() to service_role;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'platform_theme_settings'
  ) then
    alter publication supabase_realtime add table public.platform_theme_settings;
  end if;
exception
  when insufficient_privilege then null;
end;
$$;
