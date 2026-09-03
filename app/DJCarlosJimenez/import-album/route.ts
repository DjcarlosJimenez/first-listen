import { NextRequest, NextResponse } from "next/server";
import {
  DJ_CARLOS_ADMIN_COOKIE_NAME,
  isDjCarlosAdminSession,
} from "@/lib/dj-carlos-admin-auth";
import {
  detectDjCarlosPlatform,
  getDjCarlosTrackThumbnail,
  slugifyDjCarlosAlbumTitle,
  type DjCarlosTrack,
} from "@/lib/dj-carlos-page";

type ImportedAlbum = {
  badge: string;
  coverUrl: string;
  description: string;
  link: string;
  slug: string;
  subtitle: string;
  title: string;
};

const YOUTUBE_MUSIC_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return "";
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function readMetaContent(html: string, key: string) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyFirst = new RegExp(
    `<meta\\s+[^>]*(?:name|property)=["']${escapedKey}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    "i",
  );
  const contentFirst = new RegExp(
    `<meta\\s+[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${escapedKey}["'][^>]*>`,
    "i",
  );
  return cleanText(keyFirst.exec(html)?.[1] ?? contentFirst.exec(html)?.[1]);
}

function getPlaylistId(rawLink: string) {
  try {
    const url = new URL(rawLink.trim());
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      host !== "music.youtube.com" &&
      host !== "youtube.com" &&
      host !== "m.youtube.com"
    ) {
      return null;
    }

    const playlistId = url.searchParams.get("list")?.trim() ?? "";
    return /^[A-Za-z0-9_-]{6,}$/.test(playlistId) ? playlistId : null;
  } catch {
    return null;
  }
}

function decodeYouTubeJsString(value: string) {
  const jsonCompatible = value
    .replace(/\\x([0-9A-Fa-f]{2})/g, "\\u00$1")
    .replace(/\\([&'<>])/g, "$1")
    .replace(/"/g, "\\\"");

  return JSON.parse(`"${jsonCompatible}"`) as string;
}

function readInitialDataEntries(html: string) {
  const entries: unknown[] = [];
  const pattern =
    /initialData\.push\(\{path: '((?:\\.|[^'])*)', params: JSON\.parse\('((?:\\.|[^'])*)'\), data: '((?:\\.|[^'])*)'\}\);/g;

  for (const match of html.matchAll(pattern)) {
    try {
      entries.push(JSON.parse(decodeYouTubeJsString(match[3])));
    } catch {
      continue;
    }
  }

  return entries;
}

function walkRecords(
  value: unknown,
  visit: (record: Record<string, unknown>) => void,
) {
  if (Array.isArray(value)) {
    value.forEach((item) => walkRecords(item, visit));
    return;
  }

  if (!isRecord(value)) return;
  visit(value);

  Object.values(value).forEach((item) => walkRecords(item, visit));
}

function readRendererText(value: unknown) {
  if (!isRecord(value)) return "";
  if (typeof value.simpleText === "string") return cleanText(value.simpleText);
  if (!Array.isArray(value.runs)) return "";

  return cleanText(
    value.runs
      .map((run) => (isRecord(run) && typeof run.text === "string" ? run.text : ""))
      .join(""),
  );
}

function readFlexColumnText(item: Record<string, unknown>, index: number) {
  if (!Array.isArray(item.flexColumns)) return "";
  const column = item.flexColumns[index];
  if (!isRecord(column)) return "";
  const renderer = column.musicResponsiveListItemFlexColumnRenderer;
  if (!isRecord(renderer)) return "";
  return readRendererText(renderer.text);
}

function collectMusicItems(entries: unknown[]) {
  const items: Record<string, unknown>[] = [];

  entries.forEach((entry) => {
    walkRecords(entry, (record) => {
      const renderer = record.musicResponsiveListItemRenderer;
      if (isRecord(renderer)) items.push(renderer);
    });
  });

  return items;
}

function collectWatchEndpoints(value: unknown) {
  const endpoints: Record<string, unknown>[] = [];

  walkRecords(value, (record) => {
    const endpoint = record.watchEndpoint;
    if (isRecord(endpoint)) endpoints.push(endpoint);
  });

  return endpoints;
}

function videoIdForItem(item: Record<string, unknown>, playlistId: string) {
  const endpoints = collectWatchEndpoints(item);
  const preferred = endpoints.find(
    (endpoint) =>
      endpoint.playlistId === playlistId && typeof endpoint.videoId === "string",
  );
  const fallback = endpoints.find(
    (endpoint) => typeof endpoint.videoId === "string",
  );
  const videoId = preferred?.videoId ?? fallback?.videoId;

  return typeof videoId === "string" && /^[A-Za-z0-9_-]{6,}$/.test(videoId)
    ? videoId
    : null;
}

function importedAlbumTracks({
  albumId,
  albumTitle,
  entries,
  playlistId,
}: {
  albumId: string;
  albumTitle: string;
  entries: unknown[];
  playlistId: string;
}) {
  const seenVideoIds = new Set<string>();
  const safeAlbumId = slugifyDjCarlosAlbumTitle(albumId, "album");

  return collectMusicItems(entries)
    .map((item) => {
      const title = readFlexColumnText(item, 0);
      const videoId = videoIdForItem(item, playlistId);
      if (!title || !videoId || seenVideoIds.has(videoId)) return null;
      seenVideoIds.add(videoId);

      const link = `https://music.youtube.com/watch?v=${encodeURIComponent(
        videoId,
      )}&list=${encodeURIComponent(playlistId)}`;
      const track: DjCarlosTrack = {
        albumId,
        artist: "DJ Carlos Jimenez Compositor",
        badge: "Album",
        coverUrl: getDjCarlosTrackThumbnail(link) ?? "",
        id: `dj-carlos-import-${safeAlbumId}-${videoId}`,
        link,
        mood: "Album",
        platform: detectDjCarlosPlatform(link),
        release: albumTitle,
        section: "album",
        subtitle: albumTitle,
        title,
      };

      return track;
    })
    .filter((track): track is DjCarlosTrack => Boolean(track));
}

async function fetchYouTubeMusicAlbum(rawLink: string, albumId: string) {
  const playlistId = getPlaylistId(rawLink);
  if (!playlistId) {
    throw new Error("Pega un link de album o playlist de YouTube Music.");
  }

  const playlistUrl = `https://music.youtube.com/playlist?list=${encodeURIComponent(
    playlistId,
  )}`;
  const response = await fetch(playlistUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
      "User-Agent": YOUTUBE_MUSIC_USER_AGENT,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("YouTube Music no respondio al intentar leer el album.");
  }

  const html = await response.text();
  const albumTitle =
    readMetaContent(html, "title") ||
    readMetaContent(html, "og:title") ||
    "Album importado";
  const coverUrl =
    readMetaContent(html, "og:image") || readMetaContent(html, "twitter:image");
  const entries = readInitialDataEntries(html);
  const tracks = importedAlbumTracks({
    albumId,
    albumTitle,
    entries,
    playlistId,
  });
  const description = readMetaContent(html, "description");
  const album: ImportedAlbum = {
    badge: "Album",
    coverUrl,
    description:
      description ||
      `Album importado desde YouTube Music con ${tracks.length} canciones.`,
    link: rawLink.trim(),
    slug: slugifyDjCarlosAlbumTitle(albumTitle),
    subtitle: tracks.length
      ? `${tracks.length} canciones importadas desde YouTube Music.`
      : "Album importado desde YouTube Music.",
    title: albumTitle,
  };

  return {
    album,
    tracks,
    warning: tracks.length
      ? null
      : "Guarde el link del album, pero YouTube Music no entrego la lista de canciones.",
  };
}

export async function POST(request: NextRequest) {
  if (
    !isDjCarlosAdminSession(
      request.cookies.get(DJ_CARLOS_ADMIN_COOKIE_NAME)?.value,
    )
  ) {
    return NextResponse.json(
      { error: "Necesitas entrar al panel antes de importar un album." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const link = isRecord(body) && typeof body.link === "string"
    ? body.link.trim()
    : "";
  const albumId = isRecord(body) && typeof body.albumId === "string"
    ? body.albumId.trim()
    : "album";

  if (!link) {
    return NextResponse.json(
      { error: "Pega el link de compartir del album." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await fetchYouTubeMusicAlbum(link, albumId));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo importar el album ahora.",
      },
      { status: 400 },
    );
  }
}
