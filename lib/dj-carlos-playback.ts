import type { DjCarlosTrack } from "@/lib/dj-carlos-page";

export function nextDjCarlosQueueTrackId(
  activeTrackId: string | null | undefined,
  playQueue: readonly DjCarlosTrack[],
) {
  if (!playQueue.length) return null;
  if (!activeTrackId) return playQueue[0].id;

  const currentIndex = playQueue.findIndex(
    (track) => track.id === activeTrackId,
  );
  if (currentIndex === -1) return playQueue[0].id;

  return playQueue[(currentIndex + 1) % playQueue.length].id;
}
