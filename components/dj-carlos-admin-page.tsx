"use client";

import Image from "next/image";
import Link from "next/link";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Disc3,
  ExternalLink,
  ImagePlus,
  ListMusic,
  Play,
  Plus,
  RotateCcw,
  Save,
  Smartphone,
  Trash2,
  Video,
} from "lucide-react";
import { PwaInstallButton } from "@/components/pwa-install-prompt";
import {
  DJ_CARLOS_PAGE_STORAGE_KEY,
  detectDjCarlosPlatform,
  isPlayableDjCarlosLink,
  labelForDjCarlosTrackSection,
  normalizeDjCarlosPageConfig,
  sectionBadge,
  type DjCarlosPageConfig,
  type DjCarlosTrack,
  type DjCarlosTrackSection,
} from "@/lib/dj-carlos-page";

type TrackDraft = {
  link: string;
  mood: string;
  section: DjCarlosTrackSection;
  title: string;
};

type EditableTrackField = "link" | "mood" | "section" | "subtitle" | "title";

const emptyDraft: TrackDraft = {
  link: "",
  mood: "Cumbia Sonidera",
  section: "album",
  title: "",
};

export function DjCarlosAdminPage({
  initialConfig,
  logoUrl,
}: {
  initialConfig: DjCarlosPageConfig;
  logoUrl: string;
}) {
  const storageReadyRef = useRef(false);
  const [config, setConfig] = useState(() => initialConfig);
  const [draft, setDraft] = useState(emptyDraft);
  const [status, setStatus] = useState("Cambios locales listos.");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DJ_CARLOS_PAGE_STORAGE_KEY);
      if (saved) {
        setConfig(normalizeDjCarlosPageConfig(JSON.parse(saved), initialConfig));
      }
    } catch {
      window.localStorage.removeItem(DJ_CARLOS_PAGE_STORAGE_KEY);
    } finally {
      storageReadyRef.current = true;
    }
  }, [initialConfig]);

  useEffect(() => {
    if (!storageReadyRef.current) return;
    const nextConfig = { ...config, updatedAt: new Date().toISOString() };
    window.localStorage.setItem(
      DJ_CARLOS_PAGE_STORAGE_KEY,
      JSON.stringify(nextConfig),
    );
  }, [config]);

  const albumTracks = useMemo(
    () => config.tracks.filter((track) => track.section !== "official-video"),
    [config.tracks],
  );
  const videoTracks = useMemo(
    () => config.tracks.filter((track) => track.section === "official-video"),
    [config.tracks],
  );
  const topTenCount = useMemo(
    () => config.tracks.filter((track) => track.section === "top-ten").length,
    [config.tracks],
  );

  const updateAlbum = (
    field: keyof DjCarlosPageConfig["album"],
    value: string,
  ) => {
    setConfig((current) => ({
      ...current,
      album: {
        ...current.album,
        [field]: value,
      },
    }));
    setStatus("Album actualizado localmente.");
  };

  const updateTrack = (
    trackId: string,
    field: EditableTrackField,
    value: string,
  ) => {
    setConfig((current) => ({
      ...current,
      tracks: current.tracks.map((track) => {
        if (track.id !== trackId) return track;
        if (field === "section") {
          const section = value as DjCarlosTrackSection;
          return {
            ...track,
            badge: sectionBadge(section),
            platform:
              section === "official-video"
                ? "YouTube"
                : detectDjCarlosPlatform(track.link),
            section,
          };
        }
        if (field === "link") {
          return {
            ...track,
            link: value,
            platform: detectDjCarlosPlatform(value),
          };
        }
        return {
          ...track,
          [field]: value,
        };
      }),
    }));
    setStatus("Cancion actualizada localmente.");
  };

  const moveTrack = (trackId: string, direction: 1 | -1) => {
    setConfig((current) => {
      const track = current.tracks.find((item) => item.id === trackId);
      if (!track) return current;
      const groupTracks = current.tracks.filter((item) =>
        track.section === "official-video"
          ? item.section === "official-video"
          : item.section !== "official-video",
      );
      const groupIndex = groupTracks.findIndex((item) => item.id === trackId);
      const swapTrack = groupTracks[groupIndex + direction];
      if (!swapTrack) return current;
      return {
        ...current,
        tracks: current.tracks.map((item) => {
          if (item.id === track.id) return swapTrack;
          if (item.id === swapTrack.id) return track;
          return item;
        }),
      };
    });
    setStatus("Orden actualizado localmente.");
  };

  const removeTrack = (trackId: string) => {
    setConfig((current) => ({
      ...current,
      tracks: current.tracks.filter((track) => track.id !== trackId),
    }));
    setStatus("Cancion quitada localmente.");
  };

  const addTrack = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = draft.title.trim();
    const link = draft.link.trim();
    if (!title || !link) {
      setStatus("Falta titulo o link.");
      return;
    }
    if (!isPlayableDjCarlosLink(link)) {
      setStatus("Usa un link directo de YouTube o YouTube Music.");
      return;
    }

    const track: DjCarlosTrack = {
      artist: "DJ Carlos Jimenez Compositor",
      badge: sectionBadge(draft.section),
      coverUrl: config.album.coverUrl || logoUrl,
      id: `dj-carlos-local-${Date.now()}`,
      link,
      mood: draft.mood.trim() || "DJ Carlos",
      platform:
        draft.section === "official-video"
          ? "YouTube"
          : detectDjCarlosPlatform(link),
      release: config.album.title,
      section: draft.section,
      subtitle:
        draft.section === "official-video"
          ? "Video en YouTube"
          : config.album.title,
      title,
    };

    setConfig((current) => ({
      ...current,
      tracks: [...current.tracks, track],
    }));
    setDraft(emptyDraft);
    setStatus("Cancion agregada localmente.");
  };

  const handleCoverFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") return;
      updateAlbum("coverUrl", reader.result);
      setStatus("Portada cargada localmente.");
    });
    reader.readAsDataURL(file);
  };

  const resetConfig = () => {
    window.localStorage.removeItem(DJ_CARLOS_PAGE_STORAGE_KEY);
    setConfig(initialConfig);
    setStatus("Pagina restaurada a la version base local.");
  };

  const saveConfig = (nextStatus = "Cambios guardados localmente.") => {
    const nextConfig = { ...config, updatedAt: new Date().toISOString() };
    window.localStorage.setItem(
      DJ_CARLOS_PAGE_STORAGE_KEY,
      JSON.stringify(nextConfig),
    );
    setConfig(nextConfig);
    setStatus(nextStatus);
  };

  const saveAndViewPage = () => {
    saveConfig("Cambios guardados. Abriendo la pagina.");
    window.location.href = "/DJCarlosJimenez";
  };

  return (
    <main className="djcx-admin-page">
      <header className="djcx-admin-header">
        <div>
          <Image
            alt="DJ Carlos Jimenez logo"
            height={58}
            priority
            src={logoUrl}
            width={58}
          />
          <div>
            <span>Admin artista</span>
            <h1>DJ Carlos Jimenez</h1>
          </div>
        </div>
        <nav>
          <button
            className="djcx-admin-save"
            onClick={() => saveConfig()}
            type="button"
          >
            <Save size={15} />
            Guardar cambios
          </button>
          <button
            className="djcx-admin-save-view"
            onClick={saveAndViewPage}
            type="button"
          >
            Guardar y ver <ExternalLink size={15} />
          </button>
          <Link href="/DJCarlosJimenez">
            Ver pagina <ExternalLink size={15} />
          </Link>
          <PwaInstallButton
            className="djcx-admin-install"
            label="Instalar DJ Carlos"
            locale="es"
          />
        </nav>
      </header>

      <section className="djcx-admin-grid">
        <article className="djcx-admin-preview">
          <div className="djcx-cd-case">
            <div className="djcx-cd-spine">DJ CARLOS JIMENEZ</div>
            <div className="djcx-cd-cover">
              <Image
                alt={`Portada de ${config.album.title}`}
                fill
                priority
                sizes="(max-width: 900px) 70vw, 260px"
                src={config.album.coverUrl || logoUrl}
                unoptimized
              />
            </div>
            <div className="djcx-cd-disc" aria-hidden="true">
              <span />
            </div>
          </div>
          <div>
            <span>{config.album.badge}</span>
            <h2>{config.album.title}</h2>
            <p>{config.album.subtitle}</p>
          </div>
        </article>

        <section className="djcx-admin-panel">
          <div className="djcx-admin-panel-heading">
            <span>
              <Disc3 size={15} /> Album promocionado
            </span>
            <strong>{status}</strong>
          </div>

          <div className="djcx-admin-form-grid">
            <label>
              Titulo del album
              <input
                onChange={(event) => updateAlbum("title", event.target.value)}
                value={config.album.title}
              />
            </label>
            <label>
              Badge
              <input
                onChange={(event) => updateAlbum("badge", event.target.value)}
                value={config.album.badge}
              />
            </label>
            <label className="djcx-admin-wide">
              Frase principal
              <input
                onChange={(event) => updateAlbum("subtitle", event.target.value)}
                value={config.album.subtitle}
              />
            </label>
            <label className="djcx-admin-wide">
              Descripcion
              <textarea
                onChange={(event) =>
                  updateAlbum("description", event.target.value)
                }
                rows={3}
                value={config.album.description}
              />
            </label>
            <label className="djcx-admin-wide">
              Link del album o primera cancion
              <input
                onChange={(event) => updateAlbum("link", event.target.value)}
                placeholder="https://music.youtube.com/watch?v=..."
                value={config.album.link}
              />
            </label>
            <label className="djcx-admin-wide">
              URL de portada
              <input
                onChange={(event) => updateAlbum("coverUrl", event.target.value)}
                value={config.album.coverUrl}
              />
            </label>
            <label className="djcx-file-control">
              <ImagePlus size={17} />
              Cargar portada local
              <input accept="image/*" onChange={handleCoverFile} type="file" />
            </label>
          </div>
        </section>
      </section>

      <section className="djcx-admin-stats">
        <article>
          <strong>{albumTracks.length}</strong>
          <span>canciones del album</span>
        </article>
        <article>
          <strong>{topTenCount}</strong>
          <span>Top Ten</span>
        </article>
        <article>
          <strong>{videoTracks.length}</strong>
          <span>videos oficiales</span>
        </article>
        <article>
          <Smartphone size={18} />
          <span>instalador personalizado</span>
        </article>
      </section>

      <section className="djcx-admin-panel">
        <div className="djcx-admin-panel-heading">
          <span>
            <Plus size={15} /> Agregar cancion
          </span>
          <button onClick={resetConfig} type="button">
            <RotateCcw size={15} />
            Restaurar
          </button>
        </div>

        <form className="djcx-admin-add" onSubmit={addTrack}>
          <label>
            Titulo
            <input
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="Nombre de la cancion"
              value={draft.title}
            />
          </label>
          <label>
            Link
            <input
              onChange={(event) =>
                setDraft((current) => ({ ...current, link: event.target.value }))
              }
              placeholder="YouTube o YouTube Music"
              value={draft.link}
            />
          </label>
          <label>
            Estilo
            <input
              onChange={(event) =>
                setDraft((current) => ({ ...current, mood: event.target.value }))
              }
              value={draft.mood}
            />
          </label>
          <label>
            Lista
            <select
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  section: event.target.value as DjCarlosTrackSection,
                }))
              }
              value={draft.section}
            >
              <option value="album">Album</option>
              <option value="top-ten">Album + Top Ten</option>
              <option value="official-video">Videos oficiales</option>
            </select>
          </label>
          <button type="submit">
            <Save size={16} />
            Agregar
          </button>
        </form>
      </section>

      <AdminTrackGroup
        icon={<ListMusic size={15} />}
        onMoveDown={(trackId) => moveTrack(trackId, 1)}
        onMoveUp={(trackId) => moveTrack(trackId, -1)}
        onRemove={removeTrack}
        onUpdate={updateTrack}
        title="Orden del album"
        tracks={albumTracks}
      />

      <AdminTrackGroup
        icon={<Video size={15} />}
        onMoveDown={(trackId) => moveTrack(trackId, 1)}
        onMoveUp={(trackId) => moveTrack(trackId, -1)}
        onRemove={removeTrack}
        onUpdate={updateTrack}
        title="Videos oficiales"
        tracks={videoTracks}
      />
    </main>
  );
}

function AdminTrackGroup({
  icon,
  onMoveDown,
  onMoveUp,
  onRemove,
  onUpdate,
  title,
  tracks,
}: {
  icon: ReactNode;
  onMoveDown: (trackId: string) => void;
  onMoveUp: (trackId: string) => void;
  onRemove: (trackId: string) => void;
  onUpdate: (trackId: string, field: EditableTrackField, value: string) => void;
  title: string;
  tracks: DjCarlosTrack[];
}) {
  return (
    <section className="djcx-admin-panel">
      <div className="djcx-admin-panel-heading">
        <span>
          {icon} {title}
        </span>
      </div>
      <div className="djcx-admin-track-list">
        {tracks.map((track, index) => (
          <article className="djcx-admin-track-row" key={track.id}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <button
              aria-label={`Probar ${track.title}`}
              onClick={() => window.open(track.link, "_blank", "noopener,noreferrer")}
              type="button"
            >
              <Play fill="currentColor" size={14} />
            </button>
            <label>
              Titulo
              <input
                onChange={(event) =>
                  onUpdate(track.id, "title", event.target.value)
                }
                value={track.title}
              />
            </label>
            <label>
              Link
              <input
                onChange={(event) => onUpdate(track.id, "link", event.target.value)}
                value={track.link}
              />
            </label>
            <label>
              Lista
              <select
                onChange={(event) =>
                  onUpdate(track.id, "section", event.target.value)
                }
                value={track.section}
              >
                <option value="album">Album</option>
                <option value="top-ten">Album + Top Ten</option>
                <option value="official-video">Videos oficiales</option>
              </select>
            </label>
            <em>{labelForDjCarlosTrackSection(track.section)}</em>
            <div>
              <button aria-label="Mover arriba" onClick={() => onMoveUp(track.id)} type="button">
                <ArrowUp size={15} />
              </button>
              <button aria-label="Mover abajo" onClick={() => onMoveDown(track.id)} type="button">
                <ArrowDown size={15} />
              </button>
              <button aria-label="Quitar" onClick={() => onRemove(track.id)} type="button">
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
