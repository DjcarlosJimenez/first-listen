import "server-only";

import { displayPlatform } from "@/lib/content-economy";
import type { FirstPublishLiveSong } from "@/lib/first-publish";
import { createClient } from "@/lib/supabase/server";
import type { Platform } from "@/lib/types";

function count(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export async function getFirstPublishLiveSong(
  songId: string,
): Promise<FirstPublishLiveSong | null> {
  if (!/^[0-9a-f-]{36}$/i.test(songId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_first_publish_live_song", {
    target_song_id: songId,
  });
  if (error) {
    console.error("first publication public song lookup failed", error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const platform = displayPlatform[String(row.platform)] ?? "Other";
  if (!(["YouTube", "YouTube Music", "SoundCloud"] as Platform[]).includes(platform)) {
    return null;
  }
  return {
    artistName: String(row.artist_name ?? ""),
    contentKind: row.content_kind === "music_video" ? "music_video" : "song",
    coverImageUrl: String(row.cover_image_url ?? ""),
    expiresAt: typeof row.publication_expires_at === "string"
      ? row.publication_expires_at
      : null,
    genre: String(row.genre ?? ""),
    id: String(row.song_id),
    isOwner: Boolean(row.viewer_owns),
    musicUrl: String(row.music_url ?? ""),
    platform,
    reactions: {
      good_rhythm: count(row.good_rhythm_count),
      good_voice: count(row.good_voice_count),
      liked: count(row.liked_count),
      listen_again: count(row.listen_again_count),
    },
    retained: Boolean(row.retained),
    title: String(row.title ?? ""),
  };
}
