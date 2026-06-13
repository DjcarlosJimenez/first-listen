const DISMISSALS_KEY = "first-listen-youtube-music-discovery-dismissals";

type DiscoveryPlatform = "YouTube Music" | string | null | undefined;

function readDismissals(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DISMISSALS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, boolean>)
      : {};
  } catch {
    return {};
  }
}

export function youtubeMusicDiscoveryDismissed(songId: string) {
  return Boolean(readDismissals()[songId]);
}

export function dismissYoutubeMusicDiscovery(songId: string) {
  if (typeof window === "undefined") return;
  const next = { ...readDismissals(), [songId]: true };
  window.localStorage.setItem(DISMISSALS_KEY, JSON.stringify(next));
}

export function shouldShowYoutubeMusicDiscoveryRecommendation({
  primaryPlatform,
  savedPlatform,
  songId,
}: {
  primaryPlatform: DiscoveryPlatform;
  savedPlatform: DiscoveryPlatform;
  songId: string;
}) {
  return (
    savedPlatform === "YouTube Music" &&
    primaryPlatform !== "YouTube Music" &&
    !youtubeMusicDiscoveryDismissed(songId)
  );
}
