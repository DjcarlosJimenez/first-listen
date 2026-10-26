import assert from "node:assert/strict";
import {
  normalizeDjCarlosVideoPlayCounts,
  sameDjCarlosRhythm,
  sortDjCarlosOfficialVideos,
  uniqueDjCarlosRhythms,
} from "../lib/dj-carlos-page.ts";

function video(id, mood) {
  return {
    artist: "DJ Carlos Jimenez",
    coverUrl: "https://example.com/cover.jpg",
    id,
    link: "https://www.youtube.com/watch?v=abcdefghijk",
    mood,
    platform: "YouTube",
    release: "DJ Carlos Jimenez",
    section: "official-video",
    subtitle: "Video oficial",
    title: id,
  };
}

const videos = [
  video("video-a", "Cumbia Sonidera"),
  video("video-b", "Bachata"),
  video("video-c", "Cumbia Sonidera"),
];

assert.deepEqual(
  sortDjCarlosOfficialVideos(videos, {}, "official").map(({ id }) => id),
  ["video-a", "video-b", "video-c"],
  "El orden oficial debe conservar exactamente el orden del administrador.",
);

const counts = normalizeDjCarlosVideoPlayCounts({
  "video-a": { recent: -3, total: "invalid" },
  "video-b": { recent: 4.8, total: 8 },
  "video-c": { recent: 4, total: 12 },
});
assert.deepEqual(counts["video-a"], { recent: 0, total: 0 });
assert.deepEqual(counts["video-b"], { recent: 4, total: 8 });
assert.deepEqual(
  sortDjCarlosOfficialVideos(videos, counts, "popular").map(({ id }) => id),
  ["video-c", "video-b", "video-a"],
  "Mas reproducidos debe ordenar por reproducciones recientes, total y orden oficial.",
);

assert.deepEqual(uniqueDjCarlosRhythms(videos.map(({ mood }) => mood)), [
  "Cumbia Sonidera",
  "Bachata",
]);
assert.equal(sameDjCarlosRhythm(" bachata ", "Bachata"), true);

console.log("DJ Carlos video library verification passed.");
