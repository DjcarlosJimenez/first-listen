import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

const report = data ?? {};
const requiredPlatforms = [
  "youtube",
  "spotify",
  "youtube_music",
  "soundcloud",
  "apple_music",
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
    passed: Object.values(report.indexes ?? {}).every(Boolean),
    details: report.indexes,
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
    name: "No duplicate active song links",
    passed: Number(report.duplicate_active_song_urls ?? -1) === 0,
    details: report.duplicate_active_song_urls,
  },
  {
    name: "No orphan reviews",
    passed: Number(report.orphan_reviews ?? -1) === 0,
    details: report.orphan_reviews,
  },
];

const passed = checks.filter((check) => check.passed).length;
const score = Math.round((passed / checks.length) * 100);
const result = {
  score,
  status: score === 100 ? "healthy" : score >= 80 ? "needs_attention" : "unhealthy",
  checks,
  report,
};

console.log(JSON.stringify(result, null, 2));
if (score !== 100) process.exitCode = 1;
