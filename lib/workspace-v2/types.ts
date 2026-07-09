export type WorkspaceV2PlaybackState =
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "completed"
  | "error";

export type WorkspaceV2QueueMode =
  | "review"
  | "discovery"
  | "genre"
  | "random"
  | "top10";

export type WorkspaceV2PlaybackKind = "internal" | "external";

export type WorkspaceV2Song = {
  artist: string;
  artistId?: string;
  category?: string | null;
  coverUrl: string;
  durationSeconds?: number | null;
  exposureScore?: number | null;
  genre?: string | null;
  id: string;
  lastHeardAt?: number | null;
  link: string;
  playbackKind: WorkspaceV2PlaybackKind;
  platform: string;
  subcategory?: string | null;
  title: string;
};

export type WorkspaceV2ExternalDiscoveryItem = {
  artist: string;
  artistId?: string;
  badge?: string;
  category?: string | null;
  coverUrl: string;
  feedKind?: string;
  genre?: string | null;
  id: string;
  link: string;
  platform: string;
  subcategory?: string | null;
  title: string;
};

export type WorkspaceV2QueueSource =
  | "featured"
  | "top10"
  | "new_releases"
  | "trending"
  | "most_played"
  | "discovery_pool"
  | "random"
  | "review"
  | "manual";

export type WorkspaceV2Queue = {
  id: string;
  mode: WorkspaceV2QueueMode;
  source: WorkspaceV2QueueSource;
  songs: WorkspaceV2Song[];
  title: string;
};

export type WorkspaceV2ProviderSnapshot = {
  at: number;
  currentTime: number;
  duration: number;
  muted: boolean | null;
  pageFocused?: boolean;
  pageVisible?: boolean;
  playbackState: WorkspaceV2PlaybackState;
  supported: boolean;
  volume: number | null;
};

export type WorkspaceV2ProviderCommand =
  | { command: "load"; song: WorkspaceV2Song; autoPlay: boolean }
  | { command: "play" }
  | { command: "pause" }
  | { command: "stop" }
  | { command: "none" };

export type WorkspaceV2ProviderEvent =
  | { type: "ready"; at: number }
  | { type: "playing"; at: number; snapshot: WorkspaceV2ProviderSnapshot }
  | { type: "paused"; at: number; snapshot: WorkspaceV2ProviderSnapshot }
  | { type: "completed"; at: number; snapshot: WorkspaceV2ProviderSnapshot }
  | { type: "telemetry"; at: number; snapshot: WorkspaceV2ProviderSnapshot }
  | { type: "error"; at: number; message: string };
