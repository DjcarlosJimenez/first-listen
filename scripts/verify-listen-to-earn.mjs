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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

const supabaseUrl = `https://${projectRef}.supabase.co`;
const clientOptions = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
};
const service = createClient(supabaseUrl, serviceRoleKey, clientOptions);
const ownerClient = createClient(supabaseUrl, anonKey, clientOptions);
const reviewerClient = createClient(supabaseUrl, anonKey, clientOptions);
const runId = randomUUID().replaceAll("-", "").slice(0, 18);
const password = `Listening${runId}Aa1`;
const userIds = [];
const checks = [];

function record(name, details) {
  checks.push({ name, passed: true, details });
}

async function createUser(client, label) {
  const email = `listen-${label}-${runId}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: {
      explicit_content_acknowledged: true,
      full_name: `Listening ${label}`,
      legal_accepted: true,
      system_bootstrap: true,
    },
  });
  assertNoError(error, `Create ${label} user`);
  assert(data.user, `${label} user was not returned`);
  userIds.push(data.user.id);

  const login = await client.auth.signInWithPassword({ email, password });
  assertNoError(login.error, `Sign in ${label} user`);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const profile = await service
      .from("profiles")
      .select("id")
      .eq("id", data.user.id)
      .maybeSingle();
    assertNoError(profile.error, `Read ${label} profile`);
    if (profile.data) break;
    await delay(200);
  }

  const onboarding = await client.rpc("save_onboarding_preferences", {
    profile_languages: ["English"],
    profile_genres: ["Pop"],
    profile_interface_language: "en",
  });
  assertNoError(onboarding.error, `Save ${label} onboarding`);
  return data.user;
}

async function rpc(client, name, params, context) {
  const { data, error } = await client.rpc(name, params);
  assertNoError(error, context);
  return Array.isArray(data) ? data[0] : data;
}

try {
  const owner = await createUser(ownerClient, "owner");
  const reviewer = await createUser(reviewerClient, "reviewer");

  const topUp = await service
    .from("profiles")
    .update({ credits: 2 })
    .eq("id", owner.id);
  assertNoError(topUp.error, "Top up owner for test submission");

  const songId = await rpc(
    ownerClient,
    "submit_song",
    {
      song_title: `Listening Test ${runId}`,
      song_artist_name: "First Listen Diagnostics",
      song_cover_image_url:
        "https://www.firstlisten.net/covers/default-song.svg",
      song_music_url: `https://www.youtube.com/watch?v=${runId.slice(0, 11)}`,
      song_platform: "youtube",
      song_genre: "Pop",
      song_language: "English",
      song_feedback_focus: ["Hook Strength"],
      song_country: "United States",
      song_explicit_content: false,
    },
    "Submit isolated listening song",
  );

  const session = await rpc(
    reviewerClient,
    "start_listening_session",
    { target_song_id: songId },
    "Start listening session",
  );
  assert(session.earning_eligible === true, "YouTube session was not eligible");
  record("Eligible provider starts one verified session", session);
  const repeatedStart = await rpc(
    reviewerClient,
    "start_listening_session",
    { target_song_id: songId },
    "Reuse active listening session",
  );
  assert(
    repeatedStart.session_id === session.session_id,
    "Repeated start created a duplicate active session",
  );
  record("Repeated starts reuse the active song session");

  const baseline = await rpc(
    reviewerClient,
    "record_listening_heartbeat",
    {
      target_session_id: session.session_id,
      playback_position_seconds: 1,
      playback_duration_seconds: 180,
      playback_state: "playing",
      playback_muted: false,
      playback_volume: 100,
      page_visible: true,
      page_focused: true,
      interaction_recent: true,
    },
    "Record heartbeat baseline",
  );
  assert(baseline.seconds_counted === 0, "Baseline heartbeat counted time");
  const earlyHeartbeat = await rpc(
    reviewerClient,
    "record_listening_heartbeat",
    {
      target_session_id: session.session_id,
      playback_position_seconds: 2,
      playback_duration_seconds: 180,
      playback_state: "playing",
      playback_muted: false,
      playback_volume: 100,
      page_visible: true,
      page_focused: true,
      interaction_recent: true,
    },
    "Reject early heartbeat",
  );
  assert(earlyHeartbeat.seconds_counted === 0, "Early heartbeat earned time");
  assert(
    earlyHeartbeat.warning === "Heartbeat arrived too soon.",
    "Early heartbeat did not return the rate-limit warning",
  );
  record("Rapid heartbeat calls return without earning time");

  await delay(10500);
  const muted = await rpc(
    reviewerClient,
    "record_listening_heartbeat",
    {
      target_session_id: session.session_id,
      playback_position_seconds: 11,
      playback_duration_seconds: 180,
      playback_state: "playing",
      playback_muted: true,
      playback_volume: 0,
      page_visible: true,
      page_focused: true,
      interaction_recent: true,
    },
    "Reject muted heartbeat",
  );
  assert(muted.seconds_counted === 0, "Muted playback earned time");
  record("Muted playback earns zero seconds", muted.warning);

  await delay(10500);
  const active = await rpc(
    reviewerClient,
    "record_listening_heartbeat",
    {
      target_session_id: session.session_id,
      playback_position_seconds: 21,
      playback_duration_seconds: 180,
      playback_state: "playing",
      playback_muted: false,
      playback_volume: 100,
      page_visible: true,
      page_focused: true,
      interaction_recent: true,
    },
    "Accept active heartbeat",
  );
  assert(active.seconds_counted >= 8, "Active playback did not earn time");
  record("Visible, focused, audible forward playback earns pending seconds", active);

  await delay(10500);
  const rewind = await rpc(
    reviewerClient,
    "record_listening_heartbeat",
    {
      target_session_id: session.session_id,
      playback_position_seconds: 5,
      playback_duration_seconds: 180,
      playback_state: "playing",
      playback_muted: false,
      playback_volume: 100,
      page_visible: true,
      page_focused: true,
      interaction_recent: true,
    },
    "Reject rewind heartbeat",
  );
  assert(rewind.seconds_counted === 0, "Rewind earned listening time");

  await delay(10500);
  const replay = await rpc(
    reviewerClient,
    "record_listening_heartbeat",
    {
      target_session_id: session.session_id,
      playback_position_seconds: 15,
      playback_duration_seconds: 180,
      playback_state: "playing",
      playback_muted: false,
      playback_volume: 100,
      page_visible: true,
      page_focused: true,
      interaction_recent: true,
    },
    "Reject replayed section",
  );
  assert(replay.seconds_counted === 0, "Replayed section earned listening time");
  assert(
    replay.session_verified_seconds === active.session_verified_seconds,
    "Looped playback changed verified listening time",
  );
  record("Rewound and replayed sections never earn twice", replay.warning);

  const review = await rpc(
    reviewerClient,
    "submit_review_with_listening",
    {
      reviewed_song_id: songId,
      review_listen_full: false,
      review_add_to_playlist: true,
      review_grabbed_attention: true,
      review_share_with_friend: false,
      review_rating: 8,
      review_comment:
        "The opening hook arrives quickly and the arrangement leaves enough space for the vocal to stay memorable.",
      review_pasted_comment_detected: false,
      listening_session_id: session.session_id,
    },
    "Submit review and settle listening session",
  );
  assert(review.accepted === true, "Quality review was rejected");
  assert(review.credit_granted === false, "Review automatically granted a credit");
  assert(
    review.listening_seconds_banked === active.session_verified_seconds,
    "Pending listening seconds were not settled",
  );
  record("Accepted quality review settles pending seconds into the bank", review);
  record("Review completion does not automatically grant credits");

  const reviewerProfile = await service
    .from("profiles")
    .select("credits, listening_bank_seconds, lifetime_listening_seconds")
    .eq("id", reviewer.id)
    .single();
  assertNoError(reviewerProfile.error, "Read reviewer listening balances");
  assert(reviewerProfile.data.credits === 1, "Reviewer credit changed automatically");
  assert(
    Number(reviewerProfile.data.listening_bank_seconds) ===
      review.listening_seconds_banked,
    "Listening bank balance is incorrect",
  );

  const dashboard = await rpc(
    ownerClient,
    "get_my_song_dashboard_with_listening",
    {},
    "Read artist listening analytics",
  );
  assert(
    Number(dashboard.total_listening_seconds) ===
      review.listening_seconds_banked,
    "Artist total listening time is incorrect",
  );
  record("Artist dashboard reports verified listening analytics", dashboard);

  const prepareClaim = await service
    .from("profiles")
    .update({ listening_bank_seconds: 120 * 60 })
    .eq("id", reviewer.id);
  assertNoError(prepareClaim.error, "Prepare exact reward balance");

  const claim = await rpc(
    reviewerClient,
    "claim_listening_reward",
    {},
    "Claim listening reward",
  );
  assert(claim.credits_awarded === 1, "Claim did not award one credit");
  assert(claim.credits_balance === 2, "Claimed credit balance is incorrect");
  assert(Number(claim.bank_seconds) === 0, "Claim did not spend banked minutes");
  record("Manual claim exchanges 120 minutes for exactly one credit", claim);

  const rewardRows = await service
    .from("listening_reward_claims")
    .select("credits_awarded, minutes_spent")
    .eq("user_id", reviewer.id);
  assertNoError(rewardRows.error, "Read reward claim ledger");
  assert(rewardRows.data.length === 1, "Reward claim ledger row is missing");
  record("Reward claim is recorded in an immutable ledger", rewardRows.data[0]);

  console.log(JSON.stringify({ checks, status: "passed" }, null, 2));
} finally {
  for (const userId of userIds.reverse()) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) console.error(`Cleanup failed for ${userId}: ${error.message}`);
  }
}
