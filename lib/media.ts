export const defaultCoverUrl = "/covers/default-song.svg";

const providerPageHosts = new Set([
  "music.apple.com",
  "music.youtube.com",
  "open.spotify.com",
  "soundcloud.com",
  "www.soundcloud.com",
  "www.youtube.com",
  "youtube.com",
  "youtu.be",
]);

export function safeCoverUrl(value: string | null | undefined) {
  if (!value) return defaultCoverUrl;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || providerPageHosts.has(parsed.hostname)) {
      return defaultCoverUrl;
    }
    return parsed.toString();
  } catch {
    return defaultCoverUrl;
  }
}
