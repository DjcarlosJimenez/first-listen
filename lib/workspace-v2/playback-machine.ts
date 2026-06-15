import type {
  WorkspaceV2PlaybackState,
  WorkspaceV2ProviderCommand,
  WorkspaceV2ProviderSnapshot,
  WorkspaceV2Song,
} from "./types";

export type WorkspaceV2PlaybackMachineState = {
  activeSong: WorkspaceV2Song | null;
  error: string | null;
  lastEventAt: number;
  manualPause: boolean;
  pendingCommand: WorkspaceV2ProviderCommand;
  state: WorkspaceV2PlaybackState;
};

export type WorkspaceV2PlaybackMachineEvent =
  | { type: "load"; at: number; song: WorkspaceV2Song; autoPlay: boolean }
  | { type: "provider_ready"; at: number }
  | { type: "user_play"; at: number }
  | { type: "user_pause"; at: number }
  | { type: "provider_snapshot"; at: number; snapshot: WorkspaceV2ProviderSnapshot }
  | { type: "provider_completed"; at: number; snapshot?: WorkspaceV2ProviderSnapshot }
  | { type: "provider_error"; at: number; message: string }
  | { type: "stop"; at: number };

export const initialWorkspaceV2PlaybackState: WorkspaceV2PlaybackMachineState = {
  activeSong: null,
  error: null,
  lastEventAt: 0,
  manualPause: false,
  pendingCommand: { command: "none" },
  state: "ready",
};

function snapshotState(snapshot: WorkspaceV2ProviderSnapshot) {
  return snapshot.playbackState;
}

export function reduceWorkspaceV2Playback(
  state: WorkspaceV2PlaybackMachineState,
  event: WorkspaceV2PlaybackMachineEvent,
): WorkspaceV2PlaybackMachineState {
  switch (event.type) {
    case "load":
      return {
        activeSong: event.song,
        error: null,
        lastEventAt: event.at,
        manualPause: false,
        pendingCommand: {
          autoPlay: event.autoPlay,
          command: "load",
          song: event.song,
        },
        state: "loading",
      };

    case "provider_ready":
      if (!state.activeSong) return { ...state, lastEventAt: event.at };
      if (
        state.pendingCommand.command === "load" &&
        state.pendingCommand.autoPlay &&
        !state.manualPause
      ) {
        return {
          ...state,
          error: null,
          lastEventAt: event.at,
          pendingCommand: { command: "play" },
          state: "ready",
        };
      }
      return {
        ...state,
        error: null,
        lastEventAt: event.at,
        pendingCommand:
          state.pendingCommand.command === "play"
            ? state.pendingCommand
            : { command: "none" },
        state: state.pendingCommand.command === "load" ? "ready" : state.state,
      };

    case "user_play":
      if (!state.activeSong) return { ...state, lastEventAt: event.at };
      return {
        ...state,
        error: null,
        lastEventAt: event.at,
        manualPause: false,
        pendingCommand: { command: "play" },
        state: state.state === "completed" ? "loading" : state.state,
      };

    case "user_pause":
      return {
        ...state,
        lastEventAt: event.at,
        manualPause: true,
        pendingCommand: { command: "pause" },
        state: state.activeSong ? "paused" : "ready",
      };

    case "provider_snapshot": {
      const nextState = snapshotState(event.snapshot);
      if (state.manualPause && nextState === "playing") {
        return {
          ...state,
          lastEventAt: event.at,
          pendingCommand: { command: "pause" },
          state: "paused",
        };
      }
      return {
        ...state,
        error: nextState === "error" ? state.error : null,
        lastEventAt: event.at,
        pendingCommand: { command: "none" },
        state: nextState,
      };
    }

    case "provider_completed":
      return {
        ...state,
        lastEventAt: event.at,
        pendingCommand: { command: "none" },
        state: "completed",
      };

    case "provider_error":
      return {
        ...state,
        error: event.message,
        lastEventAt: event.at,
        pendingCommand: { command: "none" },
        state: "error",
      };

    case "stop":
      return {
        ...initialWorkspaceV2PlaybackState,
        lastEventAt: event.at,
        pendingCommand: { command: "stop" },
      };

    default:
      return state;
  }
}
