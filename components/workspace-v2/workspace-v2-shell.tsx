"use client";

import { useEffect } from "react";
import { Pause, Play, SkipForward } from "lucide-react";
import type { InterfaceLocale } from "@/lib/catalog";
import type { WorkspaceV2Queue } from "@/lib/workspace-v2";
import { WorkspaceV2ProviderPlayerAdapter } from "@/components/workspace-v2/workspace-v2-provider-player-adapter";
import { useWorkspaceV2Controller } from "@/components/workspace-v2/workspace-v2-controller";

function clock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
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

  useEffect(() => {
    loadQueue(initialQueue);
  }, [initialQueue, loadQueue]);

  return (
    <section className="workspace-v2-shell" data-workspace-version="2">
      <header className="workspace-v2-header">
        <div>
          <span className="eyebrow">Workspace V2</span>
          <h2>{controller.activeSong?.title ?? (spanish ? "Listo para escuchar" : "Ready to listen")}</h2>
          <p>
            {controller.activeSong?.artist ??
              (spanish
                ? "Una sola máquina de reproducción, cola, validación y telemetría."
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
          <strong>{controller.playback.state}</strong>
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
          <span>{spanish ? "Posición" : "Position"}</span>
          <strong>
            {controller.position.current}/{controller.position.total}
          </strong>
        </div>
      </div>

      <aside className="workspace-v2-queue">
        <h3>{spanish ? "Cola" : "Queue"}</h3>
        <strong>{controller.queue.activeQueue?.title ?? initialQueue.title}</strong>
        <ol>
          {controller.remainingSongs.slice(0, 8).map((song) => (
            <li key={song.id}>
              <span>{song.title}</span>
              <small>{song.artist}</small>
            </li>
          ))}
        </ol>
      </aside>
    </section>
  );
}
