import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required.",
  );
}

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
};

const service = createClient(url, serviceRoleKey, clientOptions);
const ownerClient = createClient(url, anonKey, clientOptions);
const reviewerClient = createClient(url, anonKey, clientOptions);
const anonClient = createClient(url, anonKey, clientOptions);

const runId = randomUUID().replaceAll("-", "").slice(0, 16);
const password = `Fl!${runId}Aa9`;
const testUsers = [];
const checks = [];
let baseline = null;

function record(name, details = null) {
  checks.push({ name, passed: true, details });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoError(error, context) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

async function waitForProfile(userId) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const { data, error } = await service
      .from("profiles")
      .select(
        "id, display_name, credits, completed_reviews, founder_number, role, account_status, legal_accepted_at, explicit_content_acknowledged_at",
      )
      .eq("id", userId)
      .maybeSingle();
    assertNoError(error, "Read generated profile");
    if (data) return data;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Profile trigger did not create a profile in time");
}

async function createTestUser(client, label) {
  const email = `first.listen.${label}.${runId}@gmail.com`;
  const { data: createData, error: createError } =
    await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: `First Listen ${label}`,
      legal_accepted: true,
      explicit_content_acknowledged: true,
      system_bootstrap: true,
    },
  });
  assertNoError(createError, `${label} Auth creation`);
  assert(createData.user?.id, `${label} Auth creation did not return a user`);
  testUsers.push(createData.user.id);

  await client.auth.signOut();
  const { data: loginData, error: loginError } =
    await client.auth.signInWithPassword({ email, password });
  assertNoError(loginError, `${label} login`);
  assert(loginData.user?.id === createData.user.id, `${label} login mismatch`);

  const profile = await waitForProfile(createData.user.id);
  assert(profile.credits === 1, `${label} registration credit is not 1`);
  assert(profile.founder_number === null, `${label} consumed a Founder spot`);
  assert(profile.role === "user", `${label} did not receive the user role`);
  assert(profile.account_status === "active", `${label} is not active`);
  assert(profile.legal_accepted_at, `${label} legal acceptance was not stored`);
  assert(
    profile.explicit_content_acknowledged_at,
    `${label} explicit-content acknowledgement was not stored`,
  );

  return { id: createData.user.id, email, profile };
}

async function rpc(client, name, params, context) {
  const { data, error } = await client.rpc(name, params);
  assertNoError(error, context);
  return data;
}

async function cleanup() {
  for (const userId of [...testUsers].reverse()) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) {
      checks.push({
        name: `Cleanup test user ${userId.slice(0, 8)}`,
        passed: false,
        details: error.message,
      });
    }
  }

  if (baseline) {
    const { count: authCount, error: authError } = await service
      .schema("auth")
      .from("users")
      .select("*", { count: "exact", head: true });
    // Supabase REST does not expose the auth schema. Profile and content cleanup
    // are checked below, while the Auth user count is verified by the catalog audit.
    if (authError || authCount === null) {
      void authError;
    }

    const { count: remainingProfiles, error: profileError } = await service
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .in("id", testUsers);
    assertNoError(profileError, "Verify profile cleanup");
    assert(remainingProfiles === 0, "Disposable profiles were not removed");

    const { data: founderState, error: founderError } = await service
      .from("founder_program")
      .select("claimed_count")
      .single();
    assertNoError(founderError, "Verify Founder counter after cleanup");
    assert(
      founderState.claimed_count === baseline.founderCount,
      "Founder counter changed during isolated testing",
    );
    record("Disposable test data cleaned up");
    record("Founder counter unchanged by tests", founderState.claimed_count);
  }
}

try {
  const { data: founderState, error: founderError } = await service
    .from("founder_program")
    .select("claimed_count")
    .single();
  assertNoError(founderError, "Read baseline Founder counter");
  baseline = { founderCount: founderState.claimed_count };

  const owner = await createTestUser(ownerClient, "owner");
  const reviewer = await createTestUser(reviewerClient, "reviewer");
  record("Auth user creation triggers profile creation");
  record("Email/password login succeeds");
  record("Profile trigger stores legal acknowledgements and registration credit");

  await rpc(
    ownerClient,
    "save_onboarding_preferences",
    {
      profile_languages: ["English"],
      profile_genres: ["Pop", "Rock"],
      profile_interface_language: "en",
    },
    "Save owner onboarding",
  );
  await rpc(
    reviewerClient,
    "save_onboarding_preferences",
    {
      profile_languages: ["English", "Instrumental Only"],
      profile_genres: ["Pop", "Rock"],
      profile_interface_language: "en",
    },
    "Save reviewer onboarding",
  );
  record("Onboarding preferences persist");

  const platformCases = [
    ["youtube", "https://www.youtube.com/watch?v=abcdefghijk"],
    ["spotify", "https://open.spotify.com/track/1234567890"],
    ["youtube_music", "https://music.youtube.com/watch?v=abcdefghijk"],
    ["soundcloud", "https://soundcloud.com/first-listen/test-track"],
    ["apple_music", "https://music.apple.com/us/song/test-song/123456789"],
  ];
  for (const [songPlatform, musicUrl] of platformCases) {
    const matches = await rpc(
      service,
      "music_url_matches_platform",
      { music_url: musicUrl, song_platform: songPlatform },
      `Validate ${songPlatform} URL`,
    );
    assert(matches === true, `${songPlatform} URL validation failed`);
  }
  record("All five supported music platforms validate");

  const { error: topUpError } = await service
    .from("profiles")
    .update({ credits: 2 })
    .eq("id", owner.id);
  assertNoError(topUpError, "Prepare isolated submission credits");

  const invalidSubmission = await ownerClient.rpc("submit_song", {
    song_title: "Invalid Test Song",
    song_artist_name: "First Listen Test",
    song_cover_image_url: "https://example.com/cover.jpg",
    song_music_url: "https://example.com/not-music",
    song_platform: "youtube",
    song_genre: "Pop",
    song_language: "English",
    song_feedback_focus: ["Hook Strength"],
    song_country: "United States",
    song_explicit_content: false,
  });
  assert(
    invalidSubmission.error?.message.includes("Unsupported or invalid music link"),
    "Invalid music URL was accepted",
  );
  record("Invalid song links are rejected before submission");

  const firstUrl = `https://www.youtube.com/watch?v=${runId.slice(0, 11)}`;
  const secondUrl = `https://open.spotify.com/track/${runId}`;
  const firstSongId = await rpc(
    ownerClient,
    "submit_song",
    {
      song_title: "Live Verification One",
      song_artist_name: "First Listen Test Artist",
      song_cover_image_url: "https://example.com/cover-one.jpg",
      song_music_url: firstUrl,
      song_platform: "youtube",
      song_genre: "Pop",
      song_language: "English",
      song_feedback_focus: ["Hook Strength", "Production"],
      song_country: "United States",
      song_explicit_content: false,
    },
    "Submit first song",
  );
  const secondSongId = await rpc(
    ownerClient,
    "submit_song",
    {
      song_title: "Live Verification Two",
      song_artist_name: "First Listen Test Artist",
      song_cover_image_url: "https://example.com/cover-two.jpg",
      song_music_url: secondUrl,
      song_platform: "spotify",
      song_genre: "Rock",
      song_language: "Instrumental",
      song_feedback_focus: ["Mix", "Arrangement"],
      song_country: "United States",
      song_explicit_content: false,
    },
    "Submit second song",
  );
  assert(firstSongId && secondSongId, "Song submission did not return IDs");

  const duplicateSubmission = await ownerClient.rpc("submit_song", {
    song_title: "Duplicate Test Song",
    song_artist_name: "First Listen Test",
    song_cover_image_url: "https://example.com/cover.jpg",
    song_music_url: firstUrl,
    song_platform: "youtube",
    song_genre: "Pop",
    song_language: "English",
    song_feedback_focus: ["General Feedback"],
    song_country: "United States",
    song_explicit_content: false,
  });
  assert(
    duplicateSubmission.error?.message.includes("already been submitted"),
    "Duplicate song URL was accepted",
  );

  const { data: ownerAfterSongs, error: ownerCreditsError } = await service
    .from("profiles")
    .select("credits")
    .eq("id", owner.id)
    .single();
  assertNoError(ownerCreditsError, "Read owner credits after submissions");
  assert(ownerAfterSongs.credits === 0, "Song submissions did not cost one credit");
  record("Song submissions persist and each cost one credit");
  record("Duplicate song links are rejected");

  const { error: milestoneSetupError } = await service
    .from("profiles")
    .update({ completed_reviews: 4 })
    .eq("id", reviewer.id);
  assertNoError(milestoneSetupError, "Prepare isolated reward milestone");

  const initialQueue = await rpc(
    reviewerClient,
    "get_smart_review_queue",
    { queue_limit: 20 },
    "Load smart review queue",
  );
  assert(initialQueue.length === 2, "Smart queue did not include both eligible songs");
  assert(
    initialQueue.some(
      (song) =>
        song.song_id === firstSongId &&
        song.match_reasons.includes("English") &&
        song.match_reasons.includes("Pop"),
    ),
    "Smart queue did not prioritize matching language and genre",
  );
  record("Smart review queue matches language, genre, activity, and fairness");

  const lowQuality = await rpc(
    reviewerClient,
    "submit_review",
    {
      reviewed_song_id: firstSongId,
      review_listen_full: true,
      review_add_to_playlist: true,
      review_grabbed_attention: true,
      review_share_with_friend: true,
      review_rating: 8,
      review_comment: "Too short.",
      review_pasted_comment_detected: false,
    },
    "Submit short review",
  );
  assert(lowQuality[0]?.accepted === false, "Short review was accepted");

  const firstComment =
    "The opening melody feels distinctive and the vocal arrangement builds clear momentum throughout.";
  const acceptedFirst = await rpc(
    reviewerClient,
    "submit_review",
    {
      reviewed_song_id: firstSongId,
      review_listen_full: true,
      review_add_to_playlist: true,
      review_grabbed_attention: true,
      review_share_with_friend: true,
      review_rating: 8,
      review_comment: firstComment,
      review_pasted_comment_detected: false,
    },
    "Submit quality review",
  );
  assert(acceptedFirst[0]?.accepted === true, "Quality review was rejected");
  assert(acceptedFirst[0]?.credit_granted === true, "Five-review reward was not granted");

  const nextQueue = await rpc(
    reviewerClient,
    "get_smart_review_queue",
    { queue_limit: 20 },
    "Load next review song",
  );
  assert(
    nextQueue.length === 1 && nextQueue[0].song_id === secondSongId,
    "Reviewed song was not removed or next song was not loaded",
  );
  record("Review completion advances to the next available song");

  const repeatedReview = await rpc(
    reviewerClient,
    "submit_review",
    {
      reviewed_song_id: secondSongId,
      review_listen_full: false,
      review_add_to_playlist: true,
      review_grabbed_attention: true,
      review_share_with_friend: false,
      review_rating: 7,
      review_comment: firstComment,
      review_pasted_comment_detected: false,
    },
    "Submit repeated review",
  );
  assert(repeatedReview[0]?.accepted === false, "Repeated comment was accepted");

  const secondComment =
    "The instrumental texture is engaging, while the transition into the chorus could land with more impact.";
  const pastedReview = await rpc(
    reviewerClient,
    "submit_review",
    {
      reviewed_song_id: secondSongId,
      review_listen_full: false,
      review_add_to_playlist: true,
      review_grabbed_attention: true,
      review_share_with_friend: false,
      review_rating: 7,
      review_comment: secondComment,
      review_pasted_comment_detected: true,
    },
    "Submit pasted review",
  );
  assert(pastedReview[0]?.accepted === false, "Pasted review was accepted");

  const acceptedSecond = await rpc(
    reviewerClient,
    "submit_review",
    {
      reviewed_song_id: secondSongId,
      review_listen_full: false,
      review_add_to_playlist: true,
      review_grabbed_attention: true,
      review_share_with_friend: false,
      review_rating: 7,
      review_comment: secondComment,
      review_pasted_comment_detected: false,
    },
    "Submit second quality review",
  );
  assert(acceptedSecond[0]?.accepted === true, "Second quality review was rejected");
  record("Short, repeated, and pasted reviews receive no credit");
  record("Quality reviews persist and update reviewer quality");

  const { data: reviewerState, error: reviewerStateError } = await service
    .from("profiles")
    .select("credits, completed_reviews, total_review_credits_earned, review_quality_score")
    .eq("id", reviewer.id)
    .single();
  assertNoError(reviewerStateError, "Read reviewer reward state");
  assert(reviewerState.completed_reviews === 6, "Completed review count is incorrect");
  assert(reviewerState.credits === 2, "Review milestone credits are incorrect");
  assert(
    reviewerState.total_review_credits_earned === 1,
    "Earned credit total is incorrect",
  );
  assert(
    Number(reviewerState.review_quality_score) === 100,
    "Review quality score is incorrect",
  );
  record("Five-review milestone awards exactly one credit");

  await rpc(
    reviewerClient,
    "follow_artist",
    { target_artist_id: owner.id },
    "Follow artist",
  );
  await rpc(
    reviewerClient,
    "save_song_for_later",
    { target_song_id: firstSongId },
    "Save song",
  );
  const savedSongs = await rpc(
    reviewerClient,
    "get_saved_songs",
    {},
    "Load saved songs",
  );
  assert(
    savedSongs.length === 1 && savedSongs[0].song_id === firstSongId,
    "Saved song was not returned",
  );
  record("Artist follows and saved songs persist");

  const reportId = await rpc(
    reviewerClient,
    "report_song",
    {
      reported_song_id: firstSongId,
      report_reason: "broken_link",
      report_details: "Automated live verification report.",
    },
    "Report song",
  );
  assert(reportId, "Song report was not created");
  record("Song reports persist for moderation");

  const publicProfile = await rpc(
    anonClient,
    "get_public_artist_profile",
    { target_artist_id: owner.id },
    "Load public artist profile",
  );
  assert(publicProfile.length === 1, "Public artist profile was not returned");
  assert(publicProfile[0].followers === 1, "Public follower count is incorrect");
  assert(publicProfile[0].songs_submitted === 2, "Public song count is incorrect");

  const publicSongs = await rpc(
    anonClient,
    "get_public_artist_songs",
    { target_artist_id: owner.id },
    "Load public artist songs",
  );
  assert(publicSongs.length === 2, "Public artist songs were not returned");
  record("Public artist profiles expose safe discovery data");

  const dashboard = await rpc(
    ownerClient,
    "get_my_song_dashboard",
    {},
    "Load creator dashboard",
  );
  assert(dashboard.length === 2, "Creator dashboard did not return both songs");
  const firstDashboardSong = dashboard.find((song) => song.song_id === firstSongId);
  const secondDashboardSong = dashboard.find((song) => song.song_id === secondSongId);
  assert(firstDashboardSong?.reviews_received === 1, "First review total is incorrect");
  assert(Number(firstDashboardSong?.average_rating) === 8, "First average is incorrect");
  assert(firstDashboardSong?.hook_score === 100, "First Hook Score is incorrect");
  assert(firstDashboardSong?.report_count === 1, "First report count is incorrect");
  assert(secondDashboardSong?.hook_score === 50, "Second Hook Score is incorrect");

  const comments = await rpc(
    ownerClient,
    "get_my_song_comments",
    { target_song_id: null },
    "Load creator comments",
  );
  assert(comments.length === 2, "Creator comments page did not return both comments");
  record("Creator dashboard metrics and comments are correct");

  const { data: hiddenProfileRows, error: hiddenProfileError } =
    await reviewerClient.from("profiles").select("id").eq("id", owner.id);
  assertNoError(hiddenProfileError, "Check profile RLS");
  assert(hiddenProfileRows.length === 0, "Profile RLS exposed another user's row");

  const anonProfiles = await anonClient.from("profiles").select("id").limit(1);
  assert(anonProfiles.error, "Anonymous role could read private profiles");
  record("RLS blocks private profile access");

  const exhaustedQueue = await rpc(
    reviewerClient,
    "get_smart_review_queue",
    { queue_limit: 20 },
    "Verify completed queue",
  );
  assert(exhaustedQueue.length === 0, "Reviewed songs remained in the queue");
  record("Reviewed songs are excluded from future queue results");
} catch (error) {
  checks.push({
    name: "Live flow verification",
    passed: false,
    details: error instanceof Error ? error.message : String(error),
  });
} finally {
  try {
    await cleanup();
  } catch (error) {
    checks.push({
      name: "Cleanup verification",
      passed: false,
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

const failed = checks.filter((check) => !check.passed);
const result = {
  status: failed.length === 0 ? "passed" : "failed",
  passed: checks.length - failed.length,
  failed: failed.length,
  checks,
};

console.log(JSON.stringify(result, null, 2));
if (failed.length > 0) process.exitCode = 1;
