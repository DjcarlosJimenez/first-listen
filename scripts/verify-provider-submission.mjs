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

await loadLocalEnvironment();
const projectRef = process.env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!projectRef || !accessToken) {
  throw new Error("SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required.");
}

const headers = { Authorization: `Bearer ${accessToken}` };
const keyResponse = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`,
  { headers },
);
if (!keyResponse.ok) {
  throw new Error(`Supabase API key lookup failed: ${keyResponse.status}`);
}
const keys = await keyResponse.json();
const keyList = Array.isArray(keys) ? keys : keys.api_keys ?? [];
const anonKey = keyList.find((key) => key.name === "anon")?.api_key;
const serviceRoleKey = keyList.find(
  (key) => key.name === "service_role" || key.name === "secret" || key.type === "secret",
)?.api_key;
if (!anonKey || !serviceRoleKey) {
  throw new Error("Supabase API keys are unavailable.");
}

const url = `https://${projectRef}.supabase.co`;
const options = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
};
const service = createClient(url, serviceRoleKey, options);
const userClient = createClient(url, anonKey, options);
const runId = randomUUID().replaceAll("-", "");
const email = `provider-check-${runId}@example.com`;
const password = `Provider${runId.slice(0, 12)}Aa1`;
let userId = null;
let songId = null;

try {
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: {
      explicit_content_acknowledged: true,
      full_name: "Provider Submission Check",
      legal_accepted: true,
      system_bootstrap: true,
    },
  });
  if (createError || !created.user) {
    throw createError ?? new Error("Disposable Auth user was not created.");
  }
  userId = created.user.id;

  const { error: loginError } = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  if (loginError) throw loginError;

  const playlistAttempt = await userClient.rpc("submit_song", {
    song_artist_name: "Provider Check",
    song_country: "United States",
    song_cover_image_url: "",
    song_explicit_content: false,
    song_feedback_focus: ["Hook Strength"],
    song_genre: "Pop",
    song_language: "English",
    song_music_url: `https://music.youtube.com/playlist?list=PL${runId}`,
    song_platform: "youtube_music",
    song_title: "Playlist Must Be Rejected",
  });
  if (!playlistAttempt.error?.message.includes("Unsupported or invalid music link")) {
    throw new Error("A pure YouTube Music playlist was not rejected.");
  }

  const trackUrl = `https://music.youtube.com/watch?v=${runId.slice(0, 11)}&list=PL${runId}`;
  const trackAttempt = await userClient.rpc("submit_song", {
    song_artist_name: "Provider Check",
    song_country: "United States",
    song_cover_image_url: "",
    song_explicit_content: false,
    song_feedback_focus: ["Hook Strength"],
    song_genre: "Pop",
    song_language: "English",
    song_music_url: trackUrl,
    song_platform: "youtube_music",
    song_title: "Direct Track Accepted",
  });
  if (trackAttempt.error || !trackAttempt.data) {
    throw trackAttempt.error ?? new Error("Direct YouTube Music track was not submitted.");
  }
  songId = trackAttempt.data;

  const { data: song, error: songError } = await service
    .from("songs")
    .select("id, cover_image_url, music_url, platform")
    .eq("id", songId)
    .single();
  if (songError) throw songError;
  if (song.cover_image_url !== "https://www.firstlisten.net/covers/default-song.svg") {
    throw new Error("Blank cover art did not receive the production default.");
  }

  console.log(
    JSON.stringify(
      {
        blank_cover_defaulted: true,
        direct_track_with_list_accepted: song.music_url === trackUrl,
        platform: song.platform,
        pure_playlist_rejected: true,
        status: "passed",
      },
      null,
      2,
    ),
  );
} finally {
  await userClient.auth.signOut();
  if (userId) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) throw error;
  }
  if (songId) {
    const { count, error } = await service
      .from("songs")
      .select("*", { count: "exact", head: true })
      .eq("id", songId);
    if (error) throw error;
    if (count !== 0) throw new Error("Disposable song cleanup failed.");
  }
}
