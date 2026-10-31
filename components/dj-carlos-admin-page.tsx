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
  BarChart3,
  Bell,
  Disc3,
  Download,
  ExternalLink,
  Heart,
  Eye,
  EyeOff,
  ImagePlus,
  ListMusic,
  LogOut,
  MessageCircle,
  Music2,
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
  DJ_CARLOS_DEFAULT_RHYTHM,
  DJ_CARLOS_PAGE_STORAGE_KEY,
  DJ_CARLOS_PREVIEW_CLIP_MAX_MB,
  DJ_CARLOS_PREVIEW_CLIP_MAX_SECONDS,
  detectDjCarlosPlatform,
  getDjCarlosTrackThumbnail,
  getDjCarlosYouTubeVideoId,
  isDjCarlosTrack,
  isDjCarlosPlaceholderRhythm,
  isPlayableDjCarlosLink,
  labelForDjCarlosTrackSection,
  mergeDjCarlosRhythms,
  normalizeDjCarlosPageConfig,
  normalizeDjCarlosRhythm,
  sectionBadge,
  sameDjCarlosRhythm,
  slugifyDjCarlosAlbumTitle,
  type DjCarlosAlbum,
  type DjCarlosCompilation,
  type DjCarlosCompilationTrack,
  type DjCarlosPageConfig,
  type DjCarlosTrack,
  type DjCarlosTrackSection,
  type DjCarlosUpcomingPreviewClip,
  type DjCarlosUpcomingReactionKey,
} from "@/lib/dj-carlos-page";

type TrackDraft = {
  link: string;
  mood: string;
  section: DjCarlosTrackSection;
  title: string;
};

type EditableTrackField = "link" | "mood" | "section" | "subtitle" | "title";

type EditableIdentityField = "logoUrl" | "portraitUrl";

type EditableUpcomingField = "badge" | "coverUrl" | "note" | "status" | "title";
type EditableUpcomingBooleanField =
  | "hidePreviewClipsWhenAvailable"
  | "showPreviewClips";

type EditableCompilationField =
  | "coverUrl"
  | "description"
  | "enabled"
  | "link"
  | "mood"
  | "title";

type EditableCompilationTrackField = "link" | "mood" | "title";

type AlbumImportResponse = {
  album?: Partial<DjCarlosAlbum>;
  error?: string;
  tracks?: unknown[];
  warning?: string | null;
};

const emptyDraft: TrackDraft = {
  link: "",
  mood: DJ_CARLOS_DEFAULT_RHYTHM,
  section: "album",
  title: "",
};

const upcomingReactionLabels: Record<DjCarlosUpcomingReactionKey, string> = {
  favorite: "Mi favorita",
  video: "Quiero video",
  waiting: "La espero",
};
const DJ_CARLOS_COVER_MAX_MB = 20;
const DJ_CARLOS_COVER_MAX_BYTES = DJ_CARLOS_COVER_MAX_MB * 1024 * 1024;
const DJ_CARLOS_PREVIEW_CLIP_MAX_BYTES =
  DJ_CARLOS_PREVIEW_CLIP_MAX_MB * 1024 * 1024;

function previewTitleKey(value: string) {
  return value.trim().toLocaleLowerCase("es");
}

function isAcceptedPreviewAudio(file: File) {
  const validTypes = new Set([
    "audio/aac",
    "audio/mp3",
    "audio/mp4",
    "audio/mpeg",
    "audio/x-aac",
    "audio/x-m4a",
  ]);
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return validTypes.has(file.type.toLowerCase()) ||
    ["aac", "m4a", "mp3"].includes(extension);
}

function readAudioElementDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    let settled = false;
    const finish = (duration?: number, error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      cleanup();
      if (duration && Number.isFinite(duration) && duration > 0) {
        resolve(duration);
        return;
      }
      reject(error ?? new Error("No se pudo leer la duracion del audio."));
    };
    const cleanup = () => {
      audio.onloadedmetadata = null;
      audio.ondurationchange = null;
      audio.ontimeupdate = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(objectUrl);
    };
    const readKnownDuration = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        finish(audio.duration);
        return true;
      }
      return false;
    };
    const timeoutId = window.setTimeout(() => {
      finish(undefined, new Error("El navegador no pudo leer este MP3."));
    }, 9000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      if (readKnownDuration()) return;
      // Algunos MP3 VBR informan Infinity hasta que el navegador busca el final.
      audio.ondurationchange = () => void readKnownDuration();
      audio.ontimeupdate = () => void readKnownDuration();
      try {
        audio.currentTime = Number.MAX_SAFE_INTEGER;
      } catch {
        finish(undefined, new Error("No se pudo leer la duracion del MP3."));
      }
    };
    audio.onerror = () => {
      finish(undefined, new Error("No se pudo abrir este archivo de audio."));
    };
    audio.src = objectUrl;
  });
}

async function readAudioDuration(file: File) {
  try {
    return await readAudioElementDuration(file);
  } catch {
    const AudioContextConstructor = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error("El navegador no pudo leer este MP3.");
    }
    const context = new AudioContextConstructor();
    try {
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) {
        throw new Error("No se pudo leer la duracion del MP3.");
      }
      return decoded.duration;
    } catch {
      throw new Error(
        "No se pudo abrir el MP3. Comprueba que el archivo no este danado.",
      );
    } finally {
      await context.close().catch(() => undefined);
    }
  }
}

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
    mood: DJ_CARLOS_DEFAULT_RHYTHM,
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
  const sessionRedirectTimerRef = useRef<number | null>(null);
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
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingPortrait, setUploadingPortrait] = useState(false);
  const [uploadingUpcomingCover, setUploadingUpcomingCover] = useState(false);
  const [uploadingCompilationCoverId, setUploadingCompilationCoverId] =
    useState("");
  const [uploadingPreviewTitle, setUploadingPreviewTitle] = useState("");
  const [importingAlbum, setImportingAlbum] = useState(false);
  const [status, setStatus] = useState("Panel listo para editar.");
  const [newRhythm, setNewRhythm] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const hasLocalChangesRef = useRef(false);

  const redirectToAdminLogin = useCallback(() => {
    if (sessionRedirectTimerRef.current !== null) return;
    sessionRedirectTimerRef.current = window.setTimeout(() => {
      window.location.href = "/DJCarlosJimenez/admin";
    }, 1200);
  }, []);

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

  const ensureAdminSession = useCallback(async () => {
    try {
      const response = await fetch("/DJCarlosJimenez/admin/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.authenticated === true) {
        setSessionExpired(false);
        return true;
      }
    } catch {
      // The visible status below explains the action the user needs.
    }

    setSessionExpired(true);
    setStatus(
      "Tu sesion de administrador vencio. Entra otra vez; tu borrador queda guardado en este navegador.",
    );
    redirectToAdminLogin();
    return false;
  }, [redirectToAdminLogin]);

  useEffect(() => {
    void ensureAdminSession();
    return () => {
      if (sessionRedirectTimerRef.current !== null) {
        window.clearTimeout(sessionRedirectTimerRef.current);
      }
    };
  }, [ensureAdminSession]);

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
  const artistLogoUrl = config.identity.logoUrl || logoUrl;
  const artistPortraitUrl = config.identity.portraitUrl;
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
  const upcomingPreviewByTitle = useMemo(
    () => new Map(
      upcomingRelease.previewClips.map((clip) => [
        previewTitleKey(clip.title),
        clip,
      ]),
    ),
    [upcomingRelease.previewClips],
  );
  const unassignedUpcomingPreviews = useMemo(() => {
    const trackTitles = new Set(upcomingRelease.tracks.map(previewTitleKey));
    return upcomingRelease.previewClips.filter(
      (clip) => !trackTitles.has(previewTitleKey(clip.title)),
    );
  }, [upcomingRelease.previewClips, upcomingRelease.tracks]);
  const albumTrackCounts = useMemo(() => {
    const counts = new Map<string, number>();
    config.tracks.forEach((track) => {
      if (track.section !== "album" || !track.albumId) return;
      counts.set(track.albumId, (counts.get(track.albumId) ?? 0) + 1);
    });
    return counts;
  }, [config.tracks]);
  const rhythmOptions = useMemo(
    () =>
      mergeDjCarlosRhythms(
        config.rhythms,
        albums.map((album) => album.mood),
        config.tracks.map((track) => track.mood),
        [selectedAlbum.mood, draft.mood],
      ),
    [albums, config.rhythms, config.tracks, draft.mood, selectedAlbum.mood],
  );

  useEffect(() => {
    if (albums.some((album) => album.id === selectedAlbumId)) return;
    const nextAlbum = albums[0];
    setSelectedAlbumId(nextAlbum?.id ?? "");
    setAlbumImportLink(nextAlbum?.link ?? "");
  }, [albums, selectedAlbumId]);

  const selectAlbum = (album: DjCarlosAlbum) => {
    setSelectedAlbumId(album.id);
    setAlbumImportLink(album.link);
    setDraft((current) => ({
      ...current,
      mood: current.section === "album" ? album.mood : current.mood,
    }));
  };

  const addRhythm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const rhythm = newRhythm.trim().replace(/\s+/g, " ");
    if (!rhythm || isDjCarlosPlaceholderRhythm(rhythm)) {
      setStatus("Escribe un ritmo valido.");
      return;
    }
    if (rhythmOptions.some((option) => sameDjCarlosRhythm(option, rhythm))) {
      setStatus("Ese ritmo ya existe.");
      setNewRhythm("");
      return;
    }

    hasLocalChangesRef.current = true;
    setConfig((current) => ({
      ...current,
      rhythms: mergeDjCarlosRhythms(current.rhythms, [rhythm]),
    }));
    setNewRhythm("");
    setStatus("Ritmo agregado. Ya puedes usarlo en albumes y canciones.");
  };

  const removeRhythm = (rhythm: string) => {
    const rhythmInUse =
      albums.some((album) => sameDjCarlosRhythm(album.mood, rhythm)) ||
      config.tracks.some((track) => sameDjCarlosRhythm(track.mood, rhythm));

    if (rhythmInUse) {
      setStatus("Ese ritmo esta en uso. Cambia primero los albumes o canciones que lo usan.");
      return;
    }

    hasLocalChangesRef.current = true;
    setConfig((current) => ({
      ...current,
      rhythms: current.rhythms.filter(
        (option) => !sameDjCarlosRhythm(option, rhythm),
      ),
    }));
    setDraft((current) =>
      sameDjCarlosRhythm(current.mood, rhythm)
        ? { ...current, mood: DJ_CARLOS_DEFAULT_RHYTHM }
        : current,
    );
    setStatus("Ritmo quitado de las opciones.");
  };

  const updateAlbum = (
    field: keyof DjCarlosPageConfig["album"],
    value: string,
  ) => {
    hasLocalChangesRef.current = true;
    setConfig((current) => {
      const nextValue =
        field === "mood"
          ? normalizeDjCarlosRhythm(value, selectedAlbum.mood)
          : value;
      const nextAlbums = albumsForConfig(current).map((album) =>
        album.id === selectedAlbum.id
          ? {
              ...album,
              [field]: nextValue,
              slug:
                field === "title" &&
                (album.slug === slugifyDjCarlosAlbumTitle(album.title) ||
                  album.slug.startsWith("nuevo-album"))
                  ? slugifyDjCarlosAlbumTitle(nextValue, album.slug)
                  : album.slug,
            }
          : album,
      );
      const nextConfig = syncAlbums(
        field === "mood"
          ? {
              ...current,
              rhythms: mergeDjCarlosRhythms(current.rhythms, [nextValue]),
            }
          : current,
        nextAlbums,
      );
      if (field !== "title" && field !== "mood") return nextConfig;
      return {
        ...nextConfig,
        tracks: nextConfig.tracks.map((track) => {
          if (track.section !== "album" || track.albumId !== selectedAlbum.id) {
            return track;
          }

          let nextTrack = track;
          if (field === "title") {
            nextTrack = {
              ...nextTrack,
              release: nextValue,
              subtitle:
                nextTrack.subtitle === selectedAlbum.title
                  ? nextValue
                  : nextTrack.subtitle,
            };
          }

          if (
            field === "mood" &&
            (isDjCarlosPlaceholderRhythm(nextTrack.mood) ||
              sameDjCarlosRhythm(nextTrack.mood, selectedAlbum.mood))
          ) {
            nextTrack = { ...nextTrack, mood: nextValue };
          }

          return nextTrack;
        }),
      };
    });
    setStatus("Album actualizado. Toca Guardar cambios para publicarlo.");
  };

  const updateIdentity = (field: EditableIdentityField, value: string) => {
    hasLocalChangesRef.current = true;
    setConfig((current) => ({
      ...current,
      identity: {
        ...current.identity,
        [field]: value,
      },
      updatedAt: new Date().toISOString(),
    }));
    setStatus("Identidad visual actualizada. Toca Guardar cambios.");
  };

  const updatePortraitVisible = (showPortrait: boolean) => {
    hasLocalChangesRef.current = true;
    setConfig((current) => ({
      ...current,
      identity: {
        ...current.identity,
        showPortrait,
      },
      updatedAt: new Date().toISOString(),
    }));
    setStatus(
      showPortrait
        ? "Foto personal visible. Toca Guardar cambios."
        : "Foto personal oculta. Toca Guardar cambios.",
    );
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

  const updateUpcomingBoolean = (
    field: EditableUpcomingBooleanField,
    value: boolean,
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
    setStatus("Visibilidad de adelantos actualizada. Toca Guardar cambios.");
  };

  const publishUpcomingPreviews = async (
    previewClips: DjCarlosUpcomingPreviewClip[],
    successMessage: string,
  ) => {
    const nextConfig: DjCarlosPageConfig = {
      ...config,
      upcomingRelease: {
        ...config.upcomingRelease,
        previewClips,
      },
      updatedAt: new Date().toISOString(),
    };
    hasLocalChangesRef.current = true;
    persistLocalDraft(nextConfig);
    setConfig(nextConfig);
    return saveConfig(successMessage, nextConfig);
  };

  const deleteStoredPreviewFile = async (storagePath: string) => {
    const response = await fetch("/DJCarlosJimenez/preview-clips", {
      body: JSON.stringify({ storagePath }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    }).catch(() => null);
    return response?.ok === true;
  };

  const handleUpcomingPreviewFile = async (
    event: ChangeEvent<HTMLInputElement>,
    trackTitle: string,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!isAcceptedPreviewAudio(file)) {
      setStatus("Selecciona un audio MP3, M4A o AAC.");
      return;
    }
    if (file.size > DJ_CARLOS_PREVIEW_CLIP_MAX_BYTES) {
      setStatus(
        `El adelanto debe pesar menos de ${DJ_CARLOS_PREVIEW_CLIP_MAX_MB} MB.`,
      );
      return;
    }

    const titleKey = previewTitleKey(trackTitle);
    setUploadingPreviewTitle(titleKey);
    setStatus("Revisando la duracion del adelanto...");

    try {
      const durationSeconds = await readAudioDuration(file);
      const publishedDuration = Math.min(
        DJ_CARLOS_PREVIEW_CLIP_MAX_SECONDS,
        durationSeconds,
      );
      if (!(await ensureAdminSession())) return;

      const existingClip = upcomingPreviewByTitle.get(titleKey);
      const formData = new FormData();
      formData.append("durationSeconds", String(publishedDuration));
      formData.append("file", file);
      formData.append("title", trackTitle);
      if (existingClip) formData.append("clipId", existingClip.id);

      setStatus(
        durationSeconds > DJ_CARLOS_PREVIEW_CLIP_MAX_SECONDS + 0.5
          ? `El archivo dura ${Math.ceil(durationSeconds)} segundos; se publicaran solamente los primeros ${DJ_CARLOS_PREVIEW_CLIP_MAX_SECONDS}.`
          : existingClip
            ? "Reemplazando adelanto..."
            : "Subiendo adelanto privado...",
      );
      const response = await fetch("/DJCarlosJimenez/preview-clips", {
        body: formData,
        cache: "no-store",
        credentials: "same-origin",
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        setStatus(
          "Tu sesion vencio. Entra otra vez para subir el adelanto.",
        );
        redirectToAdminLogin();
        return;
      }
      if (!response.ok || !data.clip) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "No se pudo subir el adelanto.",
        );
      }

      const nextClip = data.clip as DjCarlosUpcomingPreviewClip;
      const nextClips = existingClip
        ? upcomingRelease.previewClips.map((clip) =>
            clip.id === existingClip.id ? nextClip : clip,
          )
        : [...upcomingRelease.previewClips, nextClip];
      const published = await publishUpcomingPreviews(
        nextClips,
        existingClip ? "Adelanto reemplazado y publicado." : "Adelanto publicado.",
      );
      if (
        published &&
        existingClip &&
        existingClip.storagePath !== nextClip.storagePath
      ) {
        await deleteStoredPreviewFile(existingClip.storagePath);
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "No se pudo subir el adelanto.",
      );
    } finally {
      setUploadingPreviewTitle("");
    }
  };

  const toggleUpcomingPreview = async (
    clip: DjCarlosUpcomingPreviewClip,
  ) => {
    await publishUpcomingPreviews(
      upcomingRelease.previewClips.map((item) =>
        item.id === clip.id ? { ...item, enabled: !item.enabled } : item,
      ),
      clip.enabled ? "Adelanto ocultado." : "Adelanto publicado.",
    );
  };

  const removeUpcomingPreview = async (
    clip: DjCarlosUpcomingPreviewClip,
  ) => {
    if (!window.confirm(`Quitar el adelanto de ${clip.title}?`)) return;
    const published = await publishUpcomingPreviews(
      upcomingRelease.previewClips.filter((item) => item.id !== clip.id),
      "Adelanto quitado de la pagina.",
    );
    if (published) {
      const deleted = await deleteStoredPreviewFile(clip.storagePath);
      if (!deleted) {
        setStatus(
          "El adelanto se quito de la pagina, pero el archivo privado no pudo limpiarse ahora.",
        );
      }
    }
  };

  const reassignUpcomingPreview = async (
    clip: DjCarlosUpcomingPreviewClip,
    title: string,
  ) => {
    if (!title || title === clip.title) return;
    const titleKey = previewTitleKey(title);
    if (
      upcomingRelease.previewClips.some(
        (item) =>
          item.id !== clip.id && previewTitleKey(item.title) === titleKey,
      )
    ) {
      setStatus("Esa cancion ya tiene un adelanto.");
      return;
    }
    await publishUpcomingPreviews(
      upcomingRelease.previewClips.map((item) =>
        item.id === clip.id ? { ...item, title } : item,
      ),
      "Adelanto reasignado.",
    );
  };

  const addCompilation = () => {
    hasLocalChangesRef.current = true;
    const stamp = Date.now().toString(36);
    const nextCompilation: DjCarlosCompilation = {
      coverUrl: artistLogoUrl,
      description: "Una seleccion especial de canciones en una sola lista.",
      enabled: true,
      id: `compilacion-${stamp}`,
      link: "",
      mood: DJ_CARLOS_DEFAULT_RHYTHM,
      title: `Nueva compilacion ${config.compilations.length + 1}`,
      tracks: [],
    };
    setConfig((current) => ({
      ...current,
      compilations: [...current.compilations, nextCompilation],
      updatedAt: new Date().toISOString(),
    }));
    setStatus("Compilacion agregada. Completa el enlace y guarda los cambios.");
  };

  const updateCompilation = (
    compilationId: string,
    field: EditableCompilationField,
    value: string | boolean,
  ) => {
    hasLocalChangesRef.current = true;
    setConfig((current) => ({
      ...current,
      compilations: current.compilations.map((compilation) =>
        compilation.id === compilationId
          ? {
              ...compilation,
              [field]: field === "mood" && typeof value === "string"
                ? normalizeDjCarlosRhythm(value, compilation.mood)
                : value,
            }
          : compilation,
      ),
      updatedAt: new Date().toISOString(),
    }));
    setStatus("Compilacion actualizada. Toca Guardar cambios.");
  };

  const addCompilationTrack = (compilationId: string) => {
    hasLocalChangesRef.current = true;
    const stamp = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
    setConfig((current) => ({
      ...current,
      compilations: current.compilations.map((compilation) =>
        compilation.id === compilationId
          ? {
              ...compilation,
              tracks: [
                ...compilation.tracks,
                {
                  id: `single-${stamp}`,
                  link: "",
                  mood: compilation.mood || DJ_CARLOS_DEFAULT_RHYTHM,
                  title: `Nueva cancion ${compilation.tracks.length + 1}`,
                },
              ],
            }
          : compilation,
      ),
      updatedAt: new Date().toISOString(),
    }));
    setStatus("Cancion agregada a la compilacion. Completa sus datos y guarda.");
  };

  const updateCompilationTrack = (
    compilationId: string,
    trackId: string,
    field: EditableCompilationTrackField,
    value: string,
  ) => {
    hasLocalChangesRef.current = true;
    setConfig((current) => ({
      ...current,
      compilations: current.compilations.map((compilation) =>
        compilation.id === compilationId
          ? {
              ...compilation,
              tracks: compilation.tracks.map((track) =>
                track.id === trackId
                  ? {
                      ...track,
                      [field]: field === "mood"
                        ? normalizeDjCarlosRhythm(value, track.mood)
                        : value,
                    }
                  : track,
              ),
            }
          : compilation,
      ),
      updatedAt: new Date().toISOString(),
    }));
    setStatus("Cancion de la compilacion actualizada. Toca Guardar cambios.");
  };

  const moveCompilationTrack = (
    compilationId: string,
    trackId: string,
    direction: -1 | 1,
  ) => {
    hasLocalChangesRef.current = true;
    setConfig((current) => ({
      ...current,
      compilations: current.compilations.map((compilation) => {
        if (compilation.id !== compilationId) return compilation;
        const tracks = [...compilation.tracks];
        const index = tracks.findIndex((track) => track.id === trackId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= tracks.length) {
          return compilation;
        }
        [tracks[index], tracks[target]] = [tracks[target], tracks[index]];
        return { ...compilation, tracks };
      }),
      updatedAt: new Date().toISOString(),
    }));
    setStatus("Orden de canciones actualizado. Toca Guardar cambios.");
  };

  const removeCompilationTrack = (compilationId: string, trackId: string) => {
    hasLocalChangesRef.current = true;
    setConfig((current) => ({
      ...current,
      compilations: current.compilations.map((compilation) =>
        compilation.id === compilationId
          ? {
              ...compilation,
              tracks: compilation.tracks.filter((track) => track.id !== trackId),
            }
          : compilation,
      ),
      updatedAt: new Date().toISOString(),
    }));
    setStatus("Cancion quitada de la compilacion. Toca Guardar cambios.");
  };

  const moveCompilation = (compilationId: string, direction: -1 | 1) => {
    hasLocalChangesRef.current = true;
    setConfig((current) => {
      const index = current.compilations.findIndex(
        (compilation) => compilation.id === compilationId,
      );
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.compilations.length) {
        return current;
      }
      const compilations = [...current.compilations];
      [compilations[index], compilations[target]] = [
        compilations[target],
        compilations[index],
      ];
      return { ...current, compilations, updatedAt: new Date().toISOString() };
    });
    setStatus("Orden de compilaciones actualizado. Toca Guardar cambios.");
  };

  const removeCompilation = (compilationId: string) => {
    if (!window.confirm("Quitar esta compilacion de la pagina?")) return;
    hasLocalChangesRef.current = true;
    setConfig((current) => ({
      ...current,
      compilations: current.compilations.filter(
        (compilation) => compilation.id !== compilationId,
      ),
      updatedAt: new Date().toISOString(),
    }));
    setStatus("Compilacion quitada. Toca Guardar cambios.");
  };

  const addAlbum = () => {
    hasLocalChangesRef.current = true;
    const nextAlbum = newArtistAlbum(albums.length + 1, artistLogoUrl);
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
    setConfig((current) => {
      const nextRhythm =
        field === "mood" ? normalizeDjCarlosRhythm(value) : null;
      return {
        ...current,
        rhythms: nextRhythm
          ? mergeDjCarlosRhythms(current.rhythms, [nextRhythm])
          : current.rhythms,
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
          if (field === "mood") {
            return {
              ...track,
              mood: nextRhythm ?? track.mood,
            };
          }
          return {
            ...track,
            [field]: value,
          };
        }),
      };
    });
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
          (track.section !== "album" || item.albumId === track.albumId) &&
          (track.section !== "official-video" ||
            sameDjCarlosRhythm(item.mood, track.mood)),
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

  const addTrack = async (event: FormEvent<HTMLFormElement>) => {
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

    if (draft.section === "official-video") {
      const videoId = getDjCarlosYouTubeVideoId(link);
      const duplicate = config.tracks.some(
        (track) =>
          track.section === "official-video" &&
          videoId !== null &&
          getDjCarlosYouTubeVideoId(track.link) === videoId,
      );
      if (duplicate) {
        setStatus("Este video ya esta publicado en Videos oficiales.");
        return;
      }
    }

    const platform = detectDjCarlosPlatform(link);
    hasLocalChangesRef.current = true;
    const trackMood = normalizeDjCarlosRhythm(
      draft.mood,
      draft.section === "album" ? selectedAlbum.mood : DJ_CARLOS_DEFAULT_RHYTHM,
    );
    const track: DjCarlosTrack = {
      albumId: draft.section === "album" ? selectedAlbum.id : undefined,
      artist: "DJ Carlos Jimenez Compositor",
      badge: sectionBadge(draft.section),
      coverUrl: getDjCarlosTrackThumbnail(link) ?? artistLogoUrl,
      id: `dj-carlos-local-${Date.now()}`,
      link,
      mood: trackMood,
      platform,
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

    const nextConfig: DjCarlosPageConfig = {
      ...config,
      rhythms: mergeDjCarlosRhythms(config.rhythms, [trackMood]),
      tracks: [...config.tracks, track],
    };
    setConfig(nextConfig);
    setDraft({ ...emptyDraft, mood: selectedAlbum.mood || DJ_CARLOS_DEFAULT_RHYTHM });

    if (draft.section === "official-video") {
      setStatus("Publicando video...");
      await saveConfig("Video publicado.", nextConfig);
      return;
    }

    setStatus("Cancion agregada. Toca Guardar cambios para publicarla.");
  };

  const importAlbumFromLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const link = albumImportLink.trim();
    const albumMood = normalizeDjCarlosRhythm(selectedAlbum.mood);

    if (!hasYouTubePlaylistId(link)) {
      setStatus("Pega el link de compartir del album de YouTube Music.");
      return;
    }

    if (!(await ensureAdminSession())) return;

    setImportingAlbum(true);
    setStatus("Importando album desde YouTube Music...");

    try {
      const response = await fetch("/DJCarlosJimenez/import-album", {
        body: JSON.stringify({
          albumId: selectedAlbum.id,
          link,
          mood: albumMood,
        }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as AlbumImportResponse;

      if (response.status === 401) {
        setStatus(
          "Tu sesion de administrador vencio. Entra otra vez para importar; tu borrador queda guardado.",
        );
        redirectToAdminLogin();
        return;
      }

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
          : selectedAlbum.coverUrl || artistLogoUrl;
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
            mood:
              typeof importedAlbum.mood === "string" && importedAlbum.mood.trim()
                ? normalizeDjCarlosRhythm(importedAlbum.mood, albumMood)
                : albumMood,
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
          mood: normalizeDjCarlosRhythm(track.mood, albumMood),
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

        return syncAlbums(
          {
            ...current,
            rhythms: mergeDjCarlosRhythms(current.rhythms, [albumMood]),
            tracks,
          },
          nextAlbums,
        );
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
    if (file.size > DJ_CARLOS_COVER_MAX_BYTES) {
      setStatus(`La portada debe pesar menos de ${DJ_CARLOS_COVER_MAX_MB} MB.`);
      event.target.value = "";
      return;
    }

    setUploadingCover(true);
    setStatus("Revisando sesion...");

    try {
      if (!(await ensureAdminSession())) return;

      setStatus("Subiendo portada...");
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/DJCarlosJimenez/assets", {
        body: formData,
        cache: "no-store",
        credentials: "same-origin",
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 401) {
        setStatus(
          "Tu sesion de administrador vencio. Entra otra vez para subir la portada; tu borrador queda guardado.",
        );
        redirectToAdminLogin();
        return;
      }

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
    if (file.size > DJ_CARLOS_COVER_MAX_BYTES) {
      setStatus(`La portada debe pesar menos de ${DJ_CARLOS_COVER_MAX_MB} MB.`);
      event.target.value = "";
      return;
    }

    setUploadingUpcomingCover(true);
    setStatus("Revisando sesion...");

    try {
      if (!(await ensureAdminSession())) return;

      setStatus("Subiendo portada del proximo lanzamiento...");
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/DJCarlosJimenez/assets", {
        body: formData,
        cache: "no-store",
        credentials: "same-origin",
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 401) {
        setStatus(
          "Tu sesion de administrador vencio. Entra otra vez para subir la portada; tu borrador queda guardado.",
        );
        redirectToAdminLogin();
        return;
      }

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

  const handleCompilationCoverFile = async (
    event: ChangeEvent<HTMLInputElement>,
    compilationId: string,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("Selecciona una imagen JPG, PNG o WEBP para la compilacion.");
      return;
    }
    if (file.size > DJ_CARLOS_COVER_MAX_BYTES) {
      setStatus(`La portada debe pesar menos de ${DJ_CARLOS_COVER_MAX_MB} MB.`);
      return;
    }

    setUploadingCompilationCoverId(compilationId);
    setStatus("Revisando sesion...");
    try {
      if (!(await ensureAdminSession())) return;
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/DJCarlosJimenez/assets", {
        body: formData,
        cache: "no-store",
        credentials: "same-origin",
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        setStatus(
          "Tu sesion vencio. Entra otra vez; el resto del borrador queda guardado.",
        );
        redirectToAdminLogin();
        return;
      }
      const coverUrl = typeof data.coverUrl === "string"
        ? data.coverUrl
        : typeof data.assetUrl === "string"
          ? data.assetUrl
          : "";
      if (!response.ok || !coverUrl) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "No se pudo subir la portada de la compilacion.",
        );
      }
      updateCompilation(compilationId, "coverUrl", coverUrl);
      setStatus("Portada de compilacion subida. Toca Guardar cambios.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "No se pudo subir la portada de la compilacion.",
      );
    } finally {
      setUploadingCompilationCoverId("");
    }
  };

  const handleIdentityImageFile = async (
    event: ChangeEvent<HTMLInputElement>,
    field: EditableIdentityField,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const isLogo = field === "logoUrl";
    const label = isLogo ? "logo" : "foto personal";
    const setUploading = isLogo ? setUploadingLogo : setUploadingPortrait;
    if (!file.type.startsWith("image/")) {
      setStatus(`Selecciona una imagen para el ${label}.`);
      event.target.value = "";
      return;
    }
    if (file.size > DJ_CARLOS_COVER_MAX_BYTES) {
      setStatus(`La imagen debe pesar menos de ${DJ_CARLOS_COVER_MAX_MB} MB.`);
      event.target.value = "";
      return;
    }

    setUploading(true);
    setStatus("Revisando sesion...");

    try {
      if (!(await ensureAdminSession())) return;

      setStatus(`Subiendo ${label}...`);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", "identity");
      const response = await fetch("/DJCarlosJimenez/assets", {
        body: formData,
        cache: "no-store",
        credentials: "same-origin",
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 401) {
        setStatus(
          "Tu sesion de administrador vencio. Entra otra vez para subir la imagen; tu borrador queda guardado.",
        );
        redirectToAdminLogin();
        return;
      }

      const assetUrl =
        typeof data.assetUrl === "string"
          ? data.assetUrl
          : typeof data.coverUrl === "string"
            ? data.coverUrl
            : "";

      if (!response.ok || !assetUrl) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "No se pudo subir la imagen.",
        );
      }

      updateIdentity(field, assetUrl);
      setStatus(
        `${isLogo ? "Logo" : "Foto personal"} subido. Toca Guardar cambios para publicarlo.`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "No se pudo subir la imagen.",
      );
    } finally {
      setUploading(false);
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

  async function saveConfig(
    nextStatus = "Cambios publicados.",
    configOverride?: DjCarlosPageConfig,
  ) {
    let sourceConfig = configOverride ?? config;
    if (!configOverride) {
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
    }

    const nextConfig = normalizeDjCarlosPageConfig(
      { ...sourceConfig, updatedAt: new Date().toISOString() },
      sourceConfig,
    );

    if (!(await ensureAdminSession())) {
      hasLocalChangesRef.current = true;
      persistLocalDraft(nextConfig);
      setConfig(nextConfig);
      return false;
    }

    setSaving(true);

    try {
      const response = await fetch("/DJCarlosJimenez/config", {
        body: JSON.stringify(nextConfig),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 401) {
        hasLocalChangesRef.current = true;
        persistLocalDraft(nextConfig);
        setConfig(nextConfig);
        setStatus(
          "Tu sesion de administrador vencio. Entra otra vez para guardar; tu borrador queda guardado.",
        );
        redirectToAdminLogin();
        return false;
      }

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
      const publishedVideoCount = publishedConfig.tracks.filter(
        (track) => track.section === "official-video",
      ).length;
      setStatus(
        nextStatus.toLocaleLowerCase("es").includes("video")
          ? `${nextStatus} ${publishedVideoCount} videos oficiales disponibles.`
          : nextStatus,
      );
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
  }

  const saveAndViewPage = async () => {
    const published = await saveConfig("Cambios publicados. Abriendo la pagina.");
    if (published) window.location.href = "/DJCarlosJimenez";
  };

  const lockAdmin = async () => {
    try {
      await fetch("/DJCarlosJimenez/admin/session", {
        cache: "no-store",
        credentials: "same-origin",
        method: "DELETE",
      });
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
            src={artistLogoUrl}
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
          <Link href="/DJCarlosJimenez/analytics">
            Estadisticas <BarChart3 size={15} />
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

      <div
        className={
          sessionExpired
            ? "djcx-admin-status-bar is-warning"
            : "djcx-admin-status-bar"
        }
        role={sessionExpired ? "alert" : "status"}
      >
        <span>{status}</span>
        {sessionExpired && (
          <Link href="/DJCarlosJimenez/admin">Entrar otra vez</Link>
        )}
      </div>

      <section className="djcx-admin-panel djcx-admin-identity-panel">
        <div className="djcx-admin-panel-heading">
          <span>
            <ImagePlus size={15} /> Identidad visual
          </span>
          <strong>Logo y foto personal de tu pagina</strong>
        </div>

        <div className="djcx-admin-identity-layout">
          <article className="djcx-admin-identity-preview">
            <div className="djcx-admin-identity-logo">
              <Image
                alt="Logo actual de DJ Carlos Jimenez"
                fill
                sizes="220px"
                src={artistLogoUrl}
                unoptimized
              />
            </div>
            {config.identity.showPortrait && artistPortraitUrl ? (
              <div className="djcx-admin-identity-portrait">
                <Image
                  alt="Foto personal actual de DJ Carlos Jimenez"
                  fill
                  sizes="220px"
                  src={artistPortraitUrl}
                  unoptimized
                />
              </div>
            ) : (
              <p>La foto personal esta oculta en la pagina publica.</p>
            )}
          </article>

          <div className="djcx-admin-form-grid">
            <label className="djcx-admin-toggle djcx-admin-wide">
              <input
                checked={config.identity.showPortrait}
                onChange={(event) => updatePortraitVisible(event.target.checked)}
                type="checkbox"
              />
              Mostrar foto personal junto al logo en mi pagina
            </label>
            <label>
              URL del logo
              <input
                onChange={(event) =>
                  updateIdentity("logoUrl", event.target.value)
                }
                placeholder="/artist/dj-carlos-jimenez/logo.png"
                value={config.identity.logoUrl}
              />
            </label>
            <label>
              URL de foto personal
              <input
                onChange={(event) =>
                  updateIdentity("portraitUrl", event.target.value)
                }
                placeholder="/artist/dj-carlos-jimenez/portrait.png"
                value={config.identity.portraitUrl}
              />
            </label>
            <label
              className={`djcx-file-control${
                uploadingLogo ? " is-loading" : ""
              }`}
            >
              <ImagePlus size={17} />
              {uploadingLogo ? "Subiendo logo..." : "Cargar logo PNG"}
              <input
                accept="image/jpeg,image/png,image/webp"
                disabled={uploadingLogo}
                onChange={(event) =>
                  void handleIdentityImageFile(event, "logoUrl")
                }
                type="file"
              />
            </label>
            <label
              className={`djcx-file-control${
                uploadingPortrait ? " is-loading" : ""
              }`}
            >
              <ImagePlus size={17} />
              {uploadingPortrait ? "Subiendo foto..." : "Cargar foto personal"}
              <input
                accept="image/jpeg,image/png,image/webp"
                disabled={uploadingPortrait}
                onChange={(event) =>
                  void handleIdentityImageFile(event, "portraitUrl")
                }
                type="file"
              />
            </label>
          </div>
        </div>
      </section>

      <section className="djcx-admin-panel djcx-admin-rhythms-panel">
        <div className="djcx-admin-panel-heading">
          <span>
            <ListMusic size={15} /> Ritmos de la pagina
          </span>
          <strong>Estos botones aparecen cuando tienen musica asignada</strong>
        </div>

        <form className="djcx-admin-rhythm-add" onSubmit={addRhythm}>
          <label>
            Nuevo ritmo
            <input
              onChange={(event) => setNewRhythm(event.target.value)}
              placeholder="Tribal, Pop Rock, Merengue..."
              value={newRhythm}
            />
          </label>
          <button type="submit">
            <Plus size={15} />
            Agregar ritmo
          </button>
        </form>

        <div className="djcx-admin-rhythm-list" aria-label="Ritmos disponibles">
          {rhythmOptions.map((rhythm) => (
            <span key={rhythm}>
              {rhythm}
              <button
                aria-label={`Quitar ritmo ${rhythm}`}
                onClick={() => removeRhythm(rhythm)}
                type="button"
              >
                <Trash2 size={13} />
              </button>
            </span>
          ))}
        </div>
      </section>

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
                  src={album.coverUrl || artistLogoUrl}
                  unoptimized
                  width={52}
                />
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{album.title}</strong>
                  <small>
                    {album.mood} / {albumTrackCounts.get(album.id) ?? 0} canciones
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
                src={selectedAlbum.coverUrl || artistLogoUrl}
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
            <strong className="djcx-admin-preview-rhythm">{selectedAlbum.mood}</strong>
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
            <label>
              Ritmo principal
              <select
                onChange={(event) => updateAlbum("mood", event.target.value)}
                value={selectedAlbum.mood}
              >
                {rhythmOptions.map((rhythm) => (
                  <option key={rhythm} value={rhythm}>
                    {rhythm}
                  </option>
                ))}
              </select>
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
              Reemplaza solo las canciones del album seleccionado y usa su ritmo principal. Top Ten y videos no cambian.
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
                src={upcomingRelease.coverUrl || artistLogoUrl}
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

        <div className="djcx-admin-preview-clips">
          <div className="djcx-admin-preview-heading">
            <div>
              <span><Music2 size={16} /> Adelantos exclusivos</span>
              <strong>Clips privados de hasta 30 segundos</strong>
            </div>
            <small>
              MP3, M4A o AAC · maximo {DJ_CARLOS_PREVIEW_CLIP_MAX_MB} MB · se
              publican los primeros {DJ_CARLOS_PREVIEW_CLIP_MAX_SECONDS} segundos
            </small>
          </div>

          <div className="djcx-admin-preview-settings">
            <label className="djcx-admin-toggle">
              <input
                checked={upcomingRelease.showPreviewClips}
                onChange={(event) =>
                  updateUpcomingBoolean("showPreviewClips", event.target.checked)
                }
                type="checkbox"
              />
              Mostrar adelantos en mi pagina
            </label>
            <label className="djcx-admin-toggle">
              <input
                checked={upcomingRelease.hidePreviewClipsWhenAvailable}
                onChange={(event) =>
                  updateUpcomingBoolean(
                    "hidePreviewClipsWhenAvailable",
                    event.target.checked,
                  )
                }
                type="checkbox"
              />
              Ocultarlos cuando el estado diga Disponible
            </label>
          </div>

          <p className="djcx-admin-preview-note">
            Cada archivo se guarda de forma privada y la pagina usa un enlace temporal.
            Si el archivo dura mas, la reproduccion se detiene automaticamente a los
            {` ${DJ_CARLOS_PREVIEW_CLIP_MAX_SECONDS} segundos`}. Subir o reemplazar un
            clip lo publica inmediatamente.
          </p>

          <div className="djcx-admin-preview-list">
            {upcomingRelease.tracks.map((trackTitle, index) => {
              const clip = upcomingPreviewByTitle.get(previewTitleKey(trackTitle));
              const uploading =
                uploadingPreviewTitle === previewTitleKey(trackTitle);
              return (
                <article key={`${trackTitle}-${index}`}>
                  <div className="djcx-admin-preview-title">
                    <Music2 size={16} />
                    <div>
                      <strong>{trackTitle}</strong>
                      <small>
                        {clip
                          ? `${clip.durationSeconds.toFixed(1)} segundos · ${clip.enabled ? "Visible" : "Oculto"}`
                          : "Sin adelanto"}
                      </small>
                    </div>
                  </div>

                  {clip && (
                    <audio
                      controls
                      controlsList="nodownload noplaybackrate"
                      onContextMenu={(event) => event.preventDefault()}
                      preload="none"
                      src={`/DJCarlosJimenez/preview-clips/${encodeURIComponent(clip.id)}`}
                    />
                  )}

                  <div className="djcx-admin-preview-actions">
                    <label
                      className={`djcx-file-control${uploading ? " is-loading" : ""}`}
                    >
                      <Save size={15} />
                      {uploading
                        ? "Subiendo..."
                        : clip
                          ? "Reemplazar"
                          : "Agregar MP3"}
                      <input
                        accept=".mp3,.m4a,.aac,audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/aac,audio/x-aac"
                        disabled={Boolean(uploadingPreviewTitle) || saving}
                        onChange={(event) =>
                          void handleUpcomingPreviewFile(event, trackTitle)
                        }
                        type="file"
                      />
                    </label>
                    {clip && (
                      <>
                        <button
                          disabled={saving || Boolean(uploadingPreviewTitle)}
                          onClick={() => void toggleUpcomingPreview(clip)}
                          type="button"
                        >
                          {clip.enabled ? <EyeOff size={15} /> : <Eye size={15} />}
                          {clip.enabled ? "Ocultar" : "Mostrar"}
                        </button>
                        <button
                          className="is-danger"
                          disabled={saving || Boolean(uploadingPreviewTitle)}
                          onClick={() => void removeUpcomingPreview(clip)}
                          type="button"
                        >
                          <Trash2 size={15} /> Quitar
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}

            {!upcomingRelease.tracks.length && (
              <p className="djcx-admin-preview-empty">
                Agrega primero los posibles nombres de las canciones.
              </p>
            )}
          </div>

          {unassignedUpcomingPreviews.length > 0 && (
            <div className="djcx-admin-preview-unassigned">
              <strong>Adelantos sin una cancion actual</strong>
              {unassignedUpcomingPreviews.map((clip) => (
                <article key={clip.id}>
                  <span>{clip.title}</span>
                  <select
                    defaultValue=""
                    disabled={saving}
                    onChange={(event) =>
                      void reassignUpcomingPreview(clip, event.target.value)
                    }
                  >
                    <option value="">Reasignar a...</option>
                    {upcomingRelease.tracks.map((trackTitle) => (
                      <option key={trackTitle} value={trackTitle}>
                        {trackTitle}
                      </option>
                    ))}
                  </select>
                  <button
                    className="is-danger"
                    disabled={saving}
                    onClick={() => void removeUpcomingPreview(clip)}
                    type="button"
                  >
                    <Trash2 size={15} /> Quitar
                  </button>
                </article>
              ))}
            </div>
          )}
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

      <AdminCompilations
        compilations={config.compilations}
        onAdd={addCompilation}
        onAddTrack={addCompilationTrack}
        onCoverFile={handleCompilationCoverFile}
        onMove={moveCompilation}
        onMoveTrack={moveCompilationTrack}
        onRemove={removeCompilation}
        onRemoveTrack={removeCompilationTrack}
        onUpdate={updateCompilation}
        onUpdateTrack={updateCompilationTrack}
        rhythmOptions={rhythmOptions}
        uploadingCoverId={uploadingCompilationCoverId}
      />

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
            <select
              onChange={(event) =>
                setDraft((current) => ({ ...current, mood: event.target.value }))
              }
              value={draft.mood}
            >
              {rhythmOptions.map((rhythm) => (
                <option key={rhythm} value={rhythm}>
                  {rhythm}
                </option>
              ))}
            </select>
          </label>
          <label>
            Lista
            <select
              onChange={(event) => {
                const section = event.target.value as DjCarlosTrackSection;
                setDraft((current) => ({
                  ...current,
                  mood: section === "album" ? selectedAlbum.mood : current.mood,
                  section,
                }));
              }}
              value={draft.section}
            >
              <option value="album">Album</option>
              <option value="top-ten">Top Ten</option>
              <option value="official-video">Videos oficiales</option>
            </select>
          </label>
          <button disabled={saving} type="submit">
            <Save size={16} />
            {saving
              ? "Publicando..."
              : draft.section === "official-video"
                ? "Agregar y publicar"
                : "Agregar"}
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
        rhythmOptions={rhythmOptions}
        title={`Orden del album: ${selectedAlbum.title}`}
        tracks={albumTracks}
      />

      <AdminTrackGroup
        icon={<ListMusic size={15} />}
        onMoveDown={(trackId) => moveTrack(trackId, 1)}
        onMoveUp={(trackId) => moveTrack(trackId, -1)}
        onRemove={removeTrack}
        onUpdate={updateTrack}
        rhythmOptions={rhythmOptions}
        title="Top Ten"
        tracks={topTenTracks}
      />

      <AdminTrackGroup
        icon={<Video size={15} />}
        onMoveDown={(trackId) => moveTrack(trackId, 1)}
        onMoveUp={(trackId) => moveTrack(trackId, -1)}
        onRemove={removeTrack}
        onUpdate={updateTrack}
        rhythmOptions={rhythmOptions}
        title={`Videos oficiales (${videoTracks.length}) · orden por estilo`}
        tracks={videoTracks}
      />
    </main>
  );
}

function AdminCompilations({
  compilations,
  onAdd,
  onAddTrack,
  onCoverFile,
  onMove,
  onMoveTrack,
  onRemove,
  onRemoveTrack,
  onUpdate,
  onUpdateTrack,
  rhythmOptions,
  uploadingCoverId,
}: {
  compilations: DjCarlosCompilation[];
  onAdd: () => void;
  onAddTrack: (compilationId: string) => void;
  onCoverFile: (
    event: ChangeEvent<HTMLInputElement>,
    compilationId: string,
  ) => void;
  onMove: (compilationId: string, direction: -1 | 1) => void;
  onMoveTrack: (
    compilationId: string,
    trackId: string,
    direction: -1 | 1,
  ) => void;
  onRemove: (compilationId: string) => void;
  onRemoveTrack: (compilationId: string, trackId: string) => void;
  onUpdate: (
    compilationId: string,
    field: EditableCompilationField,
    value: string | boolean,
  ) => void;
  onUpdateTrack: (
    compilationId: string,
    trackId: string,
    field: EditableCompilationTrackField,
    value: string,
  ) => void;
  rhythmOptions: string[];
  uploadingCoverId: string;
}) {
  return (
    <section className="djcx-admin-panel djcx-admin-compilations">
      <div className="djcx-admin-panel-heading">
        <span>
          <ListMusic size={15} /> Listas y compilaciones
        </span>
        <button onClick={onAdd} type="button">
          <Plus size={15} /> Nueva compilacion
        </button>
      </div>
      <p className="djcx-admin-compilation-help">
        Son independientes de Top Ten. Sube una portada propia y agrega cada
        sencillo con su enlace y ritmo. El enlace general de playlist es opcional.
      </p>
      <div className="djcx-admin-compilation-list">
        {compilations.map((compilation, index) => (
          <article key={compilation.id}>
            <div className="djcx-admin-compilation-order">
              <strong>{String(index + 1).padStart(2, "0")}</strong>
              <button
                aria-label="Mover compilacion arriba"
                disabled={index === 0}
                onClick={() => onMove(compilation.id, -1)}
                type="button"
              >
                <ArrowUp size={15} />
              </button>
              <button
                aria-label="Mover compilacion abajo"
                disabled={index === compilations.length - 1}
                onClick={() => onMove(compilation.id, 1)}
                type="button"
              >
                <ArrowDown size={15} />
              </button>
            </div>
            <div className="djcx-admin-compilation-fields">
              <label>
                Titulo
                <input
                  onChange={(event) =>
                    onUpdate(compilation.id, "title", event.target.value)
                  }
                  value={compilation.title}
                />
              </label>
              <label>
                Enlace general de playlist (opcional)
                <input
                  onChange={(event) =>
                    onUpdate(compilation.id, "link", event.target.value)
                  }
                  placeholder="https://music.youtube.com/playlist?list=..."
                  value={compilation.link}
                />
              </label>
              <label>
                Ritmo para la playlist general
                <select
                  onChange={(event) =>
                    onUpdate(compilation.id, "mood", event.target.value)
                  }
                  value={compilation.mood}
                >
                  {rhythmOptions.map((rhythm) => (
                    <option key={rhythm} value={rhythm}>{rhythm}</option>
                  ))}
                </select>
              </label>
              <label>
                URL de portada
                <input
                  onChange={(event) =>
                    onUpdate(compilation.id, "coverUrl", event.target.value)
                  }
                  value={compilation.coverUrl}
                />
              </label>
              <label
                className={`djcx-file-control djcx-admin-compilation-cover${
                  uploadingCoverId === compilation.id ? " is-loading" : ""
                }`}
              >
                <ImagePlus size={16} />
                {uploadingCoverId === compilation.id
                  ? "Subiendo portada..."
                  : "Cargar portada propia"}
                <input
                  accept="image/jpeg,image/png,image/webp"
                  disabled={uploadingCoverId === compilation.id}
                  onChange={(event) => onCoverFile(event, compilation.id)}
                  type="file"
                />
              </label>
              <label className="djcx-admin-compilation-description">
                Descripcion
                <textarea
                  onChange={(event) =>
                    onUpdate(compilation.id, "description", event.target.value)
                  }
                  rows={2}
                  value={compilation.description}
                />
              </label>
              <div className="djcx-admin-compilation-tracks">
                <div>
                  <strong>Sencillos de esta compilacion</strong>
                  <button
                    onClick={() => onAddTrack(compilation.id)}
                    type="button"
                  >
                    <Plus size={14} /> Agregar cancion
                  </button>
                </div>
                {compilation.tracks.map((track, trackIndex) => (
                  <CompilationTrackEditor
                    compilationId={compilation.id}
                    index={trackIndex}
                    key={track.id}
                    onMove={onMoveTrack}
                    onRemove={onRemoveTrack}
                    onUpdate={onUpdateTrack}
                    rhythmOptions={rhythmOptions}
                    total={compilation.tracks.length}
                    track={track}
                  />
                ))}
                {!compilation.tracks.length && (
                  <p>
                    Agrega canciones individuales para mezclar cumbia, banda,
                    pop u otros ritmos dentro de la misma compilacion.
                  </p>
                )}
              </div>
            </div>
            <div className="djcx-admin-compilation-actions">
              <label className="djcx-admin-toggle">
                <input
                  checked={compilation.enabled}
                  onChange={(event) =>
                    onUpdate(compilation.id, "enabled", event.target.checked)
                  }
                  type="checkbox"
                />
                Visible
              </label>
              {compilation.link && (
                <a href={compilation.link} rel="noreferrer" target="_blank">
                  <ExternalLink size={15} /> Probar enlace
                </a>
              )}
              <button
                className="is-danger"
                onClick={() => onRemove(compilation.id)}
                type="button"
              >
                <Trash2 size={15} /> Quitar
              </button>
            </div>
          </article>
        ))}
        {!compilations.length && (
          <p className="djcx-admin-empty">
            Todavia no hay compilaciones. Agrega la primera sin modificar Top Ten.
          </p>
        )}
      </div>
    </section>
  );
}

function CompilationTrackEditor({
  compilationId,
  index,
  onMove,
  onRemove,
  onUpdate,
  rhythmOptions,
  total,
  track,
}: {
  compilationId: string;
  index: number;
  onMove: (
    compilationId: string,
    trackId: string,
    direction: -1 | 1,
  ) => void;
  onRemove: (compilationId: string, trackId: string) => void;
  onUpdate: (
    compilationId: string,
    trackId: string,
    field: EditableCompilationTrackField,
    value: string,
  ) => void;
  rhythmOptions: string[];
  total: number;
  track: DjCarlosCompilationTrack;
}) {
  return (
    <article className="djcx-admin-compilation-track">
      <span>{String(index + 1).padStart(2, "0")}</span>
      <label>
        Titulo
        <input
          onChange={(event) =>
            onUpdate(compilationId, track.id, "title", event.target.value)
          }
          value={track.title}
        />
      </label>
      <label>
        Enlace de la cancion
        <input
          onChange={(event) =>
            onUpdate(compilationId, track.id, "link", event.target.value)
          }
          placeholder="YouTube o YouTube Music"
          value={track.link}
        />
      </label>
      <label>
        Ritmo de esta cancion
        <select
          onChange={(event) =>
            onUpdate(compilationId, track.id, "mood", event.target.value)
          }
          value={track.mood}
        >
          {rhythmOptions.map((rhythm) => (
            <option key={rhythm} value={rhythm}>{rhythm}</option>
          ))}
        </select>
      </label>
      <div>
        <button
          aria-label="Mover cancion arriba"
          disabled={index === 0}
          onClick={() => onMove(compilationId, track.id, -1)}
          type="button"
        >
          <ArrowUp size={14} />
        </button>
        <button
          aria-label="Mover cancion abajo"
          disabled={index === total - 1}
          onClick={() => onMove(compilationId, track.id, 1)}
          type="button"
        >
          <ArrowDown size={14} />
        </button>
        <button
          aria-label="Quitar cancion"
          className="is-danger"
          onClick={() => onRemove(compilationId, track.id)}
          type="button"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </article>
  );
}

function AdminTrackGroup({
  icon,
  onMoveDown,
  onMoveUp,
  onRemove,
  onUpdate,
  rhythmOptions,
  title,
  tracks,
}: {
  icon: ReactNode;
  onMoveDown: (trackId: string) => void;
  onMoveUp: (trackId: string) => void;
  onRemove: (trackId: string) => void;
  onUpdate: (trackId: string, field: EditableTrackField, value: string) => void;
  rhythmOptions: string[];
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
              Ritmo
              <select
                onChange={(event) => onUpdate(track.id, "mood", event.target.value)}
                value={track.mood}
              >
                {rhythmOptions.map((rhythm) => (
                  <option key={rhythm} value={rhythm}>
                    {rhythm}
                  </option>
                ))}
              </select>
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
