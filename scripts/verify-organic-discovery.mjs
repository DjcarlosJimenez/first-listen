import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildArtistFairQueue } from "../lib/workspace-v2/artist-fair-queue.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function song(id, artistId, artist) {
  return {
    artist,
    artistId,
    coverUrl: "/icon.png",
    id,
    link: `https://www.youtube.com/watch?v=${id}`,
    playbackKind: "internal",
    platform: "YouTube",
    title: id,
  };
}

const crowdedCatalog = [
  ...Array.from({ length: 200 }, (_, index) =>
    song(`a-${index + 1}`, "artist-a", "Artist A"),
  ),
  song("b-1", "artist-b", "Artist B"),
  song("b-2", "artist-b", "Artist B"),
  song("c-1", "artist-c", "Artist C"),
];

const fairQueue = buildArtistFairQueue(crowdedCatalog);
assert.deepEqual(
  fairQueue.slice(0, 3).map((entry) => entry.artistId),
  ["artist-a", "artist-b", "artist-c"],
  "Every artist must receive one position before Artist A repeats.",
);
assert.equal(fairQueue.length, crowdedCatalog.length);
assert.equal(new Set(fairQueue.map((entry) => entry.id)).size, crowdedCatalog.length);

const simplePreview = fs.readFileSync(
  path.join(root, "components/workspace-v2/first-listen-simple-preview.tsx"),
  "utf8",
);
assert.match(simplePreview, /Sí, reproducir/);
assert.match(simplePreview, /Ahora no/);
assert.match(simplePreview, /Tal vez después/);
assert.match(simplePreview, /No es para mí/);
assert.match(simplePreview, /Escuchas verificadas/);
assert.match(simplePreview, /no entrega tokens/);
assert.match(simplePreview, /playNext\(continuousPlayback\)/);
assert.match(simplePreview, /pausedByUserRef\.current = true/);
assert.match(simplePreview, /snapshot\.playbackState === "playing"/);
assert.doesNotMatch(simplePreview, /preserveAutoPlayOnProviderPause/);
assert.doesNotMatch(simplePreview, /Reclamar token/);

const memberWorkspaceRoute = fs.readFileSync(
  path.join(root, "app/workspace-v2/page.tsx"),
  "utf8",
);
const guestWorkspaceRoute = fs.readFileSync(
  path.join(root, "app/workspace-v2/guest/page.tsx"),
  "utf8",
);
assert.match(memberWorkspaceRoute, /redirect\("\/dashboard"\)/);
assert.match(guestWorkspaceRoute, /redirect\("\/guest"\)/);

console.log("Organic discovery verification passed.");
