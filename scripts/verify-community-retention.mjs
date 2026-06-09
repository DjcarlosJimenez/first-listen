import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

async function loadLocalEnvironment() {
  try {
    const contents = await readFile(".env.local", "utf8");
    for (const line of contents.split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // CI and production environments provide variables directly.
  }
}

await loadLocalEnvironment();

const projectRef = process.env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  (projectRef ? `https://${projectRef}.supabase.co` : null);
let serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey && projectRef && accessToken) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(`Supabase key lookup failed with ${response.status}.`);
  }
  const keys = await response.json();
  serviceRoleKey = (Array.isArray(keys) ? keys : keys.api_keys ?? []).find(
    (key) =>
      key.name === "service_role" ||
      key.name === "secret" ||
      key.type === "secret",
  )?.api_key;
}

if (!url || !serviceRoleKey) {
  throw new Error("Supabase production credentials are required.");
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const [
  profilesResult,
  sessionsResult,
  remindersResult,
  songsResult,
  authResult,
] = await Promise.all([
  supabase
    .from("profiles")
    .select(
      "id, creator_activity_status, last_contribution_at, complete_listens",
    ),
  supabase
    .from("listening_sessions")
    .select(
      "id, user_id, song_id, reward_eligible, engaged_seconds, valid_listen_at, complete_listen_at",
    ),
  supabase
    .from("creator_activity_reminders")
    .select("id, user_id, reminder_stage, status"),
  supabase
    .from("songs")
    .select("id, user_id, is_active, removed_at"),
  supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
]);

for (const result of [
  profilesResult,
  sessionsResult,
  remindersResult,
  songsResult,
  authResult,
]) {
  if (result.error) throw result.error;
}

const profiles = profilesResult.data ?? [];
const sessions = sessionsResult.data ?? [];
const rewardLedgerKeys = sessions
  .filter((session) => session.reward_eligible)
  .map((session) => `${session.user_id}:${session.song_id}`);
const duplicateRewardLedgers =
  rewardLedgerKeys.length - new Set(rewardLedgerKeys).size;
const invalidActivityStatuses = profiles.filter(
  (profile) =>
    !["active", "paused", "archived"].includes(
      profile.creator_activity_status,
    ),
).length;
const invalidEngagedSeconds = sessions.filter(
  (session) => session.engaged_seconds < 0,
).length;
const authUsers = authResult.data.users;
const missingProfiles = authUsers.filter(
  (authUser) => !profiles.some((profile) => profile.id === authUser.id),
).length;

let publicProfileShapeValid = true;
const firstProfile = profiles[0];
if (firstProfile) {
  const { data, error } = await supabase.rpc("get_public_artist_profile", {
    target_artist_id: firstProfile.id,
  });
  if (error) throw error;
  const artist = Array.isArray(data) ? data[0] : data;
  publicProfileShapeValid =
    !artist ||
    [
      "valid_listens_received",
      "complete_listens_received",
      "community_rank",
      "activity_status",
    ].every((key) => Object.hasOwn(artist, key));
}

const checks = [
  {
    name: "Every Auth user has a profile",
    passed: missingProfiles === 0,
    details: { authUsers: authUsers.length, profiles: profiles.length },
  },
  {
    name: "Creator activity statuses are valid",
    passed: invalidActivityStatuses === 0,
    details: profiles.reduce((counts, profile) => {
      counts[profile.creator_activity_status] =
        (counts[profile.creator_activity_status] ?? 0) + 1;
      return counts;
    }, {}),
  },
  {
    name: "Every profile has an activity timestamp",
    passed: profiles.every((profile) => profile.last_contribution_at),
    details: profiles.filter((profile) => !profile.last_contribution_at).length,
  },
  {
    name: "One reward ledger exists per listener and song",
    passed: duplicateRewardLedgers === 0,
    details: {
      eligibleLedgers: rewardLedgerKeys.length,
      duplicateRewardLedgers,
    },
  },
  {
    name: "Engaged listening seconds are nonnegative",
    passed: invalidEngagedSeconds === 0,
    details: invalidEngagedSeconds,
  },
  {
    name: "Public artist profile exposes support metrics",
    passed: publicProfileShapeValid,
    details: publicProfileShapeValid,
  },
  {
    name: "Reminder outbox is readable to service operations",
    passed: Array.isArray(remindersResult.data),
    details: remindersResult.data?.length ?? 0,
  },
];

const passed = checks.filter((check) => check.passed).length;
const score = Math.round((passed / checks.length) * 100);
console.log(
  JSON.stringify(
    {
      score,
      status: score === 100 ? "healthy" : "needs_attention",
      checks,
      counts: {
        profiles: profiles.length,
        songs: songsResult.data?.length ?? 0,
        sessions: sessions.length,
        validListens: sessions.filter((session) => session.valid_listen_at)
          .length,
        completeListens: sessions.filter(
          (session) => session.complete_listen_at,
        ).length,
      },
    },
    null,
    2,
  ),
);

if (score !== 100) process.exitCode = 1;
