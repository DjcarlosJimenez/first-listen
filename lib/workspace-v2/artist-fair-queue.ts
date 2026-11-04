import type { WorkspaceV2Song } from "./types";

function normalizedArtistKey(song: WorkspaceV2Song) {
  const artistId = String(song.artistId ?? "").trim();
  if (artistId) return `id:${artistId}`;
  return `name:${song.artist.trim().toLocaleLowerCase()}`;
}

/**
 * Preserves the server ranking inside each artist catalog while ensuring that
 * every artist receives one position before any artist receives a second one.
 */
export function buildArtistFairQueue(songs: WorkspaceV2Song[]) {
  const artistOrder: string[] = [];
  const songsByArtist = new Map<string, WorkspaceV2Song[]>();

  for (const song of songs) {
    const artistKey = normalizedArtistKey(song);
    const artistSongs = songsByArtist.get(artistKey);
    if (artistSongs) {
      artistSongs.push(song);
      continue;
    }
    artistOrder.push(artistKey);
    songsByArtist.set(artistKey, [song]);
  }

  const result: WorkspaceV2Song[] = [];
  const largestCatalog = Math.max(
    0,
    ...Array.from(songsByArtist.values(), (artistSongs) => artistSongs.length),
  );

  for (let catalogIndex = 0; catalogIndex < largestCatalog; catalogIndex += 1) {
    for (const artistKey of artistOrder) {
      const song = songsByArtist.get(artistKey)?.[catalogIndex];
      if (song) result.push(song);
    }
  }

  return result;
}

export function countQueueArtists(songs: WorkspaceV2Song[]) {
  return new Set(songs.map(normalizedArtistKey)).size;
}
