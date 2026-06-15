import assert from "node:assert/strict";
import {
  initialWorkspaceV2PlaybackState,
  reduceWorkspaceV2Playback,
} from "../lib/workspace-v2/playback-machine.ts";
import {
  activeWorkspaceV2Song,
  buildWorkspaceV2ContinuousQueue,
  initialWorkspaceV2QueueState,
  reduceWorkspaceV2Queue,
  workspaceV2CanAdvance,
} from "../lib/workspace-v2/queue-machine.ts";
import {
  initialWorkspaceV2ValidationState,
  reduceWorkspaceV2Validation,
} from "../lib/workspace-v2/validation-machine.ts";
import {
  initialWorkspaceV2TelemetryState,
  reduceWorkspaceV2Telemetry,
} from "../lib/workspace-v2/telemetry-machine.ts";

const now = 1_000_000;

function song(id, playbackKind, lastHeardAt = null) {
  return {
    artist: `Artist ${id}`,
    coverUrl: "/icon.png",
    durationSeconds: 120,
    id,
    lastHeardAt,
    link: `https://example.com/${id}`,
    playbackKind,
    platform: playbackKind === "internal" ? "YouTube Music" : "Spotify",
    title: `Song ${id}`,
  };
}

function sample(at, currentTime, playbackState = "playing") {
  return {
    at,
    currentTime,
    duration: 120,
    muted: false,
    playbackState,
    supported: true,
    volume: 80,
  };
}

const queue = buildWorkspaceV2ContinuousQueue({
  mode: "discovery",
  now,
  previousConsumedSongIds: ["internal-old"],
  queueId: "test-queue",
  songs: [
    song("external-1", "external"),
    song("internal-old", "internal", now - 1000),
    song("internal-new", "internal"),
    song("internal-replay", "internal", now - 1000 * 60 * 60 * 48),
  ],
  source: "featured",
  title: "Featured",
});

assert.equal(queue.songs[0].id, "internal-new");
assert.equal(queue.songs.some((item) => item.playbackKind === "external"), false);

let queueState = reduceWorkspaceV2Queue(initialWorkspaceV2QueueState, {
  at: now,
  queue: {
    ...queue,
    songs: [song("external-load", "external"), ...queue.songs],
  },
  type: "load_queue",
});
assert.equal(activeWorkspaceV2Song(queueState)?.id, "internal-new");
assert.equal(queueState.activeQueue?.songs.some((item) => item.playbackKind === "external"), false);
assert.equal(workspaceV2CanAdvance(queueState), true);

let playback = reduceWorkspaceV2Playback(initialWorkspaceV2PlaybackState, {
  at: now,
  autoPlay: true,
  song: activeWorkspaceV2Song(queueState),
  type: "load",
});
assert.equal(playback.state, "loading");
assert.equal(playback.pendingCommand.command, "load");

playback = reduceWorkspaceV2Playback(playback, {
  at: now + 100,
  type: "provider_ready",
});
assert.equal(playback.state, "ready");
assert.equal(playback.pendingCommand.command, "play");

playback = reduceWorkspaceV2Playback(playback, {
  at: now + 200,
  snapshot: sample(now + 200, 1),
  type: "provider_snapshot",
});
assert.equal(playback.state, "playing");

let validation = reduceWorkspaceV2Validation(initialWorkspaceV2ValidationState, {
  at: now,
  song: activeWorkspaceV2Song(queueState),
  type: "start",
});
let telemetry = initialWorkspaceV2TelemetryState;

for (let second = 1; second <= 31; second += 1) {
  const eventAt = now + second * 1000;
  validation = reduceWorkspaceV2Validation(validation, {
    at: eventAt,
    snapshot: sample(eventAt, second),
    type: "sample",
  });
  telemetry = reduceWorkspaceV2Telemetry(telemetry, {
    at: eventAt,
    snapshot: sample(eventAt, second),
    type: "validated_sample",
    validation,
  });
}

assert.equal(validation.validListen, true);
assert.equal(validation.fairSkipAvailable, true);
assert.equal(telemetry.validListen, true);
assert.equal(Math.round(telemetry.currentProgressSeconds), 31);

playback = reduceWorkspaceV2Playback(playback, {
  at: now + 32_000,
  type: "user_pause",
});
assert.equal(playback.state, "paused");
assert.equal(playback.manualPause, true);
playback = reduceWorkspaceV2Playback(playback, {
  at: now + 33_000,
  snapshot: sample(now + 33_000, 33, "playing"),
  type: "provider_snapshot",
});
assert.equal(playback.state, "paused");
assert.equal(playback.pendingCommand.command, "pause");

queueState = reduceWorkspaceV2Queue(queueState, {
  at: now + 34_000,
  reason: "completed",
  type: "consume_current",
});
assert.equal(queueState.consumedSongIds.includes("internal-new"), true);

queueState = reduceWorkspaceV2Queue(queueState, {
  at: now + 35_000,
  reason: "ended",
  type: "advance",
});
assert.equal(activeWorkspaceV2Song(queueState)?.id, "internal-replay");

console.log("Workspace V2 machine verification passed.");
