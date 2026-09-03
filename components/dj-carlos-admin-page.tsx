"use client";

import Image from "next/image";
import Link from "next/link";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Disc3,
  Download,
  ExternalLink,
  Heart,
  ImagePlus,
  ListMusic,
  LogOut,
  MessageCircle,
  Play,
  Plus,
  RotateCcw,
  Save,
  Smartphone,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import { PwaInstallButton } from "@/components/pwa-install-prompt";
import {
  DJ_CARLOS_PAGE_STORAGE_KEY,
  detectDjCarlosPlatform,
  getDjCarlosTrackThumbnail,
  isDjCarlosTrack,
  isPlayableDjCarlosLink,
  labelForDjCarlosTrackSection,
  normalizeDjCarlosPageConfig,
  sectionBadge,
  slugifyDjCarlosAlbumTitle,
  type DjCarlosAlbum,
  type DjCarlosPageConfig,
  type DjCarlosTrack,
  type DjCarlosTrackSection,
  type DjCarlosUpcomingReactionKey,
} from "@/lib/dj-carlos-page";

type TrackDraft = {
  link: string;
  mood: string;
  section: DjCarlosTrackSection;
  title: string;
};

type EditableTrackField = "link" | "mood" | "section" | "subtitle" | "title";

type EditableUpcomingField = "badge" | "coverUrl" | "note" | "status" | "title";

type AlbumImportResponse = {
  album?: Partial<DjCarlosAlbum>;
  error?: string;
  tracks?: unknown[];
  warning?: string | null;
};

const emptyDraft: TrackDraft = {
  link: "",
  mood: "Cumbia Sonidera",
  section: "album",
  title: "",
};

const upcomingReactionLabels: Record<DjCarlosUpcomingReactionKey, string> = {
  favorite: "Mi favorita",
  video: "Quiero video",
  waiting: "La espero",
};

function albumsForConfig(config: DjCarlosPageConfig) {
  return config.albums?.length ? config.albums : [config.album];
}

function hasYouTubePlaylistId(link: string) {
  try {
    const url = new URL(link.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return (
      (host === "music.youtube.com" ||
        host === "youtube.com" ||
        host === "m.youtube.com") &&
      Boolean(url.searchParams.get("list"))
    );
  } catch {
    return false;
  }
}

function uniqueAlbumSlugForConfig(
  baseSlug: string,
  albums: DjCarlosAlbum[],
  albumId: string,
) {
  let slug = baseSlug || "album";
  let index = 2;
  const usedSlugs = new Set(
    albums
      .filter((album) => album.id !== albumId)
      .map((album) => album.slug.toLowerCase()),
  );

  while (usedSlugs.has(slug.toLowerCase())) {
    slug = `${baseSlug}-${index}`;
    index += 1;
  }

  return slug;
}

function syncAlbums(
  config: DjCarlosPageConfig,
  albums: DjCarlosAlbum[],
): DjCarlosPageConfig {
  const safeAlbums = albums.length ? albums : [config.album];
  return {
    ...config,
    album: safeAlbums[0],
    albums: safeAlbums,
  };
}

function newArtistAlbum(index: number, logoUrl: string): DjCarlosAlbum {
  const title = `Nuevo album ${index}`;
  const slug = slugifyDjCarlosAlbumTitle(title);
  const stamp = Date.now().toString(36);
  return {
    id: `${slug}-${stamp}`,
    slug: `${slug}-${stamp}`,
    badge: "Album",
    coverUrl: logoUrl,
    description: "Agrega la descripcion de este album.",
    link: "",
    subtitle: "Canciones en el orden oficial del album.",
    title,
  };
}

export function DjCarlosAdminPage({
  initialConfig,
  logoUrl,
}: {
  initialConfig: DjCarlosPageConfig;
  logoUrl: string;
}) {
  const storageReadyRef = useRef(false);
  const [config, setConfig] = useState(() =>
    normalizeDjCarlosPageConfig(initialConfig),
  );
  const [selectedAlbumId, setSelectedAlbumId] = useState(
    () => initialConfig.album.id,
  );
  const [draft, setDraft] = useState(emptyDraft);
  const [albumImportLink, setAlbumImportLink] = useState(
    () => initialConfig.album.link,
  );
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingUpcomingCover, setUploadingUpcomingCover] = useState(false);
  const [importingAlbum, setImportingAlbum] = useState(false);
  const [status, setStatus] = useState("Panel listo para editar.");
  const hasLocalChangesRef = useRef(false);

  const persistLocalDraft = useCallback((nextConfig: DjCarlosPageConfig) => {
    try {
      window.localStorage.setItem(
        DJ_CARLOS_PAGE_STORAGE_KEY,
        JSON.stringify(nextConfig),
      );
      return true;
    } catch {
      window.localStorage.removeItem(DJ_CARLOS_PAGE_STORAGE_KEY);
      return false;
    }
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DJ_CARLOS_PAGE_STORAGE_KEY);
      if (saved) {
        const savedConfig = normalizeDjCarlosPageConfig(
          JSON.parse(saved),
          initialConfig,
        );
        const savedAt = Date.parse(savedConfig.updatedAt);
        const serverAt = Date.parse(initialConfig.updatedAt);
        if (
          Number.isFinite(savedAt) &&
          (!Number.isFinite(serverAt) || savedAt > serverAt)
        ) {
          hasLocalChangesRef.current = true;
          setConfig(savedConfig);
          setSelectedAlbumId(savedConfig.album.id);
          setAlbumImportLink(savedConfig.album.link);
          setStatus("Hay un borrador local mas nuevo. Guarda para publicarlo.");
        }
      }
    } catch {
      window.localStorage.removeItem(DJ_CARLOS_PAGE_STORAGE_KEY);
    } finally {
      storageReadyRef.current = true;
    }
  }, [initialConfig]);

  useEffect(() => {
    if (!storageReadyRef.current || !hasLocalChangesRef.current) return;
    const nextConfig = { ...config, updatedAt: new Date().toISOString() };
    persistLocalDraft(nextConfig);
  }, [config, persistLocalDraft]);

  const albums = useMemo(() => albumsForConfig(config), [config]);
  const selectedAlbum = useMemo(
    () =>
      albums.find((album) => album.id === selectedAlbumId) ??
      albums[0] ??
      config.album,
    [albums, config.album, selectedAlbumId],
  );
  const albumTracks = useMemo(
    () =>
      config.tracks.filter(
        (track) =>
          track.section === "album" && track.albumId === selectedAlbum.id,
      ),
    [config.tracks, selectedAlbum.id],
  );
  const topTenTracks = useMemo(
    () => config.tracks.filter((track) => track.section === "top-ten"),
    [config.tracks],
  );
  const videoTracks = useMemo(
    () => config.tracks.filter((track) => track.section === "official-video"),
    [config.tracks],
  );
  const upcomingRelease = config.upcomingRelease;
  const albumTrackCounts = useMemo(() => {
    const counts = new Map<string, number>();
    config.tracks.forEach((track) => {
      if (track.section !== "album" || !track.albumId) return;
      counts.set(track.albumId, (counts.get(track.albumId) ?? 0) + 1);
    });
    return counts;
  }, [config.tracks]);

  useEffect(() => {
    if (albums.some((album) => album.id === selectedAlbumId)) return;
    const nextAlbum = albums[0];
    setSelectedAlbumId(nextAlbum?.id ?? "");
    setAlbumImportLink(nextAlbum?.link ?? "");
  }, [albums, selectedAlbumId]);

  const selectAlbum = (album: DjCarlosAlbum) => {
    setSelectedAlbumId(album.id);
    setAlbumImportLink(album.link);
  };

  const updateAlbum = (
    field: keyof DjCarlosPageConfig["album"],
    value: string,
  ) => {
    hasLocalChangesRef.current = true;
    setConfig((current) => {
      const nextAlbums = albumsForConfig(current).map((album) =>
        album.id === selectedAlbum.id
          ? {
              ...album,
              [field]: value,
              slug:
                field === "title" &&
                (album.slug === slugifyDjCarlosAlbumTitle(album.title) ||
                  album.slug.startsWith("nuevo-album"))
                  ? slugifyDjCarlosAlbumTitle(value, album.slug)
                  : album.slug,
            }
          : album,
      );
      const nextConfig = syncAlbums(current, nextAlbums);
      if (field !== "title") return nextConfig;
      return {
        ...nextConfig,
        tracks: nextConfig.tracks.map((track) =>
          track.section === "album" && track.albumId === selectedAlbum.id
            ? {
                ...track,
                release: value,
                subtitle:
                  track.subtitle === selectedAlbum.title ? value : track.subtitle,
              }
            : track,
        ),
      };
    });
    setStatus("Album actualizado. Toca Guardar cambios para publicarlo.");
  };

  const updateUpcomingRelease = (
    field: EditableUpcomingField,
    value: string,
  ) => {
    hasLocalChangesRef.current = true;
    setConfig((current) => {
      const nextConfig = {
        ...current,
        upcomingRelease: {
          ...current.upcomingRelease,
          [field]: value,
        },
        updatedAt: new Date().toISOString(),
      };
      persistLocalDraft(nextConfig);
      return nextConfig;
    });
    setStatus("Proximo lanzamiento actualizado. Toca Guardar cambios.");
  };

  const updateUpcomingEnabled = (enabled: boolean) => {
    hasLocalChangesRef.current = true;
    setConfig((current) => {
      const nextConfig = {
        ...current,
        upcomingRelease: {
          ...current.upcomingRelease,
          enabled,
        },
        updatedAt: new Date().toISOString(),
      };
      persistLocalDraft(nextConfig);
      return nextConfig;
    });
    setStatus(
      enabled
        ? "Proximo lanzamiento visible. Toca Guardar cambios."
        : "Proximo lanzamiento oculto. Toca Guardar cambios.",
    );
  };

  const updateUpcomingTracks = (value: string) => {
    hasLocalChangesRef.current = true;
    setConfig((current) => {
      const nextConfig = {
        ...current,
        upcomingRelease: {
          ...current.upcomingRelease,
          tracks: value
            .split(/\r?\n/)
            .map((track) => track.trim())
            .filter(Boolean),
        },
        updatedAt: new Date().toISOString(),
      };
      persistLocalDraft(nextConfig);
      return nextConfig;
    });
    setStatus("Lista tentativa actualizada. Toca Guardar cambios.");
  };

  const addAlbum = () => {
    hasLocalChangesRef.current = true;
    const nextAlbum = newArtistAlbum(albums.length + 1, logoUrl);
    setSelectedAlbumId(nextAlbum.id);
    setAlbumImportLink(nextAlbum.link);
    setConfig((current) => {
      return syncAlbums(current, [...albumsForConfig(current), nextAlbum]);
    });
    setStatus("Album agregado. Toca Guardar cambios para publicarlo.");
  };

  const moveAlbum = (albumId: string, direction: 1 | -1) => {
    hasLocalChangesRef.current = true;
    setConfig((current) => {
      const nextAlbums = [...albumsForConfig(current)];
      const index = nextAlbums.findIndex((album) => album.id === albumId);
      const swapIndex = index + direction;
      if (index < 0 || swapIndex < 0 || swapIndex >= nextAlbums.length) {
        return current;
      }
      [nextAlbums[index], nextAlbums[swapIndex]] = [
        nextAlbums[swapIndex],
        nextAlbums[index],
      ];
      return syncAlbums(current, nextAlbums);
    });
    setStatus("Orden de albumes actualizado. Toca Guardar cambios.");
  };

  const removeAlbum = (albumId: string) => {
    const currentAlbums = albumsForConfig(config);
    if (currentAlbums.length <= 1) {
      setStatus("Debe quedar por lo menos un album en la pagina.");
      return;
    }

    hasLocalChangesRef.current = true;
    const nextSelectedAlbumId =
      selectedAlbumId === albumId
        ? currentAlbums.find((album) => album.id !== albumId)?.id ?? ""
        : selectedAlbumId;
    const nextSelectedAlbum =
      currentAlbums.find((album) => album.id === nextSelectedAlbumId) ??
      currentAlbums.find((album) => album.id !== albumId);
    setSelectedAlbumId(nextSelectedAlbumId);
    setAlbumImportLink(nextSelectedAlbum?.link ?? "");
    setConfig((current) => {
      const nextAlbums = albumsForConfig(current).filter(
        (album) => album.id !== albumId,
      );
      return syncAlbums(
        {
          ...current,
          tracks: current.tracks.filter(
            (track) => track.section !== "album" || track.albumId !== albumId,
          ),
        },
        nextAlbums,
      );
    });
    setStatus("Album quitado. Toca Guardar cambios para publicarlo.");
  };

  const updateTrack = (
    trackId: string,
    field: EditableTrackField,
    value: string,
  ) => {
    hasLocalChangesRef.current = true;
    setConfig((current) => ({
      ...current,
      tracks: current.tracks.map((track) => {
        if (track.id !== trackId) return track;
        if (field === "section") {
          const section = value as DjCarlosTrackSection;
          const thumbnailUrl = getDjCarlosTrackThumbnail(track.link);
          return {
            ...track,
            albumId: section === "album" ? selectedAlbum.id : undefined,
            badge: sectionBadge(section),
            coverUrl: thumbnailUrl ?? track.coverUrl,
            platform:
              section === "official-video"
                ? "YouTube"
                : detectDjCarlosPlatform(track.link),
            release:
              section === "album" ? selectedAlbum.title : "DJ Carlos Jimenez",
            section,
            subtitle:
              section === "official-video"
                ? "Video en YouTube"
                : section === "top-ten"
                  ? "Top Ten de DJ Carlos"
                  : selectedAlbum.title,
          };
        }
        if (field === "link") {
          const thumbnailUrl = getDjCarlosTrackThumbnail(value);
          return {
            ...track,
            coverUrl: thumbnailUrl ?? track.coverUrl,
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
    setStatus("Cancion actualizada. Toca Guardar cambios para publicarla.");
  };

  const moveTrack = (trackId: string, direction: 1 | -1) => {
    hasLocalChangesRef.current = true;
    setConfig((current) => {
      const track = current.tracks.find((item) => item.id === trackId);
      if (!track) return current;
      const groupTracks = current.tracks.filter(
        (item) =>
          item.section === track.section &&
          (track.section !== "album" || item.albumId === track.albumId),
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
    setStatus("Orden actualizado. Toca Guardar cambios para publicarlo.");
  };

  const removeTrack = (trackId: string) => {
    hasLocalChangesRef.current = true;
    setConfig((current) => ({
      ...current,
      tracks: current.tracks.filter((track) => track.id !== trackId),
    }));
    setStatus("Cancion quitada. Toca Guardar cambios para publicarlo.");
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

    hasLocalChangesRef.current = true;
    const track: DjCarlosTrack = {
      albumId: draft.section === "album" ? selectedAlbum.id : undefined,
      artist: "DJ Carlos Jimenez Compositor",
      badge: sectionBadge(draft.section),
      coverUrl: getDjCarlosTrackThumbnail(link) ?? logoUrl,
      id: `dj-carlos-local-${Date.now()}`,
      link,
      mood: draft.mood.trim() || "DJ Carlos",
      platform: detectDjCarlosPlatform(link),
      release:
        draft.section === "album" ? selectedAlbum.title : "DJ Carlos Jimenez",
      section: draft.section,
      subtitle:
        draft.section === "official-video"
          ? "Video en YouTube"
          : draft.section === "top-ten"
            ? "Top Ten de DJ Carlos"
            : selectedAlbum.title,
      title,
    };

    setConfig((current) => ({
      ...current,
      tracks: [...current.tracks, track],
    }));
    setDraft(emptyDraft);
    setStatus("Cancion agregada. Toca Guardar cambios para publicarla.");
  };

  const importAlbumFromLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const link = albumImportLink.trim();

    if (!hasYouTubePlaylistId(link)) {
      setStatus("Pega el link de compartir del album de YouTube Music.");
      return;
    }

    setImportingAlbum(true);
    setStatus("Importando album desde YouTube Music...");

    try {
      const response = await fetch("/DJCarlosJimenez/import-album", {
        body: JSON.stringify({
          albumId: selectedAlbum.id,
          link,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as AlbumImportResponse;

      if (!response.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "No se pudo importar el album.",
        );
      }

      const importedTracks = Array.isArray(data.tracks)
        ? data.tracks.filter(isDjCarlosTrack)
        : [];
      const importedAlbum = data.album ?? {};
      const importedTitle =
        typeof importedAlbum.title === "string" && importedAlbum.title.trim()
          ? importedAlbum.title.trim()
          : selectedAlbum.title;
      const importedSlug =
        typeof importedAlbum.slug === "string" && importedAlbum.slug.trim()
          ? importedAlbum.slug.trim()
          : slugifyDjCarlosAlbumTitle(importedTitle, selectedAlbum.slug);
      const importedCoverUrl =
        typeof importedAlbum.coverUrl === "string" && importedAlbum.coverUrl.trim()
          ? importedAlbum.coverUrl.trim()
          : selectedAlbum.coverUrl || logoUrl;
      const importedSubtitle =
        typeof importedAlbum.subtitle === "string" && importedAlbum.subtitle.trim()
          ? importedAlbum.subtitle.trim()
          : selectedAlbum.subtitle;
      const importedDescription =
        typeof importedAlbum.description === "string" &&
        importedAlbum.description.trim()
          ? importedAlbum.description.trim()
          : selectedAlbum.description;
      const stamp = Date.now();

      hasLocalChangesRef.current = true;
      setConfig((current) => {
        const currentAlbums = albumsForConfig(current);
        let nextAlbumTitle = importedTitle;
        const nextAlbums = currentAlbums.map((album) => {
          if (album.id !== selectedAlbum.id) return album;
          const autoSlug =
            album.slug === slugifyDjCarlosAlbumTitle(album.title) ||
            album.slug.startsWith("nuevo-album");
          const slug = autoSlug
            ? uniqueAlbumSlugForConfig(importedSlug, currentAlbums, album.id)
            : album.slug;
          nextAlbumTitle = importedTitle || album.title;

          return {
            ...album,
            badge:
              typeof importedAlbum.badge === "string" && importedAlbum.badge.trim()
                ? importedAlbum.badge.trim()
                : album.badge,
            coverUrl: importedCoverUrl,
            description: importedDescription,
            link,
            slug,
            subtitle: importedSubtitle,
            title: nextAlbumTitle,
          };
        });
        const nextImportedTracks = importedTracks.map((track, index) => ({
          ...track,
          albumId: selectedAlbum.id,
          badge: "Album",
          coverUrl:
            track.coverUrl ||
            getDjCarlosTrackThumbnail(track.link) ||
            importedCoverUrl,
          id: `dj-carlos-import-${selectedAlbum.id}-${stamp}-${index + 1}`,
          mood: track.mood || "Album",
          platform: detectDjCarlosPlatform(track.link),
          release: nextAlbumTitle,
          section: "album" as const,
          subtitle: nextAlbumTitle,
        }));
        const tracks = importedTracks.length
          ? [
              ...current.tracks.filter(
                (track) =>
                  track.section !== "album" ||
                  track.albumId !== selectedAlbum.id,
              ),
              ...nextImportedTracks,
            ]
          : current.tracks;

        return syncAlbums({ ...current, tracks }, nextAlbums);
      });
      setStatus(
        data.warning ||
          `Album importado con ${importedTracks.length} canciones. Toca Guardar cambios para publicarlo.`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "No se pudo importar el album ahora.",
      );
    } finally {
      setImportingAlbum(false);
    }
  };

  const handleCoverFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("Selecciona una imagen para la portada.");
      event.target.value = "";
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setStatus("La portada debe pesar menos de 8 MB.");
      event.target.value = "";
      return;
    }

    setUploadingCover(true);
    setStatus("Subiendo portada...");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/DJCarlosJimenez/assets", {
        body: formData,
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || typeof data.coverUrl !== "string") {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "No se pudo subir la portada.",
        );
      }

      updateAlbum("coverUrl", data.coverUrl);
      setStatus("Portada subida. Toca Guardar cambios para publicarla.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "No se pudo subir la portada.",
      );
    } finally {
      setUploadingCover(false);
      event.target.value = "";
    }
  };

  const handleUpcomingCoverFile = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("Selecciona una imagen para el proximo lanzamiento.");
      event.target.value = "";
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setStatus("La portada debe pesar menos de 8 MB.");
      event.target.value = "";
      return;
    }

    setUploadingUpcomingCover(true);
    setStatus("Subiendo portada del proximo lanzamiento...");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/DJCarlosJimenez/assets", {
        body: formData,
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || typeof data.coverUrl !== "string") {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "No se pudo subir la portada.",
        );
      }

      updateUpcomingRelease("coverUrl", data.coverUrl);
      setStatus("Portada subida. Toca Guardar cambios para publicarla.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "No se pudo subir la portada.",
      );
    } finally {
      setUploadingUpcomingCover(false);
      event.target.value = "";
    }
  };

  const resetConfig = () => {
    hasLocalChangesRef.current = true;
    window.localStorage.removeItem(DJ_CARLOS_PAGE_STORAGE_KEY);
    const cleanInitialConfig = normalizeDjCarlosPageConfig(initialConfig);
    setConfig(cleanInitialConfig);
    setSelectedAlbumId(cleanInitialConfig.album.id);
    setStatus("Pagina restaurada en el editor. Toca Guardar cambios para publicarla.");
  };

  const saveConfig = async (nextStatus = "Cambios publicados.") => {
    let sourceConfig = config;
    try {
      const saved = window.localStorage.getItem(DJ_CARLOS_PAGE_STORAGE_KEY);
      if (saved) {
        const savedConfig = normalizeDjCarlosPageConfig(
          JSON.parse(saved),
          config,
        );
        const savedAt = Date.parse(savedConfig.updatedAt);
        const currentAt = Date.parse(config.updatedAt);
        if (
          Number.isFinite(savedAt) &&
          (!Number.isFinite(currentAt) || savedAt >= currentAt)
        ) {
          sourceConfig = savedConfig;
        }
      }
    } catch {
      sourceConfig = config;
    }

    const nextConfig = normalizeDjCarlosPageConfig(
      { ...sourceConfig, updatedAt: new Date().toISOString() },
      sourceConfig,
    );
    setSaving(true);

    try {
      const response = await fetch("/DJCarlosJimenez/config", {
        body: JSON.stringify(nextConfig),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "No se pudo publicar.",
        );
      }

      const publishedConfig = normalizeDjCarlosPageConfig(
        data.config ?? nextConfig,
        nextConfig,
      );
      hasLocalChangesRef.current = false;
      persistLocalDraft(publishedConfig);
      setConfig(publishedConfig);
      setStatus(nextStatus);
      return true;
    } catch {
      hasLocalChangesRef.current = true;
      persistLocalDraft(nextConfig);
      setConfig(nextConfig);
      setStatus(
        "No se pudo publicar ahora. El borrador quedo guardado en este navegador.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAndViewPage = async () => {
    const published = await saveConfig("Cambios publicados. Abriendo la pagina.");
    if (published) window.location.href = "/DJCarlosJimenez";
  };

  const lockAdmin = async () => {
    try {
      await fetch("/DJCarlosJimenez/admin/session", { method: "DELETE" });
    } finally {
      window.location.reload();
    }
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
            disabled={saving}
            onClick={() => void saveConfig()}
            type="button"
          >
            <Save size={15} />
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
          <button
            className="djcx-admin-save-view"
            disabled={saving}
            onClick={() => void saveAndViewPage()}
            type="button"
          >
            {saving ? "Guardando..." : "Guardar y ver"} <ExternalLink size={15} />
          </button>
          <Link href="/DJCarlosJimenez">
            Ver pagina <ExternalLink size={15} />
          </Link>
          <button className="djcx-admin-secondary" onClick={lockAdmin} type="button">
            <LogOut size={15} />
            Salir
          </button>
          <PwaInstallButton
            className="djcx-admin-install"
            label="Instalar DJ Carlos"
            locale="es"
          />
        </nav>
      </header>

      <section className="djcx-admin-panel djcx-admin-albums-panel">
        <div className="djcx-admin-panel-heading">
          <span>
            <Disc3 size={15} /> Biblioteca de albumes
          </span>
          <button onClick={addAlbum} type="button">
            <Plus size={15} />
            Agregar album
          </button>
        </div>

        <div className="djcx-admin-album-list">
          {albums.map((album, index) => (
            <article
              className={
                album.id === selectedAlbum.id
                  ? "djcx-admin-album-row is-active"
                  : "djcx-admin-album-row"
              }
              key={album.id}
            >
              <button
                className="djcx-admin-album-select"
                onClick={() => selectAlbum(album)}
                type="button"
              >
                <Image
                  alt={`Portada de ${album.title}`}
                  height={52}
                  src={album.coverUrl || logoUrl}
                  unoptimized
                  width={52}
                />
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{album.title}</strong>
                  <small>
                    {albumTrackCounts.get(album.id) ?? 0} canciones
                    {index === 0 ? " / principal" : ""}
                  </small>
                </div>
              </button>

              <div className="djcx-admin-album-actions">
                <Link href={`/DJCarlosJimenez/album/${album.slug}?localPreview=1`}>
                  <ExternalLink size={15} />
                </Link>
                <button
                  aria-label="Mover album arriba"
                  onClick={() => moveAlbum(album.id, -1)}
                  type="button"
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  aria-label="Mover album abajo"
                  onClick={() => moveAlbum(album.id, 1)}
                  type="button"
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  aria-label="Quitar album"
                  onClick={() => removeAlbum(album.id)}
                  type="button"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="djcx-admin-grid">
        <article className="djcx-admin-preview">
          <div className="djcx-cd-case">
            <div className="djcx-cd-spine">DJ CARLOS JIMENEZ</div>
            <div className="djcx-cd-cover">
              <Image
                alt={`Portada de ${selectedAlbum.title}`}
                fill
                priority
                sizes="(max-width: 900px) 70vw, 260px"
                src={selectedAlbum.coverUrl || logoUrl}
                unoptimized
              />
            </div>
            <div className="djcx-cd-disc" aria-hidden="true">
              <span />
            </div>
          </div>
          <div>
            <span>{selectedAlbum.badge}</span>
            <h2>{selectedAlbum.title}</h2>
            <p>{selectedAlbum.subtitle}</p>
          </div>
        </article>

        <section className="djcx-admin-panel">
          <div className="djcx-admin-panel-heading">
            <span>
              <Disc3 size={15} /> Album seleccionado
            </span>
            <strong>{status}</strong>
          </div>

          <div className="djcx-admin-form-grid">
            <label>
              Titulo del album
              <input
                onChange={(event) => updateAlbum("title", event.target.value)}
                value={selectedAlbum.title}
              />
            </label>
            <label>
              Nombre en enlace
              <input
                onChange={(event) =>
                  updateAlbum(
                    "slug",
                    slugifyDjCarlosAlbumTitle(event.target.value, selectedAlbum.slug),
                  )
                }
                value={selectedAlbum.slug}
              />
            </label>
            <label>
              Badge
              <input
                onChange={(event) => updateAlbum("badge", event.target.value)}
                value={selectedAlbum.badge}
              />
            </label>
            <label className="djcx-admin-wide">
              Frase principal
              <input
                onChange={(event) => updateAlbum("subtitle", event.target.value)}
                value={selectedAlbum.subtitle}
              />
            </label>
            <label className="djcx-admin-wide">
              Descripcion
              <textarea
                onChange={(event) =>
                  updateAlbum("description", event.target.value)
                }
                rows={3}
                value={selectedAlbum.description}
              />
            </label>
            <label className="djcx-admin-wide">
              Link del album o primera cancion
              <input
                onChange={(event) => updateAlbum("link", event.target.value)}
                placeholder="https://music.youtube.com/watch?v=..."
                value={selectedAlbum.link}
              />
            </label>
            <label className="djcx-admin-wide">
              URL de portada
              <input
                onChange={(event) => updateAlbum("coverUrl", event.target.value)}
                value={selectedAlbum.coverUrl}
              />
            </label>
            <label
              className={`djcx-file-control${uploadingCover ? " is-loading" : ""}`}
            >
              <ImagePlus size={17} />
              {uploadingCover ? "Subiendo portada..." : "Cargar portada"}
              <input
                accept="image/jpeg,image/png,image/webp"
                disabled={uploadingCover}
                onChange={(event) => void handleCoverFile(event)}
                type="file"
              />
            </label>
          </div>

          <form className="djcx-admin-import" onSubmit={importAlbumFromLink}>
            <label>
              Importar album completo
              <input
                disabled={importingAlbum}
                onChange={(event) => setAlbumImportLink(event.target.value)}
                placeholder="https://music.youtube.com/playlist?list=..."
                value={albumImportLink}
              />
            </label>
            <button disabled={importingAlbum} type="submit">
              <Download size={16} />
              {importingAlbum ? "Importando..." : "Importar album"}
            </button>
            <small>
              Reemplaza solo las canciones del album seleccionado. Top Ten y videos no cambian.
            </small>
          </form>
        </section>
      </section>

      <section className="djcx-admin-stats">
        <article>
          <strong>{albums.length}</strong>
          <span>albumes en biblioteca</span>
        </article>
        <article>
          <strong>{albumTracks.length}</strong>
          <span>canciones del album seleccionado</span>
        </article>
        <article>
          <strong>{topTenTracks.length}</strong>
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

      <section className="djcx-admin-panel djcx-admin-upcoming-panel">
        <div className="djcx-admin-panel-heading">
          <span>
            <Sparkles size={15} /> Proximo lanzamiento
          </span>
          <strong>{upcomingRelease.enabled ? "Visible en tu pagina" : "Oculto"}</strong>
        </div>

        <div className="djcx-admin-upcoming-layout">
          <article className="djcx-admin-upcoming-preview">
            <div>
              <Image
                alt={`Portada de ${upcomingRelease.title}`}
                fill
                sizes="(max-width: 760px) 82vw, 190px"
                src={upcomingRelease.coverUrl || logoUrl}
                unoptimized
              />
              <span>{upcomingRelease.status}</span>
            </div>
            <strong>{upcomingRelease.title}</strong>
            <small>{upcomingRelease.note}</small>
          </article>

          <div className="djcx-admin-form-grid djcx-admin-upcoming-form">
            <label className="djcx-admin-toggle djcx-admin-wide">
              <input
                checked={upcomingRelease.enabled}
                onChange={(event) => updateUpcomingEnabled(event.target.checked)}
                type="checkbox"
              />
              Mostrar proximo lanzamiento en mi pagina
            </label>
            <label>
              Badge
              <input
                onChange={(event) =>
                  updateUpcomingRelease("badge", event.target.value)
                }
                value={upcomingRelease.badge}
              />
            </label>
            <label>
              Estado
              <input
                onChange={(event) =>
                  updateUpcomingRelease("status", event.target.value)
                }
                placeholder="En preparacion"
                value={upcomingRelease.status}
              />
            </label>
            <label className="djcx-admin-wide">
              Titulo posible
              <input
                onChange={(event) =>
                  updateUpcomingRelease("title", event.target.value)
                }
                value={upcomingRelease.title}
              />
            </label>
            <label className="djcx-admin-wide">
              Nota para visitantes
              <textarea
                onChange={(event) =>
                  updateUpcomingRelease("note", event.target.value)
                }
                rows={3}
                value={upcomingRelease.note}
              />
            </label>
            <label className="djcx-admin-wide">
              Posibles canciones
              <textarea
                onChange={(event) => updateUpcomingTracks(event.target.value)}
                rows={6}
                value={upcomingRelease.tracks.join("\n")}
              />
            </label>
            <label className="djcx-admin-wide">
              URL de portada
              <input
                onChange={(event) =>
                  updateUpcomingRelease("coverUrl", event.target.value)
                }
                value={upcomingRelease.coverUrl}
              />
            </label>
            <label
              className={`djcx-file-control${uploadingUpcomingCover ? " is-loading" : ""}`}
            >
              <ImagePlus size={17} />
              {uploadingUpcomingCover ? "Subiendo portada..." : "Cargar portada"}
              <input
                accept="image/jpeg,image/png,image/webp"
                disabled={uploadingUpcomingCover}
                onChange={(event) => void handleUpcomingCoverFile(event)}
                type="file"
              />
            </label>
          </div>
        </div>

        <div className="djcx-admin-upcoming-signals">
          <article>
            <Bell size={16} />
            <strong>{upcomingRelease.signals.followers}</strong>
            <span>siguiendo el avance</span>
          </article>
          {(Object.keys(upcomingReactionLabels) as DjCarlosUpcomingReactionKey[]).map(
            (reaction) => (
              <article key={reaction}>
                {reaction === "favorite" ? (
                  <Heart size={16} />
                ) : (
                  <MessageCircle size={16} />
                )}
                <strong>{upcomingRelease.signals.reactions[reaction]}</strong>
                <span>{upcomingReactionLabels[reaction]}</span>
              </article>
            ),
          )}
        </div>
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
              <option value="top-ten">Top Ten</option>
              <option value="official-video">Videos oficiales</option>
            </select>
          </label>
          <button type="submit">
            <Save size={16} />
            Agregar
          </button>
        </form>
        <p className="djcx-admin-add-status" role="status">{status}</p>
      </section>

      <AdminTrackGroup
        icon={<ListMusic size={15} />}
        onMoveDown={(trackId) => moveTrack(trackId, 1)}
        onMoveUp={(trackId) => moveTrack(trackId, -1)}
        onRemove={removeTrack}
        onUpdate={updateTrack}
        title={`Orden del album: ${selectedAlbum.title}`}
        tracks={albumTracks}
      />

      <AdminTrackGroup
        icon={<ListMusic size={15} />}
        onMoveDown={(trackId) => moveTrack(trackId, 1)}
        onMoveUp={(trackId) => moveTrack(trackId, -1)}
        onRemove={removeTrack}
        onUpdate={updateTrack}
        title="Top Ten"
        tracks={topTenTracks}
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
                <option value="top-ten">Top Ten</option>
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
        {!tracks.length && (
          <p className="djcx-admin-empty">
            Todavia no hay elementos en esta lista. Agrega uno arriba y elige esta lista.
          </p>
        )}
      </div>
    </section>
  );
}
