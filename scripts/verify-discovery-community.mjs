import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoError(error, context) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

await loadLocalEnvironment();

const projectRef = process.env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!projectRef || !accessToken) {
  throw new Error("SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required.");
}

const keyResponse = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
if (!keyResponse.ok) {
  throw new Error(`Supabase API key lookup failed: ${keyResponse.status}`);
}
const keys = await keyResponse.json();
const keyList = Array.isArray(keys) ? keys : keys.api_keys ?? [];
const anonKey = keyList.find((key) => key.name === "anon")?.api_key;
const serviceRoleKey = keyList.find(
  (key) =>
    key.name === "service_role" ||
    key.name === "secret" ||
    key.type === "secret",
)?.api_key;
if (!anonKey || !serviceRoleKey) {
  throw new Error("Supabase API keys are unavailable.");
}

const options = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
};
const url = `https://${projectRef}.supabase.co`;
const service = createClient(url, serviceRoleKey, options);
const adminClient = createClient(url, anonKey, options);
const ownerClient = createClient(url, anonKey, options);
const reviewerClient = createClient(url, anonKey, options);
const viewerClient = createClient(url, anonKey, options);
const clients = { admin: adminClient, owner: ownerClient, reviewer: reviewerClient, viewer: viewerClient };
const runId = randomUUID().replaceAll("-", "");
const password = `Discovery${runId.slice(0, 10)}Aa1`;
const userIds = [];
const programIds = { contests: [], events: [] };
const checks = [];
let originalSlots = [];
let reviewerId = null;

function record(name, details = true) {
  checks.push({ name, passed: true, details });
}

async function createUser(label) {
  const client = clients[label];
  const email = `discovery-${label}-${runId}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: {
      explicit_content_acknowledged: true,
      full_name: `Discovery ${label}`,
      legal_accepted: true,
      system_bootstrap: true,
    },
  });
  assertNoError(error, `Create ${label}`);
  assert(data.user, `${label} user missing`);
  userIds.push(data.user.id);
  const login = await client.auth.signInWithPassword({ email, password });
  assertNoError(login.error, `Sign in ${label}`);
  const onboarding = await client.rpc("save_onboarding_preferences", {
    profile_languages: ["English"],
    profile_genres: ["Pop"],
    profile_interface_language: "en",
  });
  assertNoError(onboarding.error, `Onboard ${label}`);
  return data.user;
}

async function rpc(client, name, params, context) {
  const { data, error } = await client.rpc(name, params);
  assertNoError(error, context);
  return Array.isArray(data) && data.length === 1 ? data[0] : data;
}

async function submitSong(client, suffix, title) {
  return rpc(
    client,
    "submit_song",
    {
      song_title: title,
      song_artist_name: "Discovery Diagnostics",
      song_cover_image_url: "https://www.firstlisten.net/covers/default-song.svg",
      song_music_url: `https://www.youtube.com/watch?v=${suffix}`,
      song_platform: "youtube",
      song_genre: "Pop",
      song_language: "English",
      song_feedback_focus: ["Hook Strength"],
      song_country: "United States",
      song_explicit_content: false,
    },
    `Submit ${title}`,
  );
}

async function submitVerifiedReview(songId, rating) {
  const session = await rpc(
    reviewerClient,
    "start_listening_session",
    { target_song_id: songId },
    "Start verified mission session",
  );
  const prepared = await service
    .from("listening_sessions")
    .update({
      telemetry_supported: true,
      provider_duration_seconds: 120,
      valid_requirement_seconds: 30,
      valid_listen_at: new Date().toISOString(),
      community_point_awarded: true,
      last_position_seconds: 60,
      max_position_seconds: 60,
      verified_seconds: 60,
      settled_seconds: 60,
      last_heartbeat_at: new Date().toISOString(),
    })
    .eq("id", session.session_id);
  assertNoError(prepared.error, "Prepare verified session");

  const currentProfile = await service
    .from("profiles")
    .select("listening_bank_seconds, lifetime_listening_seconds")
    .eq("id", reviewerId)
    .single();
  assertNoError(currentProfile.error, "Read reviewer listening balances");
  const banked = await service
    .from("profiles")
    .update({
      listening_bank_seconds:
        Number(currentProfile.data.listening_bank_seconds) + 60,
      lifetime_listening_seconds:
        Number(currentProfile.data.lifetime_listening_seconds) + 60,
    })
    .eq("id", reviewerId);
  assertNoError(banked.error, "Mirror immediate heartbeat banking");

  return rpc(
    reviewerClient,
    "submit_review_with_listening",
    {
      reviewed_song_id: songId,
      review_listen_full: true,
      review_add_to_playlist: true,
      review_grabbed_attention: true,
      review_share_with_friend: rating >= 9,
      review_rating: rating,
      review_comment: `The opening is immediate, the arrangement stays focused, and this ${rating}/10 hook remains clear through the first full section.`,
      review_pasted_comment_detected: false,
      listening_session_id: session.session_id,
    },
    "Submit verified Spotlight review",
  );
}

try {
  const listedUsers = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  assertNoError(listedUsers.error, "List stale discovery fixtures");
  const staleFixtures = listedUsers.data.users.filter((user) =>
    /^discovery-(admin|owner|reviewer|viewer)-.+@example\.com$/i.test(
      user.email ?? "",
    ),
  );
  for (const fixture of staleFixtures) {
    await service
      .from("spotlight_slots")
      .update({ updated_by: null })
      .eq("updated_by", fixture.id);
    await service.from("contests").delete().eq("created_by", fixture.id);
    await service.from("special_events").delete().eq("created_by", fixture.id);
    await service
      .from("song_boosts")
      .update({ reviewed_by: null })
      .eq("reviewed_by", fixture.id);
    assertNoError(
      (await service.auth.admin.deleteUser(fixture.id)).error,
      "Delete stale discovery fixture",
    );
  }

  originalSlots =
    (
      await service
        .from("spotlight_slots")
        .select(
          "slot_number, song_id, placement_kind, custom_label, active_from, active_until, updated_by",
        )
        .order("slot_number")
    ).data ?? [];

  const admin = await createUser("admin");
  const owner = await createUser("owner");
  const reviewer = await createUser("reviewer");
  reviewerId = reviewer.id;
  await createUser("viewer");

  assertNoError(
    (
      await service
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", admin.id)
    ).error,
    "Promote disposable admin",
  );
  assertNoError(
    (
      await service
        .from("profiles")
        .update({ credits: 5 })
        .eq("id", owner.id)
    ).error,
    "Fund disposable owner",
  );

  const songOne = await submitSong(
    ownerClient,
    runId.slice(0, 11),
    `Spotlight One ${runId.slice(0, 6)}`,
  );
  const songTwo = await submitSong(
    ownerClient,
    runId.slice(11, 22),
    `Spotlight Two ${runId.slice(0, 6)}`,
  );

  const unauthorized = await ownerClient.rpc("admin_set_spotlight_slot", {
    target_slot: 1,
    target_song_id: songOne,
    placement: "editor_pick",
    label: "Unauthorized",
    starts_at: null,
    ends_at: null,
  });
  assert(unauthorized.error, "Normal user edited a Spotlight slot");
  record("Only administrators can edit Spotlight");

  await rpc(
    adminClient,
    "admin_set_spotlight_slot",
    {
      target_slot: 1,
      target_song_id: songOne,
      placement: "editor_pick",
      label: "Editor Pick",
      starts_at: null,
      ends_at: null,
    },
    "Assign Spotlight slot 1",
  );
  await rpc(
    adminClient,
    "admin_set_spotlight_slot",
    {
      target_slot: 2,
      target_song_id: songTwo,
      placement: "new_release",
      label: "New Release",
      starts_at: null,
      ends_at: null,
    },
    "Assign Spotlight slot 2",
  );

  const spotlight = await rpc(
    viewerClient,
    "get_spotlight_songs",
    {},
    "Read Spotlight",
  );
  assert(
    spotlight.length === 2 &&
      spotlight.some((row) => row.song_id === songOne) &&
      spotlight.some((row) => row.song_id === songTwo),
    "Spotlight did not return exactly the two configured songs",
  );
  record("Spotlight exposes exactly two admin-selected songs");

  const firstReview = await submitVerifiedReview(songOne, 9);
  assert(firstReview.listening_seconds_banked === 0, "First listen was banked twice");
  assert(firstReview.community_points_awarded === 5, "First review points are incorrect");
  let mission = await rpc(
    reviewerClient,
    "get_daily_mission_status",
    {},
    "Read mission progress after first review",
  );
  assert(
    mission.progress_count === 1 && mission.completed === false,
    "Mission did not advance to 1/2",
  );

  const secondReview = await submitVerifiedReview(songTwo, 8);
  assert(secondReview.listening_seconds_banked === 0, "Second listen was banked twice");
  assert(secondReview.community_points_awarded === 5, "Second review points are incorrect");
  mission = await rpc(
    reviewerClient,
    "get_daily_mission_status",
    {},
    "Read completed mission",
  );
  assert(
    mission.progress_count === 2 && mission.completed === true,
    "Mission did not complete at 2/2",
  );
  record("Daily mission advances only with verified Spotlight listening", mission);

  const bankBeforeClaim = await rpc(
    reviewerClient,
    "get_listening_bank_status_v2",
    {},
    "Read bank before mission claim",
  );
  assert(
    Number(bankBeforeClaim.bank_seconds) === 120 &&
      Number(bankBeforeClaim.pending_seconds) === 0,
    "Approved and pending listening balances are incorrect",
  );
  record("Listening Bank reports immediately approved verified seconds", bankBeforeClaim);

  const missionClaim = await rpc(
    reviewerClient,
    "claim_daily_mission_reward",
    { target_mission_id: mission.mission_id },
    "Claim mission reward",
  );
  assert(
    missionClaim.reward_kind === "listening_minutes" &&
      missionClaim.reward_amount === 15 &&
      Number(missionClaim.bank_seconds) === 1020,
    "Mission reward did not add 15 approved Bank minutes",
  );
  record("Daily mission reward is manually claimed", missionClaim);

  const topBeforeBoost = await rpc(
    viewerClient,
    "get_top_ten_songs",
    {},
    "Read organic Top 10",
  );
  const organicBefore = topBeforeBoost.find((row) => row.song_id === songOne);
  assert(organicBefore, "Reviewed test song was missing from Top 10 results");

  const boostId = await rpc(
    ownerClient,
    "request_song_boost",
    { target_song_id: songOne },
    "Request boost",
  );
  const ownerAfterRequest = await service
    .from("profiles")
    .select("credits")
    .eq("id", owner.id)
    .single();
  assertNoError(ownerAfterRequest.error, "Read credits after boost request");
  assert(ownerAfterRequest.data.credits === 3, "Pending boost spent credits early");

  await rpc(
    adminClient,
    "admin_review_song_boost",
    {
      target_boost_id: boostId,
      approve: true,
      note: "Disposable verification",
    },
    "Approve boost",
  );
  const ownerAfterApproval = await service
    .from("profiles")
    .select("credits")
    .eq("id", owner.id)
    .single();
  assertNoError(ownerAfterApproval.error, "Read credits after boost approval");
  assert(ownerAfterApproval.data.credits === 2, "Approved boost did not spend one credit");

  const queue = await rpc(
    viewerClient,
    "get_smart_review_queue",
    { queue_limit: 20 },
    "Read boosted review queue",
  );
  const boostedQueueSong = queue.find((row) => row.song_id === songOne);
  const organicQueueSong = queue.find((row) => row.song_id === songTwo);
  assert(
    boostedQueueSong &&
      organicQueueSong &&
      boostedQueueSong.match_score >= organicQueueSong.match_score + 35,
    "Approved boost did not increase discovery queue visibility",
  );

  const topAfterBoost = await rpc(
    viewerClient,
    "get_top_ten_songs",
    {},
    "Read Top 10 after boost",
  );
  const organicAfter = topAfterBoost.find((row) => row.song_id === songOne);
  assert(
    organicAfter &&
      Number(organicAfter.ranking_score) === Number(organicBefore.ranking_score),
    "Boost changed the organic Top 10 score",
  );
  record("Boost affects queue visibility but not Top 10 scoring");

  const startsAt = new Date(Date.now() - 60_000).toISOString();
  const endsAt = new Date(Date.now() + 86_400_000).toISOString();
  const contestId = await rpc(
    adminClient,
    "admin_create_contest",
    {
      contest_title: `Discovery Contest ${runId.slice(0, 6)}`,
      contest_description: "Disposable contest infrastructure verification.",
      contest_genre: "Pop",
      contest_starts_at: startsAt,
      contest_ends_at: endsAt,
      contest_reward_description: "Spotlight placement",
    },
    "Create contest",
  );
  const eventId = await rpc(
    adminClient,
    "admin_create_special_event",
    {
      event_title: `Discovery Event ${runId.slice(0, 6)}`,
      event_description: "Disposable event infrastructure verification.",
      event_starts_at: startsAt,
      event_ends_at: endsAt,
    },
    "Create event",
  );
  programIds.contests.push(contestId);
  programIds.events.push(eventId);
  assertNoError(
    (
      await service
        .from("contests")
        .update({ status: "active" })
        .eq("id", contestId)
    ).error,
    "Activate contest",
  );
  assertNoError(
    (
      await service
        .from("special_events")
        .update({ status: "active" })
        .eq("id", eventId)
    ).error,
    "Activate event",
  );
  await rpc(
    ownerClient,
    "enter_contest",
    { target_contest_id: contestId, target_song_id: songOne },
    "Enter contest",
  );
  const programs = await rpc(
    viewerClient,
    "get_active_community_programs",
    {},
    "Read active community programs",
  );
  assert(
    programs.some((program) => program.program_id === contestId) &&
      programs.some((program) => program.program_id === eventId),
    "Active contest and event were not discoverable",
  );
  record("Contest and special-event infrastructure is operational");

  console.log(JSON.stringify({ checks, status: "passed" }, null, 2));
} finally {
  if (originalSlots.length === 2) {
    await service
      .from("spotlight_slots")
      .update({ song_id: null })
      .in("slot_number", [1, 2]);
    for (const slot of originalSlots) {
      await service
        .from("spotlight_slots")
        .update({
          song_id: slot.song_id,
          placement_kind: slot.placement_kind,
          custom_label: slot.custom_label,
          active_from: slot.active_from,
          active_until: slot.active_until,
          updated_by: slot.updated_by,
          updated_at: new Date().toISOString(),
        })
        .eq("slot_number", slot.slot_number);
    }
    const originalSongIds = originalSlots
      .map((slot) => slot.song_id)
      .filter(Boolean);
    if (originalSongIds.length) {
      await service
        .from("songs")
        .update({ featured: true })
        .in("id", originalSongIds);
    }
  }
  if (programIds.contests.length) {
    await service.from("contests").delete().in("id", programIds.contests);
  }
  if (programIds.events.length) {
    await service.from("special_events").delete().in("id", programIds.events);
  }
  for (const userId of userIds.reverse()) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) console.error(`Cleanup failed for ${userId}: ${error.message}`);
  }
}
