"use client";

import Link from "next/link";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Clock3,
  Coins,
  Compass,
  ExternalLink,
  Flag,
  Gauge,
  HelpCircle,
  Inbox,
  ListMusic,
  LockKeyhole,
  LogOut,
  Maximize2,
  Moon,
  MoreHorizontal,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Search,
  Send,
  ShieldCheck,
  SkipForward,
  Sun,
  TrendingUp,
  Trophy,
  User,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { SubmitView, type SongSubmission } from "@/components/first-listen-app";
import { ProfilePanel, type ProfilePanelProps } from "@/components/profile-panel";
import { PwaInstallButton } from "@/components/pwa-install-prompt";
import { SongActionBar } from "@/components/song-action-bar";
import type { InterfaceLocale } from "@/lib/catalog";
import { databasePlatform } from "@/lib/content-economy";
import type {
  FounderDiscoveryAnalyticsReport,
  FounderOperationsSnapshot,
} from "@/lib/founder-operations-types";
import { getCopy } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import type { ContentEconomySetting, Platform } from "@/lib/types";
import {
  dispatchWorkspaceV2PlaybackCommand,
  WORKSPACE_V2_PLAYBACK_COMMAND_CHANNEL,
  type WorkspaceV2ExternalDiscoveryItem,
  type WorkspaceV2Queue,
  type WorkspaceV2QueueMode,
  type WorkspaceV2QueueSource,
  type WorkspaceV2Song,
} from "@/lib/workspace-v2";
import {
  WorkspaceV2ProviderPlayerAdapter,
  type WorkspaceV2ProviderDebugEvent,
} from "@/components/workspace-v2/workspace-v2-provider-player-adapter";
import { useWorkspaceV2Controller } from "@/components/workspace-v2/workspace-v2-controller";
import {
  useWorkspaceV2EconomyBridge,
  type WorkspaceV2EconomyMode,
} from "@/components/workspace-v2/workspace-v2-economy-bridge";

export type WorkspaceV2ViewerMode =
  | "guest"
  | "member"
  | "creator"
  | "founder"
  | "admin";

type WorkspaceV2Panel =
  | "discover"
  | "submit"
  | "profile"
  | "founder-operations"
  | "owner"
  | "admin";

type WorkspaceV2DiscoveryView = "home" | "internal" | "external";
type WorkspaceV2DiscoveryStyleId =
  | "all"
  | "cumbia"
  | "bachata"
  | "reggaeton"
  | "regional-mexican"
  | "salsa"
  | "fiesta"
  | "pop"
  | "hip-hop"
  | "rock"
  | "edm"
  | "country"
  | "indie"
  | "alternative"
  | "instrumental"
  | "other";
type PlaybackBankState = "idle" | "fresh" | "partial" | "complete" | "replay";

type PlaybackEarningStatus = {
  canEarnMore: boolean;
  durationSeconds: number;
  earnedSeconds: number;
  remainingSeconds: number;
  replayState: PlaybackBankState;
  suggestedResumeSeconds: number | null;
};

type PlaybackEarningOpportunity = {
  artist: string;
  coverUrl: string;
  durationSeconds: number;
  earnedSeconds: number;
  remainingSeconds: number;
  songId: string;
  suggestedResumeSeconds: number | null;
  title: string;
};

type InstrumentationLog = {
  at: number;
  channel:
    | "error"
    | "playback"
    | "provider"
    | "queue"
    | "transition"
    | "validation"
    | "telemetry"
    | "economy";
  details?: string;
  message: string;
};

type ProviderDebugState = {
  adapterMountCount: number;
  adapterRenderCount: number;
  adapterUnmountCount: number;
  currentIframeSrc: string | null;
  iframeLoadCount: number;
  lastEvent: string;
  playerMountCount: number;
  playerRenderCount: number;
  playerUnmountCount: number;
  providerLoaded: boolean;
  providerPlaying: boolean;
  providerReady: boolean;
  youtubeCleanupCount: number;
};

type PlaybackPipelineDebug = {
  playButtonRequestCount: number;
  playFailedCount: number;
  playRequestAdapterCount: number;
  playRequestEmittedCount: number;
  playStartedCount: number;
  providerReadyEventCount: number;
  providerReadyHandledCount: number;
};

type WorkspaceQueueSnapshotRow = {
  current_index: number | null;
  current_song_id: string | null;
  duration_seconds: number | string | null;
  expires_at: string | null;
  playback_position_seconds: number | string | null;
  queue_id: string | null;
  queue_mode: string | null;
  queue_source: string | null;
  queue_title: string | null;
  snapshot_id: string;
  song_ids: string[] | null;
  updated_at: string | null;
};

type PendingWorkspaceResume = {
  currentSongTitle: string;
  playbackPositionSeconds: number;
  queue: WorkspaceV2Queue;
  snapshotId: string;
  startIndex: number;
  updatedAt: string | null;
};

const initialProviderDebug: ProviderDebugState = {
  adapterMountCount: 0,
  adapterRenderCount: 0,
  adapterUnmountCount: 0,
  currentIframeSrc: null,
  iframeLoadCount: 0,
  lastEvent: "waiting",
  playerMountCount: 0,
  playerRenderCount: 0,
  playerUnmountCount: 0,
  providerLoaded: false,
  providerPlaying: false,
  providerReady: false,
  youtubeCleanupCount: 0,
};

const initialPipelineDebug: PlaybackPipelineDebug = {
  playButtonRequestCount: 0,
  playFailedCount: 0,
  playRequestAdapterCount: 0,
  playRequestEmittedCount: 0,
  playStartedCount: 0,
  providerReadyEventCount: 0,
  providerReadyHandledCount: 0,
};

function clock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function normalizePlaybackBankState(value: unknown): PlaybackBankState {
  if (value === "fresh" || value === "new") return "fresh";
  if (value === "partial") return "partial";
  if (value === "complete" || value === "completed") return "complete";
  if (value === "replay" || value === "heard") return "replay";
  return "idle";
}

function parsePlaybackEarningStatus(
  value: Record<string, unknown> | null,
): PlaybackEarningStatus | null {
  if (!value) return null;
  return {
    canEarnMore: Boolean(value.can_earn_more),
    durationSeconds: Number(value.duration_seconds ?? 0),
    earnedSeconds: Number(value.earned_seconds ?? 0),
    remainingSeconds: Number(value.remaining_seconds ?? 0),
    replayState: normalizePlaybackBankState(value.replay_state),
    suggestedResumeSeconds:
      value.suggested_resume_seconds === null ||
      value.suggested_resume_seconds === undefined
        ? null
        : Math.max(0, Number(value.suggested_resume_seconds)),
  };
}

function parsePlaybackEarningOpportunity(
  value: Record<string, unknown>,
): PlaybackEarningOpportunity | null {
  const songId = String(value.song_id ?? "").trim();
  if (!songId) return null;
  return {
    artist: String(value.artist_name ?? "Unknown Artist"),
    coverUrl: String(value.cover_image_url ?? ""),
    durationSeconds: Number(value.duration_seconds ?? 0),
    earnedSeconds: Number(value.earned_seconds ?? 0),
    remainingSeconds: Number(value.remaining_seconds ?? 0),
    songId,
    suggestedResumeSeconds:
      value.suggested_resume_seconds === null ||
      value.suggested_resume_seconds === undefined
        ? null
        : Math.max(0, Number(value.suggested_resume_seconds)),
    title: String(value.title ?? "Untitled"),
  };
}

function pushLog(logs: InstrumentationLog[], entry: InstrumentationLog) {
  return [entry, ...logs].slice(0, 80);
}

function statusLabel(value: string, spanish: boolean) {
  if (!spanish) return value;
  const labels: Record<string, string> = {
    completed: "completado",
    error: "error",
    loading: "cargando",
    paused: "pausado",
    playing: "reproduciendo",
    ready: "listo",
  };
  return labels[value] ?? value;
}

function viewerLabel(viewerMode: WorkspaceV2ViewerMode, spanish: boolean) {
  const labels: Record<WorkspaceV2ViewerMode, string> = spanish
    ? {
        admin: "Admin",
        creator: "Creador",
        founder: "Founder",
        guest: "Invitado",
        member: "Miembro",
      }
    : {
        admin: "Admin",
        creator: "Creator",
        founder: "Founder",
        guest: "Guest",
        member: "Member",
      };
  return labels[viewerMode];
}

function panelLabel(panel: WorkspaceV2Panel, spanish: boolean) {
  const labels: Record<WorkspaceV2Panel, string> = spanish
    ? {
        admin: "Admin",
        discover: "Descubrir",
        "founder-operations": "Centro de Operaciones",
        owner: "Owner",
        profile: "Mi perfil",
        submit: "Enviar canción",
      }
    : {
        admin: "Admin",
        discover: "Discover",
        "founder-operations": "Centro de Operaciones",
        owner: "Owner",
        profile: "My profile",
        submit: "Submit song",
      };
  return labels[panel];
}

function queueSourceLabel(source: string | undefined, spanish: boolean) {
  if (!source) return spanish ? "Cola de descubrimiento" : "Discovery queue";
  const normalized = source.replaceAll("_", " ");
  const labels: Record<string, { en: string; es: string }> = {
    discovery_pool: {
      en: "Discovery queue",
      es: "Cola de descubrimiento",
    },
    featured: {
      en: "Featured discovery",
      es: "Descubrimiento destacado",
    },
    genre: {
      en: "Genre discovery",
      es: "Descubrimiento por género",
    },
    manual: {
      en: "Selected queue",
      es: "Cola seleccionada",
    },
    most_played: {
      en: "Most played",
      es: "Más escuchadas",
    },
    new_releases: {
      en: "New releases",
      es: "Nuevos lanzamientos",
    },
    random: {
      en: "Discovery queue",
      es: "Cola de descubrimiento",
    },
    review: {
      en: "Support queue",
      es: "Cola para apoyar artistas",
    },
    top10: {
      en: "Top songs",
      es: "Canciones destacadas",
    },
    trending: {
      en: "Trending",
      es: "Tendencias",
    },
  };
  return labels[source]?.[spanish ? "es" : "en"] ?? normalized;
}

type WorkspaceV2DiscoveryStyle = {
  aliases: string[];
  emoji: string;
  id: WorkspaceV2DiscoveryStyleId;
  labelEn: string;
  labelEs: string;
};

type WorkspaceV2DiscoveryStyleSection = {
  id: "latin" | "general" | "other";
  labelEn: string;
  labelEs: string;
  styles: WorkspaceV2DiscoveryStyle[];
};

const workspaceV2DiscoveryStyleSections: WorkspaceV2DiscoveryStyleSection[] = [
  {
    id: "latin",
    labelEn: "Latin music",
    labelEs: "Musica latina",
    styles: [
      { aliases: ["cumbia"], emoji: "💃", id: "cumbia", labelEn: "Cumbia", labelEs: "Cumbia" },
      { aliases: ["bachata"], emoji: "🎶", id: "bachata", labelEn: "Bachata", labelEs: "Bachata" },
      { aliases: ["reggaeton"], emoji: "🔥", id: "reggaeton", labelEn: "Reggaeton", labelEs: "Reggaeton" },
      {
        aliases: ["regional mexican", "regional mexicano", "regional-mexicano"],
        emoji: "🤠",
        id: "regional-mexican",
        labelEn: "Regional Mexican",
        labelEs: "Regional Mexicano",
      },
      { aliases: ["salsa"], emoji: "🎺", id: "salsa", labelEn: "Salsa", labelEs: "Salsa" },
      { aliases: ["chilena", "fiesta"], emoji: "🎉", id: "fiesta", labelEn: "Party", labelEs: "Fiesta" },
    ],
  },
  {
    id: "general",
    labelEn: "General music",
    labelEs: "Musica general",
    styles: [
      { aliases: ["pop"], emoji: "🎵", id: "pop", labelEn: "Pop", labelEs: "Pop" },
      { aliases: ["hip hop", "hip-hop", "rap"], emoji: "🎤", id: "hip-hop", labelEn: "Hip-Hop", labelEs: "Hip-Hop" },
      { aliases: ["rock"], emoji: "🎸", id: "rock", labelEn: "Rock", labelEs: "Rock" },
      { aliases: ["edm", "electronic", "electronica"], emoji: "⚡", id: "edm", labelEn: "EDM", labelEs: "EDM" },
      { aliases: ["country"], emoji: "🌾", id: "country", labelEn: "Country", labelEs: "Country" },
      { aliases: ["indie"], emoji: "✨", id: "indie", labelEn: "Indie", labelEs: "Indie" },
      { aliases: ["alternative", "alternativo"], emoji: "🌀", id: "alternative", labelEn: "Alternative", labelEs: "Alternativo" },
      { aliases: ["instrumental", "instrumental only"], emoji: "🎼", id: "instrumental", labelEn: "Instrumental", labelEs: "Instrumental" },
    ],
  },
  {
    id: "other",
    labelEn: "Other styles",
    labelEs: "Otros estilos",
    styles: [
      { aliases: ["other", "otro", ""], emoji: "🎧", id: "other", labelEn: "Other", labelEs: "Otro estilo" },
    ],
  },
];

const workspaceV2DiscoveryStyles = workspaceV2DiscoveryStyleSections.flatMap(
  (section) => section.styles,
);

function normalizeDiscoveryStyleValue(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ");
}

function itemDiscoveryStyleValue(
  item: Pick<WorkspaceV2Song, "category" | "genre" | "subcategory">,
) {
  return normalizeDiscoveryStyleValue(
    item.genre || item.subcategory || item.category || "",
  );
}

function styleForDiscoveryItem(
  item: Pick<WorkspaceV2Song, "category" | "genre" | "subcategory">,
) {
  const value = itemDiscoveryStyleValue(item);
  if (!value) {
    return workspaceV2DiscoveryStyles.find((style) => style.id === "other")!;
  }
  return (
    workspaceV2DiscoveryStyles.find((style) =>
      style.aliases.some(
        (alias) => normalizeDiscoveryStyleValue(alias) === value,
      ),
    ) ?? workspaceV2DiscoveryStyles.find((style) => style.id === "other")!
  );
}

function discoveryStyleLabel(
  style: WorkspaceV2DiscoveryStyle,
  spanish: boolean,
) {
  return spanish ? style.labelEs : style.labelEn;
}

function filterItemsByDiscoveryStyle<
  T extends Pick<WorkspaceV2Song, "category" | "genre" | "subcategory">,
>(items: T[], styleId: WorkspaceV2DiscoveryStyleId) {
  if (styleId === "all") return items;
  return items.filter((item) => styleForDiscoveryItem(item).id === styleId);
}

function itemMatchesDiscoverySearch(
  item: Pick<
    WorkspaceV2Song,
    "artist" | "category" | "genre" | "platform" | "subcategory" | "title"
  >,
  query: string,
) {
  const normalizedQuery = normalizeDiscoveryStyleValue(query);
  if (!normalizedQuery) return true;
  const searchableText = normalizeDiscoveryStyleValue(
    [
      item.title,
      item.artist,
      item.platform,
      item.genre,
      item.category,
      item.subcategory,
    ].join(" "),
  );
  return searchableText.includes(normalizedQuery);
}

function normalizeWorkspaceV2DiscoveryView(
  value: string | null | undefined,
): WorkspaceV2DiscoveryView {
  return value === "internal" || value === "external" ? value : "home";
}

function normalizeWorkspaceV2DiscoveryStyle(
  value: string | null | undefined,
): WorkspaceV2DiscoveryStyleId {
  if (
    value &&
    (value === "all" ||
      workspaceV2DiscoveryStyles.some((style) => style.id === value))
  ) {
    return value as WorkspaceV2DiscoveryStyleId;
  }
  return "all";
}

function nowPlayingLabel(song: WorkspaceV2Song | null, spanish: boolean) {
  if (song) return song.title;
  return spanish ? "Descubriendo nueva música" : "Discovering new music";
}

function workspaceSessionHeadline({
  activeSong,
  resumeTitle,
  spanish,
}: {
  activeSong: WorkspaceV2Song | null;
  resumeTitle: string | null;
  spanish: boolean;
}) {
  if (activeSong) return activeSong.title;
  if (resumeTitle) {
    return spanish ? "Continuando tu sesión" : "Continuing your session";
  }
  return spanish ? "Descubriendo nueva música" : "Discovering new music";
}

function workspaceSongPlatform(song: WorkspaceV2Song): Platform {
  return song.platform as Platform;
}

function firstRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeQueueMode(value: string | null | undefined): WorkspaceV2QueueMode {
  const validModes: WorkspaceV2QueueMode[] = [
    "discovery",
    "genre",
    "random",
    "review",
    "top10",
  ];
  return validModes.includes(value as WorkspaceV2QueueMode)
    ? (value as WorkspaceV2QueueMode)
    : "discovery";
}

function normalizeQueueSource(
  value: string | null | undefined,
): WorkspaceV2QueueSource {
  const validSources: WorkspaceV2QueueSource[] = [
    "discovery_pool",
    "featured",
    "manual",
    "most_played",
    "new_releases",
    "random",
    "review",
    "top10",
    "trending",
  ];
  return validSources.includes(value as WorkspaceV2QueueSource)
    ? (value as WorkspaceV2QueueSource)
    : "manual";
}

function restoreQueueFromSnapshot(
  initialQueue: WorkspaceV2Queue,
  snapshot: WorkspaceQueueSnapshotRow,
): PendingWorkspaceResume | null {
  const songIds = snapshot.song_ids ?? [];
  const currentSongId = snapshot.current_song_id;
  if (!songIds.length || !currentSongId) return null;

  const songsById = new Map(initialQueue.songs.map((song) => [song.id, song]));
  const restoredSongs = songIds
    .map((songId) => songsById.get(songId))
    .filter((song): song is WorkspaceV2Song => Boolean(song));
  const currentIndex = restoredSongs.findIndex((song) => song.id === currentSongId);
  if (currentIndex < 0) return null;

  const missingCurrentSong = !songsById.has(currentSongId);
  if (missingCurrentSong) return null;

  const restoredIds = new Set(restoredSongs.map((song) => song.id));
  const appendedSongs = initialQueue.songs.filter((song) => !restoredIds.has(song.id));
  const queue: WorkspaceV2Queue = {
    id: snapshot.queue_id?.trim() || initialQueue.id,
    mode: normalizeQueueMode(snapshot.queue_mode),
    songs: [...restoredSongs, ...appendedSongs],
    source: normalizeQueueSource(snapshot.queue_source),
    title: snapshot.queue_title?.trim() || initialQueue.title,
  };

  const playbackPositionSeconds = Number(snapshot.playback_position_seconds ?? 0);
  return {
    currentSongTitle: restoredSongs[currentIndex]?.title ?? initialQueue.title,
    playbackPositionSeconds: Number.isFinite(playbackPositionSeconds)
      ? Math.max(0, playbackPositionSeconds)
      : 0,
    queue,
    snapshotId: snapshot.snapshot_id,
    startIndex: currentIndex,
    updatedAt: snapshot.updated_at,
  };
}

export function WorkspaceV2Shell({
  contentEconomy = [],
  debugMode = false,
  economyMode = "sandbox",
  externalDiscoveryItems = [],
  founderOperations = null,
  guestToken,
  initialFounderSubmissionsRemaining = 0,
  initialQueue,
  initialSubmissionTokens = 0,
  locale,
  profilePanel,
  viewerIdentity,
  viewerMode = "member",
}: {
  contentEconomy?: ContentEconomySetting[];
  debugMode?: boolean;
  economyMode?: WorkspaceV2EconomyMode;
  externalDiscoveryItems?: WorkspaceV2ExternalDiscoveryItem[];
  founderOperations?: FounderOperationsSnapshot | null;
  guestToken?: string | null;
  initialFounderSubmissionsRemaining?: number;
  initialQueue: WorkspaceV2Queue;
  initialSubmissionTokens?: number;
  locale: InterfaceLocale;
  profilePanel?: ProfilePanelProps | null;
  viewerIdentity?: string | null;
  viewerMode?: WorkspaceV2ViewerMode;
}) {
  const [clientMounted, setClientMounted] = useState(false);

  useEffect(() => {
    setClientMounted(true);
  }, []);

  if (!clientMounted) {
    return (
      <section className="workspace-v2-product-shell" data-workspace-version="2">
        <div className="workspace-v2-product-loading" role="status">
          <strong>First Listen Workspace</strong>
          <span>Preparing player...</span>
        </div>
      </section>
    );
  }

  return (
    <WorkspaceV2ShellClient
      contentEconomy={contentEconomy}
      debugMode={debugMode}
      economyMode={economyMode}
      externalDiscoveryItems={externalDiscoveryItems}
      founderOperations={founderOperations}
      guestToken={guestToken}
      initialFounderSubmissionsRemaining={initialFounderSubmissionsRemaining}
      initialQueue={initialQueue}
      initialSubmissionTokens={initialSubmissionTokens}
      locale={locale}
      profilePanel={profilePanel}
      viewerIdentity={viewerIdentity}
      viewerMode={viewerMode}
    />
  );
}

function WorkspaceV2ShellClient({
  contentEconomy,
  debugMode,
  economyMode,
  externalDiscoveryItems,
  founderOperations,
  guestToken,
  initialFounderSubmissionsRemaining,
  initialQueue,
  initialSubmissionTokens,
  locale,
  profilePanel,
  viewerIdentity,
  viewerMode,
}: {
  contentEconomy: ContentEconomySetting[];
  debugMode: boolean;
  economyMode: WorkspaceV2EconomyMode;
  externalDiscoveryItems: WorkspaceV2ExternalDiscoveryItem[];
  founderOperations: FounderOperationsSnapshot | null;
  guestToken?: string | null;
  initialFounderSubmissionsRemaining: number;
  initialQueue: WorkspaceV2Queue;
  initialSubmissionTokens: number;
  locale: InterfaceLocale;
  profilePanel?: ProfilePanelProps | null;
  viewerIdentity?: string | null;
  viewerMode: WorkspaceV2ViewerMode;
}) {
  const controller = useWorkspaceV2Controller();
  const economy = useWorkspaceV2EconomyBridge({
    guestToken,
    mode: economyMode,
    validation: controller.validation,
  });
  const { loadQueue } = controller;
  const [workspaceLocale, setWorkspaceLocale] = useState<InterfaceLocale>("es");
  const spanish = workspaceLocale === "es";
  const canAccessAdmin = viewerMode === "founder" || viewerMode === "admin";
  const canAccessFounderOperations = viewerMode === "founder";
  const canClaimRewards = viewerMode !== "guest" && economy.enabled;
  const canSubmit = viewerMode !== "guest";
  const copy = useMemo(() => getCopy(workspaceLocale), [workspaceLocale]);
  const debugAllowed = canAccessAdmin;
  const displayIdentity =
    viewerIdentity?.trim() || viewerLabel(viewerMode, spanish);
  const [activePanel, setActivePanel] = useState<WorkspaceV2Panel>("discover");
  const [discoveryView, setDiscoveryView] =
    useState<WorkspaceV2DiscoveryView>("home");
  const [selectedDiscoveryStyle, setSelectedDiscoveryStyle] =
    useState<WorkspaceV2DiscoveryStyleId>("all");
  const productivityMode = activePanel !== "discover";
  const workspaceMode = productivityMode ? "productivity" : "discover";
  const activeDiscoveryLabel =
    discoveryView === "internal"
      ? spanish
        ? "Descubrimiento interno"
        : "Internal discovery"
      : discoveryView === "external"
        ? spanish
          ? "Plataformas externas"
          : "External platforms"
        : "";
  const workspaceReturnVisible =
    activePanel !== "discover" || discoveryView !== "home";
  const workspaceReturnLabel =
    activePanel === "discover"
      ? activeDiscoveryLabel
      : panelLabel(activePanel, spanish);
  const [darkMode, setDarkMode] = useState(false);
  const [debugOpen, setDebugOpen] = useState(debugMode && debugAllowed);
  const [
    founderSubmissionsRemaining,
    setFounderSubmissionsRemaining,
  ] = useState(initialFounderSubmissionsRemaining);
  const [heroCollapsed, setHeroCollapsed] = useState(false);
  const [logs, setLogs] = useState<InstrumentationLog[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastTransition, setLastTransition] = useState("BOOT");
  const [metadataOverlayVisible, setMetadataOverlayVisible] = useState(true);
  const [mobileQueueExpanded, setMobileQueueExpanded] = useState(false);
  const [providerSkipNotice, setProviderSkipNotice] = useState("");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [localPlaybackBankPreview, setLocalPlaybackBankPreview] = useState<
    PlaybackBankState | null
  >(null);
  const [playbackEarningStatus, setPlaybackEarningStatus] =
    useState<PlaybackEarningStatus | null>(null);
  const [
    playbackEarningOpportunities,
    setPlaybackEarningOpportunities,
  ] = useState<PlaybackEarningOpportunity[]>([]);
  const [playbackBankMenuOpen, setPlaybackBankMenuOpen] = useState(false);
  const [pipelineDebug, setPipelineDebug] =
    useState<PlaybackPipelineDebug>(initialPipelineDebug);
  const [providerDebug, setProviderDebug] =
    useState<ProviderDebugState>(initialProviderDebug);
  const [resumedSession, setResumedSession] =
    useState<PendingWorkspaceResume | null>(null);
  const [resumeChecked, setResumeChecked] = useState(false);
  const [queueBootstrapped, setQueueBootstrapped] = useState(false);
  const [submissionTokens, setSubmissionTokens] = useState(initialSubmissionTokens);
  const [submitNotice, setSubmitNotice] = useState("");
  const commandRef = useRef("");
  const heroCollapseFrameRef = useRef<number | null>(null);
  const heroCollapsedRef = useRef(false);
  const lastSnapshotSignatureRef = useRef("");
  const snapshotSaveTimeoutRef = useRef<number | null>(null);
  const heroRef = useRef<HTMLDivElement | null>(null);
  const playbackRef = useRef("");
  const providerSkipSongRef = useRef<string | null>(null);
  const providerSkipTimeoutRef = useRef<number | null>(null);
  const queueRef = useRef("");
  const returnStripFrameRef = useRef<number | null>(null);
  const returnStripRef = useRef<HTMLDivElement | null>(null);
  const telemetryRef = useRef("");
  const touchStartYRef = useRef<number | null>(null);
  const trustedPlaybackRequestRef = useRef<(() => void) | null>(null);
  const validationRef = useRef("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hostname = window.location.hostname;
    const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
    const privateIpv4 =
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
    const localPreviewHost =
      localHostnames.has(hostname) ||
      privateIpv4 ||
      window.location.port === "3000" ||
      window.location.port === "3100";
    if (!localPreviewHost) return;

    const syncLocalPlaybackBankPreview = () => {
      const preview = new URL(window.location.href).searchParams
        .get("bankPreview")
        ?.trim()
        .toLowerCase();
      const normalizedPreview =
        preview === "fresh" || preview === "new" || preview === "nueva"
          ? "fresh"
          : preview === "partial" ||
              preview === "restante" ||
              preview === "disponible" ||
              preview === "resume" ||
              preview === "reanudar"
            ? "partial"
            : preview === "complete" ||
                preview === "completed" ||
                preview === "completa" ||
                preview === "agotada"
              ? "complete"
          : preview === "replay" ||
              preview === "heard" ||
              preview === "escuchada" ||
              preview === "repetida" ||
              preview === "ya-la-escuche"
            ? "replay"
            : preview === "idle" ||
                preview === "ready" ||
                preview === "preparado"
              ? "idle"
              : null;
      setLocalPlaybackBankPreview(
        normalizedPreview,
      );
    };

    syncLocalPlaybackBankPreview();
    window.addEventListener("popstate", syncLocalPlaybackBankPreview);
    return () =>
      window.removeEventListener("popstate", syncLocalPlaybackBankPreview);
  }, []);

  const recordLog = useCallback(
    ({
      channel,
      details,
      message,
    }: {
      channel: InstrumentationLog["channel"];
      details?: string;
      message: string;
    }) => {
      setLogs((current) =>
        pushLog(current, {
          at: Date.now(),
          channel,
          details,
          message,
        }),
      );
    },
    [],
  );

  const recordTransition = useCallback(
    (message: string, details?: string) => {
      setLastTransition(message);
      recordLog({ channel: "transition", details, message });
    },
    [recordLog],
  );

  const recordError = useCallback(
    (message: string, details?: string) => {
      setLastError(details ? `${message}: ${details}` : message);
      recordLog({ channel: "error", details, message });
    },
    [recordLog],
  );

  const registerTrustedPlaybackRequest = useCallback(
    (requestPlayback: (() => void) | null) => {
      trustedPlaybackRequestRef.current = requestPlayback;
    },
    [],
  );

  useEffect(() => {
    setDarkMode(window.localStorage.getItem("first-listen-theme") === "dark");
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("first-listen-locale");
    const fallbackLocale: InterfaceLocale =
      locale === "en" || locale === "es" ? locale : "es";
    setWorkspaceLocale(
      stored === "en" || stored === "es"
        ? stored
        : fallbackLocale === "en"
          ? "es"
          : fallbackLocale,
    );
  }, [locale]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = workspaceLocale;
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem("first-listen-locale", workspaceLocale);
    }
  }, [workspaceLocale]);

  const handleWorkspaceLocaleChange = useCallback(
    (nextLocale: InterfaceLocale) => {
      setWorkspaceLocale(nextLocale);
      if (typeof document !== "undefined") {
        document.documentElement.lang = nextLocale;
      }
      if (typeof window !== "undefined") {
        window.localStorage.setItem("first-listen-locale", nextLocale);
      }
    },
    [],
  );

  useEffect(() => {
    document.documentElement.classList.toggle("theme-dark", darkMode);
    window.localStorage.setItem("first-listen-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    setMobileQueueExpanded(false);
  }, [activePanel]);

  useEffect(() => {
    setPlaybackBankMenuOpen(false);
  }, [controller.activeSong?.id]);

  useEffect(() => {
    if (!economy.state.lastUpdatedAt) return;
    setSubmissionTokens(Number(economy.state.credits ?? 0));
  }, [economy.state.credits, economy.state.lastUpdatedAt]);

  const notifySubmit = useCallback(
    (message: string) => {
      setSubmitNotice(message);
      recordLog({
        channel: "transition",
        details: message,
        message: "SUBMIT_NOTICE",
      });
    },
    [recordLog],
  );

  const handleSubmitSong = useCallback(
    async (usedFounderFree: boolean, submission: SongSubmission) => {
      const supabase = createClient();
      if (!supabase) {
        notifySubmit(
          spanish
            ? "El servicio de envio no esta disponible. Actualiza e intenta otra vez."
            : "Submission service is unavailable. Please refresh and try again.",
        );
        return false;
      }

      const { error } = await supabase.rpc("submit_song", {
        song_artist_name: submission.artistName,
        song_content_kind: submission.contentKind,
        song_country: submission.country,
        song_cover_image_url: submission.coverImageUrl,
        song_duration_seconds: submission.durationSeconds,
        song_explicit_content: submission.explicitContent,
        song_feedback_focus: submission.feedbackFocus,
        song_genre: submission.genre,
        song_language: submission.language,
        song_music_url: submission.musicUrl,
        song_platform: databasePlatform[submission.platform],
        song_title: submission.title,
      });
      if (error) {
        notifySubmit(error.message);
        recordError("SUBMIT_FAILED", error.message);
        return false;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: updatedProfile } = await supabase
          .from("profiles")
          .select("credits, founder_free_submissions_remaining")
          .eq("id", user.id)
          .maybeSingle();
        if (updatedProfile) {
          setSubmissionTokens(Number(updatedProfile.credits ?? 0));
          setFounderSubmissionsRemaining(
            Number(updatedProfile.founder_free_submissions_remaining ?? 0),
          );
        }
      } else if (usedFounderFree) {
        setFounderSubmissionsRemaining((current) => Math.max(0, current - 1));
      }

      void economy.refreshEconomyStatus();
      recordLog({
        channel: "transition",
        details: `${submission.title} / ${submission.platform}`,
        message: "SUBMIT_SUCCESS",
      });
      return true;
    },
    [economy, notifySubmit, recordError, recordLog, spanish],
  );

  const loadInitialQueue = useCallback(
    (reason: string) => {
      try {
        loadQueue(initialQueue, { autoPlay: true });
        setResumedSession(null);
        setQueueBootstrapped(true);
        recordTransition(
          "LOAD_SONG",
          initialQueue.songs[0]
            ? `${reason}: ${initialQueue.songs[0].id} / ${initialQueue.songs[0].title}`
            : `${reason}: Queue is empty`,
        );
      } catch (error) {
        recordError(
          "LOAD_SONG failed",
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [initialQueue, loadQueue, recordError, recordTransition],
  );

  const clearQueueSnapshot = useCallback(async () => {
    if (economyMode === "sandbox") return;
    const supabase = createClient();
    if (!supabase) return;
    if (economyMode === "guest") {
      if (!guestToken) return;
      await supabase.rpc("clear_guest_workspace_queue_snapshot", {
        guest_access_token: guestToken,
      });
      return;
    }
    await supabase.rpc("clear_workspace_queue_snapshot");
  }, [economyMode, guestToken]);

  useEffect(() => {
    let active = true;

    const bootstrapQueue = async () => {
      if (economyMode === "sandbox") {
        setResumeChecked(true);
        loadInitialQueue("sandbox");
        return;
      }

      const supabase = createClient();
      if (!supabase) {
        setResumeChecked(true);
        loadInitialQueue("supabase unavailable");
        return;
      }

      try {
        const result =
          economyMode === "guest"
            ? guestToken
              ? await supabase.rpc("get_guest_workspace_queue_snapshot", {
                  guest_access_token: guestToken,
                })
              : { data: null, error: null }
            : await supabase.rpc("get_workspace_queue_snapshot");

        if (!active) return;
        if (result.error) {
          recordError("RESUME_SNAPSHOT_FAILED", result.error.message);
          setResumeChecked(true);
          loadInitialQueue("resume snapshot failed");
          return;
        }

        const snapshot = firstRow(
          result.data as
            | WorkspaceQueueSnapshotRow
            | WorkspaceQueueSnapshotRow[]
            | null,
        );
        const resume = snapshot
          ? restoreQueueFromSnapshot(initialQueue, snapshot)
          : null;

        if (resume) {
          loadQueue(resume.queue, {
            autoPlay: true,
            startIndex: resume.startIndex,
          });
          setResumedSession(resume);
          setResumeChecked(true);
          setQueueBootstrapped(true);
          recordTransition(
            "RESUME_AUTO_CONTINUED",
            `${resume.currentSongTitle} / ${clock(resume.playbackPositionSeconds)}`,
          );
          return;
        }

        if (snapshot) {
          void clearQueueSnapshot();
        }
        setResumeChecked(true);
        loadInitialQueue(snapshot ? "invalid resume snapshot" : "fresh session");
      } catch (error) {
        if (!active) return;
        recordError(
          "RESUME_SNAPSHOT_FAILED",
          error instanceof Error ? error.message : String(error),
        );
        setResumeChecked(true);
        loadInitialQueue("resume snapshot exception");
      }
    };

    void bootstrapQueue();
    return () => {
      active = false;
    };
  }, [
    clearQueueSnapshot,
    economyMode,
    guestToken,
    initialQueue,
    loadInitialQueue,
    loadQueue,
    recordError,
    recordTransition,
  ]);

  const handleStartNewSession = useCallback(() => {
    void clearQueueSnapshot();
    setResumedSession(null);
    loadInitialQueue("new session");
  }, [clearQueueSnapshot, loadInitialQueue]);

  const snapshotProgressBucket = Math.floor(
    controller.telemetry.currentProgressSeconds / 15,
  );
  const snapshotActiveQueue = controller.queue.activeQueue;
  const snapshotActiveSong = controller.activeSong;
  const snapshotCurrentPosition = controller.position.current;
  const snapshotCurrentProgressSeconds =
    controller.telemetry.currentProgressSeconds;
  const snapshotDurationSeconds = controller.telemetry.durationSeconds;

  useEffect(() => {
    if (
      !queueBootstrapped ||
      economyMode === "sandbox" ||
      !snapshotActiveSong ||
      !snapshotActiveQueue?.songs.length
    ) {
      return;
    }

    const activeQueue = snapshotActiveQueue;
    const activeSong = snapshotActiveSong;
    const currentIndex = Math.max(0, snapshotCurrentPosition - 1);
    const songIds = activeQueue.songs.map((song) => song.id);
    const signature = [
      activeQueue.id,
      activeSong.id,
      currentIndex,
      snapshotProgressBucket,
      songIds.join(","),
    ].join("|");
    if (lastSnapshotSignatureRef.current === signature) return;
    lastSnapshotSignatureRef.current = signature;

    if (snapshotSaveTimeoutRef.current) {
      window.clearTimeout(snapshotSaveTimeoutRef.current);
    }
    snapshotSaveTimeoutRef.current = window.setTimeout(() => {
      snapshotSaveTimeoutRef.current = null;
      const supabase = createClient();
      if (!supabase) return;

      const payload = {
        snapshot_current_index: currentIndex,
        snapshot_current_song_id: activeSong.id,
        snapshot_duration_seconds: snapshotDurationSeconds || null,
        snapshot_playback_position_seconds:
          snapshotCurrentProgressSeconds,
        snapshot_queue_id: activeQueue.id,
        snapshot_queue_mode: activeQueue.mode,
        snapshot_queue_source: activeQueue.source,
        snapshot_queue_title: activeQueue.title,
        snapshot_song_ids: songIds,
      };

      const request =
        economyMode === "guest"
          ? guestToken
            ? supabase.rpc("save_guest_workspace_queue_snapshot", {
                ...payload,
                guest_access_token: guestToken,
              })
            : null
          : supabase.rpc("save_workspace_queue_snapshot", payload);

      if (!request) return;
      void request.then(({ error }) => {
        if (error) {
          recordError("RESUME_SNAPSHOT_SAVE_FAILED", error.message);
        }
      });
    }, 600);
  }, [
    economyMode,
    guestToken,
    queueBootstrapped,
    recordError,
    snapshotActiveQueue,
    snapshotActiveSong,
    snapshotCurrentPosition,
    snapshotCurrentProgressSeconds,
    snapshotDurationSeconds,
    snapshotProgressBucket,
  ]);

  useEffect(
    () => () => {
      if (snapshotSaveTimeoutRef.current) {
        window.clearTimeout(snapshotSaveTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const setCollapsedState = (nextCollapsed: boolean) => {
      if (heroCollapsedRef.current === nextCollapsed) return;
      heroCollapsedRef.current = nextCollapsed;
      setHeroCollapsed(nextCollapsed);
    };

    const readWorkspaceScroll = () => {
      const scrollingElement = document.scrollingElement ?? document.documentElement;
      const rootOffset = Math.max(
        window.scrollY,
        scrollingElement?.scrollTop ?? 0,
        document.documentElement?.scrollTop ?? 0,
        document.body?.scrollTop ?? 0,
      );

      if (rootOffset > 0 || !heroRef.current) {
        return rootOffset;
      }

      let current = heroRef.current.parentElement;
      while (current && current !== document.body && current !== document.documentElement) {
        const scrollable = current.scrollHeight > current.clientHeight + 4;
        if (scrollable && current.scrollTop > 0) {
          return current.scrollTop;
        }
        current = current.parentElement;
      }

      return 0;
    };

    const updateCollapsedState = () => {
      if (heroCollapseFrameRef.current !== null) return;
      heroCollapseFrameRef.current = window.requestAnimationFrame(() => {
        heroCollapseFrameRef.current = null;
        const mobile = window.matchMedia("(max-width: 900px)").matches;
        const collapseAt = mobile ? 64 : 44;
        const expandAt = mobile ? 32 : 18;
        const scrollOffset = readWorkspaceScroll();
        const nextCollapsed = heroCollapsedRef.current
          ? scrollOffset > expandAt
          : scrollOffset > collapseAt;
        setCollapsedState(nextCollapsed);
      });
    };

    const handleWheelIntent = (event: WheelEvent) => {
      if (event.deltaY > 4) {
        setCollapsedState(true);
        return;
      }
      if (event.deltaY < -4 && readWorkspaceScroll() <= 32) {
        setCollapsedState(false);
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      touchStartYRef.current = event.touches[0]?.clientY ?? null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const startY = touchStartYRef.current;
      const currentY = event.touches[0]?.clientY ?? null;
      if (startY === null || currentY === null) return;
      const delta = startY - currentY;
      if (delta > 8) {
        setCollapsedState(true);
        return;
      }
      if (delta < -8 && readWorkspaceScroll() <= 32) {
        setCollapsedState(false);
      }
    };

    const handleTouchEnd = () => {
      touchStartYRef.current = null;
      if (readWorkspaceScroll() <= 32) {
        setCollapsedState(false);
      }
    };

    updateCollapsedState();
    document.addEventListener("wheel", handleWheelIntent, {
      capture: true,
      passive: true,
    });
    document.addEventListener("scroll", updateCollapsedState, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchstart", handleTouchStart, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchmove", handleTouchMove, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchend", handleTouchEnd, {
      capture: true,
      passive: true,
    });
    window.addEventListener("scroll", updateCollapsedState, { passive: true });
    window.addEventListener("resize", updateCollapsedState);
    return () => {
      document.removeEventListener("wheel", handleWheelIntent, {
        capture: true,
      });
      document.removeEventListener("scroll", updateCollapsedState, {
        capture: true,
      });
      document.removeEventListener("touchstart", handleTouchStart, {
        capture: true,
      });
      document.removeEventListener("touchmove", handleTouchMove, {
        capture: true,
      });
      document.removeEventListener("touchend", handleTouchEnd, {
        capture: true,
      });
      window.removeEventListener("scroll", updateCollapsedState);
      window.removeEventListener("resize", updateCollapsedState);
      if (heroCollapseFrameRef.current !== null) {
        window.cancelAnimationFrame(heroCollapseFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!workspaceReturnVisible) return;

    const updateReturnStripOffset = () => {
      if (returnStripFrameRef.current !== null) return;
      returnStripFrameRef.current = window.requestAnimationFrame(() => {
        returnStripFrameRef.current = null;
        const strip = returnStripRef.current;
        if (!strip) return;
        const heroBottom = heroRef.current?.getBoundingClientRect().bottom ?? 0;
        const preferredTop = Math.ceil(heroBottom + 8);
        const maxVisibleTop = Math.max(10, window.innerHeight - 88);
        const safeTop = Math.max(10, Math.min(preferredTop, maxVisibleTop));
        strip.style.setProperty(
          "--workspace-v2-return-strip-top",
          `${safeTop}px`,
        );
        document.documentElement.style.setProperty(
          "--workspace-v2-return-strip-top",
          `${safeTop}px`,
        );
      });
    };

    updateReturnStripOffset();
    document.addEventListener("scroll", updateReturnStripOffset, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchmove", updateReturnStripOffset, {
      capture: true,
      passive: true,
    });
    window.addEventListener("scroll", updateReturnStripOffset, {
      passive: true,
    });
    window.addEventListener("resize", updateReturnStripOffset);

    return () => {
      document.removeEventListener("scroll", updateReturnStripOffset, {
        capture: true,
      });
      document.removeEventListener("touchmove", updateReturnStripOffset, {
        capture: true,
      });
      window.removeEventListener("scroll", updateReturnStripOffset);
      window.removeEventListener("resize", updateReturnStripOffset);
      if (returnStripFrameRef.current !== null) {
        window.cancelAnimationFrame(returnStripFrameRef.current);
        returnStripFrameRef.current = null;
      }
      document.documentElement.style.removeProperty(
        "--workspace-v2-return-strip-top",
      );
    };
  }, [activePanel, discoveryView, heroCollapsed, workspaceReturnVisible]);

  const handleProviderDebug = useCallback(
    (event: WorkspaceV2ProviderDebugEvent) => {
      if (event.transition) {
        setLastTransition(event.transition);
      }
      if (event.error) {
        setLastError(event.error);
      }
      setProviderDebug((current) => ({
        adapterMountCount: event.adapterMountCount ?? current.adapterMountCount,
        adapterRenderCount:
          event.adapterRenderCount ?? current.adapterRenderCount,
        adapterUnmountCount:
          event.adapterUnmountCount ?? current.adapterUnmountCount,
        currentIframeSrc: event.currentIframeSrc ?? current.currentIframeSrc,
        iframeLoadCount: event.iframeLoadCount ?? current.iframeLoadCount,
        lastEvent: event.transition ?? current.lastEvent,
        playerMountCount: event.playerMountCount ?? current.playerMountCount,
        playerRenderCount: event.playerRenderCount ?? current.playerRenderCount,
        playerUnmountCount:
          event.playerUnmountCount ?? current.playerUnmountCount,
        providerLoaded: event.providerLoaded ?? current.providerLoaded,
        providerPlaying: event.providerPlaying ?? current.providerPlaying,
        providerReady: event.providerReady ?? current.providerReady,
        youtubeCleanupCount:
          event.youtubeCleanupCount ?? current.youtubeCleanupCount,
      }));
      if (event.transition === "PROVIDER_READY") {
        setPipelineDebug((current) => ({
          ...current,
          providerReadyEventCount: current.providerReadyEventCount + 1,
        }));
      }
      if (event.transition === "PLAY_REQUEST") {
        setPipelineDebug((current) => ({
          ...current,
          playRequestAdapterCount: current.playRequestAdapterCount + 1,
        }));
      }
      if (event.transition === "PLAY_STARTED") {
        setPipelineDebug((current) => ({
          ...current,
          playStartedCount: current.playStartedCount + 1,
        }));
      }
      if (event.transition === "PLAY_FAILED") {
        setPipelineDebug((current) => ({
          ...current,
          playFailedCount: current.playFailedCount + 1,
        }));
      }
      if (debugOpen) {
        recordLog({
          channel: event.error ? "error" : "provider",
          details: event.error ?? event.details,
          message: event.transition ?? "PROVIDER_EVENT",
        });
      }
    },
    [debugOpen, recordLog],
  );

  const handleProviderEvent = useCallback(
    (event: Parameters<typeof controller.handleProviderEvent>[0]) => {
      if (event.type === "ready") {
        setPipelineDebug((current) => ({
          ...current,
          providerReadyHandledCount: current.providerReadyHandledCount + 1,
        }));
      }
      if (event.type === "error") {
        const failedSongId = controller.activeSong?.id ?? null;
        setProviderSkipNotice(
          spanish
            ? "Este contenido no puede reproducirse dentro de First Listen. Saltando automáticamente..."
            : "This content cannot play inside First Listen. Skipping automatically...",
        );
        if (
          controller.canAdvance &&
          providerSkipSongRef.current !== failedSongId
        ) {
          providerSkipSongRef.current = failedSongId;
          if (providerSkipTimeoutRef.current) {
            window.clearTimeout(providerSkipTimeoutRef.current);
          }
          providerSkipTimeoutRef.current = window.setTimeout(() => {
            providerSkipTimeoutRef.current = null;
            if (providerSkipSongRef.current !== failedSongId) return;
            controller.next("error");
          }, 2200);
        }
      } else if (event.type === "ready" || event.type === "playing") {
        setProviderSkipNotice("");
      }
      economy.handleProviderEvent(event, controller.activeSong);
      controller.handleProviderEvent(event);
    },
    [controller, economy, spanish],
  );

  useEffect(() => {
    economy.resetForSong(controller.activeSong);
  }, [controller.activeSong, economy]);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      recordError(
        "Client exception captured",
        event.error instanceof Error
          ? `${event.error.message}\n${event.error.stack ?? ""}`
          : event.message,
      );
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      recordError(
        "Unhandled promise rejection captured",
        event.reason instanceof Error
          ? `${event.reason.message}\n${event.reason.stack ?? ""}`
          : String(event.reason),
      );
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [recordError]);

  const activeSongId = controller.activeSong?.id ?? "none";
  const activePlaybackDurationSeconds = Math.max(
    0,
    Math.floor(
      controller.telemetry.durationSeconds ||
        controller.activeSong?.durationSeconds ||
        0,
    ),
  );
  const nextSong = controller.remainingSongs[0] ?? null;
  const nextSongId = nextSong?.id ?? "none";
  const queueTitle = controller.queue.activeQueue?.title ?? initialQueue.title;
  const queueSource = controller.queue.activeQueue?.source ?? initialQueue.source;
  const localizedQueueTitle =
    queueTitle === "Continuous Discovery" ||
    queueTitle === "Descubrimiento continuo"
      ? spanish
        ? "Cola de reproducción"
        : "Playback queue"
      : queueTitle;
  const positionCurrent = controller.position.current;
  const positionTotal = controller.position.total;
  const remainingCount = controller.remainingSongs.length;

  useEffect(() => {
    let cancelled = false;
    setPlaybackEarningStatus(null);
    if (!controller.activeSong) return;

    const supabase = createClient();
    if (!supabase) return;

    const params: Record<string, unknown> = {
      target_song_id: controller.activeSong.id,
      playback_duration_seconds:
        activePlaybackDurationSeconds > 0
          ? activePlaybackDurationSeconds
          : null,
    };
    if (viewerMode === "guest" && guestToken) {
      params.guest_access_token = guestToken;
    }

    const loadPlaybackEarningStatus = async () => {
      try {
        const { data, error } = await supabase.rpc(
          "get_playback_earning_status",
          params,
        );
        if (cancelled || error) return;
        setPlaybackEarningStatus(
          parsePlaybackEarningStatus(
            firstRow(data as Record<string, unknown>[] | Record<string, unknown> | null),
          ),
        );
      } catch {
        // Older local databases will not have this RPC until the new migration is applied.
      }
    };

    void loadPlaybackEarningStatus();

    return () => {
      cancelled = true;
    };
  }, [
    activePlaybackDurationSeconds,
    activeSongId,
    controller.activeSong,
    economy.state.lastUpdatedAt,
    guestToken,
    viewerMode,
  ]);

  useEffect(() => {
    let cancelled = false;
    setPlaybackEarningOpportunities([]);

    const supabase = createClient();
    if (!supabase) return;

    const params: Record<string, unknown> = {
      p_opportunity_limit: 8,
    };
    if (viewerMode === "guest" && guestToken) {
      params.p_guest_access_token = guestToken;
    }

    const loadPlaybackEarningOpportunities = async () => {
      try {
        const { data, error } = await supabase.rpc(
          "get_playback_earning_opportunities",
          params,
        );
        if (cancelled || error) return;
        setPlaybackEarningOpportunities(
          ((data ?? []) as Record<string, unknown>[])
            .map(parsePlaybackEarningOpportunity)
            .filter(
              (item): item is PlaybackEarningOpportunity => Boolean(item),
            ),
        );
      } catch {
        // Older local databases will not have this RPC until the new migration is applied.
      }
    };

    void loadPlaybackEarningOpportunities();

    return () => {
      cancelled = true;
    };
  }, [
    activeSongId,
    economy.state.lastUpdatedAt,
    guestToken,
    viewerMode,
  ]);

  const sessionValid =
    economy.state.validListenRecorded || controller.validation.validListen;
  const displayedTimePlayed = Math.max(
    controller.telemetry.timeLiveSeconds,
    controller.telemetry.currentProgressSeconds,
  );
  const rewardProgressPercent = canClaimRewards
    ? economy.state.availableRewardCredits > 0
      ? 100
      : Math.min(
          100,
          ((economy.state.bankSeconds %
            Math.max(1, economy.state.minutesPerCredit * 60)) /
            Math.max(1, economy.state.minutesPerCredit * 60)) *
            100,
        )
    : Math.min(
        100,
        (controller.validation.eligibleSeconds /
          Math.max(1, controller.validation.minimumListenSeconds)) *
          100,
      );
  const activePlatform = controller.activeSong?.platform ?? "First Listen";
  const playerIsVideo = Boolean(
    controller.activeSong?.platform.toLowerCase().includes("youtube"),
  );
  const playerMode = controller.activeSong
    ? playerIsVideo
      ? spanish
        ? "Video"
        : "Video"
      : spanish
        ? "Audio"
        : "Audio"
    : spanish
      ? "Listo"
      : "Ready";
  const playbackStatusText = sessionValid
    ? spanish
      ? "Reproducción válida"
      : "Counting"
    : controller.playback.state === "playing"
      ? spanish
        ? "Reproduciendo"
        : "Playing"
      : statusLabel(controller.playback.state, spanish);
  const playbackTrustIndicatorVisible =
    Boolean(controller.activeSong) && controller.playback.state === "playing";
  const playbackTrustIndicatorLabel = spanish
    ? "✔ Reproducción válida"
    : "✔ Valid playback";
  const previewPlaybackEarningStatus: PlaybackEarningStatus | null =
    localPlaybackBankPreview
      ? {
          canEarnMore:
            localPlaybackBankPreview === "fresh" ||
            localPlaybackBankPreview === "partial",
          durationSeconds: activePlaybackDurationSeconds || 240,
          earnedSeconds:
            localPlaybackBankPreview === "fresh"
              ? 0
              : localPlaybackBankPreview === "partial"
                ? Math.max(0, (activePlaybackDurationSeconds || 240) - 120)
                : activePlaybackDurationSeconds || 240,
          remainingSeconds:
            localPlaybackBankPreview === "fresh"
              ? activePlaybackDurationSeconds || 240
              : localPlaybackBankPreview === "partial"
                ? 120
                : 0,
          replayState: localPlaybackBankPreview,
          suggestedResumeSeconds:
            localPlaybackBankPreview === "partial"
              ? Math.max(0, (activePlaybackDurationSeconds || 240) - 120)
              : null,
        }
      : null;
  const effectivePlaybackEarningStatus =
    previewPlaybackEarningStatus ?? playbackEarningStatus;
  const detectedPlaybackBankState = !controller.activeSong
    ? "idle"
    : effectivePlaybackEarningStatus
      ? effectivePlaybackEarningStatus.replayState
      : controller.activeSong.lastHeardAt
      ? "replay"
      : "fresh";
  const playbackBankState = detectedPlaybackBankState;
  const playbackBankRemainingSeconds =
    effectivePlaybackEarningStatus?.remainingSeconds ?? 0;
  const playbackBankResumeSeconds =
    effectivePlaybackEarningStatus?.suggestedResumeSeconds ?? null;
  const playbackBankCanEarnMore =
    effectivePlaybackEarningStatus?.canEarnMore ??
    (playbackBankState === "fresh" || playbackBankState === "partial");
  const playbackBankTitle =
    playbackBankState === "fresh"
      ? spanish
        ? "Canción nueva"
        : "New song"
      : playbackBankState === "partial"
        ? spanish
          ? `Puedes ganar ${clock(playbackBankRemainingSeconds)} restantes`
          : `${clock(playbackBankRemainingSeconds)} still available`
        : playbackBankState === "complete"
          ? spanish
            ? "Tiempo ganado completo"
            : "Earnable time complete"
          : playbackBankState === "replay"
        ? spanish
          ? "Ya la escuchaste"
          : "Heard before"
        : spanish
          ? "Banco preparado"
          : "Bank ready";
  const playbackBankChipText =
    playbackBankState === "partial"
      ? spanish
        ? `Tiempo pendiente • ${clock(playbackBankRemainingSeconds)}`
        : `Available time • ${clock(playbackBankRemainingSeconds)}`
      : playbackBankState === "complete"
        ? spanish
          ? "Tiempo completo"
          : "Time complete"
        : playbackBankState === "replay"
          ? spanish
            ? "Repetida"
            : "Replay"
          : "";
  const currentPlaybackOpportunity: PlaybackEarningOpportunity | null =
    controller.activeSong &&
    playbackBankState === "partial" &&
    playbackBankCanEarnMore &&
    playbackBankRemainingSeconds > 0
      ? {
          artist: controller.activeSong.artist,
          coverUrl: controller.activeSong.coverUrl,
          durationSeconds:
            effectivePlaybackEarningStatus?.durationSeconds ??
            activePlaybackDurationSeconds,
          earnedSeconds: effectivePlaybackEarningStatus?.earnedSeconds ?? 0,
          remainingSeconds: playbackBankRemainingSeconds,
          songId: controller.activeSong.id,
          suggestedResumeSeconds: playbackBankResumeSeconds,
          title: controller.activeSong.title,
        }
      : null;
  const playbackBankOpportunityMap = new Map<string, PlaybackEarningOpportunity>();
  playbackEarningOpportunities.forEach((item) =>
    playbackBankOpportunityMap.set(item.songId, item),
  );
  if (currentPlaybackOpportunity) {
    playbackBankOpportunityMap.set(
      currentPlaybackOpportunity.songId,
      currentPlaybackOpportunity,
    );
  }
  const playbackBankVisibleOpportunities = Array.from(
    playbackBankOpportunityMap.values(),
  ).slice(0, 5);
  const playbackBankHasOpportunities =
    playbackBankVisibleOpportunities.length > 0;
  const playbackBankMenuLabel = playbackBankHasOpportunities
    ? spanish
      ? `Tiempo disponible (${playbackBankVisibleOpportunities.length})`
      : `Available time (${playbackBankVisibleOpportunities.length})`
    : spanish
      ? "Tiempo disponible"
      : "Available time";
  const playbackBankMenuAvailable =
    Boolean(controller.activeSong) &&
    (playbackBankHasOpportunities ||
      playbackBankState === "partial");
  const playbackBankChipVisible =
    Boolean(playbackBankChipText) &&
    (playbackBankState === "partial" ||
      playbackBankState === "complete" ||
      playbackBankState === "replay");
  const heroHeadline = workspaceSessionHeadline({
    activeSong: controller.activeSong,
    resumeTitle: resumedSession?.currentSongTitle ?? null,
    spanish,
  });
  const bankSecondsForDisplay =
    viewerMode === "guest"
      ? controller.validation.eligibleSeconds
      : economy.state.bankSeconds;
  const exchangeSeconds = Math.max(1, economy.state.minutesPerCredit * 60);
  const secondsUntilReward =
    viewerMode === "guest"
      ? Math.max(
          0,
          controller.validation.minimumListenSeconds -
            controller.validation.eligibleSeconds,
        )
      : Math.max(0, economy.state.secondsToNextCredit);
  const rewardReady =
    viewerMode !== "guest" && economy.state.availableRewardCredits > 0;
  const rewardStatusText =
    viewerMode === "guest"
      ? spanish
        ? "Crea una cuenta gratis para activar recompensas."
        : "Create a free account to activate rewards."
      : rewardReady
        ? spanish
          ? "Token listo para reclamar"
          : "Token ready to claim"
        : `${clock(secondsUntilReward)} ${
            spanish ? "para el próximo token" : "to next token"
          }`;
  const bankProgressPercent =
    viewerMode === "guest"
      ? Math.min(
          100,
          (controller.validation.eligibleSeconds /
            Math.max(1, controller.validation.minimumListenSeconds)) *
            100,
        )
      : rewardReady
        ? 100
        : Math.min(
          100,
          ((bankSecondsForDisplay % exchangeSeconds) / exchangeSeconds) * 100,
        );
  const activeQueueSongs = controller.queue.activeQueue?.songs ?? initialQueue.songs;
  const discoveryCatalogSongs = initialQueue.songs;
  const consumedSongs = activeQueueSongs.filter((song) =>
    controller.queue.consumedSongIds.includes(song.id),
  );
  const activeArtist = controller.activeSong?.artist;
  const supportedArtistCount = new Set(
    [
      ...consumedSongs.map((song) => song.artist).filter(Boolean),
      sessionValid && activeArtist ? activeArtist : "",
    ].filter(Boolean),
  ).size;
  const songsListenedToday =
    viewerMode === "guest"
      ? Math.max(consumedSongs.length, sessionValid ? 1 : 0)
      : Math.max(economy.state.todayValidListens, consumedSongs.length);
  const artistsSupportedToday = Math.max(supportedArtistCount, 0);
  const playbackStreak =
    controller.playback.state === "playing"
      ? spanish
        ? "Activa"
        : "Active"
      : sessionValid
        ? spanish
          ? "En progreso"
          : "In progress"
        : spanish
          ? "Empieza al reproducir"
          : "Starts when you play";
  const minutesListenedToday =
    viewerMode === "guest"
      ? Math.floor(controller.validation.eligibleSeconds / 60)
      : Math.floor(
          Math.max(economy.state.todayListeningSeconds, displayedTimePlayed) /
            60,
        );
  const compactHero = heroCollapsed || productivityMode;
  const playerSurfaceStyle: CSSProperties | undefined =
    controller.activeSong && !playerIsVideo && controller.activeSong.coverUrl
      ? {
          backgroundImage: `linear-gradient(135deg, rgba(7, 16, 9, 0.5), rgba(7, 16, 9, 0.92)), url("${controller.activeSong.coverUrl}")`,
        }
      : undefined;

  useEffect(() => {
    setProviderSkipNotice("");
    providerSkipSongRef.current = null;
    if (providerSkipTimeoutRef.current) {
      window.clearTimeout(providerSkipTimeoutRef.current);
      providerSkipTimeoutRef.current = null;
    }
  }, [activeSongId]);

  useEffect(
    () => () => {
      if (providerSkipTimeoutRef.current) {
        window.clearTimeout(providerSkipTimeoutRef.current);
      }
    },
    [],
  );

  const revealMetadataOverlay = useCallback(() => {
    if (!playerIsVideo) return;
    setMetadataOverlayVisible(true);
  }, [playerIsVideo]);

  useEffect(() => {
    setMetadataOverlayVisible(playerIsVideo);
  }, [activeSongId, playerIsVideo]);

  useEffect(() => {
    if (!playerIsVideo) return;
    if (
      controller.playback.state === "playing" ||
      controller.playback.state === "paused" ||
      controller.playback.state === "ready"
    ) {
      setMetadataOverlayVisible(true);
    }
  }, [controller.playback.state, playerIsVideo]);

  useEffect(() => {
    if (!playerIsVideo || !metadataOverlayVisible) return;
    const timeout = window.setTimeout(
      () => setMetadataOverlayVisible(false),
      3200,
    );
    return () => window.clearTimeout(timeout);
  }, [metadataOverlayVisible, playerIsVideo]);

  useEffect(() => {
    const pending = controller.playback.pendingCommand;
    const key = `${pending.command}:${activeSongId}:${controller.playback.lastEventAt}`;
    if (commandRef.current === key) return;
    commandRef.current = key;
    if (pending.command !== "play") return;
    setPipelineDebug((current) => ({
      ...current,
      playRequestEmittedCount: current.playRequestEmittedCount + 1,
    }));
    if (debugOpen) {
      recordLog({
        channel: "transition",
        details: `${activeSongId} / ${controller.activeSong?.title ?? "Unknown song"}`,
        message: "PLAY_REQUEST emitted",
      });
    }
  }, [
    activeSongId,
    controller.activeSong,
    controller.playback.lastEventAt,
    controller.playback.pendingCommand,
    debugOpen,
    recordLog,
  ]);

  useEffect(() => {
    const key = `${controller.playback.state}:${activeSongId}:${controller.playback.error ?? ""}`;
    if (playbackRef.current === key) return;
    playbackRef.current = key;
    if (controller.playback.state === "playing") {
      recordTransition(
        "PLAY_STARTED",
        `${activeSongId} / ${controller.activeSong?.title ?? "Unknown song"}`,
      );
    }
    if (controller.playback.state === "error") {
      recordError(
        "PLAY_FAILED",
        controller.playback.error ?? "Playback machine entered error state.",
      );
    }
    if (debugOpen) {
      setLogs((current) =>
        pushLog(current, {
          at: Date.now(),
          channel: "playback",
          details: controller.activeSong
            ? `${controller.activeSong.title} / ${controller.activeSong.platform}`
            : controller.playback.error ?? undefined,
          message: `Estado: ${statusLabel(controller.playback.state, spanish)}`,
        }),
      );
    }
  }, [
    activeSongId,
    controller.activeSong,
    controller.playback.error,
    controller.playback.state,
    debugOpen,
    recordError,
    recordTransition,
    spanish,
  ]);

  useEffect(() => {
    const key = `${positionCurrent}:${positionTotal}:${remainingCount}:${activeSongId}:${controller.queue.lastAdvanceReason ?? ""}`;
    if (queueRef.current === key) return;
    queueRef.current = key;
    if (debugOpen) {
      setLogs((current) =>
        pushLog(current, {
          at: Date.now(),
          channel: "queue",
          details: `${positionCurrent}/${positionTotal} - ${remainingCount} restantes`,
          message: controller.queue.lastAdvanceReason ?? "queue_sync",
        }),
      );
    }
    if (
      activeSongId !== "none" &&
      controller.queue.lastAdvanceReason &&
      controller.queue.lastAdvanceReason !== "load_queue"
    ) {
      recordTransition(
        "NEXT_LOADED",
        `${activeSongId} / ${controller.activeSong?.title ?? "Unknown song"}`,
      );
    }
  }, [
    activeSongId,
    controller.activeSong,
    controller.queue.lastAdvanceReason,
    debugOpen,
    positionCurrent,
    positionTotal,
    recordTransition,
    remainingCount,
  ]);

  useEffect(() => {
    const key = `${controller.validation.validListen}:${controller.validation.fairSkipAvailable}:${controller.validation.completeListen}:${controller.validation.lastRejectionReason ?? ""}`;
    if (validationRef.current === key) return;
    validationRef.current = key;
    if (debugOpen) {
      setLogs((current) =>
        pushLog(current, {
          at: Date.now(),
          channel: "validation",
          details:
            controller.validation.lastRejectionReason ??
            `${clock(controller.validation.eligibleSeconds)} elegibles / minimo ${clock(
              controller.validation.minimumListenSeconds,
            )}`,
          message: controller.validation.validListen
            ? "Escucha valida"
            : "Validacion actualizada",
        }),
      );
    }
  }, [
    controller.validation.completeListen,
    controller.validation.eligibleSeconds,
    controller.validation.fairSkipAvailable,
    controller.validation.lastRejectionReason,
    controller.validation.minimumListenSeconds,
    controller.validation.validListen,
    debugOpen,
  ]);

  const telemetryBucket = Math.floor(
    controller.telemetry.currentProgressSeconds / 10,
  );
  useEffect(() => {
    const key = `${telemetryBucket}:${controller.telemetry.playbackState}:${controller.telemetry.validListen}:${controller.telemetry.pageVisible}:${controller.telemetry.pageFocused}`;
    if (telemetryRef.current === key) return;
    telemetryRef.current = key;
    if (debugOpen) {
      setLogs((current) =>
        pushLog(current, {
          at: Date.now(),
          channel: "telemetry",
          details: `progreso=${clock(controller.telemetry.currentProgressSeconds)} duracion=${clock(
            controller.telemetry.durationSeconds,
          )} visible=${controller.telemetry.pageVisible ?? "?"} focus=${controller.telemetry.pageFocused ?? "?"}`,
          message: statusLabel(controller.telemetry.playbackState, spanish),
        }),
      );
    }
  }, [
    controller.telemetry.currentProgressSeconds,
    controller.telemetry.durationSeconds,
    controller.telemetry.pageFocused,
    controller.telemetry.pageVisible,
    controller.telemetry.playbackState,
    controller.telemetry.validListen,
    debugOpen,
    spanish,
    telemetryBucket,
  ]);

  const handlePlay = useCallback(() => {
    try {
      if (controller.activeSong) {
        if (trustedPlaybackRequestRef.current) {
          trustedPlaybackRequestRef.current();
        } else {
          dispatchWorkspaceV2PlaybackCommand("play", {
            channel: WORKSPACE_V2_PLAYBACK_COMMAND_CHANNEL,
            source: "user-click",
          });
        }
      }
      economy.markInteraction();
      setPipelineDebug((current) => ({
        ...current,
        playButtonRequestCount: current.playButtonRequestCount + 1,
      }));
      recordTransition(
        "PLAY_REQUEST",
        `${activeSongId} / ${controller.activeSong?.title ?? "No song"}`,
      );
      controller.play();
    } catch (error) {
      recordError(
        "PLAY_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [activeSongId, controller, economy, recordError, recordTransition]);

  const handlePlayClick = useCallback(() => {
    handlePlay();
  }, [handlePlay]);

  const handlePause = useCallback(() => {
    economy.markInteraction();
    controller.pause();
  }, [controller, economy]);

  const handlePlaybackBankSeek = useCallback(
    (seconds: number) => {
      if (!controller.activeSong) return;
      try {
        economy.markInteraction();
        dispatchWorkspaceV2PlaybackCommand("seek", {
          autoPlay: true,
          channel: WORKSPACE_V2_PLAYBACK_COMMAND_CHANNEL,
          seconds,
          source: "user-click",
        });
        controller.play();
        recordTransition(
          "PLAYBACK_BANK_SEEK",
          `${controller.activeSong.id} / ${Math.max(0, Math.floor(seconds))}s`,
        );
      } catch (error) {
        recordError(
          "PLAYBACK_BANK_SEEK_FAILED",
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [controller, economy, recordError, recordTransition],
  );

  const handleNext = useCallback(() => {
    try {
      economy.markInteraction();
      recordTransition("NEXT_REQUEST", `${activeSongId} -> ${nextSongId}`);
      if (!controller.canAdvance) {
        recordError("NEXT_FAILED", "Queue cannot advance from current state.");
        return;
      }
      controller.next();
    } catch (error) {
      recordError(
        "NEXT_FAILED",
        error instanceof Error
          ? `${error.message}\n${error.stack ?? ""}`
          : String(error),
      );
    }
  }, [activeSongId, controller, economy, nextSongId, recordError, recordTransition]);

  const handleDiscoveryStyleChange = useCallback(
    (styleId: WorkspaceV2DiscoveryStyleId) => {
      setSelectedDiscoveryStyle(styleId);
      if (typeof window === "undefined") return;
      const nextUrl = new URL(window.location.href);
      if (styleId === "all") {
        nextUrl.searchParams.delete("style");
      } else {
        nextUrl.searchParams.set("style", styleId);
      }
      window.history.replaceState(
        {
          firstListenWorkspace: true,
          discoveryStyle: styleId,
          discoveryView,
        },
        "",
        nextUrl,
      );
    },
    [discoveryView],
  );

  const handleDiscoveryViewChange = useCallback(
    (view: WorkspaceV2DiscoveryView) => {
      const nextStyle: WorkspaceV2DiscoveryStyleId = "all";
      setDiscoveryView(view);
      setSelectedDiscoveryStyle(nextStyle);
      if (typeof window === "undefined") return;

      const nextUrl = new URL(window.location.href);
      if (view === "home") {
        nextUrl.searchParams.delete("discover");
        nextUrl.searchParams.delete("style");
      } else {
        nextUrl.searchParams.set("discover", view);
        nextUrl.searchParams.delete("style");
      }

      const historyMethod = view === "home" ? "replaceState" : "pushState";
      window.history[historyMethod](
        {
          firstListenWorkspace: true,
          discoveryStyle: nextStyle,
          discoveryView: view,
        },
        "",
        nextUrl,
      );
    },
    [],
  );

  const handlePanelChange = useCallback((panel: WorkspaceV2Panel) => {
    setActivePanel(panel);
    if (panel === "discover") {
      setDiscoveryView("home");
      setSelectedDiscoveryStyle("all");
      if (typeof window !== "undefined") {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete("discover");
        nextUrl.searchParams.delete("style");
        window.history.replaceState(
          {
            firstListenWorkspace: true,
            discoveryStyle: "all",
            discoveryView: "home",
          },
          "",
          nextUrl,
        );
      }
    }
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 900px)").matches
    ) {
      setSidebarExpanded(false);
    }
  }, []);

  const handleWorkspaceReturn = useCallback(() => {
    if (activePanel === "discover" && discoveryView !== "home") {
      handleDiscoveryViewChange("home");
      return;
    }
    handlePanelChange("discover");
  }, [
    activePanel,
    discoveryView,
    handleDiscoveryViewChange,
    handlePanelChange,
  ]);

  const handleMobileSubmitCta = useCallback(() => {
    if (viewerMode === "guest") {
      window.location.assign("/signup?next=/dashboard");
      return;
    }

    handlePanelChange("submit");
  }, [handlePanelChange, viewerMode]);

  const handleThemeToggle = useCallback(() => {
    setDarkMode((current) => !current);
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 620px) and (orientation: portrait)").matches
    ) {
      setSidebarExpanded(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncDiscoveryFromUrl = () => {
      const currentUrl = new URL(window.location.href);
      const view = normalizeWorkspaceV2DiscoveryView(
        currentUrl.searchParams.get("discover"),
      );
      const style = normalizeWorkspaceV2DiscoveryStyle(
        currentUrl.searchParams.get("style"),
      );
      setDiscoveryView(view);
      setSelectedDiscoveryStyle(view === "home" ? "all" : style);
      if (view !== "home") {
        setActivePanel("discover");
      }
    };

    syncDiscoveryFromUrl();
    window.addEventListener("popstate", syncDiscoveryFromUrl);
    return () => window.removeEventListener("popstate", syncDiscoveryFromUrl);
  }, []);

  const handleFullscreen = useCallback(async () => {
    const target = heroRef.current;
    if (!target || typeof document === "undefined") return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await target.requestFullscreen();
      }
    } catch (error) {
      recordError(
        "FULLSCREEN_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [recordError]);

  const handleFocusPlayer = useCallback(() => {
    heroRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mobilePortrait = window.matchMedia(
      "(max-width: 620px) and (orientation: portrait)",
    ).matches;
    if (!mobilePortrait) return;
    if (activePanel === "discover" && discoveryView === "home") return;

    const timeout = window.setTimeout(() => {
      const panel = document.querySelector<HTMLElement>(
        ".workspace-v2-content-panel",
      );
      panel?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 120);

    return () => window.clearTimeout(timeout);
  }, [activePanel, discoveryView]);

  const handlePlayInternalDiscoverySongs = useCallback(
    ({
      songs,
      startSongId,
      title,
    }: {
      songs: WorkspaceV2Song[];
      startSongId: string;
      title: string;
    }) => {
      if (!songs.length) return;
      const startIndex = Math.max(
        0,
        songs.findIndex((song) => song.id === startSongId),
      );
      const nextQueue: WorkspaceV2Queue = {
        id: `manual-${selectedDiscoveryStyle}-${Date.now()}`,
        mode: selectedDiscoveryStyle === "all" ? "discovery" : "genre",
        source: "manual",
        songs,
        title,
      };
      economy.markInteraction();
      loadQueue(nextQueue, { autoPlay: true, startIndex });
      setQueueBootstrapped(true);
      recordTransition(
        "LOAD_SONG",
        `${title}: ${songs[startIndex]?.id ?? startSongId} / ${
          songs[startIndex]?.title ?? "Selected song"
        }`,
      );
      handleFocusPlayer();
    },
    [
      economy,
      handleFocusPlayer,
      loadQueue,
      recordTransition,
      selectedDiscoveryStyle,
    ],
  );

  const handleSignOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const supabase = createClient();
      if (supabase) {
        await supabase.auth.signOut();
      }
      window.localStorage.removeItem("first-listen-guest-token");
      window.sessionStorage.removeItem("first-listen-pending-email");
      document.cookie =
        "first-listen-guest-token=; Max-Age=0; Path=/; SameSite=Lax";
    } finally {
      window.location.assign("/login?next=/dashboard");
    }
  }, [signingOut]);

  const navItems = useMemo(
    () =>
      [
        { icon: Compass, id: "discover" as const, mobileIcon: "🎵" },
        { icon: Send, id: "submit" as const, mobileIcon: "➕" },
        { icon: User, id: "profile" as const, mobileIcon: "👤" },
        ...(canAccessFounderOperations
          ? [
              {
                icon: Gauge,
                id: "founder-operations" as const,
                mobileIcon: "FO",
              },
            ]
          : []),
        ...(canAccessAdmin
          ? [
              { icon: ShieldCheck, id: "owner" as const, mobileIcon: "🛡" },
              { icon: Wrench, id: "admin" as const, mobileIcon: "⚙" },
            ]
          : []),
      ],
    [canAccessAdmin, canAccessFounderOperations],
  );

  const mobileNavItems = useMemo(
    () => navItems.filter((item) => viewerMode !== "guest" || item.id !== "submit"),
    [navItems, viewerMode],
  );

  return (
    <section
      className={`workspace-v2-product-shell${darkMode ? " theme-dark" : ""}`}
      data-active-panel={activePanel}
      data-discovery-view={discoveryView}
      data-sidebar={sidebarExpanded ? "expanded" : "compact"}
      data-viewer-mode={viewerMode}
      data-workspace-mode={workspaceMode}
      data-workspace-version="2"
    >
      <aside className="workspace-v2-product-nav" aria-label="Workspace navigation">
        <div className="workspace-v2-product-brand">
          <span>FIRST LISTEN</span>
          <em className="workspace-v2-beta-status">
            {spanish ? "Beta pública" : "Public Beta"}
          </em>
          <small>{displayIdentity}</small>
        </div>
        <button
          aria-label={spanish ? "Subir canción" : "Upload song"}
          className="workspace-v2-mobile-submit-cta"
          onClick={handleMobileSubmitCta}
          type="button"
        >
          <span aria-hidden="true">🎵</span>
          <strong>{spanish ? "Subir" : "Upload"}</strong>
        </button>
        <button
          aria-expanded={sidebarExpanded}
          aria-label={
            sidebarExpanded
              ? spanish
                ? "Contraer navegacion"
                : "Collapse navigation"
              : spanish
                ? "Expandir navegacion"
                : "Expand navigation"
          }
          className="workspace-v2-sidebar-toggle"
          onClick={() => setSidebarExpanded((current) => !current)}
          type="button"
        >
          {sidebarExpanded ? (
            <PanelLeftClose className="workspace-v2-desktop-sidebar-icon" size={17} />
          ) : (
            <PanelLeftOpen className="workspace-v2-desktop-sidebar-icon" size={17} />
          )}
          <MoreHorizontal className="workspace-v2-mobile-more-icon" size={18} />
          <span>{sidebarExpanded ? (spanish ? "Contraer" : "Collapse") : "Menu"}</span>
        </button>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                aria-current={activePanel === item.id ? "page" : undefined}
                className={activePanel === item.id ? "active" : ""}
                key={item.id}
                onClick={() => handlePanelChange(item.id)}
                type="button"
              >
                <Icon size={17} />
                <span>{panelLabel(item.id, spanish)}</span>
              </button>
            );
          })}
        </nav>
        <PwaInstallButton
          className="workspace-v2-nav-action workspace-v2-install-action"
          compact
          locale={workspaceLocale}
        />
        <div
          aria-label={spanish ? "Selector de idioma" : "Language selector"}
          className="workspace-v2-language-switcher"
          role="group"
        >
          <button
            aria-pressed={workspaceLocale === "es"}
            className={workspaceLocale === "es" ? "active" : ""}
            onClick={() => handleWorkspaceLocaleChange("es")}
            type="button"
          >
            ES
          </button>
          <span aria-hidden="true">|</span>
          <button
            aria-pressed={workspaceLocale === "en"}
            className={workspaceLocale === "en" ? "active" : ""}
            onClick={() => handleWorkspaceLocaleChange("en")}
            type="button"
          >
            EN
          </button>
        </div>
        <button
          aria-label={
            darkMode
              ? spanish
                ? "Usar modo claro"
                : "Use light theme"
              : spanish
                ? "Usar modo oscuro"
                : "Use dark theme"
          }
          className="workspace-v2-nav-action"
          onClick={handleThemeToggle}
          type="button"
        >
          {darkMode ? <Sun size={17} /> : <Moon size={17} />}
          <span>{darkMode ? (spanish ? "Modo claro" : "Light mode") : (spanish ? "Modo oscuro" : "Dark mode")}</span>
        </button>
        {debugAllowed && (
          <button
            className="workspace-v2-debug-toggle"
            onClick={() => setDebugOpen((current) => !current)}
            type="button"
          >
            <Gauge size={15} />
            <span>
              {debugOpen
                ? spanish
                  ? "Ocultar debug"
                  : "Hide debug"
                : spanish
                  ? "Debug Founder"
                  : "Founder debug"}
            </span>
          </button>
        )}
        <div
          aria-label={spanish ? "Acciones rápidas móviles" : "Mobile quick actions"}
          className="workspace-v2-mobile-action-row"
        >
          {mobileNavItems.map((item) => (
            <button
              aria-current={activePanel === item.id ? "page" : undefined}
              aria-label={panelLabel(item.id, spanish)}
              className={activePanel === item.id ? "active" : ""}
              key={`mobile-${item.id}`}
              onClick={() => handlePanelChange(item.id)}
              type="button"
            >
              <span aria-hidden="true">{item.mobileIcon}</span>
            </button>
          ))}
          <PwaInstallButton
            className="workspace-v2-mobile-install-action"
            compact
            iconOnly
            locale={workspaceLocale}
            onAfterRequest={() => setSidebarExpanded(false)}
          />
          <button
            aria-label={
              darkMode
                ? spanish
                  ? "Usar modo claro"
                  : "Use light theme"
                : spanish
                  ? "Usar modo oscuro"
                  : "Use dark theme"
            }
            onClick={handleThemeToggle}
            type="button"
          >
            <span aria-hidden="true">{darkMode ? "☀" : "🌙"}</span>
          </button>
          <button
            aria-label={spanish ? "Cerrar sesión" : "Sign out"}
            disabled={signingOut}
            onClick={() => {
              setSidebarExpanded(false);
              void handleSignOut();
            }}
            type="button"
          >
            <span aria-hidden="true">🚪</span>
          </button>
        </div>
        <button
          className="workspace-v2-signout-button"
          disabled={signingOut}
          onClick={handleSignOut}
          type="button"
        >
          <LogOut size={15} />
          <span>
            {signingOut
              ? spanish
                ? "Saliendo..."
                : "Signing out..."
                : viewerMode === "guest"
                  ? spanish
                    ? "Cambiar cuenta"
                    : "Switch account"
                : spanish
                  ? "Cerrar sesion"
                  : "Sign out"}
          </span>
        </button>
      </aside>

      <main className="workspace-v2-product-main">
        <section
          className="workspace-v2-product-hero"
          data-collapsed={compactHero ? "true" : "false"}
          data-player-mode={playerIsVideo ? "video" : "audio"}
          data-workspace-mode={workspaceMode}
          ref={heroRef}
        >
          <div className="workspace-v2-hero-copy">
            <span className="eyebrow">
              {playerMode} / {activePlatform}
            </span>
            <h1>{heroHeadline}</h1>
            <p>
              {controller.activeSong?.artist ??
                (spanish
                  ? "Descubre música nueva y apoya creadores reales."
                  : "Discover new music and support real creators.")}
            </p>
            <small className="workspace-v2-mission-line">
              {spanish
                ? "Escucha. Apoya. Gana tiempo. Sube tu música."
                : "Listen. Support. Earn time. Submit your music."}
            </small>
          </div>

          {localPlaybackBankPreview && (
            <small
              className="workspace-v2-local-bank-preview"
              data-bank-state={playbackBankState}
            >
              {spanish ? "Vista local" : "Local preview"}:{" "}
              {playbackBankTitle}
            </small>
          )}

          <div
            className="workspace-v2-player-surface"
            data-player-mode={playerIsVideo ? "video" : "audio"}
            data-overlay-visible={metadataOverlayVisible ? "true" : "false"}
            onMouseEnter={revealMetadataOverlay}
            onMouseMove={revealMetadataOverlay}
            onPointerDown={revealMetadataOverlay}
            style={playerSurfaceStyle}
          >
            <WorkspaceV2ProviderPlayerAdapter
              command={controller.playback.pendingCommand}
              locale={workspaceLocale}
              onDebug={handleProviderDebug}
              onEvent={handleProviderEvent}
              onTrustedPlaybackRequestReady={registerTrustedPlaybackRequest}
              song={controller.activeSong}
            />
            {playerIsVideo && (
              <div
                aria-hidden="true"
                className="workspace-v2-video-metadata-overlay"
                data-visible={metadataOverlayVisible ? "true" : "false"}
              >
                <span>{spanish ? "Ahora suena" : "Now Playing"}</span>
                <strong>{nowPlayingLabel(controller.activeSong, spanish)}</strong>
                <small>
                  {controller.activeSong?.artist ??
                    (spanish ? "First Listen" : "First Listen")}
                </small>
              </div>
            )}
            {providerSkipNotice && (
              <div className="workspace-v2-provider-skip-notice" role="status">
                {providerSkipNotice}
              </div>
            )}
          </div>

          <div
            aria-hidden={!compactHero}
            className="workspace-v2-compact-listener-status"
          >
            <article>
              <span>{spanish ? "Ahora" : "Now"}</span>
              <strong>{heroHeadline}</strong>
            </article>
            <article>
              <span>{spanish ? "Siguiente" : "Next"}</span>
              <strong>{nextSong?.title ?? "-"}</strong>
            </article>
            <article>
              <span>{spanish ? "Banco" : "Time Bank"}</span>
              <strong>{clock(bankSecondsForDisplay)}</strong>
            </article>
            <article>
              <span>{spanish ? "Recompensa" : "Reward"}</span>
              <strong>{rewardStatusText}</strong>
            </article>
          </div>

          <div className="workspace-v2-sticky-controls">
            <button
              onClick={handlePlayClick}
              type="button"
            >
              <Play size={16} /> {spanish ? "Reproducir" : "Play"}
            </button>
            <button onClick={handlePause} type="button">
              <Pause size={16} /> {spanish ? "Pausa" : "Pause"}
            </button>
            <button
              disabled={!controller.canAdvance}
              onClick={handleNext}
              type="button"
            >
              <SkipForward size={16} /> {spanish ? "Siguiente" : "Next"}
            </button>
            <button onClick={handleFullscreen} type="button">
              <Maximize2 size={16} />{" "}
              {spanish ? "Pantalla completa" : "Fullscreen"}
            </button>
            {playbackBankChipVisible && (
              <span
                className="workspace-v2-playback-bank-chip"
                data-bank-state={playbackBankState}
              >
                <Clock3 size={14} aria-hidden="true" />
                {playbackBankChipText}
              </span>
            )}
            {rewardReady && (
              <button
                className="workspace-v2-claim-token-control"
                disabled={!canClaimRewards}
                onClick={economy.claimReward}
                type="button"
              >
                <Coins size={16} />
                {spanish ? "Reclamar token" : "Claim token"}
              </button>
            )}
            {playbackBankMenuAvailable && (
              <button
                aria-expanded={playbackBankMenuOpen}
                className="workspace-v2-playback-bank-menu-trigger"
                onClick={() =>
                  setPlaybackBankMenuOpen((current) => !current)
                }
                type="button"
              >
                <Clock3 size={16} /> {playbackBankMenuLabel}
              </button>
            )}
            {playbackTrustIndicatorVisible && (
              <div
                aria-hidden="true"
                className="workspace-v2-playback-trust-pill"
                data-playback-state={controller.playback.state}
                data-valid-playback={sessionValid ? "true" : "false"}
              >
                <strong>{playbackTrustIndicatorLabel}</strong>
                <i aria-hidden="true">•</i>
                <em>{clock(displayedTimePlayed)}</em>
              </div>
            )}
            <span className="workspace-v2-queue-position-pill">
              {queueSourceLabel(queueSource, spanish)} • {positionCurrent}{" "}
              {spanish ? "de" : "of"} {positionTotal}
            </span>
          </div>

          {playbackBankMenuOpen && playbackBankMenuAvailable && (
            <section
              className="workspace-v2-playback-bank-menu"
              role="status"
            >
              <div className="workspace-v2-playback-bank-menu-heading">
                <div>
                  <span>
                    {spanish ? "Tiempo disponible" : "Available time"}
                  </span>
                  <strong>
                    {spanish
                      ? "Termina canciones pendientes cuando quieras."
                      : "Finish pending songs whenever you want."}
                  </strong>
                </div>
                <button
                  aria-label={spanish ? "Cerrar" : "Close"}
                  onClick={() => setPlaybackBankMenuOpen(false)}
                  type="button"
                >
                  <X size={15} />
                </button>
              </div>
              {playbackBankVisibleOpportunities.length ? (
                <ol className="workspace-v2-playback-bank-menu-list">
                  {playbackBankVisibleOpportunities.map((item) => {
                    const isCurrentSong = item.songId === activeSongId;
                    return (
                      <li key={item.songId}>
                        <div>
                          <strong>{item.title}</strong>
                          <small>
                            {item.artist} • {clock(item.remainingSeconds)}{" "}
                            {spanish ? "disponibles" : "available"}
                          </small>
                        </div>
                        {isCurrentSong ? (
                          <div className="workspace-v2-playback-bank-menu-actions">
                            {item.suggestedResumeSeconds !== null && (
                              <button
                                type="button"
                                onClick={() =>
                                  handlePlaybackBankSeek(
                                    item.suggestedResumeSeconds ?? 0,
                                  )
                                }
                              >
                                {spanish ? "Reanudar" : "Resume"}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handlePlaybackBankSeek(0)}
                            >
                              {spanish ? "Inicio" : "Start"}
                            </button>
                          </div>
                        ) : (
                          <small className="workspace-v2-playback-bank-menu-note">
                            {spanish
                              ? "La cola puede llegar aquí automáticamente."
                              : "The queue can reach this automatically."}
                          </small>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p>
                  {spanish
                    ? "La cola seguirá reproduciendo música nueva. Cuando haya canciones con tiempo pendiente, aparecerán aquí."
                    : "The queue will keep playing new music. Songs with available time will appear here."}
                </p>
              )}
            </section>
          )}

          {controller.activeSong && (
            <WorkspaceV2ActiveSongActions
              locale={workspaceLocale}
              song={controller.activeSong}
              guestToken={guestToken}
              viewerMode={viewerMode}
            />
          )}
        </section>

        {resumedSession && (
          <section className="workspace-v2-resume-card" role="status">
            <div>
              <span className="eyebrow">
                {spanish ? "Sesión restaurada" : "Session restored"}
              </span>
              <h2>
                {spanish
                  ? "Continuando tu sesión"
                  : "Continuing your session"}
              </h2>
              <p>
                {resumedSession.currentSongTitle} /{" "}
                {clock(resumedSession.playbackPositionSeconds)}
              </p>
            </div>
            <div className="workspace-v2-resume-actions">
              <button onClick={handleStartNewSession} type="button">
                {spanish ? "Nueva sesión" : "New session"}
              </button>
            </div>
          </section>
        )}

        {!resumeChecked && (
          <section className="workspace-v2-resume-card" role="status">
            <div>
              <span className="eyebrow">
                {spanish ? "Preparando cola" : "Preparing queue"}
              </span>
              <h2>
                {spanish
                  ? "Buscando tu ultima sesion"
                  : "Checking for saved session"}
              </h2>
            </div>
          </section>
        )}

        <section
          className="workspace-v2-trust-layer"
          data-founder-benefits={
            founderSubmissionsRemaining > 0 && viewerMode !== "guest"
              ? "true"
              : "false"
          }
          aria-label={spanish ? "Estado de reproducción" : "Playback status"}
        >
          <article className="workspace-v2-session-card">
            <span>{spanish ? "Reproducción" : "Playback"}</span>
            <strong>{playbackStatusText}</strong>
          </article>
          <article>
            <span>{spanish ? "Tiempo reproducido" : "Playback Time"}</span>
            <strong>{clock(displayedTimePlayed)}</strong>
          </article>
          <article className="workspace-v2-time-bank-card">
            <span>{spanish ? "Banco de Tiempo" : "Time Bank"}</span>
            <strong>{clock(bankSecondsForDisplay)}</strong>
            <small>
              {viewerMode === "guest"
                ? spanish
                  ? "Tu progreso se guarda. Crea una cuenta gratis para activar recompensas."
                  : "Your progress is saved. Create a free account to activate rewards."
                : rewardReady
                  ? spanish
                    ? "Recompensa disponible ahora"
                    : "Reward available now"
                  : spanish
                    ? `${clock(secondsUntilReward)} hasta el próximo token`
                    : `${clock(secondsUntilReward)} until next token`}
            </small>
            <small className="workspace-v2-time-bank-explainer">
              {spanish
                ? "Tu tiempo de reproducción se convierte en tokens para enviar música."
                : "Your playback time turns into tokens to submit music."}
            </small>
            <i>
              <b style={{ width: `${rewardReady ? 100 : bankProgressPercent}%` }} />
            </i>
          </article>
          <article className="workspace-v2-token-card">
            <span>{spanish ? "Balance de tokens" : "Token Balance"}</span>
            <strong>
              {viewerMode === "guest"
                ? spanish
                  ? "Activa al registrarte"
                  : "Activate by joining"
                : economy.state.credits}
            </strong>
          </article>
          {founderSubmissionsRemaining > 0 && viewerMode !== "guest" && (
            <article className="workspace-v2-founder-submissions-card">
              <span>
                {spanish
                  ? "Envíos Founder gratis"
                  : "Founder Free Submissions"}
              </span>
              <strong>{founderSubmissionsRemaining}</strong>
            </article>
          )}
          <article className="workspace-v2-reward-progress">
            <span>{spanish ? "Progreso de recompensa" : "Reward Progress"}</span>
            <strong>{rewardStatusText}</strong>
            <i>
              <b style={{ width: `${rewardProgressPercent}%` }} />
            </i>
          </article>
          <article>
            <span>{spanish ? "Acción" : "Action"}</span>
            {viewerMode === "guest" ? (
              <Link href="/signup">
                <LockKeyhole size={14} />
                {spanish ? "Crear cuenta gratis" : "Create free account"}
              </Link>
            ) : (
              <button
                disabled={!canClaimRewards || economy.state.availableRewardCredits <= 0}
                onClick={economy.claimReward}
                type="button"
              >
                <Coins size={14} />
                {spanish ? "Reclamar token" : "Claim token"}
              </button>
            )}
          </article>
        </section>

        <section
          className="workspace-v2-motivation-layer"
          aria-label={
            spanish ? "Motivación de reproducción" : "Playback motivation"
          }
        >
          <article>
            <span>{spanish ? "Canciones hoy" : "Songs today"}</span>
            <strong>{songsListenedToday}</strong>
          </article>
          <article>
            <span>{spanish ? "Artistas apoyados" : "Artists supported"}</span>
            <strong>{artistsSupportedToday}</strong>
          </article>
          <article>
            <span>{spanish ? "Racha de reproducción" : "Playback streak"}</span>
            <strong>{playbackStreak}</strong>
          </article>
          <article>
            <span>{spanish ? "Minutos hoy" : "Minutes today"}</span>
            <strong>{minutesListenedToday}</strong>
          </article>
          {viewerMode === "guest" && (
            <article className="workspace-v2-guest-conversion-card">
              <span>{spanish ? "Recompensas" : "Rewards"}</span>
              <strong>
                {spanish
                  ? "Tu progreso se guarda. Crea una cuenta gratis para activar recompensas."
                  : "Your progress is saved. Create a free account to activate rewards."}
              </strong>
            </article>
          )}
        </section>

        {workspaceReturnVisible && (
          <div
            className="workspace-v2-discovery-return-strip"
            ref={returnStripRef}
          >
            <button
              onClick={handleWorkspaceReturn}
              type="button"
            >
              <ArrowLeft size={16} />
              {spanish ? "Regresar" : "Back"}
            </button>
            <span>{workspaceReturnLabel}</span>
          </div>
        )}

        <div className="workspace-v2-product-body" data-workspace-mode={workspaceMode}>
          <WorkspaceV2ContentPanel
            activePanel={activePanel}
            canAccessAdmin={canAccessAdmin}
            canSubmit={canSubmit}
            contentEconomy={contentEconomy}
            copy={copy}
            discoveryView={discoveryView}
            externalDiscoveryItems={externalDiscoveryItems}
            founderFree={founderSubmissionsRemaining > 0}
            founderOperations={founderOperations}
            initialQueue={initialQueue}
            internalQueueSongs={discoveryCatalogSongs}
            locale={workspaceLocale}
            onDiscoveryStyleChange={handleDiscoveryStyleChange}
            onDiscoveryViewChange={handleDiscoveryViewChange}
            onPanelChange={handlePanelChange}
            onPlayInternalDiscoverySongs={handlePlayInternalDiscoverySongs}
            onSubmitNotice={notifySubmit}
            onSubmitSong={handleSubmitSong}
            profilePanel={profilePanel}
            submitNotice={submitNotice}
            submissionTokens={submissionTokens}
            selectedDiscoveryStyle={selectedDiscoveryStyle}
            unlimitedSubmissionTokens={viewerMode === "founder"}
            viewerMode={viewerMode}
          />

          <aside
            className="workspace-v2-queue-panel"
            data-mobile-expanded={mobileQueueExpanded ? "true" : "false"}
            data-workspace-mode={workspaceMode}
            aria-label={spanish ? "Cola" : "Queue"}
          >
            <span className="eyebrow">
              <ListMusic size={13} />
              {spanish ? "Cola" : "Queue"}
            </span>
            <h2>{localizedQueueTitle}</h2>
            <div className="workspace-v2-queue-context">
              <strong>
                {positionCurrent} {spanish ? "de" : "of"} {positionTotal}
              </strong>
              <span>{queueSourceLabel(queueSource, spanish)}</span>
              <small>
                {remainingCount} {spanish ? "canciones por descubrir" : "songs left to discover"}
              </small>
            </div>
            <div className="workspace-v2-now-next">
              <article>
                <span>{spanish ? "Ahora" : "Now Playing"}</span>
                <strong>{controller.activeSong?.title ?? "-"}</strong>
                <small>{controller.activeSong?.artist ?? "-"}</small>
              </article>
              <article>
                <span>{spanish ? "Siguiente" : "Next Song"}</span>
                <strong>{nextSong?.title ?? "-"}</strong>
                <small>{nextSong?.artist ?? "-"}</small>
              </article>
            </div>
            <button
              aria-expanded={mobileQueueExpanded}
              className="workspace-v2-mobile-queue-toggle"
              onClick={() => setMobileQueueExpanded((current) => !current)}
              type="button"
            >
              <ListMusic size={14} />
              {mobileQueueExpanded
                ? spanish
                  ? "Ocultar cola completa"
                  : "Hide full queue"
                : spanish
                  ? "Mostrar cola completa"
                  : "Show full queue"}
            </button>
            <p>
              {spanish
                ? "La cola acompaña al reproductor sin competir con la música."
                : "The queue supports the player without competing with the music."}
            </p>
            <ol>
              {controller.remainingSongs.slice(0, 8).map((song) => (
                <li key={song.id}>
                  <span>{song.title}</span>
                  <small>
                    {song.artist} / {song.platform}
                  </small>
                </li>
              ))}
            </ol>
          </aside>
        </div>

        {debugAllowed && debugOpen && (
          <WorkspaceV2FounderDebug
            activeSongId={activeSongId}
            controller={controller}
            lastError={lastError}
            lastTransition={lastTransition}
            logs={logs}
            nextSongId={nextSongId}
            pipelineDebug={pipelineDebug}
            providerDebug={providerDebug}
          />
        )}
      </main>

      <WorkspaceV2HelpAssistant
        canSubmit={canSubmit}
        locale={workspaceLocale}
        onDiscoveryViewChange={handleDiscoveryViewChange}
        onPanelChange={handlePanelChange}
        viewerMode={viewerMode}
      />
    </section>
  );
}

type WorkspaceV2HelpTopicId =
  | "listen"
  | "earn"
  | "submit"
  | "platforms"
  | "account"
  | "artist";

function WorkspaceV2HelpAssistant({
  canSubmit,
  locale,
  onDiscoveryViewChange,
  onPanelChange,
  viewerMode,
}: {
  canSubmit: boolean;
  locale: InterfaceLocale;
  onDiscoveryViewChange: (view: WorkspaceV2DiscoveryView) => void;
  onPanelChange: (panel: WorkspaceV2Panel) => void;
  viewerMode: WorkspaceV2ViewerMode;
}) {
  const spanish = locale === "es";
  const [open, setOpen] = useState(false);
  const [activeTopic, setActiveTopic] = useState<WorkspaceV2HelpTopicId>("listen");

  const goDiscover = () => {
    onPanelChange("discover");
    onDiscoveryViewChange("home");
    setOpen(false);
  };

  const goInternalDiscovery = () => {
    onPanelChange("discover");
    onDiscoveryViewChange("internal");
    setOpen(false);
  };

  const goExternalDiscovery = () => {
    onPanelChange("discover");
    onDiscoveryViewChange("external");
    setOpen(false);
  };

  const goSubmit = () => {
    onPanelChange("submit");
    setOpen(false);
  };

  const goProfile = () => {
    onPanelChange("profile");
    setOpen(false);
  };

  const topics: Array<{
    body: string;
    icon: typeof HelpCircle;
    id: WorkspaceV2HelpTopicId;
    primaryAction?: {
      href?: string;
      label: string;
      onClick?: () => void;
    };
    secondaryAction?: {
      href?: string;
      label: string;
      onClick?: () => void;
    };
    steps: string[];
    title: string;
  }> = [
    {
      body: spanish
        ? "Presiona Play y deja que First Listen avance por la cola. Tambien puedes explorar canciones por estilo."
        : "Press Play and let First Listen move through the queue. You can also explore songs by style.",
      icon: Play,
      id: "listen",
      primaryAction: {
        label: spanish ? "Ir a escuchar" : "Go listen",
        onClick: goInternalDiscovery,
      },
      secondaryAction: {
        label: spanish ? "Ver inicio" : "View home",
        onClick: goDiscover,
      },
      steps: spanish
        ? [
            "Usa el reproductor principal.",
            "La cola sigue sonando mientras navegas.",
            "Busca por estilo si quieres descubrir algo especifico.",
          ]
        : [
            "Use the main player.",
            "The queue keeps playing while you move around.",
            "Search by style when you want something specific.",
          ],
      title: spanish ? "Quiero escuchar música" : "I want to listen",
    },
    {
      body: spanish
        ? "Tu reproducción válida suma Banco de Tiempo. Ese tiempo se convierte en tokens para enviar música."
        : "Valid playback adds Time Bank progress. That time turns into tokens for submitting music.",
      icon: Clock3,
      id: "earn",
      primaryAction: {
        label: spanish ? "Empezar a ganar" : "Start earning",
        onClick: goInternalDiscovery,
      },
      steps: spanish
        ? [
            "Escucha contenido que reproduce dentro de First Listen.",
            "Mira el Banco de Tiempo arriba.",
            "Cuando el token esté listo, presiona Reclamar token.",
          ]
        : [
            "Listen to content that plays inside First Listen.",
            "Watch the Time Bank above.",
            "When a token is ready, press Claim token.",
          ],
      title: spanish ? "Quiero ganar tiempo" : "I want to earn time",
    },
    {
      body: spanish
        ? "Para subir música necesitas una cuenta y tokens de envío. Puedes seguir escuchando mientras preparas tu envío."
        : "To submit music you need an account and submission tokens. You can keep listening while preparing your submission.",
      icon: Send,
      id: "submit",
      primaryAction: viewerMode === "guest"
        ? {
            href: "/signup?next=/dashboard",
            label: spanish ? "Crear cuenta gratis" : "Create free account",
          }
        : {
            label: canSubmit
              ? spanish
                ? "Ir a enviar canción"
                : "Go submit song"
              : spanish
                ? "Ver envío"
                : "View submit",
            onClick: goSubmit,
          },
      steps: spanish
        ? [
            "Escucha para ganar Banco de Tiempo.",
            "Reclama tokens cuando estén listos.",
            "Abre Enviar canción y completa tu información.",
          ]
        : [
            "Listen to earn Time Bank progress.",
            "Claim tokens when they are ready.",
            "Open Submit song and complete your details.",
          ],
      title: spanish ? "Quiero subir mi canción" : "I want to submit my song",
    },
    {
      body: spanish
        ? "Las plataformas externas sirven para descubrir y apoyar artistas fuera de First Listen. Abren Spotify, TikTok, Apple Music y otros enlaces."
        : "External platforms help people discover and support artists outside First Listen. They open Spotify, TikTok, Apple Music, and other links.",
      icon: ExternalLink,
      id: "platforms",
      primaryAction: {
        label: spanish ? "Ver plataformas externas" : "View external platforms",
        onClick: goExternalDiscovery,
      },
      secondaryAction: viewerMode === "guest"
        ? undefined
        : {
            label: spanish ? "Mi perfil" : "My profile",
            onClick: goProfile,
          },
      steps: spanish
        ? [
            "Interno = puede sumar Banco de Tiempo.",
            "Externo = abre fuera de First Listen.",
            "Los artistas pueden agregar enlaces desde su perfil o canción.",
          ]
        : [
            "Internal = can add Time Bank progress.",
            "External = opens outside First Listen.",
            "Artists can add links from their profile or song.",
          ],
      title: spanish ? "Quiero agregar plataformas" : "I want to add platforms",
    },
    {
      body: spanish
        ? "Si no puedes entrar, usa recuperar contraseña. Si sigues atorado, intenta una ventana nueva y revisa tu correo."
        : "If you cannot sign in, use password recovery. If you are still stuck, try a fresh window and check your email.",
      icon: LockKeyhole,
      id: "account",
      primaryAction: {
        href: "/forgot-password",
        label: spanish ? "Recuperar contraseña" : "Reset password",
      },
      secondaryAction: {
        href: "/login",
        label: spanish ? "Iniciar sesión" : "Log in",
      },
      steps: spanish
        ? [
            "Abre Recuperar contraseña.",
            "Escribe el correo de tu cuenta.",
            "Usa el enlace que llega a tu email.",
          ]
        : [
            "Open password recovery.",
            "Enter your account email.",
            "Use the link sent to your email.",
          ],
      title: spanish ? "No puedo entrar a mi cuenta" : "I cannot access my account",
    },
    {
      body: spanish
        ? "First Listen funciona así: escuchas artistas reales, ganas tiempo y usas tokens para que otros descubran tu música."
        : "First Listen works like this: you listen to real artists, earn time, and use tokens so others can discover your music.",
      icon: Music2,
      id: "artist",
      primaryAction: {
        label: spanish ? "Escuchar primero" : "Listen first",
        onClick: goInternalDiscovery,
      },
      secondaryAction: viewerMode === "guest"
        ? {
            href: "/signup?next=/dashboard",
            label: spanish ? "Crear cuenta" : "Create account",
          }
        : {
            label: spanish ? "Subir música" : "Submit music",
            onClick: goSubmit,
          },
      steps: spanish
        ? [
            "Escucha y apoya canciones de otros artistas.",
            "Gana Banco de Tiempo y reclama tokens.",
            "Sube tu canción para recibir descubrimiento real.",
          ]
        : [
            "Listen to and support other artists.",
            "Earn Time Bank progress and claim tokens.",
            "Submit your song to receive real discovery.",
          ],
      title: spanish ? "Soy artista nuevo" : "I am a new artist",
    },
  ];

  const currentTopic =
    topics.find((topic) => topic.id === activeTopic) ?? topics[0];
  const CurrentIcon = currentTopic.icon;

  return (
    <aside
      aria-label={spanish ? "Asistente de ayuda First Listen" : "First Listen help assistant"}
      className="workspace-v2-help-assistant"
      data-open={open ? "true" : "false"}
    >
      {!open && (
        <button
          className="workspace-v2-help-assistant-fab"
          onClick={() => setOpen(true)}
          type="button"
        >
          <HelpCircle size={18} />
          <span>{spanish ? "¿Necesitas ayuda?" : "Need help?"}</span>
        </button>
      )}

      {open && (
        <section className="workspace-v2-help-assistant-panel" role="dialog">
          <header>
            <div>
              <span className="eyebrow">
                <HelpCircle size={13} />
                {spanish ? "Asistente First Listen" : "First Listen Assistant"}
              </span>
              <h2>{spanish ? "Te ayudo en 30 segundos." : "I can help in 30 seconds."}</h2>
            </div>
            <button
              aria-label={spanish ? "Cerrar ayuda" : "Close help"}
              onClick={() => setOpen(false)}
              type="button"
            >
              <X size={16} />
            </button>
          </header>

          <div className="workspace-v2-help-topic-list" role="list">
            {topics.map((topic) => {
              const TopicIcon = topic.icon;
              return (
                <button
                  aria-pressed={topic.id === currentTopic.id}
                  className={topic.id === currentTopic.id ? "active" : ""}
                  key={topic.id}
                  onClick={() => setActiveTopic(topic.id)}
                  type="button"
                >
                  <TopicIcon size={14} />
                  <span>{topic.title}</span>
                </button>
              );
            })}
          </div>

          <article className="workspace-v2-help-answer">
            <span>
              <CurrentIcon size={16} />
              {currentTopic.title}
            </span>
            <p>{currentTopic.body}</p>
            <ol>
              {currentTopic.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <div className="workspace-v2-help-answer-actions">
              {currentTopic.primaryAction?.href ? (
                <Link href={currentTopic.primaryAction.href}>
                  {currentTopic.primaryAction.label}
                </Link>
              ) : currentTopic.primaryAction ? (
                <button onClick={currentTopic.primaryAction.onClick} type="button">
                  {currentTopic.primaryAction.label}
                </button>
              ) : null}
              {currentTopic.secondaryAction?.href ? (
                <Link href={currentTopic.secondaryAction.href}>
                  {currentTopic.secondaryAction.label}
                </Link>
              ) : currentTopic.secondaryAction ? (
                <button onClick={currentTopic.secondaryAction.onClick} type="button">
                  {currentTopic.secondaryAction.label}
                </button>
              ) : null}
            </div>
          </article>
        </section>
      )}
    </aside>
  );
}

function WorkspaceV2StyleFolders({
  items,
  locale,
  onSelect,
  selectedStyle,
}: {
  items: Array<Pick<WorkspaceV2Song, "category" | "genre" | "subcategory">>;
  locale: InterfaceLocale;
  onSelect: (styleId: WorkspaceV2DiscoveryStyleId) => void;
  selectedStyle: WorkspaceV2DiscoveryStyleId;
}) {
  const spanish = locale === "es";

  return (
    <div className="workspace-v2-style-folders">
      <button
        className={selectedStyle === "all" ? "is-active" : ""}
        onClick={() => onSelect("all")}
        type="button"
      >
        <span>🎵</span>
        <strong>{spanish ? "Todos" : "All"}</strong>
        <small>{items.length}</small>
      </button>
      {workspaceV2DiscoveryStyleSections.map((section) => (
        <section key={section.id}>
          <h3>{spanish ? section.labelEs : section.labelEn}</h3>
          <div>
            {section.styles.map((style) => {
              const count = filterItemsByDiscoveryStyle(items, style.id).length;
              return (
                <button
                  className={selectedStyle === style.id ? "is-active" : ""}
                  key={style.id}
                  onClick={() => onSelect(style.id)}
                  type="button"
                >
                  <span>{style.emoji}</span>
                  <strong>{discoveryStyleLabel(style, spanish)}</strong>
                  <small>{count}</small>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function WorkspaceV2ContentPanel({
  activePanel,
  canAccessAdmin,
  canSubmit,
  contentEconomy,
  copy,
  discoveryView,
  externalDiscoveryItems,
  founderFree,
  founderOperations,
  initialQueue,
  internalQueueSongs,
  locale,
  onDiscoveryStyleChange,
  onDiscoveryViewChange,
  onPanelChange,
  onPlayInternalDiscoverySongs,
  onSubmitNotice,
  onSubmitSong,
  profilePanel,
  submitNotice,
  submissionTokens,
  selectedDiscoveryStyle,
  unlimitedSubmissionTokens,
  viewerMode,
}: {
  activePanel: WorkspaceV2Panel;
  canAccessAdmin: boolean;
  canSubmit: boolean;
  contentEconomy: ContentEconomySetting[];
  copy: ReturnType<typeof getCopy>;
  discoveryView: WorkspaceV2DiscoveryView;
  externalDiscoveryItems: WorkspaceV2ExternalDiscoveryItem[];
  founderFree: boolean;
  founderOperations: FounderOperationsSnapshot | null;
  initialQueue: WorkspaceV2Queue;
  internalQueueSongs: WorkspaceV2Song[];
  locale: InterfaceLocale;
  onDiscoveryStyleChange: (styleId: WorkspaceV2DiscoveryStyleId) => void;
  onDiscoveryViewChange: (view: WorkspaceV2DiscoveryView) => void;
  onPanelChange: (panel: WorkspaceV2Panel) => void;
  onPlayInternalDiscoverySongs: (request: {
    songs: WorkspaceV2Song[];
    startSongId: string;
    title: string;
  }) => void;
  onSubmitNotice: (message: string) => void;
  onSubmitSong: (
    usedFounderFree: boolean,
    submission: SongSubmission,
  ) => Promise<boolean>;
  profilePanel?: ProfilePanelProps | null;
  submitNotice: string;
  submissionTokens: number;
  selectedDiscoveryStyle: WorkspaceV2DiscoveryStyleId;
  unlimitedSubmissionTokens: boolean;
  viewerMode: WorkspaceV2ViewerMode;
}) {
  const spanish = locale === "es";
  const [discoverySearch, setDiscoverySearch] = useState("");
  const discoveryResultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDiscoverySearch("");
  }, [discoveryView, selectedDiscoveryStyle]);

  const handleContentDiscoveryViewChange = useCallback(
    (view: WorkspaceV2DiscoveryView) => {
      setDiscoverySearch("");
      onDiscoveryViewChange(view);
    },
    [onDiscoveryViewChange],
  );

  if (activePanel === "submit") {
    if (canSubmit) {
      return (
        <section
          aria-label={spanish ? "Enviar cancion" : "Submit song"}
          className="workspace-v2-content-panel workspace-v2-submit-panel"
        >
          {submitNotice && (
            <div className="workspace-v2-submit-notice" role="status">
              {submitNotice}
            </div>
          )}
          <SubmitView
            contentEconomy={contentEconomy}
            copy={copy}
            founderFree={founderFree}
            locale={locale}
            notify={onSubmitNotice}
            onSubmitted={onSubmitSong}
            reviewCount={submissionTokens}
            unlimitedCredits={unlimitedSubmissionTokens}
          />
        </section>
      );
    }

    return (
      <section className="workspace-v2-content-panel">
        <span className="eyebrow">
          <Send size={13} />
          {spanish ? "Enviar canción" : "Submit Song"}
        </span>
        <h2>
          {canSubmit
            ? spanish
              ? "Tu flujo de envío está listo."
              : "Your submission workflow is ready."
            : spanish
              ? "Regístrate gratis para enviar música."
              : "Create a free account to submit music."}
        </h2>
        <p>
          {canSubmit
            ? spanish
              ? "Envía tu canción sin detener la reproducción. Tu Banco de Tiempo y tokens siguen visibles."
              : "Submit your song without stopping playback. Your Time Bank and tokens stay visible."
            : spanish
              ? "Sigue descubriendo como invitado. Crea una cuenta gratis para activar recompensas, tokens y envíos."
              : "Keep discovering as a guest. Create a free account to activate rewards, tokens, and submissions."}
        </p>
        {canSubmit ? (
          <Link href="/submit">{spanish ? "Abrir Enviar Canción" : "Open Submit Song"}</Link>
        ) : (
          <Link href="/signup">{spanish ? "Crear cuenta gratis" : "Create free account"}</Link>
        )}
      </section>
    );
  }

  if (activePanel === "profile") {
    if (viewerMode !== "guest" && profilePanel) {
      return (
        <section
          aria-label={spanish ? "Mi perfil" : "My profile"}
          className="workspace-v2-content-panel workspace-v2-profile-panel"
        >
          <ProfilePanel
            {...profilePanel}
            embedded
            onNavigate={(target) => {
              if (target === "submit") {
                onPanelChange("submit");
                return;
              }
              if (target === "profile") {
                onPanelChange("profile");
                return;
              }
              onPanelChange("discover");
            }}
          />
        </section>
      );
    }

    return (
      <section className="workspace-v2-content-panel">
        <span className="eyebrow">
          <User size={13} />
          {spanish ? "Perfil" : "Profile"}
        </span>
        <h2>
          {viewerMode === "guest"
            ? spanish
              ? "Tu actividad de invitado puede convertirse en cuenta."
              : "Your guest activity can become an account."
            : spanish
              ? "Tu perfil está disponible sin detener la música."
              : "Your profile is available without stopping the music."}
        </h2>
        <p>
          {viewerMode === "guest"
            ? spanish
              ? "Sigue descubriendo. Cuando te registres, puedes activar recompensas y herramientas de creador."
              : "Keep discovering. When you join, you can activate rewards and creator tools."
            : spanish
              ? "Revisa tu actividad, canciones y herramientas personales mientras la reproducción continúa."
              : "Review your activity, songs, and personal tools while playback continues."}
        </p>
        <Link href={viewerMode === "guest" ? "/signup" : "/profile"}>
          {viewerMode === "guest"
            ? spanish
              ? "Crear cuenta gratis"
              : "Create free account"
            : spanish
              ? "Abrir Mi Perfil"
              : "Open My Profile"}
        </Link>
      </section>
    );
  }

  if (activePanel === "founder-operations") {
    if (viewerMode === "founder") {
      return (
        <FounderOperationsPanel
          locale={locale}
          snapshot={founderOperations}
        />
      );
    }

    return (
      <section className="workspace-v2-content-panel">
        <span className="eyebrow">
          <Gauge size={13} />
          Founder Operations
        </span>
        <h2>
          {spanish
            ? "Esta seccion requiere acceso Founder."
            : "This section requires Founder access."}
        </h2>
        <p>
          {spanish
            ? "Los permisos de Admin, Moderator, Member y Guest se mantienen sin cambios."
            : "Admin, Moderator, Member, and Guest permissions remain unchanged."}
        </p>
      </section>
    );
  }

  if (activePanel === "owner" || activePanel === "admin") {
    return (
      <section className="workspace-v2-content-panel">
        <span className="eyebrow">
          <ShieldCheck size={13} />
          {activePanel === "owner" ? "Owner" : "Admin"}
        </span>
        <h2>
          {canAccessAdmin
            ? spanish
              ? "Acceso Founder/Admin preservado."
              : "Founder/Admin access is preserved."
            : spanish
              ? "Esta sección requiere permisos."
              : "This section requires permissions."}
        </h2>
        <p>
          {spanish
            ? "Los controles avanzados permanecen en su panel seguro para proteger la administración."
            : "Advanced controls stay in their secure panel to protect administration."}
        </p>
        {canAccessAdmin && (
          <Link href={activePanel === "owner" ? "/owner" : "/admin"}>
            {activePanel === "owner" ? "Owner Control Center" : "Admin Panel"}
          </Link>
        )}
      </section>
    );
  }

  const previewSongs = initialQueue.songs.slice(0, 4);
  const visibleInternalSongs = filterItemsByDiscoveryStyle(
    internalQueueSongs,
    selectedDiscoveryStyle,
  );
  const visibleExternalItems = filterItemsByDiscoveryStyle(
    externalDiscoveryItems,
    selectedDiscoveryStyle,
  );
  const searchedInternalSongs = visibleInternalSongs.filter((song) =>
    itemMatchesDiscoverySearch(song, discoverySearch),
  );
  const searchedExternalItems = visibleExternalItems.filter((item) =>
    itemMatchesDiscoverySearch(item, discoverySearch),
  );
  const hasDiscoverySearch = discoverySearch.trim().length > 0;
  const availableStyleCount = workspaceV2DiscoveryStyles.filter(
    (style) => filterItemsByDiscoveryStyle(internalQueueSongs, style.id).length > 0,
  ).length;
  const resetDiscoveryFilters = () => {
    setDiscoverySearch("");
    onDiscoveryStyleChange("all");
  };
  const handleDiscoveryStyleSelect = (styleId: WorkspaceV2DiscoveryStyleId) => {
    setDiscoverySearch("");
    onDiscoveryStyleChange(styleId);
    window.setTimeout(() => {
      discoveryResultsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 80);
  };
  const selectedStyle =
    selectedDiscoveryStyle === "all"
      ? null
      : workspaceV2DiscoveryStyles.find(
          (style) => style.id === selectedDiscoveryStyle,
        ) ?? null;
  const selectedStyleName = selectedStyle
    ? discoveryStyleLabel(selectedStyle, spanish)
    : spanish
      ? "Todos los estilos"
      : "All styles";

  if (discoveryView === "internal") {
    return (
      <section className="workspace-v2-content-panel workspace-v2-discovery-detail">
        <nav className="workspace-v2-discovery-breadcrumb" aria-label="Discovery breadcrumb">
          <button
            className="workspace-v2-back-action"
            onClick={() => handleContentDiscoveryViewChange("home")}
            type="button"
          >
            <ArrowLeft size={15} />
            {spanish ? "Regresar" : "Back"}
          </button>
          <span>
            {spanish
              ? "Estas en: Descubrimiento interno"
              : "Viewing: Internal discovery"}
          </span>
        </nav>
        <span className="eyebrow">
          <ListMusic size={13} />
          {spanish ? "Descubrimiento interno" : "Internal discovery"}
        </span>
        <h2>
          {spanish ? "Escucha dentro de First Listen." : "Listen inside First Listen."}
        </h2>
        <p>
          {spanish
            ? "Estas canciones pueden reproducirse aquí, apoyar artistas y sumar Banco de Tiempo cuando la reproducción es válida."
            : "These songs can play here, support artists, and add Time Bank progress when playback is valid."}
        </p>
        <div className="workspace-v2-platform-chip-row" aria-label="Internal platforms">
          <span>▶ YouTube</span>
          <span>▶ YouTube Music</span>
        </div>
        <WorkspaceV2StyleFolders
          items={internalQueueSongs}
          locale={locale}
          onSelect={handleDiscoveryStyleSelect}
          selectedStyle={selectedDiscoveryStyle}
        />
        <label className="workspace-v2-discovery-search">
          <Search size={15} />
          <span>{spanish ? "Buscar canción o artista" : "Search song or artist"}</span>
          <input
            onChange={(event) => setDiscoverySearch(event.target.value)}
            placeholder={
              spanish
                ? "Buscar por canción, artista o plataforma"
                : "Search by song, artist, or platform"
            }
            type="search"
            value={discoverySearch}
          />
        </label>
        <div
          className="workspace-v2-discovery-detail-actions"
          ref={discoveryResultsRef}
        >
          <button
            className="workspace-v2-secondary-action"
            disabled={!searchedInternalSongs.length}
            onClick={() => {
              const firstSong = searchedInternalSongs[0];
              if (!firstSong) return;
              onPlayInternalDiscoverySongs({
                songs: searchedInternalSongs,
                startSongId: firstSong.id,
                title:
                  selectedDiscoveryStyle === "all"
                    ? spanish
                      ? "Descubrimiento interno"
                      : "Internal discovery"
                    : selectedStyleName,
              });
            }}
            type="button"
          >
            {spanish ? "Reproducir esta lista" : "Play this list"}
          </button>
          <span>
            {searchedInternalSongs.length} / {visibleInternalSongs.length}{" "}
            {spanish ? `en ${selectedStyleName}` : `in ${selectedStyleName}`}
          </span>
        </div>
        {!searchedInternalSongs.length && (
          <div className="workspace-v2-discovery-empty-state">
            <strong>
              {hasDiscoverySearch
                ? spanish
                  ? "No encontramos canciones con esa búsqueda."
                  : "No songs match that search."
                : spanish
                  ? "Todavía no hay canciones en este estilo."
                  : "There are no songs in this style yet."}
            </strong>
            <small>
              {spanish
                ? "Puedes ver todos los estilos, borrar la búsqueda o regresar al inicio."
                : "You can view all styles, clear the search, or go back home."}
            </small>
            <div className="workspace-v2-discovery-empty-actions">
              <button onClick={resetDiscoveryFilters} type="button">
                {spanish ? "Ver todos" : "View all"}
              </button>
              {hasDiscoverySearch && (
                <button onClick={() => setDiscoverySearch("")} type="button">
                  {spanish ? "Borrar búsqueda" : "Clear search"}
                </button>
              )}
            </div>
          </div>
        )}
        <ol className="workspace-v2-internal-song-list">
          {searchedInternalSongs.map((song, index) => (
            <li key={song.id}>
              <span className="workspace-v2-song-index">{index + 1}</span>
              <span
                aria-hidden="true"
                className="workspace-v2-song-thumb"
                style={{ backgroundImage: `url("${song.coverUrl}")` }}
              />
              <div>
                <strong>{song.title}</strong>
                <small>
                  {song.artist} / {song.platform} /{" "}
                  {discoveryStyleLabel(styleForDiscoveryItem(song), spanish)}
                </small>
              </div>
              <button
                className="workspace-v2-song-play-action"
                onClick={() =>
                  onPlayInternalDiscoverySongs({
                    songs: searchedInternalSongs,
                    startSongId: song.id,
                    title:
                      selectedDiscoveryStyle === "all"
                        ? spanish
                          ? "Descubrimiento interno"
                          : "Internal discovery"
                        : selectedStyleName,
                  })
                }
                type="button"
              >
                <Play size={13} />
                {spanish ? "Reproducir" : "Play"}
              </button>
            </li>
          ))}
        </ol>
        <button
          className="workspace-v2-back-action workspace-v2-back-action-bottom"
          onClick={() => handleContentDiscoveryViewChange("home")}
          type="button"
        >
          <ArrowLeft size={15} />
          {spanish ? "Regresar" : "Back"}
        </button>
      </section>
    );
  }

  if (discoveryView === "external") {
    return (
      <section className="workspace-v2-content-panel workspace-v2-discovery-detail">
        <nav className="workspace-v2-discovery-breadcrumb" aria-label="Discovery breadcrumb">
          <button
            className="workspace-v2-back-action"
            onClick={() => handleContentDiscoveryViewChange("home")}
            type="button"
          >
            <ArrowLeft size={15} />
            {spanish ? "Regresar" : "Back"}
          </button>
          <span>
            {spanish
              ? "Estas en: Plataformas externas"
              : "Viewing: External platforms"}
          </span>
        </nav>
        <span className="eyebrow">
          <ExternalLink size={13} />
          {spanish ? "Plataformas externas" : "External platforms"}
        </span>
        <h2>
          {spanish ? "Descubre artistas en otras plataformas." : "Discover artists on other platforms."}
        </h2>
        <p>
          {spanish
            ? "Estos enlaces abren fuera de First Listen. Son para descubrir, seguir y apoyar artistas en sus plataformas."
            : "These links open outside First Listen. They are for discovering, following, and supporting artists on their platforms."}
        </p>
        <div className="workspace-v2-platform-chip-row" aria-label="External platforms">
          <span>↗ Spotify</span>
          <span>↗ Apple Music</span>
          <span>↗ TikTok</span>
          <span>↗ Instagram</span>
        </div>
        <WorkspaceV2StyleFolders
          items={externalDiscoveryItems}
          locale={locale}
          onSelect={handleDiscoveryStyleSelect}
          selectedStyle={selectedDiscoveryStyle}
        />
        <label className="workspace-v2-discovery-search">
          <Search size={15} />
          <span>{spanish ? "Buscar canción, artista o plataforma" : "Search song, artist, or platform"}</span>
          <input
            onChange={(event) => setDiscoverySearch(event.target.value)}
            placeholder={
              spanish
                ? "Buscar Spotify, TikTok, artista..."
                : "Search Spotify, TikTok, artist..."
            }
            type="search"
            value={discoverySearch}
          />
        </label>
        <div
          className="workspace-v2-discovery-detail-actions"
          ref={discoveryResultsRef}
        >
          <span>
            {searchedExternalItems.length} / {visibleExternalItems.length}{" "}
            {spanish ? `en ${selectedStyleName}` : `in ${selectedStyleName}`}
          </span>
        </div>
        {externalDiscoveryItems.length && !searchedExternalItems.length && (
          <div className="workspace-v2-discovery-empty-state">
            <strong>
              {hasDiscoverySearch
                ? spanish
                  ? "No encontramos destinos con esa búsqueda."
                  : "No destinations match that search."
                : spanish
                  ? "Todavía no hay destinos en este estilo."
                  : "There are no destinations in this style yet."}
            </strong>
            <small>
              {spanish
                ? "Puedes ver todos los estilos, borrar la búsqueda o regresar al inicio."
                : "You can view all styles, clear the search, or go back home."}
            </small>
            <div className="workspace-v2-discovery-empty-actions">
              <button onClick={resetDiscoveryFilters} type="button">
                {spanish ? "Ver todos" : "View all"}
              </button>
              {hasDiscoverySearch && (
                <button onClick={() => setDiscoverySearch("")} type="button">
                  {spanish ? "Borrar búsqueda" : "Clear search"}
                </button>
              )}
            </div>
          </div>
        )}
        {searchedExternalItems.length ? (
          <div className="workspace-v2-external-discovery-grid">
            {searchedExternalItems.map((item) => (
              <article key={`${item.feedKind ?? "external"}-${item.id}-${item.link}`}>
                <span
                  aria-hidden="true"
                  className="workspace-v2-song-thumb"
                  style={{ backgroundImage: `url("${item.coverUrl}")` }}
                />
                <div>
                  <span>{item.badge ?? item.platform}</span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.artist} /{" "}
                    {discoveryStyleLabel(styleForDiscoveryItem(item), spanish)}
                  </small>
                </div>
                <div className="workspace-v2-external-actions">
                  <a href={item.link} rel="noreferrer" target="_blank">
                    <ExternalLink size={14} />
                    {spanish ? `Abrir ${item.platform}` : `Open ${item.platform}`}
                  </a>
                  {item.artistId && (
                    <Link href={`/artists/${item.artistId}`}>
                      <User size={14} />
                      {spanish ? "Perfil" : "Profile"}
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : !externalDiscoveryItems.length ? (
          <div className="workspace-v2-discovery-empty-state">
            <strong>
              {spanish
                ? "Aún no hay destinos externos activos."
                : "No external destinations are active yet."}
            </strong>
            <small>
              {spanish
                ? "Cuando los artistas agreguen Spotify, Apple Music u otros enlaces, aparecerán aquí."
                : "When artists add Spotify, Apple Music, or other links, they will appear here."}
            </small>
          </div>
        ) : null}
        <button
          className="workspace-v2-back-action workspace-v2-back-action-bottom"
          onClick={() => handleContentDiscoveryViewChange("home")}
          type="button"
        >
          <ArrowLeft size={15} />
          {spanish ? "Regresar" : "Back"}
        </button>
      </section>
    );
  }

  return (
    <section className="workspace-v2-content-panel workspace-v2-discovery-home">
      <div className="workspace-v2-welcome-card">
        <span className="eyebrow">
          <Compass size={13} />
          {spanish ? "Bienvenido a First Listen" : "Welcome to First Listen"}
        </span>
        <h2>{spanish ? "Gracias por suscribirte." : "Thanks for joining."}</h2>
        <p>
          {spanish
            ? "Puedes subir tus primeras 3 canciones y empezar a ganar tiempo escuchando musica nueva."
            : "You can upload your first 3 songs and start earning time by listening to new music."}
        </p>
        <div className="workspace-v2-welcome-actions">
          <button
            className="workspace-v2-submit-music-cta workspace-v2-submit-music-cta-primary"
            onClick={() => onPanelChange("submit")}
            type="button"
          >
            <Send size={19} />
            <span>
              <strong>{spanish ? "Sube tu musica" : "Submit your music"}</strong>
              <small>
                {viewerMode === "guest"
                  ? spanish
                    ? "Crea una cuenta gratis para activar envios."
                    : "Create a free account to activate submissions."
                  : spanish
                    ? "Empieza con tus canciones y comparte tu perfil."
                    : "Start with your songs and share your profile."}
              </small>
            </span>
          </button>
          <button
            className="workspace-v2-submit-music-cta workspace-v2-profile-cta"
            onClick={() => onPanelChange("profile")}
            type="button"
          >
            <User size={18} />
            <span>
              <strong>{spanish ? "Explorar perfil" : "Explore profile"}</strong>
              <small>
                {spanish
                  ? "Revisa tu progreso, cuenta y actividad."
                  : "View your progress, account, and activity."}
              </small>
            </span>
          </button>
        </div>
      </div>
      <span className="eyebrow">
        <Compass size={13} />
        {spanish ? "Inicio First Listen" : "First Listen Home"}
      </span>
      <h2>
        {spanish ? "Escucha para ser escuchado." : "Listen to be heard."}
      </h2>
      <p>
        {spanish
          ? "Escucha música nueva, apoya artistas y gana tiempo para subir la tuya."
          : "Listen to new music, support artists, and earn time to submit yours."}
      </p>

      <div className="workspace-v2-start-panel">
        <div>
          <span className="eyebrow">
            <Play size={13} />
            {spanish ? "Empieza aquí" : "Start here"}
          </span>
          <strong>
            {spanish
              ? "Primero descubre canciones que reproducen dentro de First Listen."
              : "Start with songs that play inside First Listen."}
          </strong>
          <small>
            {spanish
              ? "Las plataformas externas siguen disponibles para descubrir artistas, pero la reproducción interna es la que puede sumar Banco de Tiempo."
              : "External platforms are still available for artist discovery, but internal playback is what can add Time Bank progress."}
          </small>
        </div>
        <div className="workspace-v2-start-actions">
          <button onClick={() => handleContentDiscoveryViewChange("internal")} type="button">
            <Play size={14} />
            {spanish ? "Escuchar aquí" : "Listen here"}
          </button>
          <button onClick={() => handleContentDiscoveryViewChange("external")} type="button">
            <ExternalLink size={14} />
            {spanish ? "Ver externas" : "External"}
          </button>
          <button onClick={() => onPanelChange("submit")} type="button">
            <Send size={14} />
            {spanish ? "Subir música" : "Submit music"}
          </button>
        </div>
      </div>

      <div
        aria-label={spanish ? "Opciones de descubrimiento" : "Discovery options"}
        className="workspace-v2-discovery-options"
      >
        <button
          className="workspace-v2-discovery-entry-card workspace-v2-discovery-entry-card-internal"
          onClick={() => handleContentDiscoveryViewChange("internal")}
          type="button"
        >
          <span className="workspace-v2-discovery-card-icon">
            <ListMusic size={22} />
          </span>
          <span className="workspace-v2-discovery-card-copy">
            <strong>{spanish ? "Descubrimiento interno" : "Internal discovery"}</strong>
            <small>
              {spanish
                ? "Canciones que reproducen aquí. Prioridad First Listen."
                : "Songs that play here. First Listen priority."}
            </small>
          </span>
          <span className="workspace-v2-discovery-card-badge">
            {spanish ? "Prioridad" : "Priority"}
          </span>
          <span className="workspace-v2-platform-chip-row workspace-v2-platform-chip-row-strong">
            <span>▶ YouTube</span>
            <span>▶ YouTube Music</span>
          </span>
        </button>
        <button
          className="workspace-v2-discovery-entry-card workspace-v2-discovery-entry-card-external"
          onClick={() => handleContentDiscoveryViewChange("external")}
          type="button"
        >
          <span className="workspace-v2-discovery-card-icon">
            <ExternalLink size={22} />
          </span>
          <span className="workspace-v2-discovery-card-copy">
            <strong>{spanish ? "Plataformas externas" : "External platforms"}</strong>
            <small>
              {spanish
                ? "Spotify, TikTok, Apple Music y más. Abren fuera."
                : "Spotify, TikTok, Apple Music, and more. Opens out."}
            </small>
          </span>
          <span className="workspace-v2-discovery-card-badge">
            {spanish ? "Abre fuera" : "Opens out"}
          </span>
          <span className="workspace-v2-platform-chip-row workspace-v2-platform-chip-row-strong">
            <span>↗ Spotify</span>
            <span>↗ Apple Music</span>
            <span>↗ TikTok</span>
          </span>
        </button>
      </div>

      <div className="workspace-v2-primary-action-stack workspace-v2-late-actions">
        <button
          className="workspace-v2-submit-music-cta workspace-v2-submit-music-cta-primary"
          onClick={() => onPanelChange("submit")}
          type="button"
        >
          <span className="workspace-v2-primary-action-badge">
            {spanish ? "Accion principal" : "Main action"}
          </span>
          <Send size={19} />
          <span>
            <strong>{spanish ? "Sube tu musica" : "Submit your music"}</strong>
            <small>
              {viewerMode === "guest"
                ? spanish
                  ? "Crea una cuenta gratis para activar envios."
                  : "Create a free account to activate submissions."
                : spanish
                  ? "Usa tus tokens cuando estes listo para compartir."
                  : "Use your tokens when you are ready to share."}
            </small>
          </span>
        </button>
        <button
          className="workspace-v2-submit-music-cta workspace-v2-profile-cta"
          onClick={() => onPanelChange("profile")}
          type="button"
        >
          <User size={18} />
          <span>
            <strong>{spanish ? "Explorar perfil" : "Explore profile"}</strong>
            <small>
              {spanish
                ? "Revisa tu progreso, cuenta y actividad."
                : "View your progress, account, and activity."}
            </small>
          </span>
        </button>
      </div>

      <div
        aria-label={spanish ? "Estado de First Listen" : "First Listen status"}
        className="workspace-v2-heart-grid"
      >
        <article>
          <span>
            <Clock3 size={14} />
            {spanish ? "Banco de Tiempo" : "Time Bank"}
          </span>
          <strong>{spanish ? "Gana tiempo" : "Earn time"}</strong>
          <small>
            {spanish
              ? "Tu reproducción válida se convierte en tokens para subir música."
              : "Your valid playback turns into tokens to submit music."}
          </small>
        </article>
        <article>
          <span>
            <ListMusic size={14} />
            {spanish ? "Canciones disponibles" : "Available songs"}
          </span>
          <strong>{internalQueueSongs.length}</strong>
          <small>{spanish ? "reproducen dentro de First Listen" : "play inside First Listen"}</small>
        </article>
        <article>
          <span>
            <Music2 size={14} />
            {spanish ? "Estilos" : "Styles"}
          </span>
          <strong>{availableStyleCount}</strong>
          <small>{spanish ? "con canciones disponibles" : "with available songs"}</small>
        </article>
        <article>
          <span>
            <ExternalLink size={14} />
            {spanish ? "Externas" : "External"}
          </span>
          <strong>{externalDiscoveryItems.length}</strong>
          <small>
            {spanish
              ? "enlaces para apoyar artistas fuera de First Listen"
              : "links to support artists outside First Listen"}
          </small>
        </article>
      </div>

      <div
        aria-label={spanish ? "Cómo funciona" : "How it works"}
        className="workspace-v2-flow-strip"
      >
        <span>{spanish ? "▶ Reproducir" : "▶ Play"}</span>
        <span>{spanish ? "⏱ Ganar tiempo" : "⏱ Earn time"}</span>
        <span>{spanish ? "🎟 Reclamar token" : "🎟 Claim token"}</span>
        <span>{spanish ? "🎵 Subir música" : "🎵 Submit music"}</span>
      </div>

      <section
        aria-label={spanish ? "Próximas canciones" : "Upcoming songs"}
        className="workspace-v2-up-next-preview"
      >
        <div>
          <span className="eyebrow">
            <ListMusic size={13} />
            {spanish ? "Próximas en la cola" : "Up next"}
          </span>
          <p>
            {spanish
              ? "La cola avanza automáticamente. Usa Siguiente solo cuando esté disponible."
              : "The queue advances automatically. Use Next only when it is available."}
          </p>
        </div>
        <ol>
          {previewSongs.map((song, index) => (
            <li key={song.id}>
              <span>{index + 1}</span>
              <strong>{song.title}</strong>
              <small>{song.artist}</small>
            </li>
          ))}
        </ol>
      </section>

      <details className="workspace-v2-help-card">
        <summary>{spanish ? "¿Necesitas ayuda? Te explico rápido" : "Need help? Quick guide"}</summary>
        <div>
          <span>{spanish ? "1. Presiona Play y descubre canciones nuevas." : "1. Press Play and discover new songs."}</span>
          <span>{spanish ? "2. Tu reproducción válida suma Banco de Tiempo." : "2. Your valid playback adds Time Bank progress."}</span>
          <span>{spanish ? "3. Reclama tokens cuando estén listos." : "3. Claim tokens when they are ready."}</span>
          <span>{spanish ? "4. Usa tus tokens para compartir tu música." : "4. Use your tokens to share your music."}</span>
          {viewerMode === "guest" && (
            <strong>
              {spanish
                ? "Crea una cuenta gratis para activar recompensas y envíos."
                : "Create a free account to activate rewards and submissions."}
            </strong>
          )}
        </div>
      </details>

      <button
        className="workspace-v2-secondary-action"
        onClick={() => onPanelChange("submit")}
        type="button"
      >
        {spanish ? "Quiero subir mi música" : "I want to submit my music"}
      </button>
    </section>
  );
}

function humanizeOperationsLabel(value: string) {
  return value.replaceAll("_", " ");
}

function formatOperationsDate(value: string, locale: InterfaceLocale) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function formatAnalyticsNumber(value: number | null | undefined, locale: InterfaceLocale) {
  return Number(value ?? 0).toLocaleString(locale === "es" ? "es-US" : "en-US");
}

function formatAnalyticsPercent(value: number | null | undefined, locale: InterfaceLocale) {
  return `${Number(value ?? 0).toLocaleString(locale === "es" ? "es-US" : "en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })}%`;
}

function formatAnalyticsHours(value: number | null | undefined, locale: InterfaceLocale) {
  const hours = Number(value ?? 0);
  if (!Number.isFinite(hours) || hours <= 0) return "0 h";
  if (hours < 24) {
    return `${hours.toLocaleString(locale === "es" ? "es-US" : "en-US", {
      maximumFractionDigits: 1,
    })} h`;
  }
  return `${(hours / 24).toLocaleString(locale === "es" ? "es-US" : "en-US", {
    maximumFractionDigits: 1,
  })} d`;
}

function FounderDiscoveryAnalyticsDashboard({
  locale,
  report,
}: {
  locale: InterfaceLocale;
  report: FounderDiscoveryAnalyticsReport | null | undefined;
}) {
  const spanish = locale === "es";
  const topDailyListens = Math.max(
    1,
    ...(report?.discoverySpread.dailyTrend ?? []).map((day) => day.validListens),
  );

  if (!report) {
    return (
      <section className="workspace-v2-founder-section workspace-v2-discovery-analytics">
        <div className="workspace-v2-founder-section-heading">
          <div>
            <span className="eyebrow">
              <BarChart3 size={13} />
              {spanish ? "Analitica de descubrimiento" : "Discovery Analytics"}
            </span>
            <h3>
              {spanish
                ? "No hay datos disponibles todavía."
                : "No discovery data is available yet."}
            </h3>
          </div>
        </div>
        <p className="workspace-v2-founder-empty">
          {spanish
            ? "Cuando haya reproducciones válidas suficientes, este panel mostrará la salud de descubrimiento."
            : "Once enough valid playback exists, this panel will show discovery health."}
        </p>
      </section>
    );
  }

  const overviewCards = [
    {
      icon: Music2,
      label: spanish ? "Canciones activas" : "Active songs",
      value: formatAnalyticsNumber(report.overview.activeSongs, locale),
    },
    {
      icon: Play,
      label: spanish ? "Reproducen aqui" : "Internal playable",
      value: formatAnalyticsNumber(report.overview.internalPlayableSongs, locale),
    },
    {
      icon: AlertTriangle,
      label: spanish ? "Sin reproducciones" : "Zero listens",
      value: formatAnalyticsNumber(report.overview.zeroListenSongs, locale),
    },
    {
      icon: Gauge,
      label: spanish ? "<=2 reproducciones" : "<=2 listens",
      value: formatAnalyticsNumber(report.overview.lowExposureSongs, locale),
    },
    {
      icon: Trophy,
      label: spanish ? "Top 10 concentra" : "Top 10 concentration",
      value: formatAnalyticsPercent(
        report.topConcentration.top10ConcentrationPercent,
        locale,
      ),
    },
    {
      icon: Clock3,
      label: spanish ? "Promedio hasta 1ra reproduccion" : "Avg. time to first listen",
      value: formatAnalyticsHours(
        report.timeToFirstListen.averageHoursToDiscovery,
        locale,
      ),
    },
  ] as const;

  const impactCards = [
    {
      label: spanish ? "Reproducciones despues de Smart Queue" : "Post Smart Queue listens",
      value: report.smartQueueImpact.postValidListens,
    },
    {
      label: spanish ? "Canciones alcanzadas" : "Songs reached",
      value: report.smartQueueImpact.postSongsReached,
    },
    {
      label: spanish ? "Pasaron de 0 a 1" : "Moved from 0 to 1",
      value: report.smartQueueImpact.zeroToOneSongs,
    },
    {
      label: spanish ? "Baja exposicion ayudada" : "Low exposure hits",
      value: report.smartQueueImpact.lowExposureHits,
    },
  ];

  return (
    <section className="workspace-v2-founder-section workspace-v2-discovery-analytics">
      <div className="workspace-v2-founder-section-heading">
        <div>
          <span className="eyebrow">
            <BarChart3 size={13} />
            {spanish ? "Analitica de descubrimiento" : "Discovery Analytics"}
          </span>
          <h3>{spanish ? "Salud de descubrimiento" : "Discovery Health"}</h3>
          <p>
            {spanish
              ? "Lectura founder-only del impacto de Smart Queue y la distribucion de exposicion."
              : "Founder-only readout for Smart Queue impact and exposure distribution."}
          </p>
        </div>
        <span className="workspace-v2-readonly-badge">
          {spanish ? "Solo lectura" : "Read only"}
        </span>
      </div>

      <div className="workspace-v2-discovery-health-grid">
        {overviewCards.map(({ icon: Icon, label, value }) => (
          <article key={label}>
            <span>
              <Icon size={14} />
              {label}
            </span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>

      <div className="workspace-v2-discovery-analytics-grid">
        <section className="workspace-v2-discovery-analytics-card">
          <div className="workspace-v2-founder-section-heading">
            <div>
              <span className="eyebrow">
                <TrendingUp size={13} />
                {spanish ? "Impacto Smart Queue" : "Smart Queue Impact"}
              </span>
              <h4>{spanish ? "Primeras senales" : "Early signals"}</h4>
            </div>
          </div>
          <div className="workspace-v2-discovery-impact-grid">
            {impactCards.map((card) => (
              <article key={card.label}>
                <strong>{formatAnalyticsNumber(card.value, locale)}</strong>
                <span>{card.label}</span>
              </article>
            ))}
          </div>
          <small>
            {spanish
              ? `Corte Smart Queue: ${formatOperationsDate(
                  report.smartQueueStartedAt,
                  locale,
                )}`
              : `Smart Queue cutoff: ${formatOperationsDate(
                  report.smartQueueStartedAt,
                  locale,
                )}`}
          </small>
        </section>

        <section className="workspace-v2-discovery-analytics-card">
          <div className="workspace-v2-founder-section-heading">
            <div>
              <span className="eyebrow">
                <Activity size={13} />
                {spanish ? "Discovery spread" : "Discovery Spread"}
              </span>
              <h4>{spanish ? "Ultimos 14 dias" : "Last 14 days"}</h4>
            </div>
          </div>
          <div className="workspace-v2-discovery-bars" aria-label="Discovery daily trend">
            {report.discoverySpread.dailyTrend.map((day) => (
              <span
                key={day.date}
                title={`${day.date}: ${day.validListens} / ${day.songsReached}`}
                style={
                  {
                    "--bar-height": `${Math.max(
                      6,
                      Math.round((day.validListens / topDailyListens) * 100),
                    )}%`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <small>
            {spanish
              ? "Barras = reproducciones validas diarias. Tooltip muestra canciones alcanzadas."
              : "Bars = daily valid listens. Tooltip shows songs reached."}
          </small>
        </section>
      </div>

      <div className="workspace-v2-founder-two-column">
        <section className="workspace-v2-discovery-analytics-card">
          <div className="workspace-v2-founder-section-heading">
            <div>
              <span className="eyebrow">
                <TrendingUp size={13} />
                {spanish ? "Canciones ganando exposicion" : "Songs Gaining Exposure"}
              </span>
              <h4>{spanish ? "Movimiento reciente" : "Recent movement"}</h4>
            </div>
          </div>
          <div className="workspace-v2-discovery-song-list">
            {report.songsGainingExposure.slice(0, 8).map((song) => (
              <article key={song.songId}>
                <strong>{song.title}</strong>
                <span>{song.artist}</span>
                <small>
                  {formatAnalyticsNumber(song.validListens7d, locale)}{" "}
                  {spanish ? "en 7 dias" : "in 7 days"} /{" "}
                  {formatAnalyticsNumber(song.totalValidListens, locale)} total
                </small>
              </article>
            ))}
            {!report.songsGainingExposure.length && (
              <p className="workspace-v2-founder-empty">
                {spanish
                  ? "Aun no hay movimiento reciente."
                  : "No recent movement yet."}
              </p>
            )}
          </div>
        </section>

        <section className="workspace-v2-discovery-analytics-card">
          <div className="workspace-v2-founder-section-heading">
            <div>
              <span className="eyebrow">
                <AlertTriangle size={13} />
                {spanish ? "Canciones en riesgo" : "Songs At Risk"}
              </span>
              <h4>{spanish ? "Baja exposicion" : "Low exposure"}</h4>
            </div>
          </div>
          <div className="workspace-v2-discovery-song-list">
            {report.songsAtRisk.slice(0, 8).map((song) => (
              <article key={song.songId}>
                <strong>{song.title}</strong>
                <span>{song.artist}</span>
                <small>
                  {formatAnalyticsNumber(song.validListens, locale)}{" "}
                  {spanish ? "reproducciones" : "listens"} /{" "}
                  {formatAnalyticsNumber(song.daysSinceUpload, locale)}{" "}
                  {spanish ? "dias publicada" : "days live"}
                </small>
              </article>
            ))}
            {!report.songsAtRisk.length && (
              <p className="workspace-v2-founder-empty">
                {spanish
                  ? "No hay canciones en riesgo."
                  : "No songs are currently at risk."}
              </p>
            )}
          </div>
        </section>
      </div>

      <div className="workspace-v2-founder-two-column">
        <section className="workspace-v2-discovery-analytics-card">
          <div className="workspace-v2-founder-section-heading">
            <div>
              <span className="eyebrow">
                <Trophy size={13} />
                {spanish ? "Discovery winners" : "Discovery Winners"}
              </span>
              <h4>{spanish ? "Beneficiadas despues de Smart Queue" : "Post Smart Queue winners"}</h4>
            </div>
          </div>
          <div className="workspace-v2-discovery-song-list">
            {report.discoveryWinners.slice(0, 8).map((song) => (
              <article key={song.songId}>
                <strong>{song.title}</strong>
                <span>{song.artist}</span>
                <small>
                  +{formatAnalyticsNumber(song.validAfterSmartQueue, locale)}{" "}
                  {spanish ? "desde Smart Queue" : "since Smart Queue"}
                </small>
              </article>
            ))}
            {!report.discoveryWinners.length && (
              <p className="workspace-v2-founder-empty">
                {spanish
                  ? "Todavia no hay ganadoras posteriores al cambio."
                  : "No post-change winners yet."}
              </p>
            )}
          </div>
        </section>

        <section className="workspace-v2-discovery-analytics-card">
          <div className="workspace-v2-founder-section-heading">
            <div>
              <span className="eyebrow">
                <Clock3 size={13} />
                {spanish ? "Tiempo hasta primera reproduccion" : "Time To First Listen"}
              </span>
              <h4>
                {spanish
                  ? `${formatAnalyticsNumber(
                      report.timeToFirstListen.pendingFirstListenSongs,
                      locale,
                    )} pendientes`
                  : `${formatAnalyticsNumber(
                      report.timeToFirstListen.pendingFirstListenSongs,
                      locale,
                    )} pending`}
              </h4>
            </div>
          </div>
          <div className="workspace-v2-discovery-song-list">
            {report.timeToFirstListen.songs.slice(0, 8).map((song) => (
              <article key={song.songId}>
                <strong>{song.title}</strong>
                <span>{song.artist}</span>
                <small>
                  {song.firstValidListenAt
                    ? `${formatAnalyticsHours(song.hoursToFirstListen, locale)} ${
                        spanish ? "hasta 1ra reproduccion" : "to first listen"
                      }`
                    : spanish
                      ? "Sin primera reproduccion valida"
                      : "No first valid listen yet"}
                </small>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function FounderOperationsPanel({
  locale,
  snapshot,
}: {
  locale: InterfaceLocale;
  snapshot: FounderOperationsSnapshot | null;
}) {
  const spanish = locale === "es";
  const [userSearch, setUserSearch] = useState("");

  const filteredUsers = useMemo(() => {
    if (!snapshot) return [];
    const query = userSearch.trim().toLowerCase();
    if (!query) return snapshot.users;
    return snapshot.users.filter((user) =>
      [
        user.username,
        user.email,
        user.role,
        user.id,
        String(user.tokenBalance),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [snapshot, userSearch]);

  if (!snapshot) {
    return (
      <section className="workspace-v2-content-panel workspace-v2-founder-ops">
        <span className="eyebrow">
          <Gauge size={13} />
          Founder Operations
        </span>
        <h2>
          {spanish
            ? "El panel Founder Operations no esta disponible."
            : "Founder Operations is unavailable."}
        </h2>
        <p>
          {spanish
            ? "La preview conserva el Workspace V2, pero no recibio el snapshot administrativo."
            : "The Workspace V2 preview remains available, but the administrative snapshot did not load."}
        </p>
      </section>
    );
  }

  const summaryCards = [
    [spanish ? "Usuarios totales" : "Total users", snapshot.summary.totalUsers, Users],
    [spanish ? "Usuarios activos" : "Active users", snapshot.summary.activeUsers, Activity],
    [spanish ? "Canciones totales" : "Total songs", snapshot.summary.totalSongs, Music2],
    [
      spanish ? "Canciones pendientes" : "Songs pending review",
      snapshot.summary.songsPendingReview,
      ListMusic,
    ],
    [spanish ? "Reportes abiertos" : "Open reports", snapshot.summary.openReports, Flag],
    [
      spanish ? "Feedback abierto" : "Open feedback items",
      snapshot.summary.openFeedbackItems,
      Inbox,
    ],
  ] as const;

  return (
    <section
      aria-label="Founder Operations"
      className="workspace-v2-content-panel workspace-v2-founder-ops"
    >
      <div className="workspace-v2-founder-ops-heading">
        <div>
          <span className="eyebrow">
            <Gauge size={13} />
            Founder Operations
          </span>
          <h2>Centro de Operaciones</h2>
          <p>
            Vista general de usuarios, actividad, reportes y soporte.
          </p>
        </div>
        <span className="workspace-v2-readonly-badge">
          Solo lectura
        </span>
      </div>

      {snapshot.errors?.length ? (
        <div className="workspace-v2-founder-ops-warning" role="status">
          <strong>{spanish ? "Lecturas incompletas" : "Incomplete reads"}</strong>
          <span>{snapshot.errors.join(" / ")}</span>
        </div>
      ) : null}

      <div className="workspace-v2-founder-summary-grid">
        {summaryCards.map(([label, value, Icon]) => (
          <article key={label}>
            <span>
              <Icon size={14} />
              {label}
            </span>
            <strong>{Number(value).toLocaleString()}</strong>
          </article>
        ))}
      </div>

      <FounderDiscoveryAnalyticsDashboard
        locale={locale}
        report={snapshot.discoveryAnalytics}
      />

      <section className="workspace-v2-founder-section">
        <div className="workspace-v2-founder-section-heading">
          <div>
            <span className="eyebrow">
              <Users size={13} />
              {spanish ? "Directorio" : "User Directory"}
            </span>
            <h3>{spanish ? "Usuarios" : "Users"}</h3>
          </div>
          <label className="workspace-v2-founder-search">
            <Search size={14} />
            <input
              aria-label={spanish ? "Buscar usuarios" : "Search users"}
              onChange={(event) => setUserSearch(event.target.value)}
              placeholder={
                spanish
                  ? "Buscar usuario, email o rol"
                  : "Search username, email, or role"
              }
              value={userSearch}
            />
          </label>
        </div>
        <div className="workspace-v2-founder-table" role="table">
          <div role="row">
            <span role="columnheader">{spanish ? "Usuario" : "Username"}</span>
            <span role="columnheader">Email</span>
            <span role="columnheader">Role</span>
            <span role="columnheader">Tokens</span>
          </div>
          {filteredUsers.slice(0, 80).map((user) => (
            <div key={user.id} role="row">
              <span role="cell">{user.username || user.id}</span>
              <span role="cell">{user.email || "-"}</span>
              <span role="cell">{humanizeOperationsLabel(user.role)}</span>
              <span role="cell">{user.tokenBalance.toLocaleString()}</span>
            </div>
          ))}
          {!filteredUsers.length && (
            <p className="workspace-v2-founder-empty">
              {spanish ? "No hay usuarios para esta busqueda." : "No users match this search."}
            </p>
          )}
        </div>
      </section>

      <div className="workspace-v2-founder-two-column">
        <section className="workspace-v2-founder-section">
          <div className="workspace-v2-founder-section-heading">
            <div>
              <span className="eyebrow">
                <Flag size={13} />
                {spanish ? "Reportes" : "Reports Overview"}
              </span>
              <h3>{spanish ? "Reportes abiertos" : "Open reports"}</h3>
            </div>
          </div>
          <div className="workspace-v2-founder-table" role="table">
            <div role="row">
              <span role="columnheader">{spanish ? "Tipo" : "Report type"}</span>
              <span role="columnheader">{spanish ? "Contenido" : "Target content"}</span>
              <span role="columnheader">Status</span>
            </div>
            {snapshot.reports.slice(0, 20).map((report) => (
              <div
                key={report.id}
                role="row"
                title={formatOperationsDate(report.createdAt, locale)}
              >
                <span role="cell">{humanizeOperationsLabel(report.reportType)}</span>
                <span role="cell">{report.targetContent}</span>
                <span role="cell">{humanizeOperationsLabel(report.status)}</span>
              </div>
            ))}
            {!snapshot.reports.length && (
              <p className="workspace-v2-founder-empty">
                {spanish ? "No hay reportes abiertos." : "No open reports."}
              </p>
            )}
          </div>
        </section>

        <section className="workspace-v2-founder-section">
          <div className="workspace-v2-founder-section-heading">
            <div>
              <span className="eyebrow">
                <Inbox size={13} />
                {spanish ? "Feedback" : "Feedback Inbox"}
              </span>
              <h3>{spanish ? "Estado del inbox" : "Inbox status"}</h3>
            </div>
          </div>
          <div className="workspace-v2-feedback-counts">
            <article>
              <span>{spanish ? "Abierto" : "Open feedback"}</span>
              <strong>{snapshot.feedback.open.toLocaleString()}</strong>
            </article>
            <article>
              <span>{spanish ? "En progreso" : "In progress"}</span>
              <strong>{snapshot.feedback.inProgress.toLocaleString()}</strong>
            </article>
            <article>
              <span>{spanish ? "Resuelto" : "Resolved"}</span>
              <strong>{snapshot.feedback.resolved.toLocaleString()}</strong>
            </article>
          </div>
        </section>
      </div>

      <small className="workspace-v2-founder-footnote">
        <BarChart3 size={13} />
        {spanish
          ? `Snapshot generado con lecturas existentes. Reportes limitados a los ultimos ${snapshot.reports.length}.`
          : `Snapshot generated from existing reads. Reports shown: ${snapshot.reports.length}.`}
      </small>
    </section>
  );
}

function WorkspaceV2ActiveSongActions({
  guestToken,
  locale,
  song,
  viewerMode,
}: {
  guestToken?: string | null;
  locale: InterfaceLocale;
  song: WorkspaceV2Song;
  viewerMode: WorkspaceV2ViewerMode;
}) {
  const spanish = locale === "es";
  const [reportReason, setReportReason] = useState("spam");
  const [reportMessage, setReportMessage] = useState("");
  const [reporting, setReporting] = useState(false);

  const submitReport = async () => {
    if (viewerMode === "guest") {
      setReportMessage(
        spanish
          ? "Crea una cuenta gratis para reportar contenido."
          : "Create a free account to report content.",
      );
      return;
    }
    const supabase = createClient();
    if (!supabase || reporting) return;
    setReporting(true);
    const { error } = await supabase.rpc("report_song", {
      reported_song_id: song.id,
      report_reason: reportReason,
      report_details: null,
    });
    setReporting(false);
    setReportMessage(
      error
        ? error.message
        : spanish
          ? "Reporte enviado para moderacion."
          : "Report sent to moderation.",
    );
  };

  return (
    <section
      className="workspace-v2-active-actions"
      aria-label={spanish ? "Acciones de la cancion actual" : "Current song actions"}
    >
      <SongActionBar
        artist={song.artist}
        artistId={song.artistId}
        compact
        link={song.link}
        locale={locale}
        guestToken={guestToken ?? undefined}
        platform={workspaceSongPlatform(song)}
        songId={song.id}
        title={song.title}
      />
      <details className="workspace-v2-report-action">
        <summary>
          <Flag size={14} />
          {spanish ? "Reportar problema" : "Report a problem"}
        </summary>
        <div>
          <select
            aria-label={spanish ? "Motivo del reporte" : "Report reason"}
            onChange={(event) => setReportReason(event.target.value)}
            value={reportReason}
          >
            <option value="spam">Spam</option>
            <option value="broken_link">{spanish ? "Enlace roto" : "Broken Link"}</option>
            <option value="not_music">{spanish ? "No es música" : "Not Music"}</option>
            <option value="illegal_content">
              {spanish ? "Contenido ilegal" : "Illegal Content"}
            </option>
            <option value="offensive_content">
              {spanish ? "Contenido ofensivo" : "Offensive Content"}
            </option>
          </select>
          <button disabled={reporting} onClick={submitReport} type="button">
            <Flag size={14} />
            {reporting
              ? spanish
                ? "Enviando..."
                : "Sending..."
              : spanish
                ? "Enviar reporte"
                : "Send report"}
          </button>
        </div>
        {reportMessage && <small role="status">{reportMessage}</small>}
      </details>
    </section>
  );
}

function WorkspaceV2FounderDebug({
  activeSongId,
  controller,
  lastError,
  lastTransition,
  logs,
  nextSongId,
  pipelineDebug,
  providerDebug,
}: {
  activeSongId: string;
  controller: ReturnType<typeof useWorkspaceV2Controller>;
  lastError: string | null;
  lastTransition: string;
  logs: InstrumentationLog[];
  nextSongId: string;
  pipelineDebug: PlaybackPipelineDebug;
  providerDebug: ProviderDebugState;
}) {
  return (
    <section className="workspace-v2-debug-panel" aria-label="Workspace V2 debug panel">
      <div>
        <span>currentSongId</span>
        <strong>{activeSongId}</strong>
      </div>
      <div>
        <span>nextSongId</span>
        <strong>{nextSongId}</strong>
      </div>
      <div>
        <span>playbackState</span>
        <strong>{controller.playback.state}</strong>
      </div>
      <div>
        <span>pendingCommand</span>
        <strong>{controller.playback.pendingCommand.command}</strong>
      </div>
      <div>
        <span>queueState</span>
        <strong>
          {controller.queue.activeQueue?.mode ?? "none"} /{" "}
          {controller.queue.activeQueue?.source ?? "none"} /{" "}
          {controller.position.current} of {controller.position.total}
        </strong>
      </div>
      <div>
        <span>providerReady</span>
        <strong>{providerDebug.providerReady ? "true" : "false"}</strong>
      </div>
      <div>
        <span>providerReady events</span>
        <strong>{pipelineDebug.providerReadyEventCount}</strong>
      </div>
      <div>
        <span>providerReady handled</span>
        <strong>{pipelineDebug.providerReadyHandledCount}</strong>
      </div>
      <div>
        <span>play button requests</span>
        <strong>{pipelineDebug.playButtonRequestCount}</strong>
      </div>
      <div>
        <span>play requests emitted</span>
        <strong>{pipelineDebug.playRequestEmittedCount}</strong>
      </div>
      <div>
        <span>play requests at adapter</span>
        <strong>{pipelineDebug.playRequestAdapterCount}</strong>
      </div>
      <div>
        <span>play started events</span>
        <strong>{pipelineDebug.playStartedCount}</strong>
      </div>
      <div>
        <span>play failed events</span>
        <strong>{pipelineDebug.playFailedCount}</strong>
      </div>
      <div>
        <span>providerLoaded</span>
        <strong>{providerDebug.providerLoaded ? "true" : "false"}</strong>
      </div>
      <div>
        <span>providerPlaying</span>
        <strong>{providerDebug.providerPlaying ? "true" : "false"}</strong>
      </div>
      <div>
        <span>lastTransition</span>
        <strong>{lastTransition}</strong>
      </div>
      <div>
        <span>adapter renders</span>
        <strong>{providerDebug.adapterRenderCount}</strong>
      </div>
      <div>
        <span>adapter mount/unmount</span>
        <strong>
          {providerDebug.adapterMountCount}/{providerDebug.adapterUnmountCount}
        </strong>
      </div>
      <div>
        <span>player renders</span>
        <strong>{providerDebug.playerRenderCount}</strong>
      </div>
      <div>
        <span>player mount/unmount</span>
        <strong>
          {providerDebug.playerMountCount}/{providerDebug.playerUnmountCount}
        </strong>
      </div>
      <div>
        <span>iframe loads</span>
        <strong>{providerDebug.iframeLoadCount}</strong>
      </div>
      <div>
        <span>youtube cleanup</span>
        <strong>{providerDebug.youtubeCleanupCount}</strong>
      </div>
      <div className="workspace-v2-debug-wide">
        <span>lastError</span>
        <strong>{lastError ?? "-"}</strong>
      </div>
      <div className="workspace-v2-debug-wide">
        <span>currentIframeSrc</span>
        <strong>{providerDebug.currentIframeSrc ?? "-"}</strong>
      </div>
      <div className="workspace-v2-debug-wide workspace-v2-log">
        {logs.slice(0, 20).map((entry, index) => (
          <article key={`${entry.at}-${entry.channel}-${index}`}>
            <span>{new Date(entry.at).toLocaleTimeString()}</span>
            <strong>{entry.channel}</strong>
            <p>{entry.message}</p>
            {entry.details && <small>{entry.details}</small>}
          </article>
        ))}
      </div>
    </section>
  );
}
