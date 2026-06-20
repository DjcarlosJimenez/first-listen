"use client";

import Link from "next/link";
import {
  type CSSProperties,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock3,
  Coins,
  Compass,
  Flag,
  Gauge,
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
  if (!source) return spanish ? "Cola" : "Queue";
  const normalized = source.replaceAll("_", " ");
  if (!spanish) return normalized;
  const labels: Record<string, string> = {
    featured: "destacadas",
    genre: "género",
    random: "aleatorio",
    review: "reproducción",
  };
  return labels[source] ?? normalized;
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
  const [workspaceLocale, setWorkspaceLocale] =
    useState<InterfaceLocale>(locale);
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
  const productivityMode = activePanel !== "discover";
  const workspaceMode = productivityMode ? "productivity" : "discover";
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
  const heroCollapsedRef = useRef(false);
  const lastSnapshotSignatureRef = useRef("");
  const snapshotSaveTimeoutRef = useRef<number | null>(null);
  const heroRef = useRef<HTMLDivElement | null>(null);
  const playbackRef = useRef("");
  const providerSkipSongRef = useRef<string | null>(null);
  const providerSkipTimeoutRef = useRef<number | null>(null);
  const queueRef = useRef("");
  const telemetryRef = useRef("");
  const trustedPlaybackRequestRef = useRef<(() => void) | null>(null);
  const trustedPlaybackPointerAtRef = useRef(0);
  const validationRef = useRef("");

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
    setWorkspaceLocale(stored === "en" || stored === "es" ? stored : locale);
  }, [locale]);

  useEffect(() => {
    document.documentElement.lang = workspaceLocale;
    window.localStorage.setItem("first-listen-locale", workspaceLocale);
  }, [workspaceLocale]);

  useEffect(() => {
    document.documentElement.classList.toggle("theme-dark", darkMode);
    window.localStorage.setItem("first-listen-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    setMobileQueueExpanded(false);
  }, [activePanel]);

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
    const updateCollapsedState = () => {
      const mobile = window.matchMedia("(max-width: 900px)").matches;
      const threshold = mobile ? 90 : 260;
      const nextCollapsed = window.scrollY > threshold;
      if (heroCollapsedRef.current === nextCollapsed) return;
      heroCollapsedRef.current = nextCollapsed;
      setHeroCollapsed(nextCollapsed);
    };

    updateCollapsedState();
    window.addEventListener("scroll", updateCollapsedState, { passive: true });
    window.addEventListener("resize", updateCollapsedState);
    return () => {
      window.removeEventListener("scroll", updateCollapsedState);
      window.removeEventListener("resize", updateCollapsedState);
    };
  }, []);

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
  const nextSong = controller.remainingSongs[0] ?? null;
  const nextSongId = nextSong?.id ?? "none";
  const queueTitle = controller.queue.activeQueue?.title ?? initialQueue.title;
  const queueSource = controller.queue.activeQueue?.source ?? initialQueue.source;
  const localizedQueueTitle =
    queueTitle === "Continuous Discovery" ||
    queueTitle === "Descubrimiento continuo"
      ? spanish
        ? "Descubrimiento continuo"
        : "Continuous Discovery"
      : queueTitle;
  const positionCurrent = controller.position.current;
  const positionTotal = controller.position.total;
  const remainingCount = controller.remainingSongs.length;
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
  const queueSongs = controller.queue.activeQueue?.songs ?? initialQueue.songs;
  const consumedSongs = queueSongs.filter((song) =>
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

  const handlePlayPointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === "mouse" || event.pointerType === "pen" || event.pointerType === "touch") {
        trustedPlaybackPointerAtRef.current = Date.now();
        handlePlay();
      }
    },
    [handlePlay],
  );

  const handlePlayClick = useCallback(() => {
    if (
      trustedPlaybackPointerAtRef.current > 0 &&
      Date.now() - trustedPlaybackPointerAtRef.current < 750
    ) {
      return;
    }
    handlePlay();
  }, [handlePlay]);

  const handlePause = useCallback(() => {
    economy.markInteraction();
    controller.pause();
  }, [controller, economy]);

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

  const handlePlayQueueSong = useCallback(
    (song: WorkspaceV2Song) => {
      const index = initialQueue.songs.findIndex((item) => item.id === song.id);
      if (index < 0) return;
      economy.markInteraction();
      loadQueue(initialQueue, { autoPlay: true, startIndex: index });
      setActivePanel("discover");
    },
    [economy, initialQueue, loadQueue],
  );

  const handlePanelChange = useCallback((panel: WorkspaceV2Panel) => {
    setActivePanel(panel);
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 900px)").matches
    ) {
      setSidebarExpanded(false);
    }
  }, []);

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
            onClick={() => setWorkspaceLocale("es")}
            type="button"
          >
            ES
          </button>
          <span aria-hidden="true">|</span>
          <button
            aria-pressed={workspaceLocale === "en"}
            className={workspaceLocale === "en" ? "active" : ""}
            onClick={() => setWorkspaceLocale("en")}
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
                  ? "Una cola interna. Un reproductor persistente. Tu progreso siempre visible."
                  : "One internal queue. One persistent player. Your progress stays visible.")}
            </p>
          </div>

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
              onPointerDown={handlePlayPointerDown}
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
              {queueSourceLabel(queueSource, spanish)} / {positionCurrent}
              /{positionTotal}
            </span>
          </div>

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
                  ? "Vista previa de progreso. Crea una cuenta para activar recompensas."
                  : "Progress preview. Create an account to activate rewards."
                : rewardReady
                  ? spanish
                    ? "Recompensa disponible ahora"
                    : "Reward available now"
                  : spanish
                    ? `${clock(secondsUntilReward)} hasta el próximo token`
                    : `${clock(secondsUntilReward)} until next token`}
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
                  ? "Crea una cuenta gratis para activar tokens."
                  : "Create a free account to activate tokens."}
              </strong>
            </article>
          )}
        </section>

        <div className="workspace-v2-product-body" data-workspace-mode={workspaceMode}>
          <WorkspaceV2ContentPanel
            activePanel={activePanel}
            canAccessAdmin={canAccessAdmin}
            canSubmit={canSubmit}
            contentEconomy={contentEconomy}
            copy={copy}
            founderFree={founderSubmissionsRemaining > 0}
            founderOperations={founderOperations}
            initialQueue={initialQueue}
            locale={workspaceLocale}
            onPanelChange={handlePanelChange}
            onPlaySong={handlePlayQueueSong}
            onSubmitNotice={notifySubmit}
            onSubmitSong={handleSubmitSong}
            profilePanel={profilePanel}
            submitNotice={submitNotice}
            submissionTokens={submissionTokens}
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
                {positionCurrent}/{positionTotal}
              </strong>
              <span>{queueSourceLabel(queueSource, spanish)}</span>
              <small>
                {remainingCount} {spanish ? "pendientes" : "remaining"}
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
    </section>
  );
}

function WorkspaceV2ContentPanel({
  activePanel,
  canAccessAdmin,
  canSubmit,
  contentEconomy,
  copy,
  founderFree,
  founderOperations,
  initialQueue,
  locale,
  onPanelChange,
  onPlaySong,
  onSubmitNotice,
  onSubmitSong,
  profilePanel,
  submitNotice,
  submissionTokens,
  unlimitedSubmissionTokens,
  viewerMode,
}: {
  activePanel: WorkspaceV2Panel;
  canAccessAdmin: boolean;
  canSubmit: boolean;
  contentEconomy: ContentEconomySetting[];
  copy: ReturnType<typeof getCopy>;
  founderFree: boolean;
  founderOperations: FounderOperationsSnapshot | null;
  initialQueue: WorkspaceV2Queue;
  locale: InterfaceLocale;
  onPanelChange: (panel: WorkspaceV2Panel) => void;
  onPlaySong: (song: WorkspaceV2Song) => void;
  onSubmitNotice: (message: string) => void;
  onSubmitSong: (
    usedFounderFree: boolean,
    submission: SongSubmission,
  ) => Promise<boolean>;
  profilePanel?: ProfilePanelProps | null;
  submitNotice: string;
  submissionTokens: number;
  unlimitedSubmissionTokens: boolean;
  viewerMode: WorkspaceV2ViewerMode;
}) {
  const spanish = locale === "es";

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
              ? "El shell conserva la reproducción mientras abres el flujo actual de envío."
              : "The shell keeps playback alive while you open the current submission workflow."
            : spanish
              ? "Puedes seguir reproduciendo como invitado. Una cuenta gratis activa recompensas, tokens y envíos."
              : "You can keep playing as a guest. A free account activates rewards, tokens and submissions."}
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
              ? "La migración completa del perfil vendrá después; por ahora el acceso se mantiene sin duplicar reproductores."
              : "The full profile migration comes later; access stays available without duplicating players."}
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
            ? "Los controles administrativos no se migran en esta fase. El shell solo conserva acceso y reproducción."
            : "Administrative controls are not migrated in this phase. The shell only preserves access and playback."}
        </p>
        {canAccessAdmin && (
          <Link href={activePanel === "owner" ? "/owner" : "/admin"}>
            {activePanel === "owner" ? "Owner Control Center" : "Admin Panel"}
          </Link>
        )}
      </section>
    );
  }

  return (
    <section className="workspace-v2-content-panel">
      <span className="eyebrow">
        <Compass size={13} />
        {spanish ? "Descubrir" : "Discover"}
      </span>
      <h2>
        {spanish
          ? "Elige música sin salir del Workspace."
          : "Choose music without leaving the Workspace."}
      </h2>
      <p>
        {spanish
          ? "Esta fase usa la cola interna actual. Los destinos avanzados se migrarán después de estabilizar el shell."
          : "This phase uses the current internal queue. Advanced destinations move later after the shell is stable."}
      </p>
      <div className="workspace-v2-discover-list">
        {initialQueue.songs.slice(0, 12).map((song) => (
          <button key={song.id} onClick={() => onPlaySong(song)} type="button">
            <span>{song.title}</span>
            <small>
              {song.artist} / {song.platform}
            </small>
          </button>
        ))}
      </div>
      <button
        className="workspace-v2-secondary-action"
        onClick={() => onPanelChange("submit")}
        type="button"
      >
        {spanish ? "Enviar mi música" : "Submit my music"}
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
      <div className="workspace-v2-report-action">
        <select
          aria-label={spanish ? "Motivo del reporte" : "Report reason"}
          onChange={(event) => setReportReason(event.target.value)}
          value={reportReason}
        >
          <option value="spam">Spam</option>
          <option value="broken_link">{spanish ? "Enlace roto" : "Broken Link"}</option>
          <option value="not_music">{spanish ? "No es musica" : "Not Music"}</option>
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
              ? "Reportar"
              : "Report"}
        </button>
        {reportMessage && <small role="status">{reportMessage}</small>}
      </div>
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
