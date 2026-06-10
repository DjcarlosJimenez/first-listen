import type { Platform } from "@/lib/types";

export type PlatformDetection = {
  platform: Platform | null;
  valid: boolean;
  message: string;
  parsedUrl: string | null;
  resourceId: string | null;
  resourceType: "track" | "video" | "playlist" | null;
};

export function detectMusicPlatform(rawUrl: string): PlatformDetection {
  if (!rawUrl.trim()) {
    return {
      platform: null,
      valid: false,
      message: "Paste a public song link to detect its platform.",
      parsedUrl: null,
      resourceId: null,
      resourceType: null,
    };
  }

  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== "https:") {
      return {
        platform: null,
        valid: false,
        message: "Use a secure URL beginning with https://.",
        parsedUrl: null,
        resourceId: null,
        resourceType: null,
      };
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname;
    const normalizedPath = path.toLowerCase();

    if (host === "open.spotify.com") {
      const valid = /^\/(?:intl-[a-z-]+\/)?track\/[a-z0-9]+/i.test(normalizedPath);
      return {
        platform: "Spotify",
        valid,
        message: valid
          ? "Spotify track detected."
          : "Use a direct Spotify track link.",
        parsedUrl: valid ? url.toString() : null,
        resourceId: valid ? path.split("/").filter(Boolean).at(-1) ?? null : null,
        resourceType: valid ? "track" : null,
      };
    }

    if (host === "music.youtube.com") {
      const videoId = normalizedPath === "/watch" ? url.searchParams.get("v") : null;
      const playlistId = url.searchParams.get("list");
      const valid = Boolean(videoId);
      return {
        platform: "YouTube Music",
        valid,
        message: videoId
          ? "YouTube Music track detected."
          : playlistId
            ? "Playlist links cannot identify one reviewable song. Open the song and copy its watch?v= track link."
            : "Use a direct YouTube Music track link containing watch?v=.",
        parsedUrl: videoId || playlistId ? url.toString() : null,
        resourceId: videoId ?? playlistId,
        resourceType: videoId ? "track" : playlistId ? "playlist" : null,
      };
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      const videoId =
        normalizedPath === "/watch"
          ? url.searchParams.get("v")
          : normalizedPath.startsWith("/shorts/")
            ? path.split("/").filter(Boolean)[1] ?? null
            : null;
      const playlistId =
        normalizedPath === "/playlist" ? url.searchParams.get("list") : null;
      const valid = Boolean(videoId);
      return {
        platform: "YouTube",
        valid,
        message: videoId
          ? "YouTube video detected."
          : playlistId
            ? "Playlist links cannot identify one reviewable song. Open the song and copy its video link."
            : "Use a direct YouTube video link.",
        parsedUrl: videoId || playlistId ? url.toString() : null,
        resourceId: videoId ?? playlistId,
        resourceType: videoId ? "video" : playlistId ? "playlist" : null,
      };
    }

    if (host === "youtu.be") {
      const valid = path.split("/").filter(Boolean).length === 1;
      return {
        platform: "YouTube",
        valid,
        message: valid
          ? "YouTube video detected."
          : "Use a direct youtu.be link.",
        parsedUrl: valid ? url.toString() : null,
        resourceId: valid ? path.split("/").filter(Boolean)[0] ?? null : null,
        resourceType: valid ? "video" : null,
      };
    }

    if (host === "soundcloud.com") {
      const parts = path.split("/").filter(Boolean);
      const valid =
        parts.length >= 2 &&
        !["discover", "stream", "you"].includes(parts[0].toLowerCase());
      return {
        platform: "SoundCloud",
        valid,
        message: valid
          ? "SoundCloud track detected."
          : "Use a public SoundCloud track link.",
        parsedUrl: valid ? url.toString() : null,
        resourceId: valid ? parts.slice(0, 2).join("/") : null,
        resourceType: valid ? "track" : null,
      };
    }

    if (host === "music.apple.com") {
      const parts = path.split("/").filter(Boolean);
      const valid =
        parts.length >= 3 &&
        ["album", "song"].includes(parts[1].toLowerCase()) &&
        (Boolean(url.searchParams.get("i")) || parts[1].toLowerCase() === "song");
      return {
        platform: "Apple Music",
        valid,
        message: valid
          ? "Apple Music track detected."
          : "Use a direct Apple Music song link.",
        parsedUrl: valid ? url.toString() : null,
        resourceId: valid
          ? url.searchParams.get("i") ?? parts.at(-1) ?? null
          : null,
        resourceType: valid ? "track" : null,
      };
    }

    if (
      host === "tiktok.com" ||
      host === "m.tiktok.com" ||
      host === "vm.tiktok.com" ||
      host === "vt.tiktok.com"
    ) {
      const parts = path.split("/").filter(Boolean);
      const directVideo =
        parts.length >= 3 &&
        parts[0].startsWith("@") &&
        parts[1].toLowerCase() === "video" &&
        /^[0-9]+$/.test(parts[2]);
      const shortLink =
        (host === "vm.tiktok.com" || host === "vt.tiktok.com") &&
        parts.length >= 1;
      const valid = directVideo || shortLink;
      return {
        platform: "TikTok",
        valid,
        message: valid
          ? "TikTok video detected."
          : "Use a direct public TikTok video link.",
        parsedUrl: valid ? url.toString() : null,
        resourceId: directVideo ? parts[2] : shortLink ? parts[0] : null,
        resourceType: valid ? "video" : null,
      };
    }

    return {
      platform: null,
      valid: false,
      message: "This link is not from a supported music platform.",
      parsedUrl: null,
      resourceId: null,
      resourceType: null,
    };
  } catch {
    return {
      platform: null,
      valid: false,
      message: "Enter a complete URL beginning with https://.",
      parsedUrl: null,
      resourceId: null,
      resourceType: null,
    };
  }
}
