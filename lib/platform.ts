import type { Platform } from "@/lib/types";

export type PlatformDetection = {
  platform: Platform | null;
  valid: boolean;
  message: string;
};

export function detectMusicPlatform(rawUrl: string): PlatformDetection {
  if (!rawUrl.trim()) {
    return {
      platform: null,
      valid: false,
      message: "Paste a public song link to detect its platform.",
    };
  }

  try {
    const url = new URL(rawUrl.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.toLowerCase();

    if (host === "open.spotify.com") {
      const valid = /^\/(?:intl-[a-z-]+\/)?track\/[a-z0-9]+/i.test(path);
      return {
        platform: "Spotify",
        valid,
        message: valid
          ? "Spotify track detected."
          : "Use a direct Spotify track link.",
      };
    }

    if (host === "music.youtube.com") {
      const valid = path === "/watch" && Boolean(url.searchParams.get("v"));
      return {
        platform: "YouTube Music",
        valid,
        message: valid
          ? "YouTube Music track detected."
          : "Use a YouTube Music watch link.",
      };
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      const valid =
        (path === "/watch" && Boolean(url.searchParams.get("v"))) ||
        path.startsWith("/shorts/");
      return {
        platform: "YouTube",
        valid,
        message: valid
          ? "YouTube video detected."
          : "Use a direct YouTube video link.",
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
      };
    }

    if (host === "soundcloud.com") {
      const parts = path.split("/").filter(Boolean);
      const valid = parts.length >= 2 && !["discover", "stream", "you"].includes(parts[0]);
      return {
        platform: "SoundCloud",
        valid,
        message: valid
          ? "SoundCloud track detected."
          : "Use a public SoundCloud track link.",
      };
    }

    return {
      platform: null,
      valid: false,
      message: "This link is not from a supported music platform.",
    };
  } catch {
    return {
      platform: null,
      valid: false,
      message: "Enter a complete URL beginning with https://.",
    };
  }
}
