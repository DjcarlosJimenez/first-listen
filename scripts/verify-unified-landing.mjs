import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

const contents = await readFile(".env.local", "utf8");
for (const line of contents.split(/\r?\n/)) {
  if (!line || line.trimStart().startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator < 1) continue;
  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (!process.env[key]) process.env[key] = value;
}

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
  throw new Error(`Supabase key lookup failed (${keyResponse.status}).`);
}
const keyPayload = await keyResponse.json();
const keys = Array.isArray(keyPayload) ? keyPayload : keyPayload.api_keys ?? [];
const anonKey = keys.find((key) => key.name === "anon")?.api_key;
if (!anonKey) throw new Error("Supabase anonymous key is unavailable.");

const supabase = createClient(
  `https://${projectRef}.supabase.co`,
  anonKey,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const [
  theme,
  announcements,
  discovery,
  activity,
  directTheme,
  blockedAnnouncements,
] = await Promise.all([
  supabase.rpc("get_platform_theme"),
  supabase.rpc("get_active_platform_announcements"),
  supabase.rpc("get_public_discovery_feed", { feed_limit: 8 }),
  supabase.rpc("get_public_community_activity", { activity_limit: 12 }),
  supabase.from("platform_theme_settings").select("preset"),
  supabase.from("platform_announcements").select("id").limit(1),
]);

for (const [label, result] of [
  ["Theme RPC", theme],
  ["Announcement RPC", announcements],
  ["Discovery RPC", discovery],
  ["Community activity RPC", activity],
  ["Public theme read", directTheme],
]) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}
if (!blockedAnnouncements.error) {
  throw new Error("Anonymous callers can read announcement storage directly.");
}

console.log(
  JSON.stringify(
    {
      score: 100,
      theme: theme.data?.[0]?.preset ?? null,
      activeAnnouncements: announcements.data?.length ?? 0,
      discoveryCards: discovery.data?.length ?? 0,
      communityEvents: activity.data?.length ?? 0,
      announcementStorageProtected: true,
    },
    null,
    2,
  ),
);

