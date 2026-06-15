"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipForward } from "lucide-react";
import type { InterfaceLocale } from "@/lib/catalog";
import type { WorkspaceV2Queue } from "@/lib/workspace-v2";
import { WorkspaceV2ProviderPlayerAdapter } from "@/components/workspace-v2/workspace-v2-provider-player-adapter";
import { useWorkspaceV2Controller } from "@/components/workspace-v2/workspace-v2-controller";

type InstrumentationChannel =
  | "playback"
  | "queue"
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
  const playbackRef = useRef("");
  const queueRef = useRef("");
  const validationRef = useRef("");
  const telemetryRef = useRef("");
  const sessionStartedAtRef = useRef<number | null>(null);

  const captureMemorySnapshot = useCallback((label: string) => {
    const snapshot = readMemorySnapshot(label);
    setMemorySnapshots((current) => [snapshot, ...current].slice(0, 20));
    setLogs((current) =>
      pushLog(current, {
        at: snapshot.at,
        channel: "memory",
        details: memoryLabel(snapshot),
        message: label,
      }),
    );
  }, []);

  useEffect(() => {
    loadQueue(initialQueue);
    setLogs((current) =>
      pushLog(current, {
        at: Date.now(),
        channel: "sandbox",
        details: `${initialQueue.songs.length} canciones cargadas en modo solo lectura`,
        message: "Workspace V2 Preview inicializado",
      }),
    );
  }, [initialQueue, loadQueue]);

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
      setLogs((current) =>
        pushLog(current, {
          at: Date.now(),
          channel: "validation",
          details: `visible=${document.visibilityState === "visible"} focused=${document.hasFocus()}`,
          message: "Cambio de pestana detectado",
        }),
      );
    };
    window.addEventListener("focus", onVisibility);
    window.addEventListener("blur", onVisibility);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("blur", onVisibility);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const activeSongId = controller.activeSong?.id ?? "none";
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

  useEffect(() => {
    const key = `${controller.playback.state}:${activeSongId}:${controller.playback.error ?? ""}`;
    if (playbackRef.current === key) return;
    playbackRef.current = key;
    if (controller.playback.state === "playing" && !sessionStartedAtRef.current) {
      sessionStartedAtRef.current = Date.now();
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
      captureMemorySnapshot(
        `Cambio de cancion ${positionCurrent}/${positionTotal}`,
      );
    }
  }, [
    activeSongId,
    captureMemorySnapshot,
    controller.queue.lastAdvanceReason,
    positionCurrent,
    positionTotal,
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
            onEvent={controller.handleProviderEvent}
            song={controller.activeSong}
          />
        </div>
      </header>

      <div className="workspace-v2-controls">
        <button onClick={controller.play}>
          <Play size={16} /> Play
        </button>
        <button onClick={controller.pause}>
          <Pause size={16} /> Pause
        </button>
        <button disabled={!controller.canAdvance} onClick={() => controller.next()}>
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
