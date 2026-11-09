import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const migration = read("supabase/migrations/20261108020000_conservative_communications.sql");
const policy = read("lib/communications.ts");
const cronRoute = read("app/api/communications/run/route.ts");
const preferences = read("components/user-music-library.tsx");
const simpleHome = read("components/workspace-v2/first-listen-simple-preview.tsx");
const twaManifest = JSON.parse(read("android/twa/twa-manifest.json"));
const androidManifest = read("android/twa/app/src/main/AndroidManifest.xml");
const vercel = JSON.parse(read("vercel.json"));

assert.match(migration, /unique \(user_id, event_key\)/);
assert.match(migration, /push_music_updates_enabled boolean not null default false/);
assert.match(migration, /digest_interval_days in \(14, 30\)/);
assert.match(policy, /MINIMUM_EXTERNAL_CONTACT_DAYS = 14/);
assert.match(policy, /List-Unsubscribe-Post/);
assert.match(cronRoute, /COMMUNICATIONS_DELIVERY_ENABLED !== "true"/);
assert.match(cronRoute, /activeMembersKeptInApp/);
assert.match(cronRoute, /singleChannelPerEvent: true/);
assert.match(preferences, /Máximo 1 contacto externo cada 14 días/);
assert.match(preferences, /push_updates_enabled: false/);
assert.match(simpleHome, /get_my_communication_preferences/);
assert.equal(twaManifest.enableNotifications, false);
assert.doesNotMatch(androidManifest, /POST_NOTIFICATIONS/);
assert.deepEqual(vercel.crons, [{ path: "/api/communications/run", schedule: "0 15 * * *" }]);

console.log(JSON.stringify({
  androidPushPermission: "unchanged_and_disabled",
  deliveryDefault: "disabled",
  externalContactMinimumDays: 14,
  scheduledCheck: "daily",
  singleChannelPerEvent: true,
  status: "passed",
}, null, 2));
