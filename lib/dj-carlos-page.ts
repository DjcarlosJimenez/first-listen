export const DJ_CARLOS_LOGO_URL = "/artist/dj-carlos-jimenez/logo.png";
export const DJ_CARLOS_PAGE_STORAGE_KEY =
  "first-listen:dj-carlos-jimenez-page-v2";

export type DjCarlosTrackSection = "album" | "top-ten" | "official-video";
export type DjCarlosPlayablePlatform = "YouTube" | "YouTube Music";

export type DjCarlosTrack = {
  albumId?: string;
  id: string;
  artist: string;
  badge: string;
  coverUrl: string;
  link: string;
  mood: string;
  platform: DjCarlosPlayablePlatform;
  release: string;
  section: DjCarlosTrackSection;
  subtitle: string;
  title: string;
};

export type DjCarlosAlbum = {
  id: string;
  slug: string;
  badge: string;
  coverUrl: string;
  description: string;
  link: string;
  subtitle: string;
  title: string;
};

export type DjCarlosUpcomingReactionKey = "waiting" | "video" | "favorite";

export type DjCarlosUpcomingSignals = {
  followers: number;
  reactions: Record<DjCarlosUpcomingReactionKey, number>;
};

export type DjCarlosUpcomingRelease = {
  enabled: boolean;
  badge: string;
  coverUrl: string;
  note: string;
  signals: DjCarlosUpcomingSignals;
  status: string;
  title: string;
  tracks: string[];
};

export type DjCarlosPageConfig = {
  album: DjCarlosAlbum;
  albums: DjCarlosAlbum[];
  tracks: DjCarlosTrack[];
  upcomingRelease: DjCarlosUpcomingRelease;
  updatedAt: string;
};

type DefaultSongSeed = {
  id: string;
  link: string;
  mood: string;
  platform?: DjCarlosPlayablePlatform;
  subtitle: string;
  title: string;
};

export const defaultDjCarlosAlbum: DjCarlosAlbum = {
  id: "sonidero-2027",
  slug: "sonidero-2027",
  badge: "Nuevo album",
  coverUrl: DJ_CARLOS_LOGO_URL,
  description:
    "Cumbia sonidera con identidad de DJ, compositor y pista: una entrada directa para que el publico llegue a reproducir sin friccion.",
  link: "https://music.youtube.com/watch?v=EUUVIce6lO0",
  subtitle:
    "Reproductor arriba, album en orden y videos oficiales en una pagina propia.",
  title: "SONIDERO 2027",
};

export function slugifyDjCarlosAlbumTitle(
  title: string,
  fallback = "album",
) {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return slug || fallback;
}

export function getDjCarlosYouTubeVideoId(link: string) {
  try {
    const url = new URL(link.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathParts = url.pathname.split("/").filter(Boolean);
    let videoId: string | null = null;

    if (host === "youtu.be") {
      videoId = pathParts[0] ?? null;
    } else if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com"
    ) {
      if (url.pathname === "/watch") {
        videoId = url.searchParams.get("v");
      } else if (pathParts[0] === "shorts" || pathParts[0] === "embed") {
        videoId = pathParts[1] ?? null;
      }
    }

    if (!videoId || !/^[A-Za-z0-9_-]{6,}$/.test(videoId)) return null;
    return videoId;
  } catch {
    return null;
  }
}

export function getDjCarlosTrackThumbnail(link: string) {
  const videoId = getDjCarlosYouTubeVideoId(link);
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}

function fallbackTrack({
  albumId,
  badge = "Top Ten",
  coverUrl,
  id,
  link,
  mood = "Cumbia Sonidera",
  platform = "YouTube",
  release = "Destacadas por First Listen",
  section = "top-ten",
  subtitle,
  title,
}: {
  albumId?: string;
  badge?: string;
  coverUrl?: string;
  id: string;
  link: string;
  mood?: string;
  platform?: DjCarlosPlayablePlatform;
  release?: string;
  section?: DjCarlosTrackSection;
  subtitle: string;
  title: string;
}): DjCarlosTrack {
  return {
    albumId,
    id,
    artist: "DJ Carlos Jimenez Compositor",
    badge,
    coverUrl: cleanDjCarlosImageUrl(
      coverUrl,
      getDjCarlosTrackThumbnail(link) ?? DJ_CARLOS_LOGO_URL,
    ),
    link,
    mood,
    platform,
    release,
    section,
    subtitle,
    title,
  };
}

const defaultSongSeeds: DefaultSongSeed[] = [
  {
    id: "sin-ti-2026",
    link: "https://music.youtube.com/watch?v=EUUVIce6lO0",
    mood: "Cumbia Sonidera",
    platform: "YouTube Music" as const,
    subtitle: "Destacada por First Listen",
    title: "Sin Ti (Cumbia Sonidera ver 2026)",
  },
  {
    id: "si-ya-te-vas",
    link: "https://www.youtube.com/watch?v=cZ4JIjUWCFo",
    mood: "Regional mexicano",
    subtitle: "YouTube / tema sugerido",
    title: "Si Ya Te Vas",
  },
  {
    id: "no-me-mires-asi",
    link: "https://www.youtube.com/watch?v=Tl1YrfQ9bkY",
    mood: "Cumbia Sonidera",
    subtitle: "YouTube / tema sugerido",
    title: "No Me Mires Asi",
  },
  {
    id: "llegaste-tu",
    link: "https://www.youtube.com/watch?v=QmpcSnVm1gA",
    mood: "Romantica",
    subtitle: "YouTube / tema sugerido",
    title: "Llegaste Tu",
  },
  {
    id: "ya-te-vieron",
    link: "https://www.youtube.com/watch?v=JIVvsdGmmX0",
    mood: "Cumbia Sonidera",
    subtitle: "YouTube / tema sugerido",
    title: "Ya Te Vieron",
  },
  {
    id: "te-amo-ya-no-dice-nada",
    link: "https://www.youtube.com/watch?v=MVql92agP5w",
    mood: "Romantica",
    subtitle: "YouTube / tema sugerido",
    title: "Te Amo Ya No Dice Nada",
  },
  {
    id: "que-mala-costumbre",
    link: "https://www.youtube.com/watch?v=Bw4WHeM9Q7I",
    mood: "Cumbia Sonidera",
    subtitle: "YouTube / tema sugerido",
    title: "Que Mala Costumbre",
  },
  {
    id: "soy-de-puebla",
    link: "https://www.youtube.com/watch?v=slnqptPrwdc",
    mood: "Cumbia Sonidera",
    subtitle: "YouTube / tema sugerido",
    title: "Soy De Puebla",
  },
  {
    id: "todo-lo-que-no-te-dije",
    link: "https://www.youtube.com/watch?v=eDPD3kpQsEc",
    mood: "Regional mexicano",
    subtitle: "YouTube / tema sugerido",
    title: "Todo Lo Que No Te Dije",
  },
  {
    id: "ya-ando-con-otra",
    link: "https://www.youtube.com/watch?v=QAabrqX7XjM",
    mood: "Regional mexicano",
    subtitle: "YouTube / tema sugerido",
    title: "Ya Ando Con Otra",
  },
];

const defaultAlbumTracks = defaultSongSeeds.map((song) =>
  fallbackTrack({
    albumId: defaultDjCarlosAlbum.id,
    badge: "Album",
    id: `dj-carlos-album-${song.id}`,
    link: song.link,
    mood: song.mood,
    platform: song.platform ?? "YouTube",
    release: defaultDjCarlosAlbum.title,
    section: "album",
    subtitle: defaultDjCarlosAlbum.title,
    title: song.title,
  }),
);

const defaultTopTenTracks = defaultSongSeeds.map((song, index) =>
  fallbackTrack({
    badge: index === 0 ? "Album Focus" : "Top Ten",
    id: `dj-carlos-top-ten-${song.id}`,
    link: song.link,
    mood: song.mood,
    platform: song.platform ?? "YouTube",
    release: "Destacadas por First Listen",
    section: "top-ten",
    subtitle: song.subtitle,
    title: song.title,
  }),
);

export const defaultDjCarlosTracks: DjCarlosTrack[] = [
  ...defaultAlbumTracks,
  ...defaultTopTenTracks,
  fallbackTrack({
    badge: "YouTube",
    id: "dj-carlos-sin-ti-video",
    link: "https://www.youtube.com/watch?v=EUUVIce6lO0",
    mood: "Video musical",
    section: "official-video",
    subtitle: "Video en YouTube",
    title: "Sin Ti",
  }),
  fallbackTrack({
    badge: "YouTube",
    id: "dj-carlos-siempre-sales-tarde-remix",
    link: "https://www.youtube.com/watch?v=iT1GFIgKHmk",
    mood: "Video musical",
    section: "official-video",
    subtitle: "Video en YouTube",
    title: "Siempre Sales Tarde (Remix)",
  }),
  fallbackTrack({
    badge: "YouTube",
    id: "dj-carlos-a-la-madre",
    link: "https://www.youtube.com/watch?v=Bclyd0X4-lM",
    mood: "Video musical",
    section: "official-video",
    subtitle: "Video en YouTube",
    title: "A la Madre (Para Mama)",
  }),
];

export const defaultDjCarlosPageConfig: DjCarlosPageConfig = {
  album: defaultDjCarlosAlbum,
  albums: [defaultDjCarlosAlbum],
  tracks: defaultDjCarlosTracks,
  upcomingRelease: {
    badge: "Exclusivo aqui",
    coverUrl: DJ_CARLOS_LOGO_URL,
    enabled: true,
    note:
      "Sigue el progreso del proximo album antes de que la musica salga oficialmente.",
    signals: {
      followers: 0,
      reactions: {
        favorite: 0,
        video: 0,
        waiting: 0,
      },
    },
    status: "En preparacion",
    title: "Nuevo album en proceso",
    tracks: [
      "Titulo por confirmar",
      "Cumbia sonidera nueva",
      "Tema romantico",
      "Cancion para bailar",
    ],
  },
  updatedAt: "2026-09-02T00:00:00.000Z",
};

export function labelForDjCarlosTrackSection(section: DjCarlosTrackSection) {
  if (section === "album") return "Album";
  if (section === "official-video") return "Video Oficial";
  return "Top Ten";
}

export function sectionBadge(section: DjCarlosTrackSection) {
  if (section === "album") return "Album";
  if (section === "official-video") return "YouTube";
  return "Top Ten";
}

export function detectDjCarlosPlatform(link: string): DjCarlosPlayablePlatform {
  return link.includes("music.youtube.com") ? "YouTube Music" : "YouTube";
}

function cleanDjCarlosImageUrl(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const imageUrl = value.trim();
  if (!imageUrl) return fallback;
  if (imageUrl.startsWith("data:")) return fallback;
  if (imageUrl.startsWith("/")) return imageUrl;
  try {
    const url = new URL(imageUrl);
    return url.protocol === "https:" ? imageUrl : fallback;
  } catch {
    return fallback;
  }
}

export function isPlayableDjCarlosLink(link: string) {
  try {
    const url = new URL(link.trim());
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.toLowerCase();
    const hasVideo = Boolean(url.searchParams.get("v"));
    const hasPlaylist = Boolean(url.searchParams.get("list"));

    if (host === "music.youtube.com") {
      return (path === "/watch" && (hasVideo || hasPlaylist)) || (path === "/playlist" && hasPlaylist);
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      return (
        (path === "/watch" && (hasVideo || hasPlaylist)) ||
        (path === "/playlist" && hasPlaylist) ||
        path.startsWith("/shorts/")
      );
    }
    return host === "youtu.be" && url.pathname.split("/").filter(Boolean).length === 1;
  } catch {
    return false;
  }
}

export function isDjCarlosTrack(value: unknown): value is DjCarlosTrack {
  if (!value || typeof value !== "object") return false;
  const track = value as Record<string, unknown>;
  return (
    typeof track.id === "string" &&
    typeof track.title === "string" &&
    typeof track.link === "string" &&
    (track.platform === "YouTube" || track.platform === "YouTube Music") &&
    (track.section === "album" ||
      track.section === "top-ten" ||
      track.section === "official-video")
  );
}

function cleanAlbum(value: unknown, fallback: DjCarlosAlbum): DjCarlosAlbum {
  if (!value || typeof value !== "object") return fallback;
  const album = value as Record<string, unknown>;
  const title =
    typeof album.title === "string" && album.title.trim()
      ? album.title.trim()
      : fallback.title;
  const fallbackSlug = fallback.slug || slugifyDjCarlosAlbumTitle(fallback.title);
  const idSource =
    typeof album.id === "string" && album.id.trim()
      ? album.id.trim()
      : fallback.id || fallbackSlug;
  const slugSource =
    typeof album.slug === "string" && album.slug.trim()
      ? album.slug.trim()
      : title;

  return {
    id: slugifyDjCarlosAlbumTitle(idSource, fallbackSlug),
    slug: slugifyDjCarlosAlbumTitle(slugSource, fallbackSlug),
    badge:
      typeof album.badge === "string" && album.badge.trim()
        ? album.badge.trim()
        : fallback.badge,
    coverUrl: cleanDjCarlosImageUrl(album.coverUrl, fallback.coverUrl),
    description:
      typeof album.description === "string" && album.description.trim()
        ? album.description.trim()
        : fallback.description,
    link:
      typeof album.link === "string"
        ? album.link.trim()
        : fallback.link,
    subtitle:
      typeof album.subtitle === "string" && album.subtitle.trim()
        ? album.subtitle.trim()
        : fallback.subtitle,
    title,
  };
}

function cleanCount(value: unknown) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.floor(count);
}

export function normalizeDjCarlosUpcomingSignals(
  value: unknown,
  fallback: DjCarlosUpcomingSignals =
    defaultDjCarlosPageConfig.upcomingRelease.signals,
): DjCarlosUpcomingSignals {
  const signals =
    value && typeof value === "object" ? value as Record<string, unknown> : {};
  const reactions =
    signals.reactions && typeof signals.reactions === "object"
      ? signals.reactions as Record<string, unknown>
      : {};

  return {
    followers: cleanCount(signals.followers ?? fallback.followers),
    reactions: {
      favorite: cleanCount(reactions.favorite ?? fallback.reactions.favorite),
      video: cleanCount(reactions.video ?? fallback.reactions.video),
      waiting: cleanCount(reactions.waiting ?? fallback.reactions.waiting),
    },
  };
}

function cleanUpcomingRelease(
  value: unknown,
  fallback: DjCarlosUpcomingRelease,
): DjCarlosUpcomingRelease {
  const release =
    value && typeof value === "object" ? value as Record<string, unknown> : {};
  const hasTrackList = Array.isArray(release.tracks);
  const rawTracks: unknown[] = hasTrackList
    ? release.tracks as unknown[]
    : fallback.tracks;
  const tracks = rawTracks
    .map((track) => (typeof track === "string" ? track.trim() : ""))
    .filter(Boolean)
    .slice(0, 24);

  return {
    badge:
      typeof release.badge === "string" && release.badge.trim()
        ? release.badge.trim()
        : fallback.badge,
    coverUrl: cleanDjCarlosImageUrl(release.coverUrl, fallback.coverUrl),
    enabled:
      typeof release.enabled === "boolean"
        ? release.enabled
        : fallback.enabled,
    note:
      typeof release.note === "string" && release.note.trim()
        ? release.note.trim()
        : fallback.note,
    signals: normalizeDjCarlosUpcomingSignals(release.signals, fallback.signals),
    status:
      typeof release.status === "string" && release.status.trim()
        ? release.status.trim()
        : fallback.status,
    title:
      typeof release.title === "string" && release.title.trim()
        ? release.title.trim()
        : fallback.title,
    tracks: hasTrackList ? tracks : fallback.tracks,
  };
}

function uniqueAlbumSlug(baseSlug: string, usedSlugs: Set<string>) {
  let slug = baseSlug;
  let index = 2;
  while (usedSlugs.has(slug)) {
    slug = `${baseSlug}-${index}`;
    index += 1;
  }
  usedSlugs.add(slug);
  return slug;
}

function uniqueAlbumId(baseId: string, usedIds: Set<string>) {
  let id = baseId;
  let index = 2;
  while (usedIds.has(id)) {
    id = `${baseId}-${index}`;
    index += 1;
  }
  usedIds.add(id);
  return id;
}

function normalizeAlbums(
  config: Record<string, unknown>,
  fallback: DjCarlosPageConfig,
) {
  const fallbackAlbums = Array.isArray(fallback.albums) && fallback.albums.length
    ? fallback.albums
    : [fallback.album];
  const sourceAlbums =
    Array.isArray(config.albums) && config.albums.length
      ? config.albums
      : config.album
        ? [config.album]
        : fallbackAlbums;
  const usedIds = new Set<string>();
  const usedSlugs = new Set<string>();
  const albums = sourceAlbums
    .map((album, index) =>
      cleanAlbum(
        album,
        fallbackAlbums[index] ??
          {
            ...fallback.album,
            id: `album-${index + 1}`,
            slug: `album-${index + 1}`,
          },
      ),
    )
    .map((album) => {
      const id = uniqueAlbumId(album.id, usedIds);
      const slug = uniqueAlbumSlug(album.slug, usedSlugs);
      return { ...album, id, slug };
    });

  return albums.length ? albums : fallbackAlbums;
}

function cleanTrack(
  track: DjCarlosTrack,
  fallbackCoverUrl: string,
  albumId?: string,
): DjCarlosTrack {
  const thumbnailUrl = getDjCarlosTrackThumbnail(track.link);
  return {
    ...track,
    albumId: track.section === "album" ? albumId : undefined,
    coverUrl: thumbnailUrl ?? cleanDjCarlosImageUrl(track.coverUrl, fallbackCoverUrl),
    platform:
      track.section === "official-video"
        ? "YouTube"
        : detectDjCarlosPlatform(track.link),
  };
}

export function normalizeDjCarlosPageConfig(
  value: unknown,
  fallback: DjCarlosPageConfig = defaultDjCarlosPageConfig,
): DjCarlosPageConfig {
  if (!value || typeof value !== "object") return fallback;
  const config = value as Record<string, unknown>;
  const albums = normalizeAlbums(config, fallback);
  const primaryAlbum = albums[0] ?? fallback.album;
  const albumIds = new Set(albums.map((album) => album.id));
  const rawTracks = Array.isArray(config.tracks)
    ? config.tracks.filter(isDjCarlosTrack)
    : fallback.tracks;
  const tracks = rawTracks.map((track) => {
    const requestedAlbumId =
      typeof track.albumId === "string" && track.albumId.trim()
        ? track.albumId.trim()
        : primaryAlbum.id;
    const albumId = albumIds.has(requestedAlbumId)
      ? requestedAlbumId
      : primaryAlbum.id;
    const album = albums.find((item) => item.id === albumId) ?? primaryAlbum;
    return cleanTrack(track, album.coverUrl, albumId);
  });

  return {
    album: primaryAlbum,
    albums,
    tracks: tracks.length ? tracks : fallback.tracks,
    upcomingRelease: cleanUpcomingRelease(
      config.upcomingRelease,
      fallback.upcomingRelease,
    ),
    updatedAt:
      typeof config.updatedAt === "string" && config.updatedAt.trim()
        ? config.updatedAt
        : fallback.updatedAt,
  };
}

export function tracksForDjCarlosAlbum(
  config: DjCarlosPageConfig,
  albumId: string,
) {
  return config.tracks.filter(
    (track) => track.section === "album" && track.albumId === albumId,
  );
}
