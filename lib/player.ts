import type { Platform } from "@/lib/types";
import { isExternalPlatform } from "@/lib/content-economy";
import { detectMusicPlatform } from "@/lib/platform";

export type ProviderEmbed = {
  src: string;
  title: string;
  telemetry:
    | "youtube_iframe_api"
    | "spotify_iframe_api"
    | "soundcloud_widget_api"
    | "apple_embed_only";
};

function youtubeVideoId(url: URL) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const pathParts = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") return pathParts[0] ?? null;
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") return url.searchParams.get("v");
    if (pathParts[0] === "shorts" || pathParts[0] === "embed") {
      return pathParts[1] ?? null;
    }
  }
  return null;
}

export function getProviderEmbed(
  rawUrl: string,
  platform: Platform,
  origin?: string,
  autoPlay = false,
): ProviderEmbed | null {
  try {
    const url = new URL(rawUrl);
    const detection = detectMusicPlatform(rawUrl);
    if (!detection.valid || detection.platform !== platform) return null;
    if (isExternalPlatform(platform)) return null;

    if (platform === "YouTube" || platform === "YouTube Music") {
      const playlistId =
        detection.resourceType === "playlist" ? detection.resourceId : null;
      const videoId = youtubeVideoId(url);
      if (
        (!videoId || !/^[A-Za-z0-9_-]{6,}$/.test(videoId)) &&
        (!playlistId || !/^[A-Za-z0-9_-]{6,}$/.test(playlistId))
      ) {
        return null;
      }
      const params = new URLSearchParams({
        controls: "1",
        enablejsapi: "1",
        playsinline: "1",
        rel: "0",
        modestbranding: "1",
        autoplay: autoPlay ? "1" : "0",
      });
      if (origin) params.set("origin", origin);
      if (playlistId) {
        params.set("listType", "playlist");
        params.set("list", playlistId);
      }
      return {
        src: playlistId
          ? `https://www.youtube-nocookie.com/embed?${params}`
          : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId ?? "")}?${params}`,
        title: `${platform} player`,
        telemetry: "youtube_iframe_api",
      };
    }

    if (platform === "SoundCloud") {
      const params = new URLSearchParams({
        url: url.toString(),
        color: "#c8ff4f",
        auto_play: autoPlay ? "true" : "false",
        hide_related: "true",
        show_comments: "false",
        show_user: "true",
        show_reposts: "false",
        visual: "true",
      });
      return {
        src: `https://w.soundcloud.com/player/?${params}`,
        title: "SoundCloud player",
        telemetry: "soundcloud_widget_api",
      };
    }

  } catch {
    return null;
  }

  return null;
}
