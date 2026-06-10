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
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
  );
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase.rpc("database_health_report");
if (error) throw error;
const { data: listeningData, error: listeningError } = await supabase.rpc(
  "listening_system_health_report",
);
if (listeningError) throw listeningError;
const { data: discoveryData, error: discoveryError } = await supabase.rpc(
  "discovery_system_health_report",
);
if (discoveryError) throw discoveryError;
const { data: alphaData, error: alphaError } = await supabase.rpc(
  "master_alpha_health_report",
);
if (alphaError) throw alphaError;
const { data: networkData, error: networkError } = await supabase.rpc(
  "community_network_health_report",
);
if (networkError) throw networkError;
const { data: guestData, error: guestError } = await supabase.rpc(
  "guest_experience_health_report",
);
if (guestError) throw guestError;
const { data: connectedData, error: connectedError } = await supabase.rpc(
  "connected_platforms_health_report",
);
if (connectedError) throw connectedError;
const { data: economyData, error: economyError } = await supabase.rpc(
  "content_economy_health_report",
);
if (economyError) throw economyError;
const { data: songManagementData, error: songManagementError } =
  await supabase.rpc("song_management_health_report");
if (songManagementError) throw songManagementError;
const { data: engagementData, error: engagementError } = await supabase.rpc(
  "community_engagement_health_report",
);
if (engagementError) throw engagementError;
const { data: guestIdentityData, error: guestIdentityError } =
  await supabase.rpc("true_guest_identity_health_report");
if (guestIdentityError) throw guestIdentityError;
const { data: unifiedLandingData, error: unifiedLandingError } =
  await supabase.rpc("unified_landing_health_report");
if (unifiedLandingError) throw unifiedLandingError;

const report = data ?? {};
const listeningReport = listeningData ?? {};
const discoveryReport = discoveryData ?? {};
const alphaReport = alphaData ?? {};
const networkReport = networkData ?? {};
const guestReport = guestData ?? {};
const connectedReport = connectedData ?? {};
const economyReport = economyData ?? {};
const songManagementReport = songManagementData ?? {};
const engagementReport = engagementData ?? {};
const guestIdentityReport = guestIdentityData ?? {};
const unifiedLandingReport = unifiedLandingData ?? {};
const requiredPlatforms = [
  "youtube",
  "spotify",
  "youtube_music",
  "soundcloud",
  "apple_music",
  "tiktok",
];

const checks = [
  {
    name: "Required tables exist",
    passed: Object.values(report.tables ?? {}).every(Boolean),
    details: report.tables,
  },
  {
    name: "Required functions exist",
    passed: Object.values(report.functions ?? {}).every(Boolean),
    details: report.functions,
  },
  {
    name: "Required indexes exist",
    passed:
      Object.entries(report.indexes ?? {})
        .filter(([name]) => name !== "songs_unique_music_url_idx")
        .every(([, exists]) => Boolean(exists)) &&
      songManagementReport.owner_unique_index === true,
    details: {
      ...report.indexes,
      songs_owner_platform_music_url_idx:
        songManagementReport.owner_unique_index,
    },
  },
  {
    name: "RLS is enabled",
    passed: Object.values(report.rls ?? {}).every(Boolean),
    details: report.rls,
  },
  {
    name: "Music platforms are complete",
    passed:
      JSON.stringify(report.music_platform ?? []) ===
      JSON.stringify(requiredPlatforms),
    details: report.music_platform,
  },
  {
    name: "Every Auth user has a profile",
    passed: Number(report.missing_profiles ?? -1) === 0,
    details: {
      authUsers: report.auth_users,
      profiles: report.profiles,
      missingProfiles: report.missing_profiles,
    },
  },
  {
    name: "Founder counter matches unique claims",
    passed:
      Number(report.founder_counter ?? -1) ===
      Number(report.founder_claims ?? -2),
    details: {
      counter: report.founder_counter,
      claims: report.founder_claims,
    },
  },
  {
    name: "No duplicate creator song links",
    passed: Number(songManagementReport.owner_duplicate_groups ?? -1) === 0,
    details: songManagementReport.owner_duplicate_groups,
  },
  {
    name: "No orphan reviews",
    passed: Number(report.orphan_reviews ?? -1) === 0,
    details: report.orphan_reviews,
  },
  {
    name: "Listen-to-Earn tables exist",
    passed: Object.values(listeningReport.tables ?? {}).every(Boolean),
    details: listeningReport.tables,
  },
  {
    name: "Listen-to-Earn functions exist",
    passed: Object.values(listeningReport.functions ?? {}).every(Boolean),
    details: listeningReport.functions,
  },
  {
    name: "Listening settings singleton exists",
    passed: Number(listeningReport.settings_rows ?? 0) === 1,
    details: listeningReport.settings_rows,
  },
  {
    name: "All five listening levels exist",
    passed: Number(listeningReport.levels ?? 0) === 5,
    details: listeningReport.levels,
  },
  {
    name: "No duplicate active listening sessions",
    passed: Number(listeningReport.active_session_duplicates ?? -1) === 0,
    details: listeningReport.active_session_duplicates,
  },
  {
    name: "No orphan listening sessions",
    passed: Number(listeningReport.orphan_sessions ?? -1) === 0,
    details: listeningReport.orphan_sessions,
  },
  {
    name: "No negative listening balances",
    passed: Number(listeningReport.negative_balances ?? -1) === 0,
    details: listeningReport.negative_balances,
  },
  {
    name: "Discovery and community tables exist",
    passed: Object.values(discoveryReport.tables ?? {}).every(Boolean),
    details: discoveryReport.tables,
  },
  {
    name: "Exactly two Spotlight slots exist",
    passed: Number(discoveryReport.spotlight_slots ?? 0) === 2,
    details: discoveryReport.spotlight_slots,
  },
  {
    name: "Spotlight has no duplicate songs",
    passed: Number(discoveryReport.active_spotlight_duplicates ?? -1) === 0,
    details: discoveryReport.active_spotlight_duplicates,
  },
  {
    name: "Active boosts have valid schedules",
    passed: Number(discoveryReport.invalid_active_boosts ?? -1) === 0,
    details: discoveryReport.invalid_active_boosts,
  },
  {
    name: "Top 10 is marked organic-only",
    passed: discoveryReport.top_ten_is_organic === true,
    details: discoveryReport.top_ten_is_organic,
  },
  {
    name: "Master Alpha tables exist",
    passed: Object.values(alphaReport.tables ?? {}).every(Boolean),
    details: alphaReport.tables,
  },
  {
    name: "Master Alpha functions exist",
    passed: Object.values(alphaReport.functions ?? {}).every(Boolean),
    details: alphaReport.functions,
  },
  {
    name: "Master Alpha RLS is enabled",
    passed: Object.values(alphaReport.rls ?? {}).every(Boolean),
    details: alphaReport.rls,
  },
  {
    name: "Founder submission balances are valid",
    passed: Number(alphaReport.invalid_founder_submission_balances ?? -1) === 0,
    details: alphaReport.invalid_founder_submission_balances,
  },
  {
    name: "Community Point ledger matches profile balances",
    passed: Number(alphaReport.community_point_balance_mismatches ?? -1) === 0,
    details: alphaReport.community_point_balance_mismatches,
  },
  {
    name: "No orphan comment reports",
    passed: Number(alphaReport.orphan_comment_reports ?? -1) === 0,
    details: alphaReport.orphan_comment_reports,
  },
  {
    name: "No unapproved long-form content is active",
    passed: Number(alphaReport.invalid_active_long_form ?? -1) === 0,
    details: alphaReport.invalid_active_long_form,
  },
  {
    name: "Community network tables exist",
    passed: Object.values(networkReport.tables ?? {}).every(Boolean),
    details: networkReport.tables,
  },
  {
    name: "Community network functions exist",
    passed: Object.values(networkReport.functions ?? {}).every(Boolean),
    details: networkReport.functions,
  },
  {
    name: "Community network RLS is enabled",
    passed: Object.values(networkReport.rls ?? {}).every(Boolean),
    details: networkReport.rls,
  },
  {
    name: "Community visibility values are valid",
    passed: Number(networkReport.invalid_visibility_profiles ?? -1) === 0,
    details: networkReport.invalid_visibility_profiles,
  },
  {
    name: "Community events and notifications are linked",
    passed:
      Number(networkReport.orphan_support_events ?? -1) === 0 &&
      Number(networkReport.orphan_notifications ?? -1) === 0,
    details: {
      supportEvents: networkReport.orphan_support_events,
      notifications: networkReport.orphan_notifications,
    },
  },
  {
    name: "Community notifications are realtime-enabled",
    passed: networkReport.realtime_enabled === true,
    details: networkReport.realtime_enabled,
  },
  {
    name: "Guest experience tables exist",
    passed: Object.values(guestReport.tables ?? {}).every(Boolean),
    details: guestReport.tables,
  },
  {
    name: "Guest experience RLS is enabled",
    passed: Object.values(guestReport.rls ?? {}).every(Boolean),
    details: guestReport.rls,
  },
  {
    name: "Guest listening has no orphan records",
    passed: Number(guestReport.orphan_listens ?? -1) === 0,
    details: guestReport.orphan_listens,
  },
  {
    name: "Community engagement storage exists",
    passed: Object.values(engagementReport.tables ?? {}).every(Boolean),
    details: engagementReport.tables,
  },
  {
    name: "Persistent guest identities are valid",
    passed: Number(engagementReport.invalid_guest_identity ?? -1) === 0,
    details: {
      persistentGuests: engagementReport.persistent_guests,
      invalidGuestIdentity: engagementReport.invalid_guest_identity,
    },
  },
  {
    name: "Likes and valid listens satisfy fairness limits",
    passed:
      Number(engagementReport.duplicate_user_likes ?? -1) === 0 &&
      Number(engagementReport.duplicate_guest_likes ?? -1) === 0 &&
      Number(engagementReport.valid_listen_window_violations ?? -1) === 0,
    details: {
      duplicateUserLikes: engagementReport.duplicate_user_likes,
      duplicateGuestLikes: engagementReport.duplicate_guest_likes,
      validListenWindowViolations:
        engagementReport.valid_listen_window_violations,
    },
  },
  {
    name: "Guest identity and platform-link storage is healthy",
    passed:
      guestIdentityReport.platform_links_table === true &&
      Number(guestIdentityReport.songs_without_primary_link ?? -1) === 0 &&
      Number(guestIdentityReport.invalid_guest_actor_events ?? -1) === 0 &&
      Number(guestIdentityReport.guest_events_without_names ?? -1) === 0,
    details: guestIdentityReport,
  },
  {
    name: "Connected platform account storage exists",
    passed: connectedReport.table_exists === true,
    details: connectedReport.table_exists,
  },
  {
    name: "Connected platform accounts are owner-readable only",
    passed:
      connectedReport.rls_enabled === true &&
      connectedReport.owner_read_policy === true &&
      connectedReport.authenticated_select_only === true,
    details: {
      rls: connectedReport.rls_enabled,
      ownerPolicy: connectedReport.owner_read_policy,
      authenticatedSelectOnly: connectedReport.authenticated_select_only,
    },
  },
  {
    name: "Connected platform account data is valid",
    passed:
      Number(connectedReport.invalid_platforms ?? -1) === 0 &&
      Number(connectedReport.invalid_statuses ?? -1) === 0 &&
      Number(connectedReport.duplicate_accounts ?? -1) === 0 &&
      Number(connectedReport.orphan_accounts ?? -1) === 0,
    details: {
      invalidPlatforms: connectedReport.invalid_platforms,
      invalidStatuses: connectedReport.invalid_statuses,
      duplicates: connectedReport.duplicate_accounts,
      orphans: connectedReport.orphan_accounts,
    },
  },
  {
    name: "Content economy storage is complete",
    passed:
      economyReport.pricing_table === true &&
      Number(economyReport.pricing_rows ?? 0) === 3 &&
      economyReport.tiktok_enum_available === true,
    details: {
      pricingTable: economyReport.pricing_table,
      pricingRows: economyReport.pricing_rows,
      externalPlatforms: economyReport.external_platforms,
      tiktok: economyReport.tiktok_enum_available,
    },
  },
  {
    name: "Content economy functions exist",
    passed: Object.values(economyReport.functions ?? {}).every(Boolean),
    details: economyReport.functions,
  },
  {
    name: "Song classifications and grandfathered costs are valid",
    passed:
      Number(economyReport.invalid_classifications ?? -1) === 0 &&
      Number(economyReport.invalid_submission_costs ?? -1) === 0,
    details: {
      invalidClassifications: economyReport.invalid_classifications,
      invalidSubmissionCosts: economyReport.invalid_submission_costs,
    },
  },
  {
    name: "Song management storage and functions exist",
    passed:
      Object.values(songManagementReport.tables ?? {}).every(Boolean) &&
      Object.values(songManagementReport.functions ?? {}).every(Boolean),
    details: {
      tables: songManagementReport.tables,
      functions: songManagementReport.functions,
    },
  },
  {
    name: "Song management RLS is enabled",
    passed: songManagementReport.rls_enabled === true,
    details: songManagementReport.rls_enabled,
  },
  {
    name: "Song lifecycle state is valid",
    passed:
      Number(songManagementReport.invalid_archives ?? -1) === 0 &&
      Number(songManagementReport.invalid_merges ?? -1) === 0 &&
      Number(songManagementReport.removed_in_active_catalog ?? -1) === 0,
    details: {
      invalidArchives: songManagementReport.invalid_archives,
      invalidMerges: songManagementReport.invalid_merges,
      removedInActiveCatalog: songManagementReport.removed_in_active_catalog,
    },
  },
  {
    name: "Unified landing controls are healthy",
    passed:
      unifiedLandingReport.theme_row_present === true &&
      unifiedLandingReport.announcement_table_present === true &&
      unifiedLandingReport.theme_rls_enabled === true &&
      unifiedLandingReport.announcements_rls_enabled === true &&
      unifiedLandingReport.public_discovery_function_present === true &&
      unifiedLandingReport.public_activity_function_present === true &&
      unifiedLandingReport.admin_health_function_present === true,
    details: unifiedLandingReport,
  },
];

const passed = checks.filter((check) => check.passed).length;
const score = Math.round((passed / checks.length) * 100);
const result = {
  score,
  status: score === 100 ? "healthy" : score >= 80 ? "needs_attention" : "unhealthy",
  alphaReport,
  checks,
  connectedReport,
  economyReport,
  engagementReport,
  guestIdentityReport,
  songManagementReport,
  discoveryReport,
  guestReport,
  networkReport,
  report,
  listeningReport,
  unifiedLandingReport,
};

console.log(JSON.stringify(result, null, 2));
if (score !== 100) process.exitCode = 1;
