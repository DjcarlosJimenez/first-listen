import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FirstPublishLive } from "@/components/first-publish-live";
import { getFirstPublishLiveSong } from "@/lib/first-publish-live";
import type { FirstPublishLiveSong } from "@/lib/first-publish";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ songId: string }> };

const localPreviewSong: FirstPublishLiveSong = {
  artistName: "Artista de ejemplo",
  contentKind: "song",
  coverImageUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  genre: "Cumbia",
  id: "00000000-0000-4000-8000-000000000001",
  isOwner: true,
  musicUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  platform: "YouTube",
  reactions: { good_rhythm: 8, good_voice: 5, liked: 12, listen_again: 7 },
  retained: false,
  title: "Mi Primera Canción",
};

async function resolveSong(songId: string) {
  if (process.env.NODE_ENV === "development" && songId === "preview") {
    return localPreviewSong;
  }
  return getFirstPublishLiveSong(songId);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { songId } = await params;
  const song = await resolveSong(songId);
  if (!song) return { title: "Publicación no disponible | First Listen" };
  const title = `${song.title} · ${song.artistName}`;
  const description = `Escucha ${song.title} de ${song.artistName} y deja una reacción rápida en First Listen.`;
  const url = `https://www.firstlisten.net/first-publish/live/${song.id}`;
  const image = `https://www.firstlisten.net/api/first-publish/card/${song.id}`;
  return {
    alternates: { canonical: url },
    description,
    openGraph: { description, images: [{ height: 630, url: image, width: 1200 }], title, type: "music.song", url },
    title: `${title} | First Listen`,
    twitter: { card: "summary_large_image", description, images: [image], title },
  };
}

export default async function FirstPublishLivePage({ params }: PageProps) {
  const { songId } = await params;
  const song = await resolveSong(songId);
  if (!song) notFound();
  return <FirstPublishLive song={song} />;
}
