import type {
  WorkspaceV2ProviderCommand,
  WorkspaceV2ProviderEvent,
  WorkspaceV2Song,
} from "./types";

export type WorkspaceV2ProviderUnsubscribe = () => void;

export type WorkspaceV2ProviderInterface = {
  destroy: () => void;
  dispatch: (command: WorkspaceV2ProviderCommand) => void;
  getCurrentSong: () => WorkspaceV2Song | null;
  subscribe: (
    listener: (event: WorkspaceV2ProviderEvent) => void,
  ) => WorkspaceV2ProviderUnsubscribe;
};

export function createWorkspaceV2ProviderBus(): WorkspaceV2ProviderInterface {
  let currentSong: WorkspaceV2Song | null = null;
  const listeners = new Set<(event: WorkspaceV2ProviderEvent) => void>();

  return {
    destroy() {
      currentSong = null;
      listeners.clear();
    },
    dispatch(command) {
      if (command.command === "load") {
        currentSong = command.song;
      }
      if (command.command === "stop") {
        currentSong = null;
      }
    },
    getCurrentSong() {
      return currentSong;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
