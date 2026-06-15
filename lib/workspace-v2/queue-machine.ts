import type {
  WorkspaceV2Queue,
  WorkspaceV2QueueMode,
  WorkspaceV2QueueSource,
  WorkspaceV2Song,
} from "./types";

export type WorkspaceV2QueueMachineState = {
  activeQueue: WorkspaceV2Queue | null;
  consumedSongIds: string[];
  currentIndex: number;
  lastAdvanceReason: string | null;
  lastUpdatedAt: number;
};

export type WorkspaceV2QueueMachineEvent =
  | { type: "load_queue"; at: number; queue: WorkspaceV2Queue; startIndex?: number }
  | { type: "advance"; at: number; reason: "ended" | "next" | "skip" | "error" }
  | { type: "consume_current"; at: number; reason: "valid_listen" | "completed" | "manual" }
  | { type: "replace_current_song"; at: number; song: WorkspaceV2Song }
  | { type: "refill"; at: number; songs: WorkspaceV2Song[]; source: WorkspaceV2QueueSource }
  | { type: "reset"; at: number };

export const initialWorkspaceV2QueueState: WorkspaceV2QueueMachineState = {
  activeQueue: null,
  consumedSongIds: [],
  currentIndex: 0,
  lastAdvanceReason: null,
  lastUpdatedAt: 0,
};

function uniqueSongs(songs: WorkspaceV2Song[]) {
  const seen = new Set<string>();
  return songs.filter((song) => {
    if (seen.has(song.id)) return false;
    seen.add(song.id);
    return true;
  });
}

function clampIndex(index: number, songs: WorkspaceV2Song[]) {
  if (!songs.length) return 0;
  return Math.min(Math.max(0, index), songs.length - 1);
}

function clampAdvanceIndex(index: number, songs: WorkspaceV2Song[]) {
  if (!songs.length) return 0;
  return Math.min(Math.max(0, index), songs.length);
}

export function activeWorkspaceV2Song(state: WorkspaceV2QueueMachineState) {
  return state.activeQueue?.songs[state.currentIndex] ?? null;
}

export function workspaceV2RemainingSongs(state: WorkspaceV2QueueMachineState) {
  if (!state.activeQueue) return [];
  return state.activeQueue.songs.slice(state.currentIndex + 1);
}

export function workspaceV2QueuePosition(state: WorkspaceV2QueueMachineState) {
  if (!state.activeQueue?.songs.length) return { current: 0, total: 0 };
  return {
    current: Math.min(state.currentIndex + 1, state.activeQueue.songs.length),
    total: state.activeQueue.songs.length,
  };
}

export function workspaceV2CanAdvance(state: WorkspaceV2QueueMachineState) {
  return Boolean(state.activeQueue && state.currentIndex + 1 < state.activeQueue.songs.length);
}

export function isWorkspaceV2PlayableInternal(song: WorkspaceV2Song) {
  return song.playbackKind === "internal";
}

export function rankWorkspaceV2DiscoveryCandidate(
  song: WorkspaceV2Song,
  now: number,
) {
  if (song.playbackKind === "external") return 4000000000000;
  if (!song.lastHeardAt) return song.exposureScore ?? 0;
  const age = Math.max(0, now - song.lastHeardAt);
  return age >= 1000 * 60 * 60 * 24 ? 1000000000000 - age : 2000000000000 - age;
}

export function buildWorkspaceV2ContinuousQueue({
  mode,
  now,
  previousConsumedSongIds,
  queueId,
  songs,
  source,
  title,
}: {
  mode: WorkspaceV2QueueMode;
  now: number;
  previousConsumedSongIds?: string[];
  queueId: string;
  songs: WorkspaceV2Song[];
  source: WorkspaceV2QueueSource;
  title: string;
}): WorkspaceV2Queue {
  const consumed = new Set(previousConsumedSongIds ?? []);
  const ordered = uniqueSongs(songs)
    .filter((song) => song.id.trim().length > 0)
    .sort((left, right) => {
      const leftConsumed = consumed.has(left.id) ? 1 : 0;
      const rightConsumed = consumed.has(right.id) ? 1 : 0;
      const leftRank =
        rankWorkspaceV2DiscoveryCandidate(left, now) + leftConsumed * 500000000000;
      const rightRank =
        rankWorkspaceV2DiscoveryCandidate(right, now) + rightConsumed * 500000000000;
      return leftRank - rightRank;
    });
  return {
    id: queueId,
    mode,
    songs: ordered,
    source,
    title,
  };
}

export function reduceWorkspaceV2Queue(
  state: WorkspaceV2QueueMachineState,
  event: WorkspaceV2QueueMachineEvent,
): WorkspaceV2QueueMachineState {
  switch (event.type) {
    case "load_queue":
      return {
        activeQueue: {
          ...event.queue,
          songs: uniqueSongs(event.queue.songs),
        },
        consumedSongIds: state.consumedSongIds,
        currentIndex: clampIndex(event.startIndex ?? 0, event.queue.songs),
        lastAdvanceReason: "load_queue",
        lastUpdatedAt: event.at,
      };

    case "consume_current": {
      const current = activeWorkspaceV2Song(state);
      if (!current || state.consumedSongIds.includes(current.id)) {
        return { ...state, lastUpdatedAt: event.at };
      }
      return {
        ...state,
        consumedSongIds: [...state.consumedSongIds, current.id],
        lastAdvanceReason: event.reason,
        lastUpdatedAt: event.at,
      };
    }

    case "advance": {
      if (!state.activeQueue) return { ...state, lastUpdatedAt: event.at };
      const current = activeWorkspaceV2Song(state);
      const consumedSongIds =
        current && !state.consumedSongIds.includes(current.id)
          ? [...state.consumedSongIds, current.id]
          : state.consumedSongIds;
      return {
        ...state,
        consumedSongIds,
        currentIndex: clampAdvanceIndex(
          state.currentIndex + 1,
          state.activeQueue.songs,
        ),
        lastAdvanceReason: event.reason,
        lastUpdatedAt: event.at,
      };
    }

    case "replace_current_song": {
      if (!state.activeQueue) return state;
      const songs = [...state.activeQueue.songs];
      songs[state.currentIndex] = event.song;
      return {
        ...state,
        activeQueue: { ...state.activeQueue, songs: uniqueSongs(songs) },
        lastAdvanceReason: "replace_current_song",
        lastUpdatedAt: event.at,
      };
    }

    case "refill": {
      if (!state.activeQueue) {
        return {
          activeQueue: {
            id: `${event.source}:${event.at}`,
            mode: "discovery",
            songs: uniqueSongs(event.songs),
            source: event.source,
            title: event.source.replaceAll("_", " "),
          },
          consumedSongIds: state.consumedSongIds,
          currentIndex: 0,
          lastAdvanceReason: "refill",
          lastUpdatedAt: event.at,
        };
      }
      const nextSongs = uniqueSongs([
        ...state.activeQueue.songs,
        ...event.songs,
      ]);
      return {
        ...state,
        activeQueue: {
          ...state.activeQueue,
          songs: nextSongs,
        },
        currentIndex: clampAdvanceIndex(state.currentIndex, nextSongs),
        lastAdvanceReason: "refill",
        lastUpdatedAt: event.at,
      };
    }

    case "reset":
      return {
        ...initialWorkspaceV2QueueState,
        lastUpdatedAt: event.at,
      };

    default:
      return state;
  }
}
