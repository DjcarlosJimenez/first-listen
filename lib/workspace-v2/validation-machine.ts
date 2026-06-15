import type {
  WorkspaceV2ProviderSnapshot,
  WorkspaceV2Song,
} from "./types";

export type WorkspaceV2ValidationState = {
  activeSongId: string | null;
  completeListen: boolean;
  durationSeconds: number;
  eligibleSeconds: number;
  fairSkipAvailable: boolean;
  lastRejectionReason: string | null;
  lastSampleAt: number;
  lastSamplePosition: number;
  minimumListenSeconds: number;
  progressSeconds: number;
  validListen: boolean;
};

export type WorkspaceV2ValidationEvent =
  | { type: "start"; at: number; song: WorkspaceV2Song }
  | { type: "sample"; at: number; snapshot: WorkspaceV2ProviderSnapshot }
  | { type: "reset"; at: number };

export const initialWorkspaceV2ValidationState: WorkspaceV2ValidationState = {
  activeSongId: null,
  completeListen: false,
  durationSeconds: 0,
  eligibleSeconds: 0,
  fairSkipAvailable: false,
  lastRejectionReason: null,
  lastSampleAt: 0,
  lastSamplePosition: 0,
  minimumListenSeconds: 30,
  progressSeconds: 0,
  validListen: false,
};

function minimumListenSeconds(durationSeconds: number) {
  if (durationSeconds <= 0) return 30;
  return Math.max(15, Math.min(30, durationSeconds * 0.25));
}

function rejectionReason(snapshot: WorkspaceV2ProviderSnapshot) {
  if (!snapshot.supported) return "PROVIDER_TELEMETRY_UNSUPPORTED";
  if (snapshot.playbackState === "paused") return "PLAYBACK_PAUSED";
  if (snapshot.playbackState === "error") return "PLAYBACK_ERROR";
  if (snapshot.muted) return "PLAYBACK_MUTED";
  if ((snapshot.volume ?? 100) <= 0) return "VOLUME_ZERO";
  if (snapshot.playbackState !== "playing" && snapshot.playbackState !== "completed") {
    return "PLAYBACK_NOT_PROGRESSING";
  }
  return null;
}

function eligibleDelta(
  state: WorkspaceV2ValidationState,
  snapshot: WorkspaceV2ProviderSnapshot,
) {
  const reason = rejectionReason(snapshot);
  if (reason || state.lastSampleAt <= 0) return 0;
  if (snapshot.currentTime < state.lastSamplePosition) return 0;
  const wallDelta = Math.max(0, (snapshot.at - state.lastSampleAt) / 1000);
  const progressDelta = Math.max(0, snapshot.currentTime - state.lastSamplePosition);
  const delta = Math.min(wallDelta + 1, progressDelta);
  return delta > 0 && delta <= 5 ? delta : 0;
}

export function reduceWorkspaceV2Validation(
  state: WorkspaceV2ValidationState,
  event: WorkspaceV2ValidationEvent,
): WorkspaceV2ValidationState {
  switch (event.type) {
    case "start": {
      const duration = Math.max(0, Number(event.song.durationSeconds ?? 0));
      return {
        ...initialWorkspaceV2ValidationState,
        activeSongId: event.song.id,
        durationSeconds: duration,
        lastSampleAt: event.at,
        minimumListenSeconds: minimumListenSeconds(duration),
      };
    }

    case "sample": {
      if (!state.activeSongId) return state;
      const snapshot = event.snapshot;
      const durationSeconds = Math.max(
        state.durationSeconds,
        snapshot.duration,
      );
      const minimum = minimumListenSeconds(durationSeconds);
      const delta = eligibleDelta(state, snapshot);
      const eligibleSeconds = state.eligibleSeconds + delta;
      const progressSeconds = Math.max(state.progressSeconds, snapshot.currentTime);
      const completeListen =
        snapshot.playbackState === "completed" ||
        (durationSeconds > 0 && progressSeconds >= durationSeconds - 0.75);
      return {
        ...state,
        completeListen,
        durationSeconds,
        eligibleSeconds,
        fairSkipAvailable: eligibleSeconds >= minimum,
        lastRejectionReason: delta > 0 ? null : rejectionReason(snapshot),
        lastSampleAt: event.at,
        lastSamplePosition: snapshot.currentTime,
        minimumListenSeconds: minimum,
        progressSeconds,
        validListen: eligibleSeconds >= minimum,
      };
    }

    case "reset":
      return {
        ...initialWorkspaceV2ValidationState,
        lastSampleAt: event.at,
      };

    default:
      return state;
  }
}
