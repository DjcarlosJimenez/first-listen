import {
  getDjCarlosYouTubeVideoId,
  isPlayableDjCarlosLink,
  slugifyDjCarlosAlbumTitle,
} from "@/lib/dj-carlos-page";

export type ArtistSiteTrack = {
  id: string;
  title: string;
  link: string;
  rhythm: string;
};

export type ArtistSiteAlbum = {
  id: string;
  slug: string;
  title: string;
  description: string;
  coverUrl: string;
  rhythm: string;
  tracks: ArtistSiteTrack[];
};

export type ArtistSiteConfig = {
  tagline: string;
  logoUrl: string;
  portraitUrl: string;
  accentColor: string;
  albums: ArtistSiteAlbum[];
  topTenIds: string[];
  videos: ArtistSiteTrack[];
  upcoming: {
    enabled: boolean;
    title: string;
    note: string;
    coverUrl: string;
    songs: string[];
  };
};

export type ArtistSiteRow = {
  id: string;
  slug: string;
  name: string;
  owner_user_id: string | null;
  published: boolean;
  sort_order: number;
  config: unknown;
  created_at: string;
  updated_at: string;
};

const MAX_ALBUMS = 40;
const MAX_TRACKS_PER_ALBUM = 150;
const MAX_VIDEOS = 80;

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanId(value: unknown, fallback: string) {
  const id = cleanText(value, 80);
  return /^[a-zA-Z0-9-]+$/.test(id) ? id : fallback;
}

function cleanImageUrl(value: unknown) {
  const url = cleanText(value, 2048);
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    return new URL(url).protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}

function cleanTrack(value: unknown, fallbackId: string): ArtistSiteTrack {
  const track = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const link = cleanText(track.link, 2048);
  return {
    id: cleanId(track.id, fallbackId),
    title: cleanText(track.title, 160),
    link: isPlayableDjCarlosLink(link) ? link : "",
    rhythm: cleanText(track.rhythm, 80),
  };
}

export function emptyArtistSiteConfig(): ArtistSiteConfig {
  return {
    tagline: "",
    logoUrl: "",
    portraitUrl: "",
    accentColor: "#FFD565",
    albums: [],
    topTenIds: [],
    videos: [],
    upcoming: {
      enabled: false,
      title: "",
      note: "",
      coverUrl: "",
      songs: [],
    },
  };
}

export function normalizeArtistSiteConfig(value: unknown): ArtistSiteConfig {
  const source = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const upcoming = source.upcoming && typeof source.upcoming === "object"
    ? source.upcoming as Record<string, unknown>
    : {};
  const usedAlbumIds = new Set<string>();
  const usedAlbumSlugs = new Set<string>();
  const usedTrackIds = new Set<string>();
  const albums = (Array.isArray(source.albums) ? source.albums : [])
    .slice(0, MAX_ALBUMS)
    .map((value, albumIndex) => {
      const album = value && typeof value === "object"
        ? value as Record<string, unknown>
        : {};
      const title = cleanText(album.title, 160);
      const idBase = cleanId(album.id, `album-${albumIndex + 1}`);
      let id = idBase;
      for (let suffix = 2; usedAlbumIds.has(id); suffix += 1) id = `${idBase}-${suffix}`;
      usedAlbumIds.add(id);
      const slugBase = slugifyDjCarlosAlbumTitle(
        cleanText(album.slug, 100) || title || id,
        id,
      );
      let slug = slugBase;
      for (let suffix = 2; usedAlbumSlugs.has(slug); suffix += 1) slug = `${slugBase}-${suffix}`;
      usedAlbumSlugs.add(slug);
      const tracks = (Array.isArray(album.tracks) ? album.tracks : [])
        .slice(0, MAX_TRACKS_PER_ALBUM)
        .map((track, trackIndex) => {
          const clean = cleanTrack(track, `${id}-track-${trackIndex + 1}`);
          const base = clean.id;
          let trackId = base;
          for (let suffix = 2; usedTrackIds.has(trackId); suffix += 1) trackId = `${base}-${suffix}`;
          usedTrackIds.add(trackId);
          return { ...clean, id: trackId };
        });
      return {
        id,
        slug,
        title,
        description: cleanText(album.description, 1000),
        coverUrl: cleanImageUrl(album.coverUrl),
        rhythm: cleanText(album.rhythm, 80),
        tracks,
      };
    });
  const videos = (Array.isArray(source.videos) ? source.videos : [])
    .slice(0, MAX_VIDEOS)
    .map((video, index) => {
      const clean = cleanTrack(video, `video-${index + 1}`);
      const base = clean.id;
      let id = base;
      for (let suffix = 2; usedTrackIds.has(id); suffix += 1) id = `${base}-${suffix}`;
      usedTrackIds.add(id);
      return { ...clean, id };
    });
  const songIds = new Set(albums.flatMap((album) => album.tracks.map((track) => track.id)));
  const topTenIds = [...new Set(
    (Array.isArray(source.topTenIds) ? source.topTenIds : [])
      .filter((id): id is string => typeof id === "string" && songIds.has(id)),
  )].slice(0, 10);
  const accentColor = cleanText(source.accentColor, 7);

  return {
    tagline: cleanText(source.tagline, 240),
    logoUrl: cleanImageUrl(source.logoUrl),
    portraitUrl: cleanImageUrl(source.portraitUrl),
    accentColor: /^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : "#FFD565",
    albums,
    topTenIds,
    videos,
    upcoming: {
      enabled: upcoming.enabled === true,
      title: cleanText(upcoming.title, 160),
      note: cleanText(upcoming.note, 1000),
      coverUrl: cleanImageUrl(upcoming.coverUrl),
      songs: (Array.isArray(upcoming.songs) ? upcoming.songs : [])
        .map((song) => cleanText(song, 160))
        .filter(Boolean)
        .slice(0, 40),
    },
  };
}

export function artistSiteThumbnail(link: string) {
  const videoId = getDjCarlosYouTubeVideoId(link);
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";
}
