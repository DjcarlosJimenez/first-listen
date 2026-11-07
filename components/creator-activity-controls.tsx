"use client";

import { useState } from "react";
import { Clock3, Power, RotateCcw, Save, UsersRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export type CreatorActivitySettings = {
  archived_after_days: number;
  inactivity_enabled: boolean;
  paused_after_days: number;
  updated_at?: string | null;
  updated_by?: string | null;
};

const fallbackSettings: CreatorActivitySettings = {
  archived_after_days: 60,
  inactivity_enabled: false,
  paused_after_days: 14,
};

function normalizedSettings(value: Partial<CreatorActivitySettings> | null | undefined) {
  return {
    archived_after_days: Number(
      value?.archived_after_days ?? fallbackSettings.archived_after_days,
    ),
    inactivity_enabled: Boolean(value?.inactivity_enabled ?? false),
    paused_after_days: Number(
      value?.paused_after_days ?? fallbackSettings.paused_after_days,
    ),
    updated_at: value?.updated_at ?? null,
    updated_by: value?.updated_by ?? null,
  } satisfies CreatorActivitySettings;
}

export function CreatorActivityControls({
  initialSettings,
}: {
  initialSettings?: Partial<CreatorActivitySettings> | null;
}) {
  const initial = normalizedSettings(initialSettings);
  const [enabled, setEnabled] = useState(initial.inactivity_enabled);
  const [pausedAfterDays, setPausedAfterDays] = useState(
    initial.paused_after_days,
  );
  const [archivedAfterDays, setArchivedAfterDays] = useState(
    initial.archived_after_days,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [savedSettings, setSavedSettings] = useState(initial);

  const hasChanges =
    enabled !== savedSettings.inactivity_enabled ||
    pausedAfterDays !== savedSettings.paused_after_days ||
    archivedAfterDays !== savedSettings.archived_after_days;

  const save = async () => {
    if (!Number.isInteger(pausedAfterDays) || pausedAfterDays < 1) {
      setNotice("Los días para pausar deben ser un número entero mayor que cero.");
      return;
    }
    if (
      !Number.isInteger(archivedAfterDays) ||
      archivedAfterDays <= pausedAfterDays
    ) {
      setNotice("Los días para archivar deben ser mayores que los días para pausar.");
      return;
    }

    setBusy(true);
    setNotice("");
    try {
      const supabase = createClient();
      if (!supabase) throw new Error("Supabase no está configurado.");
      const { data, error } = await supabase.rpc(
        "admin_update_creator_activity_settings",
        {
          activity_enabled: enabled,
          archive_after_days: archivedAfterDays,
          pause_after_days: pausedAfterDays,
        },
      );
      if (error) throw error;

      const next = normalizedSettings(
        data && typeof data === "object"
          ? (data as Partial<CreatorActivitySettings>)
          : {
              archived_after_days: archivedAfterDays,
              inactivity_enabled: enabled,
              paused_after_days: pausedAfterDays,
            },
      );
      setEnabled(next.inactivity_enabled);
      setPausedAfterDays(next.paused_after_days);
      setArchivedAfterDays(next.archived_after_days);
      setSavedSettings(next);
      setNotice(
        next.inactivity_enabled
          ? "Regla guardada. Los catálogos usarán los nuevos plazos."
          : "Regla desactivada. Los catálogos elegibles permanecen activos.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "No se pudo guardar la configuración.",
      );
    } finally {
      setBusy(false);
    }
  };

  const resetDraft = () => {
    setEnabled(savedSettings.inactivity_enabled);
    setPausedAfterDays(savedSettings.paused_after_days);
    setArchivedAfterDays(savedSettings.archived_after_days);
    setNotice("");
  };

  return (
    <section className="creator-activity-control" id="creator-activity">
      <div className="creator-activity-control-heading">
        <div className="creator-activity-control-icon">
          <UsersRound size={22} />
        </div>
        <div>
          <span>Rotación y catálogo</span>
          <h2>Actividad de artistas</h2>
          <p>
            Decide si FirstListen debe pausar y archivar automáticamente los
            catálogos de artistas que dejan de entrar.
          </p>
        </div>
        <strong className={enabled ? "is-enabled" : "is-disabled"}>
          <Power size={14} />
          {enabled ? "Regla activa" : "Desactivada temporalmente"}
        </strong>
      </div>

      <div className="creator-activity-control-body">
        <label className="creator-activity-toggle">
          <input
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            type="checkbox"
          />
          <span aria-hidden="true" />
          <div>
            <strong>Aplicar límites por inactividad</strong>
            <small>
              Al desactivarlo, los artistas elegibles y sus canciones continúan
              disponibles en la rotación.
            </small>
          </div>
        </label>

        <div className="creator-activity-day-grid">
          <label>
            <span>
              <Clock3 size={15} /> Pausar después de
            </span>
            <div>
              <input
                max={3649}
                min={1}
                onChange={(event) =>
                  setPausedAfterDays(Number(event.target.value))
                }
                type="number"
                value={pausedAfterDays}
              />
              <small>días</small>
            </div>
          </label>
          <label>
            <span>
              <Clock3 size={15} /> Archivar después de
            </span>
            <div>
              <input
                max={3650}
                min={2}
                onChange={(event) =>
                  setArchivedAfterDays(Number(event.target.value))
                }
                type="number"
                value={archivedAfterDays}
              />
              <small>días</small>
            </div>
          </label>
        </div>

        <aside>
          <strong>Estado recomendado para esta etapa</strong>
          <p>
            Mantener la regla desactivada mientras crece el catálogo. Cuando haya
            más artistas, puedes activarla y ampliar o reducir los plazos sin
            modificar código.
          </p>
        </aside>
      </div>

      <div className="creator-activity-control-actions">
        <button disabled={!hasChanges || busy} onClick={resetDraft} type="button">
          <RotateCcw size={16} /> Descartar cambios
        </button>
        <button
          className="primary"
          disabled={!hasChanges || busy}
          onClick={save}
          type="button"
        >
          <Save size={16} /> {busy ? "Guardando…" : "Guardar configuración"}
        </button>
      </div>

      {notice && <p className="creator-activity-control-notice">{notice}</p>}
    </section>
  );
}
