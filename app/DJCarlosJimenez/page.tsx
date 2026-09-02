import type { Metadata } from "next";
import { DjCarlosArtistPage } from "@/components/dj-carlos-artist-page";
import {
  DJ_CARLOS_LOGO_URL,
  defaultDjCarlosPageConfig,
  type DjCarlosPageConfig,
  type DjCarlosTrack,
} from "@/lib/dj-carlos-page";
import { platformLabels } from "@/lib/discovery";
import { safeCoverUrl } from "@/lib/media";
import { createClient } from "@/lib/supabase/server";
import type { Platform } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "DJ Carlos Jimenez | First Listen",
  description:
    "Pagina oficial de DJ Carlos Jimenez en First Listen, con reproductor, album, Top Ten y videos oficiales.",
  manifest: "/DJCarlosJimenez/manifest.webmanifest",
  applicationName: "DJ Carlos Jimenez",
  appleWebApp: {
    capable: true,
    title: "DJ Carlos",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      {
        url: "/artist/dj-carlos-jimenez/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/artist/dj-carlos-jimenez/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
  },
};

type ArtistSongRow = {
  id: string;
  title: string | null;
  artist_name: string | null;
  platform: string | null;
  music_url: string | null;
  cover_image_url: string | null;
  genre: string | null;
  song_language: string | null;
  created_at: string | null;
  featured: boolean | null;
  content_kind: string | null;
};

function normalizePlatform(value: string | null): Platform {
  const raw = String(value ?? "").trim();
  if (platformLabels[raw]) return platformLabels[raw];
  if (raw === "YouTube" || raw === "YouTube Music") return raw;
  return "YouTube Music";
}

function toArtistTrack(row: ArtistSongRow, index: number): DjCarlosTrack | null {
  const link = String(row.music_url ?? "").trim();
  if (!link) return null;

  const platform = normalizePlatform(row.platform);
  if (platform !== "YouTube Music" && platform !== "YouTube") return null;

  const isVideo =
    platform === "YouTube" ||
    String(row.content_kind ?? "").toLowerCase().includes("video") ||
    String(row.title ?? "").toLowerCase().includes("video");

  return {
    id: row.id,
    artist: row.artist_name?.trim() || "DJ Carlos Jimenez Compositor",
    badge: isVideo ? "Video Oficial" : index === 0 ? "Album Focus" : "Top Ten",
    coverUrl: safeCoverUrl(row.cover_image_url || DJ_CARLOS_LOGO_URL),
    link,
    mood: row.genre?.trim() || "Cumbia Sonidera",
    platform,
    release: defaultDjCarlosPageConfig.album.title,
    section: isVideo ? "official-video" : "top-ten",
    subtitle: row.song_language?.trim()
      ? `${row.song_language} / ${row.genre ?? "DJ Carlos Jimenez"}`
      : row.genre?.trim() || "DJ Carlos Jimenez",
    title: row.title?.trim() || "Cancion de DJ Carlos Jimenez",
  };
}

async function getDjCarlosConfig(): Promise<DjCarlosPageConfig> {
  let data: ArtistSongRow[] | null = null;

  try {
    const supabase = await createClient();
    const result = await supabase
      .from("songs")
      .select(
        "id,title,artist_name,platform,music_url,cover_image_url,genre,song_language,created_at,featured,content_kind",
      )
      .or(
        "artist_name.ilike.%Carlos Jimenez%,artist_name.ilike.%Carlos Jiménez%,artist_name.ilike.%DjcarlosJimenez%",
      )
      .eq("is_active", true)
      .is("archived_at", null)
      .is("removed_at", null)
      .order("featured", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(30)
      .abortSignal(AbortSignal.timeout(350));

    data = result.error ? null : ((result.data ?? []) as ArtistSongRow[]);
  } catch {
    data = null;
  }

  const tracks = (data ?? [])
    .map(toArtistTrack)
    .filter((track): track is DjCarlosTrack => Boolean(track));

  if (!tracks.length) return defaultDjCarlosPageConfig;

  return {
    ...defaultDjCarlosPageConfig,
    tracks,
    updatedAt: new Date().toISOString(),
  };
}

export default async function DjCarlosJimenezPage() {
  const initialConfig = await getDjCarlosConfig();

  return (
    <DjCarlosArtistPage
      initialConfig={initialConfig}
      logoUrl={DJ_CARLOS_LOGO_URL}
    />
  );
}
