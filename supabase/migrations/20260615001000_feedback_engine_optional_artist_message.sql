-- Feedback Engine reframing: keep review infrastructure, but make the
-- listener-facing artist message optional so support signals can move the
-- queue forward without forcing a written review.

alter table public.reviews
  alter column comment set default '';

alter table public.reviews
  drop constraint if exists reviews_comment_check;

alter table public.reviews
  drop constraint if exists reviews_comment_optional_or_useful_check;

alter table public.reviews
  add constraint reviews_comment_optional_or_useful_check
  check (
    comment = ''
    or char_length(comment) between 30 and 1000
  );

comment on column public.reviews.comment is
  'Optional artist message. Empty string means the listener sent structured support signals without a written message.';

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
  listening_bank_seconds bigint,
  community_points_awarded integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  raw_comment text := trim(coalesce(review_comment, ''));
  stored_comment text := '';
  normalized_comment text := '';
  repeated_comment boolean := false;
  computed_score integer := 100;
  new_quality_score numeric;
  new_review_id uuid;
  session_row public.listening_sessions%rowtype;
  current_bank bigint;
  message_warning text := '';
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  if review_rating not between 1 and 10 then
    raise exception 'Rating must be between 1 and 10';
  end if;

  if not exists (
    select 1
    from public.songs
    where id = reviewed_song_id
      and user_id <> auth.uid()
      and removed_at is null
  ) then
    raise exception 'Song is unavailable for feedback';
  end if;

  if raw_comment <> '' and char_length(raw_comment) >= 30 then
    stored_comment := raw_comment;
    normalized_comment := public.normalize_feedback(stored_comment);

    select exists (
      select 1
      from public.reviews
      where reviewer_id = auth.uid()
        and nullif(trim(comment), '') is not null
        and public.normalize_feedback(comment) = normalized_comment
    ) into repeated_comment;

    if repeated_comment then
      stored_comment := '';
      normalized_comment := '';
      message_warning := 'Optional artist message was not saved because it repeated earlier feedback.';
    else
      if coalesce(review_pasted_comment_detected, false) then
        computed_score := computed_score - 50;
      end if;
      if coalesce(array_length(regexp_split_to_array(normalized_comment, '\s+'), 1), 0) < 7 then
        computed_score := computed_score - 25;
      end if;
      computed_score := greatest(0, least(100, computed_score));

      if computed_score < 60 then
        stored_comment := '';
        normalized_comment := '';
        computed_score := 100;
        message_warning := 'Optional artist message was not saved because it looked copied or low quality.';
      end if;
    end if;
  elsif raw_comment <> '' then
    message_warning := 'Optional artist message was not saved because it was too short.';
  end if;

  if listening_session_id is not null then
    select *
    into session_row
    from public.listening_sessions
    where id = listening_session_id
      and user_id = auth.uid()
      and song_id = reviewed_song_id
      and status in ('active', 'qualified')
    for update;
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
    stored_comment,
    stored_comment <> '' and coalesce(review_pasted_comment_detected, false),
    computed_score,
    true,
    session_row.id,
    coalesce(session_row.settled_seconds, 0),
    case
      when session_row.provider_duration_seconds is null then null
      else round(session_row.provider_duration_seconds)::integer
    end,
    case
      when coalesce(session_row.provider_duration_seconds, 0) > 0
      then least(
        100,
        round(
          (session_row.max_position_seconds / session_row.provider_duration_seconds) * 100,
          2
        )
      )
      else null
    end
  )
  returning id into new_review_id;

  update public.profiles as target_profile
  set completed_reviews = completed_reviews + 1, updated_at = now()
  where id = auth.uid()
  returning target_profile.listening_bank_seconds into current_bank;

  if session_row.id is not null then
    update public.listening_sessions
    set review_id = new_review_id, updated_at = now()
    where id = session_row.id;
  end if;

  perform public.award_community_points(
    auth.uid(),
    5,
    'Send song support feedback',
    'review',
    new_review_id,
    null
  );

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
    message_warning,
    0,
    current_bank,
    5;
end;
$$;

revoke all on function public.submit_review_with_listening(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean, uuid
) from public, anon, authenticated;

grant execute on function public.submit_review_with_listening(
  uuid, boolean, boolean, boolean, boolean, smallint, text, boolean, uuid
) to authenticated;
