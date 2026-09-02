export const DJ_CARLOS_LOGO_URL = "/artist/dj-carlos-jimenez/logo.png";
export const DJ_CARLOS_PAGE_STORAGE_KEY =
  "first-listen:dj-carlos-jimenez-page-v1";

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

export const defaultDjCarlosTracks: DjCarlosTrack[] = [
  fallbackTrack({
    badge: "Album Focus",
    id: "dj-carlos-sin-ti-2026",
    link: "https://music.youtube.com/watch?v=EUUVIce6lO0",
    platform: "YouTube Music",
    subtitle: "Destacada por First Listen",
    title: "Sin Ti (Cumbia Sonidera ver 2026)",
  }),
  fallbackTrack({
    id: "dj-carlos-si-ya-te-vas",
    link: "https://www.youtube.com/watch?v=cZ4JIjUWCFo",
    mood: "Regional mexicano",
    subtitle: "YouTube / tema sugerido",
    title: "Si Ya Te Vas",
  }),
  fallbackTrack({
    id: "dj-carlos-no-me-mires-asi",
    link: "https://www.youtube.com/watch?v=Tl1YrfQ9bkY",
    mood: "Cumbia Sonidera",
    subtitle: "YouTube / tema sugerido",
    title: "No Me Mires Asi",
  }),
  fallbackTrack({
    id: "dj-carlos-llegaste-tu",
    link: "https://www.youtube.com/watch?v=QmpcSnVm1gA",
    mood: "Romantica",
    subtitle: "YouTube / tema sugerido",
    title: "Llegaste Tu",
  }),
  fallbackTrack({
    id: "dj-carlos-ya-te-vieron",
    link: "https://www.youtube.com/watch?v=JIVvsdGmmX0",
    mood: "Cumbia Sonidera",
    subtitle: "YouTube / tema sugerido",
    title: "Ya Te Vieron",
  }),
  fallbackTrack({
    id: "dj-carlos-te-amo-ya-no-dice-nada",
    link: "https://www.youtube.com/watch?v=MVql92agP5w",
    mood: "Romantica",
    subtitle: "YouTube / tema sugerido",
    title: "Te Amo Ya No Dice Nada",
  }),
  fallbackTrack({
    id: "dj-carlos-que-mala-costumbre",
    link: "https://www.youtube.com/watch?v=Bw4WHeM9Q7I",
    mood: "Cumbia Sonidera",
    subtitle: "YouTube / tema sugerido",
    title: "Que Mala Costumbre",
  }),
  fallbackTrack({
    id: "dj-carlos-soy-de-puebla",
    link: "https://www.youtube.com/watch?v=slnqptPrwdc",
    mood: "Cumbia Sonidera",
    subtitle: "YouTube / tema sugerido",
    title: "Soy De Puebla",
  }),
  fallbackTrack({
    id: "dj-carlos-todo-lo-que-no-te-dije",
    link: "https://www.youtube.com/watch?v=eDPD3kpQsEc",
    mood: "Regional mexicano",
    subtitle: "YouTube / tema sugerido",
    title: "Todo Lo Que No Te Dije",
  }),
  fallbackTrack({
    id: "dj-carlos-ya-ando-con-otra",
    link: "https://www.youtube.com/watch?v=QAabrqX7XjM",
    mood: "Regional mexicano",
    subtitle: "YouTube / tema sugerido",
    title: "Ya Ando Con Otra",
  }),
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

export function isPlayableDjCarlosLink(link: string) {
  const value = link.trim();
  return (
    /^https:\/\/music\.youtube\.com\/watch\?/i.test(value) ||
    /^https:\/\/(www\.)?youtube\.com\/watch\?/i.test(value) ||
    /^https:\/\/youtu\.be\//i.test(value)
  );
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
    coverUrl:
      typeof album.coverUrl === "string" && album.coverUrl.trim()
        ? album.coverUrl.trim()
        : fallback.coverUrl,
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

export function normalizeDjCarlosPageConfig(
  value: unknown,
  fallback: DjCarlosPageConfig = defaultDjCarlosPageConfig,
): DjCarlosPageConfig {
  if (!value || typeof value !== "object") return fallback;
  const config = value as Record<string, unknown>;
  const tracks = Array.isArray(config.tracks)
    ? config.tracks.filter(isDjCarlosTrack)
    : fallback.tracks;

  return {
    album: cleanAlbum(config.album, fallback.album),
    tracks: tracks.length ? tracks : fallback.tracks,
    updatedAt:
      typeof config.updatedAt === "string" && config.updatedAt.trim()
        ? config.updatedAt
        : fallback.updatedAt,
  };
}
