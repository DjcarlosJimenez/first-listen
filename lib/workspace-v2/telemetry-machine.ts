import type {
  WorkspaceV2PlaybackState,
  WorkspaceV2ProviderSnapshot,
} from "./types";
import type { WorkspaceV2ValidationState } from "./validation-machine";

export type WorkspaceV2TelemetryState = {
  currentProgressSeconds: number;
  durationSeconds: number;
  lastUpdatedAt: number;
  lastProviderAt: number;
  pageFocused: boolean | null;
  pageVisible: boolean | null;
  playbackState: WorkspaceV2PlaybackState;
  rewardEligibleSeconds: number;
  timeLiveSeconds: number;
  validListen: boolean;
};

export type WorkspaceV2TelemetryEvent =
  | {
      type: "validated_sample";
      at: number;
      snapshot: WorkspaceV2ProviderSnapshot;
      validation: WorkspaceV2ValidationState;
    }
  | { type: "reset"; at: number };

export const initialWorkspaceV2TelemetryState: WorkspaceV2TelemetryState = {
  currentProgressSeconds: 0,
  durationSeconds: 0,
  lastUpdatedAt: 0,
  lastProviderAt: 0,
  pageFocused: null,
  pageVisible: null,
  playbackState: "ready",
  rewardEligibleSeconds: 0,
  timeLiveSeconds: 0,
  validListen: false,
};

export function reduceWorkspaceV2Telemetry(
  state: WorkspaceV2TelemetryState,
  event: WorkspaceV2TelemetryEvent,
): WorkspaceV2TelemetryState {
  switch (event.type) {
    case "validated_sample":
      return {
        currentProgressSeconds: event.validation.progressSeconds,
        durationSeconds: event.validation.durationSeconds || event.snapshot.duration,
        lastProviderAt: event.snapshot.at,
        lastUpdatedAt: event.at,
        pageFocused: event.snapshot.pageFocused ?? null,
        pageVisible: event.snapshot.pageVisible ?? null,
        playbackState: event.snapshot.playbackState,
        rewardEligibleSeconds: event.validation.eligibleSeconds,
        timeLiveSeconds:
          event.snapshot.playbackState === "playing"
            ? event.validation.progressSeconds
            : state.timeLiveSeconds,
        validListen: event.validation.validListen,
      };

    case "reset":
      return {
        ...initialWorkspaceV2TelemetryState,
        lastUpdatedAt: event.at,
      };

    default:
      return state;
  }
}
