-- Harden moderator permissions before public growth.
--
-- Moderators are limited to report-scoped content moderation. User
-- administration, platform configuration, broad user directories, and general
-- song-state management are reserved for Admin and Super Admin roles.

create or replace function public.admin_list_users(result_limit integer default 1000)
returns table (
  id uuid,
  display_name text,
  email text,
  username text,
  role public.app_role,
  account_status public.account_status,
  creator_activity_status public.creator_activity_status,
  founder_number integer,
  banned_at timestamptz,
  warning_count integer,
  credits integer,
  completed_reviews integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Administrator access required';
  end if;

  return query
  select
    profiles.id,
    profiles.display_name,
    coalesce(auth_users.email, '')::text,
    coalesce(
      nullif(auth_users.raw_user_meta_data ->> 'username', ''),
      split_part(coalesce(auth_users.email, ''), '@', 1)
    )::text,
    profiles.role,
    profiles.account_status,
    profiles.creator_activity_status,
    profiles.founder_number,
    profiles.banned_at,
    profiles.warning_count,
    profiles.credits,
    profiles.completed_reviews,
    profiles.created_at
  from public.profiles
  join auth.users as auth_users on auth_users.id = profiles.id
  order by profiles.created_at desc
  limit greatest(1, least(result_limit, 1000));
end;
$$;

create or replace function public.admin_issue_user_warning(
  target_user_id uuid,
  warning_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  warning_id uuid;
  actor_role public.app_role := public.current_user_role();
  target_role public.app_role;
begin
  if actor_role not in ('super_admin', 'admin') then
    raise exception 'Administrator access required';
  end if;
  if char_length(trim(warning_reason)) < 3 then
    raise exception 'Warning reason is required';
  end if;

  select role into target_role
  from public.profiles
  where id = target_user_id;
  if not found then raise exception 'User not found'; end if;
  if actor_role <> 'super_admin' and target_role <> 'user' then
    raise exception 'Only Super Admin can warn staff accounts';
  end if;

  insert into public.account_warnings (user_id, issued_by, reason)
  values (target_user_id, auth.uid(), trim(warning_reason))
  returning id into warning_id;

  update public.profiles
  set warning_count = warning_count + 1, updated_at = now()
  where id = target_user_id;

  insert into public.admin_audit_log (
    actor_id, action, target_type, target_id, details
  )
  values (
    auth.uid(),
    'issue_warning',
    'profile',
    target_user_id,
    jsonb_build_object('reason', trim(warning_reason))
  );

  return warning_id;
end;
$$;

create or replace function public.admin_enforce_account(
  target_user_id uuid,
  enforcement text,
  enforcement_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_role public.app_role := public.current_user_role();
  target_role public.app_role;
begin
  if actor_role not in ('super_admin', 'admin') then
    raise exception 'Administrator access required';
  end if;
  if enforcement not in ('activate', 'suspend', 'ban') then
    raise exception 'Invalid enforcement action';
  end if;
  if enforcement <> 'activate' and char_length(trim(enforcement_reason)) < 3 then
    raise exception 'Enforcement reason is required';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'You cannot enforce your own account';
  end if;

  select role into target_role
  from public.profiles
  where id = target_user_id;
  if not found then raise exception 'User not found'; end if;
  if actor_role <> 'super_admin' and target_role <> 'user' then
    raise exception 'Only Super Admin can enforce staff accounts';
  end if;

  update public.profiles
  set
    account_status = case
      when enforcement = 'activate'
        then 'active'::public.account_status
      else 'suspended'::public.account_status
    end,
    banned_at = case when enforcement = 'ban' then now() else null end,
    banned_by = case when enforcement = 'ban' then auth.uid() else null end,
    ban_reason = case
      when enforcement = 'ban' then trim(enforcement_reason)
      else null
    end,
    updated_at = now()
  where id = target_user_id;

  insert into public.admin_audit_log (
    actor_id, action, target_type, target_id, details
  )
  values (
    auth.uid(),
    'enforce_account',
    'profile',
    target_user_id,
    jsonb_build_object(
      'enforcement', enforcement,
      'reason', trim(coalesce(enforcement_reason, ''))
    )
  );
end;
$$;

create or replace function public.admin_set_song_state(
  target_song_id uuid,
  active boolean,
  feature boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_song public.songs%rowtype;
begin
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Administrator access required';
  end if;

  select * into target_song
  from public.songs
  where id = target_song_id
  for update;
  if not found then raise exception 'Song not found'; end if;
  if target_song.merged_into_song_id is not null then
    raise exception 'Merged songs cannot be restored';
  end if;

  update public.songs
  set
    is_active = active,
    featured = feature and active,
    removed_at = case when active then null else now() end,
    removed_by = case when active then null else auth.uid() end,
    archived_at = case when active then null else archived_at end,
    archived_by = case when active then null else archived_by end,
    updated_at = now()
  where id = target_song_id;

  insert into public.admin_audit_log (
    actor_id, action, target_type, target_id, details
  )
  values (
    auth.uid(),
    case when active then 'restore_song' else 'remove_song' end,
    'song',
    target_song_id,
    jsonb_build_object('feature', feature and active)
  );
end;
$$;

create or replace function public.moderator_hide_reported_song(
  target_report_id uuid,
  moderation_reason text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_role public.app_role := public.current_user_role();
  report_row public.song_reports%rowtype;
  target_song public.songs%rowtype;
  reason text := left(
    coalesce(nullif(trim(moderation_reason), ''), 'Moderator hid reported content'),
    500
  );
begin
  if actor_role not in ('super_admin', 'admin', 'moderator') then
    raise exception 'Staff access required';
  end if;

  select *
  into report_row
  from public.song_reports
  where id = target_report_id
  for update;
  if not found then raise exception 'Report not found'; end if;
  if report_row.status not in ('open', 'reviewing') then
    raise exception 'Only open or escalated reports can hide content';
  end if;

  select *
  into target_song
  from public.songs
  where id = report_row.song_id
  for update;
  if not found then raise exception 'Reported song not found'; end if;

  update public.songs
  set
    is_active = false,
    featured = false,
    removed_at = coalesce(removed_at, now()),
    removed_by = coalesce(removed_by, auth.uid()),
    updated_at = now()
  where id = target_song.id;

  update public.song_reports
  set status = 'reviewing', reviewed_by = auth.uid(), reviewed_at = now()
  where id = target_report_id;

  insert into public.admin_audit_log (
    actor_id, action, target_type, target_id, details
  )
  values (
    auth.uid(),
    'hide_reported_song',
    'song',
    target_song.id,
    jsonb_build_object(
      'report_id', target_report_id,
      'reason', reason,
      'actor_role', actor_role
    )
  );
end;
$$;

create or replace function public.admin_moderate_review_comment(
  target_review_id uuid,
  moderation_action text,
  moderation_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_role public.app_role := public.current_user_role();
begin
  if actor_role not in ('super_admin', 'admin', 'moderator') then
    raise exception 'Staff access required';
  end if;
  if moderation_action not in ('remove', 'restore') then
    raise exception 'Invalid moderation action';
  end if;
  if char_length(trim(moderation_reason)) < 3 then
    raise exception 'Moderation reason is required';
  end if;
  if actor_role = 'moderator' then
    if moderation_action <> 'remove' then
      raise exception 'Moderators cannot restore comments';
    end if;
    if not exists (
      select 1
      from public.review_comment_reports
      where review_id = target_review_id
        and status in ('open', 'reviewing')
    ) then
      raise exception 'Moderators can only remove reported comments';
    end if;
  end if;

  update public.reviews
  set
    comment_removed_at = case
      when moderation_action = 'remove' then now()
      else null
    end,
    comment_removed_by = case
      when moderation_action = 'remove' then auth.uid()
      else null
    end,
    comment_removal_reason = case
      when moderation_action = 'remove' then trim(moderation_reason)
      else null
    end
  where id = target_review_id;
  if not found then raise exception 'Review not found'; end if;

  insert into public.admin_audit_log (
    actor_id, action, target_type, target_id, details
  )
  values (
    auth.uid(),
    'moderate_comment',
    'review',
    target_review_id,
    jsonb_build_object(
      'moderation_action', moderation_action,
      'reason', trim(moderation_reason),
      'actor_role', actor_role
    )
  );
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
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Administrator access required';
  end if;

  return query
  select
    feedback.id,
    feedback.user_id,
    coalesce(profile.display_name::text, 'Guest Listener'::text) as submitter_name,
    coalesce(auth_user.email::text, feedback.contact_email::text) as submitter_email,
    feedback.category::text,
    feedback.status::text,
    feedback.subject::text,
    feedback.message::text,
    feedback.screenshot_url::text,
    feedback.page_url::text,
    feedback.contact_email::text,
    feedback.notify_by_email,
    feedback.founder_reply::text,
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
  if public.current_user_role() not in ('super_admin', 'admin') then
    raise exception 'Administrator access required';
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

revoke all on function public.admin_list_users(integer) from public, anon, authenticated;
revoke all on function public.admin_issue_user_warning(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_enforce_account(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_set_song_state(uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public.moderator_hide_reported_song(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_moderate_review_comment(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_list_feedback(text, integer) from public, anon, authenticated;
revoke all on function public.admin_update_feedback(uuid, text, text) from public, anon, authenticated;

grant execute on function public.admin_list_users(integer) to authenticated;
grant execute on function public.admin_issue_user_warning(uuid, text) to authenticated;
grant execute on function public.admin_enforce_account(uuid, text, text) to authenticated;
grant execute on function public.admin_set_song_state(uuid, boolean, boolean) to authenticated;
grant execute on function public.moderator_hide_reported_song(uuid, text) to authenticated;
grant execute on function public.admin_moderate_review_comment(uuid, text, text) to authenticated;
grant execute on function public.admin_list_feedback(text, integer) to authenticated;
grant execute on function public.admin_update_feedback(uuid, text, text) to authenticated;
