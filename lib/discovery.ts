import type { Platform, Song } from "@/lib/types";

export const platformLabels: Record<string, Platform> = {
  spotify: "Spotify",
  youtube: "YouTube",
  youtube_music: "YouTube Music",
  soundcloud: "SoundCloud",
  apple_music: "Apple Music",
};

export function getDiscoveryLinks(song: Pick<Song, "artist" | "title" | "link" | "platform">) {
  const query = encodeURIComponent(`${song.artist} ${song.title}`);

  return {
    spotify:
      song.platform === "Spotify"
        ? song.link
        : `https://open.spotify.com/search/${query}`,
    youtube:
      song.platform === "YouTube" || song.platform === "YouTube Music"
        ? song.link
        : `https://www.youtube.com/results?search_query=${query}`,
    apple:
      song.platform === "Apple Music"
        ? song.link
        : `https://music.apple.com/us/search?term=${query}`,
  };
}

export function getInitials(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "FL";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}
