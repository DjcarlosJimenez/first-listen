-- Qualify profile columns that conflict with RETURNS TABLE output variables.
create or replace function public.submit_review_with_listening(
  reviewed_song_id uuid,
  review_listen_full boolean,
  review_add_to_playlist boolean,
  review_grabbed_attention boolean,
  review_share_with_friend boolean,
  review_rating smallint,
  review_comment text,
  review_pasted_comment_detected boolean default false,
  listening_session_id uuid default null
)
returns table (
  accepted boolean,
  quality_score smallint,
  credit_granted boolean,
  warning text,
  listening_seconds_banked integer,
  listening_bank_seconds bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_comment text := public.normalize_feedback(review_comment);
  repeated_comment boolean;
  computed_score integer := 100;
  new_quality_score numeric;
  new_review_id uuid;
  session_row public.listening_sessions%rowtype;
  settings public.listening_reward_settings%rowtype;
  today_settled integer := 0;
  seconds_to_settle integer := 0;
  completion numeric(5,2);
  new_bank bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(trim(coalesce(review_comment, ''))) not between 30 and 1000 then
    return query select false, 0::smallint, false,
      'Please provide useful feedback.'::text, 0, null::bigint;
    return;
  end if;
  if review_rating not between 1 and 10 then
    raise exception 'Rating must be between 1 and 10';
  end if;
  if not exists (
    select 1 from public.songs
    where id = reviewed_song_id
      and user_id <> auth.uid()
      and is_active
      and removed_at is null
  ) then
    raise exception 'Song is unavailable for review';
  end if;

  select exists (
    select 1 from public.reviews
    where reviewer_id = auth.uid()
      and public.normalize_feedback(comment) = normalized_comment
  ) into repeated_comment;

  if repeated_comment then computed_score := 20; end if;
  if review_pasted_comment_detected then computed_score := computed_score - 50; end if;
  if array_length(regexp_split_to_array(normalized_comment, '\s+'), 1) < 7 then
    computed_score := computed_score - 25;
  end if;
  computed_score := greatest(0, least(100, computed_score));

  if computed_score < 60 then
    return query select false, computed_score::smallint, false,
      'Please provide useful feedback.'::text, 0, null::bigint;
    return;
  end if;

  if listening_session_id is not null then
    select *
    into session_row
    from public.listening_sessions
    where id = listening_session_id
      and user_id = auth.uid()
      and song_id = reviewed_song_id
      and status = 'active'
    for update;
  end if;

  select *
  into settings
  from public.listening_reward_settings
  where id = true;

  if session_row.id is not null then
    select coalesce(sum(settled_seconds), 0)::integer
    into today_settled
    from public.listening_sessions
    where user_id = auth.uid()
      and status = 'qualified'
      and qualified_at >= date_trunc('day', now());

    seconds_to_settle := least(
      session_row.verified_seconds,
      greatest(0, settings.daily_cap_minutes * 60 - today_settled)
    );
    completion := case
      when coalesce(session_row.provider_duration_seconds, 0) > 0
      then least(
        100,
        round(
          (session_row.max_position_seconds / session_row.provider_duration_seconds) * 100,
          2
        )
      )
      else null
    end;
  end if;

  insert into public.reviews (
    song_id,
    reviewer_id,
    listen_full,
    add_to_playlist,
    grabbed_attention,
    share_with_friend,
    rating,
    comment,
    pasted_comment_detected,
    quality_score,
    quality_passed,
    listening_session_id,
    listening_seconds,
    listening_duration_seconds,
    listening_completion_percent
  )
  values (
    reviewed_song_id,
    auth.uid(),
    review_listen_full,
    review_add_to_playlist,
    review_grabbed_attention,
    review_share_with_friend,
    review_rating,
    trim(review_comment),
    review_pasted_comment_detected,
    computed_score,
    true,
    session_row.id,
    seconds_to_settle,
    case
      when session_row.provider_duration_seconds is null then null
      else round(session_row.provider_duration_seconds)::integer
    end,
    completion
  )
  returning id into new_review_id;

  update public.profiles
  set
    completed_reviews = profiles.completed_reviews + 1,
    listening_bank_seconds =
      profiles.listening_bank_seconds + seconds_to_settle,
    lifetime_listening_seconds =
      profiles.lifetime_listening_seconds + seconds_to_settle,
    updated_at = now()
  where id = auth.uid()
  returning profiles.listening_bank_seconds into new_bank;

  if session_row.id is not null then
    update public.listening_sessions
    set
      status = 'qualified',
      settled_seconds = seconds_to_settle,
      qualified_at = now(),
      review_id = new_review_id,
      updated_at = now()
    where id = session_row.id;
  end if;

  select round(avg(reviews.quality_score)::numeric, 2)
  into new_quality_score
  from public.reviews as reviews
  where reviews.reviewer_id = auth.uid();

  update public.profiles
  set review_quality_score = coalesce(new_quality_score, 100)
  where id = auth.uid();

  return query select
    true,
    computed_score::smallint,
    false,
    case
      when session_row.id is null then
        'Review accepted. No verified listening session was available.'
      when seconds_to_settle = 0 and today_settled >= settings.daily_cap_minutes * 60 then
        'Review accepted. You have reached today''s listening limit.'
      else ''
    end,
    seconds_to_settle,
    new_bank;
end;
$$;

revoke all on function public.submit_review_with_listening(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.submit_review_with_listening(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean, uuid
) to authenticated;
