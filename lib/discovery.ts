import type { Platform, Song, SongPlatformLink } from "@/lib/types";
import { displayPlatform } from "@/lib/content-economy";

export const platformLabels: Record<string, Platform> = displayPlatform;

export const preferredPlatformOrder: Platform[] = [
  "YouTube Music",
  "YouTube",
  "Spotify",
  "Apple Music",
  "TikTok",
  "SoundCloud",
];

export function sortPlatformLinks(links: SongPlatformLink[]) {
  return [...links].sort((left, right) => {
    const leftIndex = preferredPlatformOrder.indexOf(left.platform);
    const rightIndex = preferredPlatformOrder.indexOf(right.platform);
    return (
      (leftIndex === -1 ? 99 : leftIndex) -
        (rightIndex === -1 ? 99 : rightIndex) ||
      Number(right.primary) - Number(left.primary) ||
      right.confidenceScore - left.confidenceScore
    );
  });
}

export function getPrimaryPlatformLinks(
  song: Pick<Song, "link" | "platform" | "platformLinks">,
) {
  const links = song.platformLinks?.length
    ? song.platformLinks
    : [
        {
          platform: song.platform,
          url: song.link,
          primary: true,
          resolutionSource: "submitted" as const,
          confidenceScore: 100,
        },
      ];
  return sortPlatformLinks(links);
}

export function platformSearchUrl(
  platform: Platform,
  artist: string,
  title: string,
) {
  const query = encodeURIComponent(`${artist} ${title}`);
  if (platform === "Spotify") return `https://open.spotify.com/search/${query}`;
  if (platform === "Apple Music") {
    return `https://music.apple.com/us/search?term=${query}`;
  }
  if (platform === "TikTok") {
    return `https://www.tiktok.com/search?q=${query}`;
  }
  if (platform === "SoundCloud") {
    return `https://soundcloud.com/search?q=${query}`;
  }
  return `https://www.youtube.com/results?search_query=${query}`;
}

export function getDiscoveryLinks(
  song: Pick<Song, "artist" | "title" | "link" | "platform" | "platformLinks">,
) {
  const query = encodeURIComponent(`${song.artist} ${song.title}`);
  const links = getPrimaryPlatformLinks(song);
  const byPlatform = new Map(links.map((link) => [link.platform, link.url]));

  return {
    spotify: byPlatform.get("Spotify") ?? `https://open.spotify.com/search/${query}`,
    youtube:
      byPlatform.get("YouTube") ??
      byPlatform.get("YouTube Music") ??
      `https://www.youtube.com/results?search_query=${query}`,
    apple:
      byPlatform.get("Apple Music") ??
      `https://music.apple.com/us/search?term=${query}`,
  };
}

export function getInitials(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "FL";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}
