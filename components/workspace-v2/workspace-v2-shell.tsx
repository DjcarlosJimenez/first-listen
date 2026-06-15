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
  Coins,
  Compass,
  Flag,
  Gauge,
  ListMusic,
  LockKeyhole,
  LogOut,
  Maximize2,
  Pause,
  Play,
  Send,
  ShieldCheck,
  SkipForward,
  User,
  Wrench,
} from "lucide-react";
import { ProfilePanel, type ProfilePanelProps } from "@/components/profile-panel";
import { SongActionBar } from "@/components/song-action-bar";
import type { InterfaceLocale } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/client";
import type { Platform } from "@/lib/types";
import type { WorkspaceV2Queue, WorkspaceV2Song } from "@/lib/workspace-v2";
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

type WorkspaceV2Panel = "discover" | "submit" | "profile" | "owner" | "admin";

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
        owner: "Owner",
        profile: "Mi perfil",
        submit: "Enviar canción",
      }
    : {
        admin: "Admin",
        discover: "Discover",
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
    review: "escucha",
  };
  return labels[source] ?? normalized;
}

function nowPlayingLabel(song: WorkspaceV2Song | null, spanish: boolean) {
  if (song) return song.title;
  return spanish ? "Elige una canción" : "Choose a song";
}

function workspaceSongPlatform(song: WorkspaceV2Song): Platform {
  return song.platform as Platform;
}

export function WorkspaceV2Shell({
  debugMode = false,
  economyMode = "sandbox",
  guestToken,
  initialQueue,
  locale,
  profilePanel,
  viewerIdentity,
  viewerMode = "member",
}: {
  debugMode?: boolean;
  economyMode?: WorkspaceV2EconomyMode;
  guestToken?: string | null;
  initialQueue: WorkspaceV2Queue;
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
      debugMode={debugMode}
      economyMode={economyMode}
      guestToken={guestToken}
      initialQueue={initialQueue}
      locale={locale}
      profilePanel={profilePanel}
      viewerIdentity={viewerIdentity}
      viewerMode={viewerMode}
    />
  );
}

function WorkspaceV2ShellClient({
  debugMode,
  economyMode,
  guestToken,
  initialQueue,
  locale,
  profilePanel,
  viewerIdentity,
  viewerMode,
}: {
  debugMode: boolean;
  economyMode: WorkspaceV2EconomyMode;
  guestToken?: string | null;
  initialQueue: WorkspaceV2Queue;
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
  const spanish = locale === "es";
  const canAccessAdmin = viewerMode === "founder" || viewerMode === "admin";
  const canClaimRewards = viewerMode !== "guest" && economy.enabled;
  const canSubmit = viewerMode !== "guest";
  const debugAllowed = canAccessAdmin;
  const displayIdentity =
    viewerIdentity?.trim() || viewerLabel(viewerMode, spanish);
  const [activePanel, setActivePanel] = useState<WorkspaceV2Panel>("discover");
  const [debugOpen, setDebugOpen] = useState(debugMode && debugAllowed);
  const [heroCollapsed, setHeroCollapsed] = useState(false);
  const [logs, setLogs] = useState<InstrumentationLog[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastTransition, setLastTransition] = useState("BOOT");
  const [nowMs, setNowMs] = useState(Date.now());
  const [signingOut, setSigningOut] = useState(false);
  const [pipelineDebug, setPipelineDebug] =
    useState<PlaybackPipelineDebug>(initialPipelineDebug);
  const [providerDebug, setProviderDebug] =
    useState<ProviderDebugState>(initialProviderDebug);
  const commandRef = useRef("");
  const heroCollapsedRef = useRef(false);
  const heroRef = useRef<HTMLDivElement | null>(null);
  const playbackRef = useRef("");
  const queueRef = useRef("");
  const sessionStartedAtRef = useRef<number | null>(null);
  const telemetryRef = useRef("");
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

  useEffect(() => {
    try {
      loadQueue(initialQueue, { autoPlay: true });
      recordTransition(
        "LOAD_SONG",
        initialQueue.songs[0]
          ? `${initialQueue.songs[0].id} / ${initialQueue.songs[0].title}`
          : "Queue is empty",
      );
    } catch (error) {
      recordError(
        "LOAD_SONG failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [initialQueue, loadQueue, recordError, recordTransition]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

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
      economy.handleProviderEvent(event, controller.activeSong);
      controller.handleProviderEvent(event);
    },
    [controller, economy],
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
  const positionCurrent = controller.position.current;
  const positionTotal = controller.position.total;
  const remainingCount = controller.remainingSongs.length;
  const elapsedSeconds = sessionStartedAtRef.current
    ? Math.max(0, Math.floor((nowMs - sessionStartedAtRef.current) / 1000))
    : 0;
  const sessionValid =
    economy.state.validListenRecorded || controller.validation.validListen;
  const displayedTimePlayed = Math.max(
    controller.telemetry.timeLiveSeconds,
    controller.telemetry.currentProgressSeconds,
    elapsedSeconds,
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
  const listeningStreak =
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
  const playerSurfaceStyle: CSSProperties | undefined =
    controller.activeSong && !playerIsVideo && controller.activeSong.coverUrl
      ? {
          backgroundImage: `linear-gradient(135deg, rgba(7, 16, 9, 0.5), rgba(7, 16, 9, 0.92)), url("${controller.activeSong.coverUrl}")`,
        }
      : undefined;

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
    if (controller.playback.state === "playing" && !sessionStartedAtRef.current) {
      sessionStartedAtRef.current = Date.now();
    }
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
        { icon: Compass, id: "discover" as const },
        { icon: Send, id: "submit" as const },
        { icon: User, id: "profile" as const },
        ...(canAccessAdmin
          ? [
              { icon: ShieldCheck, id: "owner" as const },
              { icon: Wrench, id: "admin" as const },
            ]
          : []),
      ],
    [canAccessAdmin],
  );

  return (
    <section
      className="workspace-v2-product-shell"
      data-viewer-mode={viewerMode}
      data-workspace-version="2"
    >
      <aside className="workspace-v2-product-nav" aria-label="Workspace navigation">
        <div className="workspace-v2-product-brand">
          <span>FIRST LISTEN</span>
          <small>{displayIdentity}</small>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                aria-current={activePanel === item.id ? "page" : undefined}
                className={activePanel === item.id ? "active" : ""}
                key={item.id}
                onClick={() => setActivePanel(item.id)}
                type="button"
              >
                <Icon size={17} />
                {panelLabel(item.id, spanish)}
              </button>
            );
          })}
        </nav>
        {debugAllowed && (
          <button
            className="workspace-v2-debug-toggle"
            onClick={() => setDebugOpen((current) => !current)}
            type="button"
          >
            <Gauge size={15} />
            {debugOpen
              ? spanish
                ? "Ocultar debug"
                : "Hide debug"
              : spanish
                ? "Debug Founder"
                : "Founder debug"}
          </button>
        )}
        <button
          className="workspace-v2-signout-button"
          disabled={signingOut}
          onClick={handleSignOut}
          type="button"
        >
          <LogOut size={15} />
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
        </button>
      </aside>

      <main className="workspace-v2-product-main">
        <section
          className="workspace-v2-product-hero"
          data-collapsed={heroCollapsed ? "true" : "false"}
          data-player-mode={playerIsVideo ? "video" : "audio"}
          ref={heroRef}
        >
          <div className="workspace-v2-hero-copy">
            <span className="eyebrow">
              {playerMode} / {activePlatform}
            </span>
            <h1>{nowPlayingLabel(controller.activeSong, spanish)}</h1>
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
            style={playerSurfaceStyle}
          >
            <WorkspaceV2ProviderPlayerAdapter
              command={controller.playback.pendingCommand}
              locale={locale}
              onDebug={handleProviderDebug}
              onEvent={handleProviderEvent}
              song={controller.activeSong}
            />
          </div>

          <div
            aria-hidden={!heroCollapsed}
            className="workspace-v2-compact-listener-status"
          >
            <article>
              <span>{spanish ? "Ahora" : "Now"}</span>
              <strong>{controller.activeSong?.title ?? "-"}</strong>
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
            <button onClick={handlePlay} type="button">
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
            <span>
              {queueSourceLabel(queueSource, spanish)} / {positionCurrent}
              /{positionTotal}
            </span>
          </div>

          {controller.activeSong && (
            <WorkspaceV2ActiveSongActions
              locale={locale}
              song={controller.activeSong}
              guestToken={guestToken}
              viewerMode={viewerMode}
            />
          )}
        </section>

        <section className="workspace-v2-trust-layer" aria-label="Listening status">
          <article className="workspace-v2-session-card">
            <span>{spanish ? "Sesión" : "Session"}</span>
            <strong>
              {sessionValid
                ? spanish
                  ? "Válida"
                  : "Valid"
                : statusLabel(controller.playback.state, spanish)}
            </strong>
          </article>
          <article>
            <span>{spanish ? "Tiempo reproducido" : "Time Played"}</span>
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
            <span>{spanish ? "Tokens de envío" : "Submission Tokens"}</span>
            <strong>
              {viewerMode === "guest"
                ? spanish
                  ? "Activa al registrarte"
                  : "Activate by joining"
                : economy.state.credits}
            </strong>
          </article>
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
          aria-label={spanish ? "Motivación de escucha" : "Listening motivation"}
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
            <span>{spanish ? "Racha de escucha" : "Listening streak"}</span>
            <strong>{listeningStreak}</strong>
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

        <div className="workspace-v2-product-body">
          <WorkspaceV2ContentPanel
            activePanel={activePanel}
            canAccessAdmin={canAccessAdmin}
            canSubmit={canSubmit}
            initialQueue={initialQueue}
            locale={locale}
            onPanelChange={setActivePanel}
            onPlaySong={handlePlayQueueSong}
            profilePanel={profilePanel}
            viewerMode={viewerMode}
          />

          <aside className="workspace-v2-queue-panel" aria-label="Queue">
            <span className="eyebrow">
              <ListMusic size={13} />
              {spanish ? "Cola" : "Queue"}
            </span>
            <h2>{queueTitle}</h2>
            <div className="workspace-v2-queue-context">
              <strong>
                {positionCurrent}/{positionTotal}
              </strong>
              <span>{queueSourceLabel(queueSource, spanish)}</span>
              <small>
                {remainingCount} {spanish ? "por escuchar" : "remaining"}
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
  initialQueue,
  locale,
  onPanelChange,
  onPlaySong,
  profilePanel,
  viewerMode,
}: {
  activePanel: WorkspaceV2Panel;
  canAccessAdmin: boolean;
  canSubmit: boolean;
  initialQueue: WorkspaceV2Queue;
  locale: InterfaceLocale;
  onPanelChange: (panel: WorkspaceV2Panel) => void;
  onPlaySong: (song: WorkspaceV2Song) => void;
  profilePanel?: ProfilePanelProps | null;
  viewerMode: WorkspaceV2ViewerMode;
}) {
  const spanish = locale === "es";

  if (activePanel === "submit") {
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
              ? "Puedes seguir escuchando como invitado. Una cuenta gratis activa recompensas, tokens y envíos."
              : "You can keep listening as a guest. A free account activates rewards, tokens and submissions."}
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
