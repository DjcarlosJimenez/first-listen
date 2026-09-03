export const DJ_CARLOS_LOGO_URL = "/artist/dj-carlos-jimenez/logo.png";
export const DJ_CARLOS_PAGE_STORAGE_KEY =
  "first-listen:dj-carlos-jimenez-page-v2";

export type DjCarlosTrackSection = "album" | "top-ten" | "official-video";
export type DjCarlosPlayablePlatform = "YouTube" | "YouTube Music";

export type DjCarlosTrack = {
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
  badge: string;
  coverUrl: string;
  description: string;
  link: string;
  subtitle: string;
  title: string;
};

export type DjCarlosPageConfig = {
  album: DjCarlosAlbum;
  tracks: DjCarlosTrack[];
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
  badge: "Nuevo album",
  coverUrl: DJ_CARLOS_LOGO_URL,
  description:
    "Cumbia sonidera con identidad de DJ, compositor y pista: una entrada directa para que el publico llegue a reproducir sin friccion.",
  link: "https://music.youtube.com/watch?v=EUUVIce6lO0",
  subtitle:
    "Reproductor arriba, album en orden y videos oficiales en una pagina propia.",
  title: "SONIDERO 2027",
};

function fallbackTrack({
  badge = "Top Ten",
  id,
  link,
  mood = "Cumbia Sonidera",
  platform = "YouTube",
  release = "Destacadas por First Listen",
  section = "top-ten",
  subtitle,
  title,
}: {
  badge?: string;
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
    id,
    artist: "DJ Carlos Jimenez Compositor",
    badge,
    coverUrl: DJ_CARLOS_LOGO_URL,
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
  tracks: defaultDjCarlosTracks,
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
  return {
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
      typeof album.link === "string" && album.link.trim()
        ? album.link.trim()
        : fallback.link,
    subtitle:
      typeof album.subtitle === "string" && album.subtitle.trim()
        ? album.subtitle.trim()
        : fallback.subtitle,
    title:
      typeof album.title === "string" && album.title.trim()
        ? album.title.trim()
        : fallback.title,
  };
}

function cleanTrack(track: DjCarlosTrack, fallbackCoverUrl: string): DjCarlosTrack {
  return {
    ...track,
    coverUrl: cleanDjCarlosImageUrl(track.coverUrl, fallbackCoverUrl),
  };
}

export function normalizeDjCarlosPageConfig(
  value: unknown,
  fallback: DjCarlosPageConfig = defaultDjCarlosPageConfig,
): DjCarlosPageConfig {
  if (!value || typeof value !== "object") return fallback;
  const config = value as Record<string, unknown>;
  const rawTracks = Array.isArray(config.tracks)
    ? config.tracks.filter(isDjCarlosTrack)
    : fallback.tracks;
  const fallbackAlbumTracks = fallback.tracks.filter(
    (track) => track.section === "album",
  );
  const fallbackTopTenTracks = fallback.tracks.filter(
    (track) => track.section === "top-ten",
  );
  const fallbackVideoTracks = fallback.tracks.filter(
    (track) => track.section === "official-video",
  );
  const albumTracks = rawTracks.filter((track) => track.section === "album");
  const topTenTracks = rawTracks.filter((track) => track.section === "top-ten");
  const videoTracks = rawTracks.filter(
    (track) => track.section === "official-video",
  );
  const tracks = [
    ...(albumTracks.length ? albumTracks : fallbackAlbumTracks),
    ...(topTenTracks.length ? topTenTracks : fallbackTopTenTracks),
    ...(videoTracks.length ? videoTracks : fallbackVideoTracks),
  ].map((track) => cleanTrack(track, fallback.album.coverUrl));

  return {
    album: cleanAlbum(config.album, fallback.album),
    tracks: tracks.length ? tracks : fallback.tracks,
    updatedAt:
      typeof config.updatedAt === "string" && config.updatedAt.trim()
        ? config.updatedAt
        : fallback.updatedAt,
  };
}
