import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

async function loadEnvironment() {
  const contents = await readFile(".env.local", "utf8");
  for (const line of contents.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    process.env[line.slice(0, separator).trim()] ||=
      line.slice(separator + 1).trim();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoError(error, context) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

await loadEnvironment();

const projectRef = process.env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
assert(projectRef && accessToken, "Supabase project credentials are required");

const keyResponse = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
assert(keyResponse.ok, `Supabase key lookup failed: ${keyResponse.status}`);
const keyPayload = await keyResponse.json();
const keys = Array.isArray(keyPayload)
  ? keyPayload
  : keyPayload.api_keys ?? [];
const anonKey = keys.find((key) => key.name === "anon")?.api_key;
const serviceRoleKey = keys.find(
  (key) =>
    key.name === "service_role" ||
    key.name === "secret" ||
    key.type === "secret",
)?.api_key;
assert(anonKey && serviceRoleKey, "Supabase API keys are unavailable");

const url = `https://${projectRef}.supabase.co`;
const options = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
};
const service = createClient(url, serviceRoleKey, options);
const ownerClient = createClient(url, anonKey, options);
const peerClient = createClient(url, anonKey, options);
const runId = randomUUID().replaceAll("-", "");
const password = `SongManage${runId.slice(0, 10)}Aa1`;
const userIds = [];
const checks = [];
let baseline;

function record(name, details = true) {
  checks.push({ name, passed: true, details });
}

async function createUser(client, label) {
  const email = `song-management-${label}-${runId}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      explicit_content_acknowledged: true,
      full_name: `Song Management ${label}`,
      legal_accepted: true,
      system_bootstrap: true,
    },
  });
  assertNoError(error, `${label} user creation`);
  assert(data.user?.id, `${label} user ID is missing`);
  userIds.push(data.user.id);

  const { error: loginError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  assertNoError(loginError, `${label} login`);

  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id, founder_number, credits, role")
    .eq("id", data.user.id)
    .single();
  assertNoError(profileError, `${label} profile lookup`);
  assert(profile.founder_number === null, `${label} consumed a Founder spot`);

  const { error: creditError } = await service
    .from("profiles")
    .update({ credits: 8 })
    .eq("id", data.user.id);
  assertNoError(creditError, `${label} fixture credit setup`);
  return data.user.id;
}

async function rpc(client, name, params, context) {
  const { data, error } = await client.rpc(name, params);
  assertNoError(error, context);
  return data;
}

async function submit(client, title, musicUrl) {
  return rpc(
    client,
    "submit_song",
    {
      song_artist_name: "Song Management Test",
      song_country: "United States",
      song_cover_image_url: "",
      song_explicit_content: false,
      song_feedback_focus: ["General Feedback"],
      song_genre: "Pop",
      song_language: "English",
      song_music_url: musicUrl,
      song_platform: "youtube",
      song_title: title,
    },
    `Submit ${title}`,
  );
}

async function credits(userId) {
  const { data, error } = await service
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();
  assertNoError(error, "Read credit balance");
  return data.credits;
}

async function cleanup() {
  await ownerClient.auth.signOut();
  await peerClient.auth.signOut();
  for (const userId of [...userIds].reverse()) {
    const { error } = await service.auth.admin.deleteUser(userId);
    assertNoError(error, `Delete disposable user ${userId.slice(0, 8)}`);
  }

  const { data: founder, error: founderError } = await service
    .from("founder_program")
    .select("claimed_count")
    .single();
  assertNoError(founderError, "Verify Founder counter");
  assert(
    founder.claimed_count === baseline.founderCount,
    "Founder counter changed during isolated testing",
  );

  const { count: songs, error: songError } = await service
    .from("songs")
    .select("*", { count: "exact", head: true });
  assertNoError(songError, "Verify catalog cleanup");
  assert(songs === baseline.songCount, "Disposable songs were not cleaned up");
  record("Disposable fixtures cleaned up");
  record("Founder counter remained unchanged", founder.claimed_count);
}

try {
  const [{ data: founder }, { count: songCount }] = await Promise.all([
    service.from("founder_program").select("claimed_count").single(),
    service.from("songs").select("*", { count: "exact", head: true }),
  ]);
  baseline = { founderCount: founder.claimed_count, songCount };

  const ownerId = await createUser(ownerClient, "owner");
  const peerId = await createUser(peerClient, "peer");
  record("Disposable non-Founder users created");

  const exactUrl = `https://www.youtube.com/watch?v=${runId.slice(0, 11)}`;
  const firstSongId = await submit(
    ownerClient,
    "Exact Duplicate Protection",
    exactUrl,
  );
  const balanceAfterFirst = await credits(ownerId);
  assert(balanceAfterFirst === 7, "Initial song did not consume one token");

  const duplicateCheck = await rpc(
    ownerClient,
    "check_song_submission_duplicates",
    {
      song_music_url: exactUrl,
      song_platform: "youtube",
      song_title: "Exact Duplicate Protection",
    },
    "Check exact duplicate",
  );
  assert(
    duplicateCheck.some(
      (match) => match.song_id === firstSongId && match.exact_match,
    ),
    "Exact duplicate was not detected",
  );

  const duplicateAttempt = await ownerClient.rpc("submit_song", {
    song_artist_name: "Song Management Test",
    song_country: "United States",
    song_cover_image_url: "",
    song_explicit_content: false,
    song_feedback_focus: ["General Feedback"],
    song_genre: "Pop",
    song_language: "English",
    song_music_url: exactUrl,
    song_platform: "youtube",
    song_title: "Exact Duplicate Protection",
  });
  assert(
    duplicateAttempt.error?.message.includes("Song already submitted."),
    "Exact duplicate submission was not blocked",
  );
  assert(
    (await credits(ownerId)) === balanceAfterFirst,
    "Blocked duplicate changed the token balance",
  );
  record("Exact creator duplicate blocked without consuming tokens");

  const peerSameUrlId = await submit(
    peerClient,
    "Independent Creator Submission",
    exactUrl,
  );
  assert(peerSameUrlId, "The owner-scoped URL rule blocked another creator");
  record("Same platform URL remains owner-scoped");

  const managementBeforeDelete = await rpc(
    ownerClient,
    "get_my_song_management",
    {},
    "Read creator song management",
  );
  assert(
    managementBeforeDelete.find((song) => song.song_id === firstSongId)
      ?.can_delete,
    "Untouched song was not deletable",
  );
  const deletion = await rpc(
    ownerClient,
    "delete_my_song",
    { target_song_id: firstSongId },
    "Delete untouched song",
  );
  assert(deletion[0]?.refunded_tokens === 1, "Original token was not refunded");
  assert((await credits(ownerId)) === 8, "Refund balance is incorrect");
  record("Creator deletion refunded the recorded token cost");

  const archiveUrl =
    `https://www.youtube.com/watch?v=${runId.slice(11, 22)}`;
  const archiveSongId = await submit(
    ownerClient,
    "Archive Activity Protection",
    archiveUrl,
  );
  await rpc(
    peerClient,
    "save_song_for_later",
    { target_song_id: archiveSongId },
    "Create song activity",
  );
  const archiveBalance = await credits(ownerId);
  await rpc(
    ownerClient,
    "archive_my_song",
    { target_song_id: archiveSongId },
    "Archive active song",
  );
  assert(
    (await credits(ownerId)) === archiveBalance,
    "Archive incorrectly refunded a token",
  );

  const [queue, publicSongs, dashboard] = await Promise.all([
    rpc(
      peerClient,
      "get_smart_review_queue",
      { queue_limit: 50 },
      "Read review queue",
    ),
    rpc(
      peerClient,
      "get_public_artist_songs",
      { target_artist_id: ownerId },
      "Read public artist songs",
    ),
    rpc(ownerClient, "get_my_song_dashboard_v2", {}, "Read creator dashboard"),
  ]);
  assert(
    !queue.some((song) => song.song_id === archiveSongId),
    "Archived song remained in the review queue",
  );
  assert(
    !publicSongs.some((song) => song.song_id === archiveSongId),
    "Archived song remained on the public artist page",
  );
  assert(
    dashboard.some((song) => song.song_id === archiveSongId),
    "Archived song statistics disappeared from the creator dashboard",
  );
  record("Archive hides catalog placement while preserving dashboard statistics");

  const { error: roleError } = await service
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", ownerId);
  assertNoError(roleError, "Promote disposable admin");

  const canonicalId = await submit(
    ownerClient,
    "Admin Duplicate Candidate",
    `https://www.youtube.com/watch?v=${runId.slice(1, 12)}`,
  );
  const mergeId = await submit(
    ownerClient,
    "Admin Duplicate Candidate",
    `https://www.youtube.com/watch?v=${runId.slice(2, 13)}`,
  );
  const candidates = await rpc(
    ownerClient,
    "admin_get_duplicate_song_candidates",
    {},
    "Read admin duplicate candidates",
  );
  assert(
    candidates.some(
      (candidate) =>
        candidate.canonical_song_id === canonicalId &&
        candidate.duplicate_song_id === mergeId,
    ),
    "Admin duplicate candidate was not listed",
  );
  await rpc(
    ownerClient,
    "admin_merge_duplicate_songs",
    {
      canonical_song_id: canonicalId,
      duplicate_song_id: mergeId,
    },
    "Merge admin duplicate",
  );
  const { data: mergedSong, error: mergedError } = await service
    .from("songs")
    .select("is_active, merged_into_song_id")
    .eq("id", mergeId)
    .single();
  assertNoError(mergedError, "Verify merged duplicate");
  assert(
    !mergedSong.is_active && mergedSong.merged_into_song_id === canonicalId,
    "Merged duplicate lifecycle state is invalid",
  );
  record("Admin duplicate detection and merge succeeded");

  const cleanupUrl =
    `https://www.youtube.com/watch?v=${runId.slice(3, 14)}`;
  const matchingId = await submit(
    ownerClient,
    "Abandoned Duplicate Source",
    cleanupUrl,
  );
  const abandonedId = await submit(
    peerClient,
    "Abandoned Duplicate Copy",
    cleanupUrl,
  );
  const peerBalanceBeforeCleanup = await credits(peerId);
  const refunded = await rpc(
    ownerClient,
    "admin_delete_abandoned_duplicate",
    {
      matching_song_id: matchingId,
      target_song_id: abandonedId,
    },
    "Delete abandoned duplicate",
  );
  assert(refunded === 1, "Admin cleanup did not return the refund amount");
  assert(
    (await credits(peerId)) === peerBalanceBeforeCleanup + 1,
    "Admin duplicate cleanup did not refund the creator",
  );
  record("Admin abandoned-duplicate deletion and refund succeeded");

  const history = await rpc(
    ownerClient,
    "get_my_removed_song_history",
    {},
    "Read removed song history",
  );
  assert(
    history.some(
      (entry) =>
        entry.original_song_id === firstSongId && entry.action === "deleted",
    ),
    "Creator deletion is missing from removed song history",
  );
  assert(
    history.some(
      (entry) =>
        entry.original_song_id === mergeId && entry.action === "merged",
    ),
    "Admin merge is missing from removed song history",
  );
  record("Removed song history is complete");
} finally {
  if (baseline) await cleanup();
}

console.log(
  JSON.stringify(
    {
      checks,
      score: 100,
      status: "passed",
    },
    null,
    2,
  ),
);
