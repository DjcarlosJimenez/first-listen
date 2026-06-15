import { readFile } from "node:fs/promises";

async function loadLocalEnvironment() {
  const contents = await readFile(".env.local", "utf8");
  for (const line of contents.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

await loadLocalEnvironment();

const projectRef = process.env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!projectRef || !accessToken) {
  throw new Error("SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required.");
}

const endpoint =
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

async function query(sql) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) {
    throw new Error(
      `Supabase database query failed (${response.status}): ${await response.text()}`,
    );
  }
  return response.json();
}

const verificationSql = `
  begin;

  create temp table feedback_engine_results (
    check_name text not null,
    passed boolean not null,
    detail jsonb not null default '{}'::jsonb
  ) on commit drop;

  create or replace function pg_temp.record_feedback_engine_result(
    check_name text,
    passed boolean,
    detail jsonb default '{}'::jsonb
  )
  returns void
  language plpgsql
  as $$
  begin
    insert into feedback_engine_results (check_name, passed, detail)
    values (check_name, passed, coalesce(detail, '{}'::jsonb));
  end;
  $$;

  do $$
  #variable_conflict use_variable
  declare
    reviewer_id uuid;
    artist_id uuid;
    template_song public.songs%rowtype;
    test_song_ids uuid[] := array[]::uuid[];
    target_song_id uuid;
    target_session_id uuid;
    result_row record;
    metrics_before record;
    metrics_after record;
    top_rows_before integer;
    top_rows_after integer;
    spotlight_rows_after integer;
    artist_songs_after integer;
    points_before integer;
    points_after integer;
    point_transactions_after integer;
    mission_id uuid;
    mission_progress_before integer;
    mission_progress_after integer;
    mission_completions_after integer;
    original_slot_song uuid;
    review_comment text;
    repeated_message text :=
      'This groove keeps its identity clear while the chorus gives listeners a reason to come back again.';
    i integer;
  begin
    if to_regprocedure(
      'public.submit_review_with_listening(uuid,boolean,boolean,boolean,boolean,smallint,text,boolean,uuid)'
    ) is null then
      raise exception 'submit_review_with_listening RPC is missing.';
    end if;

    select song.*
    into template_song
    from public.songs song
    join public.profiles artist
      on artist.id = song.user_id
    where song.is_active
      and song.removed_at is null
      and coalesce(song.archived_at is null, true)
      and coalesce(song.approval_status in ('auto_approved', 'approved'), true)
      and artist.account_status = 'active'
    order by song.created_at desc
    limit 1;

    if template_song.id is null then
      raise exception 'No active production song exists for transactional verification.';
    end if;

    artist_id := template_song.user_id;

    select profile.id
    into reviewer_id
    from public.profiles profile
    where profile.id <> artist_id
      and profile.account_status = 'active'
      and coalesce(profile.banned_at is null, true)
    order by
      case profile.role
        when 'super_admin' then 1
        when 'admin' then 2
        when 'user' then 3
        else 4
      end,
      profile.created_at
    limit 1;

    if reviewer_id is null then
      raise exception 'No active reviewer profile exists for transactional verification.';
    end if;

    perform set_config('request.jwt.claim.sub', reviewer_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);

    for i in 1..6 loop
      insert into public.songs
      select (jsonb_populate_record(
        null::public.songs,
        to_jsonb(template_song) ||
        jsonb_build_object(
          'id', uuid_generate_v4(),
          'title', 'Feedback Engine Verification ' || i,
          'music_url', template_song.music_url || '#feedback-engine-' || i || '-' ||
            replace(clock_timestamp()::text, ' ', '-'),
          'is_active', true,
          'featured', false,
          'removed_at', null,
          'archived_at', null,
          'merged_into_song_id', null,
          'approval_status', 'auto_approved',
          'created_at', now(),
          'updated_at', now()
        )
      )).*
      returning id into target_song_id;
      test_song_ids := test_song_ids || target_song_id;
    end loop;

    -- 1. Feedback without a comment.
    target_song_id := test_song_ids[1];
    select * into metrics_before
    from public.external_discovery_metrics(target_song_id);
    select community_points into points_before
    from public.profiles
    where id = reviewer_id;

    select * into result_row
    from public.submit_review_with_listening(
      target_song_id, true, true, true, true, 9::smallint, ''::text, false, null::uuid
    );

    select comment into review_comment
    from public.reviews review
    where review.song_id = target_song_id
      and review.reviewer_id = reviewer_id;

    select * into metrics_after
    from public.external_discovery_metrics(target_song_id);
    select community_points into points_after
    from public.profiles
    where id = reviewer_id;

    perform pg_temp.record_feedback_engine_result(
      'empty_comment_accepted',
      result_row.accepted
        and review_comment = ''
        and coalesce(metrics_after.reviews_received, 0)
          = coalesce(metrics_before.reviews_received, 0) + 1
        and coalesce(metrics_after.average_rating, 0) = 9
        and coalesce(metrics_after.hook_score, 0) = 100
        and points_after = points_before + 5
        and result_row.community_points_awarded = 5,
      jsonb_build_object(
        'warning', result_row.warning,
        'stored_comment_length', char_length(review_comment),
        'reviews_before', metrics_before.reviews_received,
        'reviews_after', metrics_after.reviews_received,
        'hook_score_after', metrics_after.hook_score,
        'points_delta', points_after - points_before
      )
    );

    -- 2. Feedback with a full optional artist message and a listening session.
    target_song_id := test_song_ids[2];
    insert into public.listening_sessions (
      user_id,
      song_id,
      platform,
      status,
      telemetry_supported,
      provider_duration_seconds,
      last_position_seconds,
      max_position_seconds,
      verified_seconds,
      settled_seconds
    )
    values (
      reviewer_id,
      target_song_id,
      template_song.platform,
      'qualified',
      true,
      180,
      180,
      180,
      180,
      180
    )
    returning id into target_session_id;

    select * into result_row
    from public.submit_review_with_listening(
      target_song_id,
      true,
      true,
      true,
      true,
      10::smallint,
      'The opening feels strong and the chorus gives the song a clear reason for listeners to return.',
      false,
      target_session_id
    );

    select * into metrics_after
    from public.external_discovery_metrics(target_song_id);

    perform pg_temp.record_feedback_engine_result(
      'optional_comment_accepted',
      result_row.accepted
        and exists (
          select 1
          from public.reviews review
          where review.song_id = target_song_id
            and review.reviewer_id = reviewer_id
            and char_length(comment) >= 30
            and listening_seconds = 180
            and listening_completion_percent = 100
        )
        and coalesce(metrics_after.reviews_received, 0) = 1
        and coalesce(metrics_after.average_rating, 0) = 10
        and coalesce(metrics_after.hook_score, 0) = 100,
      jsonb_build_object(
        'warning', result_row.warning,
        'reviews_after', metrics_after.reviews_received,
        'average_rating_after', metrics_after.average_rating,
        'hook_score_after', metrics_after.hook_score,
        'review_listening_seconds',
          (
            select review.listening_seconds
            from public.reviews review
            where review.song_id = target_song_id
              and review.reviewer_id = reviewer_id
          ),
        'review_completion_percent',
          (
            select review.listening_completion_percent
            from public.reviews review
            where review.song_id = target_song_id
              and review.reviewer_id = reviewer_id
          )
      )
    );

    -- 3. Short optional message is accepted as structured support, but not saved.
    target_song_id := test_song_ids[3];
    select * into result_row
    from public.submit_review_with_listening(
      target_song_id, false, true, true, false, 7::smallint, 'Nice'::text, false, null::uuid
    );

    select comment into review_comment
    from public.reviews review
    where review.song_id = target_song_id
      and review.reviewer_id = reviewer_id;

    select * into metrics_after
    from public.external_discovery_metrics(target_song_id);

    perform pg_temp.record_feedback_engine_result(
      'short_comment_accepted_without_saving_message',
      result_row.accepted
        and review_comment = ''
        and result_row.warning like '%too short%'
        and coalesce(metrics_after.reviews_received, 0) = 1
        and coalesce(metrics_after.average_rating, 0) = 7
        and coalesce(metrics_after.hook_score, 0) = 50,
      jsonb_build_object(
        'warning', result_row.warning,
        'stored_comment_length', char_length(review_comment),
        'hook_score_after', metrics_after.hook_score
      )
    );

    -- 4. Repeated optional message is accepted as structured support, but not duplicated.
    target_song_id := test_song_ids[4];
    select * into result_row
    from public.submit_review_with_listening(
      target_song_id, true, false, true, false, 8::smallint, repeated_message, false, null::uuid
    );

    target_song_id := test_song_ids[5];
    select * into result_row
    from public.submit_review_with_listening(
      target_song_id, true, true, true, false, 8::smallint, repeated_message, false, null::uuid
    );

    select comment into review_comment
    from public.reviews review
    where review.song_id = target_song_id
      and review.reviewer_id = reviewer_id;

    select * into metrics_after
    from public.external_discovery_metrics(target_song_id);

    perform pg_temp.record_feedback_engine_result(
      'repeated_comment_accepted_without_duplicate_message',
      result_row.accepted
        and review_comment = ''
        and result_row.warning like '%repeated earlier feedback%'
        and coalesce(metrics_after.reviews_received, 0) = 1
        and coalesce(metrics_after.hook_score, 0) = 75,
      jsonb_build_object(
        'warning', result_row.warning,
        'stored_comment_length', char_length(review_comment),
        'hook_score_after', metrics_after.hook_score
      )
    );

    -- 5. Ranking, spotlight, artist analytics, and review-count surfaces still read review metrics.
    select count(*) into top_rows_before
    from public.get_top_ten_songs();

    select song_id into original_slot_song
    from public.spotlight_slots
    where slot_number = 1;

    update public.spotlight_slots
    set
      song_id = test_song_ids[2],
      active_from = null,
      active_until = null,
      updated_by = reviewer_id,
      updated_at = now()
    where slot_number = 1;

    select count(*) into spotlight_rows_after
    from public.get_spotlight_songs()
    where song_id = test_song_ids[2]
      and reviews_received >= 1
      and average_rating >= 10
      and hook_score = 100;

    select count(*) into artist_songs_after
    from public.get_public_artist_songs(artist_id)
    where song_id = test_song_ids[2]
      and reviews_received >= 1
      and average_rating >= 10
      and hook_score = 100;

    select count(*) into top_rows_after
    from public.get_top_ten_songs();

    perform pg_temp.record_feedback_engine_result(
      'analytics_top10_spotlight_artist_surfaces_update',
      top_rows_after >= top_rows_before
        and spotlight_rows_after = 1
        and artist_songs_after = 1,
      jsonb_build_object(
        'top10_rows_before', top_rows_before,
        'top10_rows_after', top_rows_after,
        'spotlight_test_song_rows', spotlight_rows_after,
        'artist_song_metric_rows', artist_songs_after,
        'original_spotlight_song_restored_by_rollback', original_slot_song is not null
      )
    );

    select count(*) into point_transactions_after
    from public.community_point_transactions transaction
    where transaction.user_id = reviewer_id
      and transaction.source_type = 'review'
      and transaction.source_id in (
        select review.id
        from public.reviews review
        where review.reviewer_id = reviewer_id
          and review.song_id = any(test_song_ids)
      )
      and transaction.points = 5;

    perform pg_temp.record_feedback_engine_result(
      'community_points_update',
      point_transactions_after >= 5,
      jsonb_build_object(
        'review_point_transactions', point_transactions_after
      )
    );

    -- 6. Daily mission progress remains driven by valid listening, not written comments.
    select id into mission_id
    from public.daily_missions
    where mission_key = 'review_spotlight_songs'
      and active
    limit 1;

    if mission_id is not null then
      target_song_id := test_song_ids[6];
      update public.spotlight_slots
      set
        song_id = target_song_id,
        active_from = null,
        active_until = null,
        updated_by = reviewer_id,
        updated_at = now()
      where slot_number = 1;

      select coalesce(progress_count, 0) into mission_progress_before
      from public.daily_mission_progress progress
      where progress.user_id = reviewer_id
        and progress.mission_id = mission_id
        and progress.mission_date = current_date;

      mission_progress_before := coalesce(mission_progress_before, 0);

      insert into public.listening_sessions (
        user_id,
        song_id,
        platform,
        status,
        telemetry_supported,
        provider_duration_seconds,
        last_position_seconds,
        max_position_seconds,
        verified_seconds,
        settled_seconds
      )
      values (
        reviewer_id,
        target_song_id,
        template_song.platform,
        'qualified',
        true,
        120,
        120,
        120,
        120,
        120
      )
      returning id into target_session_id;

      update public.listening_sessions
      set valid_listen_at = now(), updated_at = now()
      where id = target_session_id;

      select coalesce(progress_count, 0) into mission_progress_after
      from public.daily_mission_progress progress
      where progress.user_id = reviewer_id
        and progress.mission_id = mission_id
        and progress.mission_date = current_date;

      select count(*) into mission_completions_after
      from public.daily_mission_song_completions completion
      where completion.user_id = reviewer_id
        and completion.mission_id = mission_id
        and completion.mission_date = current_date
        and completion.song_id = target_song_id
        and completion.listening_session_id = target_session_id;

      perform pg_temp.record_feedback_engine_result(
        'mission_progress_updates_from_valid_listen',
        mission_completions_after = 1
          and coalesce(mission_progress_after, 0) >= mission_progress_before,
        jsonb_build_object(
          'mission_progress_before', mission_progress_before,
          'mission_progress_after', mission_progress_after,
          'mission_completion_rows_for_test_song', mission_completions_after
        )
      );
    else
      perform pg_temp.record_feedback_engine_result(
        'mission_progress_updates_from_valid_listen',
        false,
        jsonb_build_object('error', 'Active review_spotlight_songs mission not found')
      );
    end if;
  end;
  $$;

  select jsonb_build_object(
    'passed',
      bool_and(passed),
    'checks',
      jsonb_agg(
        jsonb_build_object(
          'name', check_name,
          'passed', passed,
          'detail', detail
        )
        order by check_name
      )
  ) as verification
  from feedback_engine_results;

  rollback;
`;

const result = await query(verificationSql);
const verification = result.at(-1)?.verification ?? null;

console.log(
  JSON.stringify({
    status: verification?.passed ? "passed" : "failed",
    verification,
    persisted_test_data: false,
  }),
);

if (!verification?.passed) {
  process.exitCode = 1;
}
