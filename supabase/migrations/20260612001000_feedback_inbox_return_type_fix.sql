-- Priority 39D hotfix: make Founder Feedback Inbox RPC return declared text types.
--
-- Production symptom:
-- admin_list_feedback crashed with:
-- "Returned type character varying does not match expected type text in column 4"
-- because auth.users.email is varchar while the RPC declares submitter_email text.

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

revoke all on function public.admin_list_feedback(text, integer) from public, anon, authenticated;
grant execute on function public.admin_list_feedback(text, integer) to authenticated;
