"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipForward } from "lucide-react";
import type { InterfaceLocale } from "@/lib/catalog";
import type { WorkspaceV2Queue } from "@/lib/workspace-v2";
import {
  WorkspaceV2ProviderPlayerAdapter,
  type WorkspaceV2ProviderDebugEvent,
} from "@/components/workspace-v2/workspace-v2-provider-player-adapter";
import { useWorkspaceV2Controller } from "@/components/workspace-v2/workspace-v2-controller";

type InstrumentationChannel =
  | "error"
  | "playback"
  | "provider"
  | "queue"
  | "transition"
  | "validation"
  | "telemetry"
  | "memory"
  | "sandbox";

type InstrumentationLog = {
  at: number;
  channel: InstrumentationChannel;
  details?: string;
  message: string;
};

type MemorySnapshot = {
  at: number;
  label: string;
  limitMB: number | null;
  totalMB: number | null;
  usedMB: number | null;
};

type PerformanceWithMemory = Performance & {
  memory?: {
    jsHeapSizeLimit: number;
    totalJSHeapSize: number;
    usedJSHeapSize: number;
  };
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

function clock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function pushLog(logs: InstrumentationLog[], entry: InstrumentationLog) {
  return [entry, ...logs].slice(0, 80);
}

function readMemorySnapshot(label: string): MemorySnapshot {
  if (typeof performance === "undefined") {
    return {
      at: Date.now(),
      label,
      limitMB: null,
      totalMB: null,
      usedMB: null,
    };
  }
  const memory = (performance as PerformanceWithMemory).memory;
  if (!memory) {
    return {
      at: Date.now(),
      label,
      limitMB: null,
      totalMB: null,
      usedMB: null,
    };
  }
  const toMB = (value: number) => Math.round((value / 1024 / 1024) * 10) / 10;
  return {
    at: Date.now(),
    label,
    limitMB: toMB(memory.jsHeapSizeLimit),
    totalMB: toMB(memory.totalJSHeapSize),
    usedMB: toMB(memory.usedJSHeapSize),
  };
}

function memoryLabel(snapshot: MemorySnapshot) {
  if (snapshot.usedMB === null) return "No disponible en este navegador";
  return `${snapshot.usedMB} MB usados / ${snapshot.totalMB} MB reservados`;
}

function browserName() {
  if (typeof navigator === "undefined") return "Unknown";
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome/")) return "Chrome";
  if (ua.includes("Safari/")) return "Safari";
  return "Browser";
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

export function WorkspaceV2Shell({
  initialQueue,
  locale,
}: {
  initialQueue: WorkspaceV2Queue;
  locale: InterfaceLocale;
}) {
  const controller = useWorkspaceV2Controller();
  const { loadQueue } = controller;
  const spanish = locale === "es";
  const [logs, setLogs] = useState<InstrumentationLog[]>([]);
  const [memorySnapshots, setMemorySnapshots] = useState<MemorySnapshot[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastTransition, setLastTransition] = useState("BOOT");
  const [providerDebug, setProviderDebug] = useState<ProviderDebugState>({
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
  });
  const playbackRef = useRef("");
  const queueRef = useRef("");
  const validationRef = useRef("");
  const telemetryRef = useRef("");
  const sessionStartedAtRef = useRef<number | null>(null);

  const recordLog = useCallback(
    ({
      channel,
      details,
      message,
    }: {
      channel: InstrumentationChannel;
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

  const captureMemorySnapshot = useCallback((label: string) => {
    const snapshot = readMemorySnapshot(label);
    setMemorySnapshots((current) => [snapshot, ...current].slice(0, 20));
    recordLog({
      channel: "memory",
      details: memoryLabel(snapshot),
      message: label,
    });
  }, [recordLog]);

  useEffect(() => {
    try {
      loadQueue(initialQueue);
      recordTransition(
        "LOAD_SONG",
        initialQueue.songs[0]
          ? `${initialQueue.songs[0].id} / ${initialQueue.songs[0].title}`
          : "Queue is empty",
      );
      recordLog({
        channel: "sandbox",
        details: `${initialQueue.songs.length} canciones cargadas en modo solo lectura`,
        message: "Workspace V2 Preview inicializado",
      });
    } catch (error) {
      recordError(
        "LOAD_SONG failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [initialQueue, loadQueue, recordError, recordLog, recordTransition]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    captureMemorySnapshot("Preview abierta");
    const interval = window.setInterval(
      () => captureMemorySnapshot("Snapshot automatico"),
      30000,
    );
    return () => window.clearInterval(interval);
  }, [captureMemorySnapshot]);

  useEffect(() => {
    const onVisibility = () => {
      recordLog({
        channel: "validation",
        details: `visible=${document.visibilityState === "visible"} focused=${document.hasFocus()}`,
        message: "Cambio de pestana detectado",
      });
    };
    window.addEventListener("focus", onVisibility);
    window.addEventListener("blur", onVisibility);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("blur", onVisibility);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [recordLog]);

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
  const positionCurrent = controller.position.current;
  const positionTotal = controller.position.total;
  const remainingCount = controller.remainingSongs.length;
  const elapsedSeconds = sessionStartedAtRef.current
    ? Math.max(0, Math.floor((nowMs - sessionStartedAtRef.current) / 1000))
    : 0;
  const memoryTrend = useMemo(() => {
    const latest = memorySnapshots[0];
    const oldest = memorySnapshots[memorySnapshots.length - 1];
    if (!latest || !oldest || latest.usedMB === null || oldest.usedMB === null) {
      return spanish ? "Pendiente" : "Pending";
    }
    const delta = Math.round((latest.usedMB - oldest.usedMB) * 10) / 10;
    return `${delta >= 0 ? "+" : ""}${delta} MB`;
  }, [memorySnapshots, spanish]);

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
      recordLog({
        channel: event.error ? "error" : "provider",
        details: event.error ?? event.details,
        message: event.transition ?? "PROVIDER_EVENT",
      });
    },
    [recordLog],
  );

  const handlePlay = useCallback(() => {
    try {
      recordTransition("PLAY_REQUEST", `${activeSongId} / ${controller.activeSong?.title ?? "No song"}`);
      controller.play();
    } catch (error) {
      recordError(
        "PLAY_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [activeSongId, controller, recordError, recordTransition]);

  const handleNext = useCallback(() => {
    try {
      recordTransition("NEXT_REQUEST", `${activeSongId} -> ${nextSongId}`);
      if (!controller.canAdvance) {
        recordError("NEXT_FAILED", "Queue cannot advance from current state.");
        return;
      }
      controller.next();
    } catch (error) {
      recordError(
        "NEXT_FAILED",
        error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error),
      );
    }
  }, [activeSongId, controller, nextSongId, recordError, recordTransition]);

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
      recordError("PLAY_FAILED", controller.playback.error ?? "Playback machine entered error state.");
    }
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
  }, [
    activeSongId,
    controller.activeSong,
    controller.playback.error,
    controller.playback.state,
    recordError,
    recordTransition,
    spanish,
  ]);

  useEffect(() => {
    const key = `${positionCurrent}:${positionTotal}:${remainingCount}:${activeSongId}:${controller.queue.lastAdvanceReason ?? ""}`;
    if (queueRef.current === key) return;
    queueRef.current = key;
    setLogs((current) =>
      pushLog(current, {
        at: Date.now(),
        channel: "queue",
        details: `${positionCurrent}/${positionTotal} - ${remainingCount} restantes`,
        message: controller.queue.lastAdvanceReason ?? "queue_sync",
      }),
    );
    if (activeSongId !== "none") {
      if (controller.queue.lastAdvanceReason && controller.queue.lastAdvanceReason !== "load_queue") {
        recordTransition(
          "NEXT_LOADED",
          `${activeSongId} / ${controller.activeSong?.title ?? "Unknown song"}`,
        );
      }
      captureMemorySnapshot(
        `Cambio de cancion ${positionCurrent}/${positionTotal}`,
      );
    }
  }, [
    activeSongId,
    captureMemorySnapshot,
    controller.queue.lastAdvanceReason,
    controller.activeSong,
    positionCurrent,
    positionTotal,
    recordTransition,
    remainingCount,
  ]);

  useEffect(() => {
    const key = `${controller.validation.validListen}:${controller.validation.fairSkipAvailable}:${controller.validation.completeListen}:${controller.validation.lastRejectionReason ?? ""}`;
    if (validationRef.current === key) return;
    validationRef.current = key;
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
          ? "Escucha valida en sandbox"
          : "Validacion actualizada",
      }),
    );
  }, [
    controller.validation.completeListen,
    controller.validation.eligibleSeconds,
    controller.validation.fairSkipAvailable,
    controller.validation.lastRejectionReason,
    controller.validation.minimumListenSeconds,
    controller.validation.validListen,
  ]);

  const telemetryBucket = Math.floor(
    controller.telemetry.currentProgressSeconds / 10,
  );
  useEffect(() => {
    const key = `${telemetryBucket}:${controller.telemetry.playbackState}:${controller.telemetry.validListen}:${controller.telemetry.pageVisible}:${controller.telemetry.pageFocused}`;
    if (telemetryRef.current === key) return;
    telemetryRef.current = key;
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
  }, [
    controller.telemetry.currentProgressSeconds,
    controller.telemetry.durationSeconds,
    controller.telemetry.pageFocused,
    controller.telemetry.pageVisible,
    controller.telemetry.playbackState,
    controller.telemetry.validListen,
    spanish,
    telemetryBucket,
  ]);

  const testCards = useMemo(
    () => [
      {
        label: "20-song autoplay",
        value: `${positionCurrent}/${Math.min(20, positionTotal)}`,
      },
      {
        label: "60-minute playback",
        value: clock(elapsedSeconds),
      },
      {
        label: "50-song memory",
        value: `${Math.min(positionCurrent, 50)}/50`,
      },
      {
        label: "Chrome / Edge",
        value: browserName(),
      },
      {
        label: "Tab switch",
        value:
          controller.telemetry.pageVisible === false
            ? spanish
              ? "Pestana oculta"
              : "Tab hidden"
            : spanish
              ? "Visible"
              : "Visible",
      },
      {
        label: "Memory trend",
        value: memoryTrend,
      },
    ],
    [
      controller.telemetry.pageVisible,
      elapsedSeconds,
      memoryTrend,
      positionCurrent,
      positionTotal,
      spanish,
    ],
  );

  return (
    <section className="workspace-v2-shell" data-workspace-version="2">
      <div className="workspace-v2-sandbox-banner" role="status">
        <strong>
          {spanish
            ? "Preview Founder #1 / Sandbox activo"
            : "Founder #1 Preview / Sandbox active"}
        </strong>
        <span>
          {spanish
            ? "Sin consumo de tokens, sin escrituras de Banco de Tiempo y sin estadisticas de produccion."
            : "No token consumption, no Time Bank writes and no production statistics updates."}
        </span>
      </div>

      <header className="workspace-v2-header">
        <div>
          <span className="eyebrow">Workspace V2</span>
          <h2>
            {controller.activeSong?.title ??
              (spanish ? "Listo para escuchar" : "Ready to listen")}
          </h2>
          <p>
            {controller.activeSong?.artist ??
              (spanish
                ? "Una sola maquina de reproduccion, cola, validacion y telemetria."
                : "One playback, queue, validation and telemetry machine.")}
          </p>
        </div>
        <div className="workspace-v2-player">
          <WorkspaceV2ProviderPlayerAdapter
            command={controller.playback.pendingCommand}
            locale={locale}
            onDebug={handleProviderDebug}
            onEvent={controller.handleProviderEvent}
            song={controller.activeSong}
          />
        </div>
      </header>

      <div className="workspace-v2-controls">
        <button onClick={handlePlay}>
          <Play size={16} /> Play
        </button>
        <button onClick={controller.pause}>
          <Pause size={16} /> Pause
        </button>
        <button disabled={!controller.canAdvance} onClick={handleNext}>
          <SkipForward size={16} /> {spanish ? "Siguiente" : "Next"}
        </button>
      </div>

      <div className="workspace-v2-status">
        <div>
          <span>{spanish ? "Estado" : "State"}</span>
          <strong>{statusLabel(controller.playback.state, spanish)}</strong>
        </div>
        <div>
          <span>{spanish ? "Tiempo en vivo" : "Time live"}</span>
          <strong>{clock(controller.telemetry.timeLiveSeconds)}</strong>
        </div>
        <div>
          <span>{spanish ? "Progreso" : "Progress"}</span>
          <strong>{clock(controller.telemetry.currentProgressSeconds)}</strong>
        </div>
        <div>
          <span>{spanish ? "Posicion" : "Position"}</span>
          <strong>
            {positionCurrent}/{positionTotal}
          </strong>
        </div>
        <div>
          <span>Fair Skip</span>
          <strong>
            {controller.validation.fairSkipAvailable
              ? "OK"
              : clock(controller.validation.minimumListenSeconds)}
          </strong>
        </div>
        <div>
          <span>{spanish ? "Valida" : "Valid"}</span>
          <strong>
            {controller.validation.validListen ? (spanish ? "Si" : "Yes") : "No"}
          </strong>
        </div>
        <div>
          <span>{spanish ? "Rechazo" : "Rejection"}</span>
          <strong>{controller.validation.lastRejectionReason ?? "-"}</strong>
        </div>
        <div>
          <span>{spanish ? "Memoria" : "Memory"}</span>
          <strong>{memoryTrend}</strong>
        </div>
      </div>

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
          <span>queueState</span>
          <strong>
            {controller.queue.activeQueue?.mode ?? "none"} /{" "}
            {controller.queue.activeQueue?.source ?? "none"} / {positionCurrent}
            of {positionTotal}
          </strong>
        </div>
        <div>
          <span>providerReady</span>
          <strong>{providerDebug.providerReady ? "true" : "false"}</strong>
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
      </section>

      <div className="workspace-v2-grid">
        <aside className="workspace-v2-queue">
          <h3>{spanish ? "Cola de prueba" : "Test queue"}</h3>
          <strong>{queueTitle}</strong>
          <p>
            {positionCurrent}/{positionTotal} -{" "}
            {remainingCount}{" "}
            {spanish ? "restantes" : "remaining"}
          </p>
          <ol>
            {controller.remainingSongs.slice(0, 12).map((song) => (
              <li key={song.id}>
                <span>{song.title}</span>
                <small>
                  {song.artist} / {song.platform}
                </small>
              </li>
            ))}
          </ol>
        </aside>

        <section className="workspace-v2-panel">
          <h3>
            {spanish
              ? "Plan de verificacion obligatorio"
              : "Required verification plan"}
          </h3>
          <div className="workspace-v2-test-grid">
            {testCards.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => captureMemorySnapshot("Snapshot manual")}>
            {spanish ? "Capturar memoria" : "Capture memory"}
          </button>
        </section>

        <section className="workspace-v2-panel">
          <h3>{spanish ? "Instrumentacion" : "Instrumentation"}</h3>
          <div className="workspace-v2-log">
            {logs.map((entry, index) => (
              <article key={`${entry.at}-${entry.channel}-${index}`}>
                <span>{new Date(entry.at).toLocaleTimeString()}</span>
                <strong>{entry.channel}</strong>
                <p>{entry.message}</p>
                {entry.details && <small>{entry.details}</small>}
              </article>
            ))}
          </div>
        </section>

        <section className="workspace-v2-panel">
          <h3>{spanish ? "Snapshots de memoria" : "Memory snapshots"}</h3>
          <div className="workspace-v2-log">
            {memorySnapshots.map((snapshot, index) => (
              <article key={`${snapshot.at}-${index}`}>
                <span>{new Date(snapshot.at).toLocaleTimeString()}</span>
                <strong>{snapshot.label}</strong>
                <p>{memoryLabel(snapshot)}</p>
                {snapshot.limitMB !== null && (
                  <small>limite {snapshot.limitMB} MB</small>
                )}
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
