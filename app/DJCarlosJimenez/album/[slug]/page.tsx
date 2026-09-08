import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { DjCarlosArtistPage } from "@/components/dj-carlos-artist-page";
import { DJ_CARLOS_LOGO_URL } from "@/lib/dj-carlos-page";
import { readDjCarlosPageConfig } from "@/lib/dj-carlos-page-store";
import {
  findPublicArtistPageByHost,
  PUBLIC_ARTIST_HOST_HEADER,
  publicArtistUrlFor,
} from "@/lib/public-artist-pages";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function wantsLocalPreview(
  searchParams?: Record<string, string | string[] | undefined>,
) {
  const value = searchParams?.localPreview;
  return Array.isArray(value) ? value.includes("1") : value === "1";
}

const artistIcons = {
  apple: [
    {
      sizes: "192x192",
      type: "image/png",
      url: "/artist/dj-carlos-jimenez/icon-192.png",
    },
  ],
  icon: [
    {
      sizes: "192x192",
      type: "image/png",
      url: "/artist/dj-carlos-jimenez/icon-192.png",
    },
  ],
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const config = await readDjCarlosPageConfig();
  const album = config.albums.find((item) => item.slug === slug);

  if (!album) {
    return {
      title: "Album DJ Carlos Jimenez | First Listen",
    };
  }

  const headerStore = await headers();
  const artistRoute = findPublicArtistPageByHost(
    headerStore.get(PUBLIC_ARTIST_HOST_HEADER) ?? headerStore.get("host"),
  );
  const onArtistHost = artistRoute?.kind === "dj-carlos";

  return {
    alternates: {
      canonical: onArtistHost
        ? publicArtistUrlFor(artistRoute, ["album", album.slug])
        : `https://www.firstlisten.net/DJCarlosJimenez/album/${album.slug}`,
    },
    applicationName: "DJ Carlos Jimenez",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "DJ Carlos",
    },
    description: album.description,
    icons: artistIcons,
    manifest: onArtistHost ? "/manifest.webmanifest" : "/DJCarlosJimenez/manifest.webmanifest",
    title: `${album.title} | DJ Carlos Jimenez`,
  };
}

export default async function DjCarlosAlbumPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const initialConfig = await readDjCarlosPageConfig();
  const album = initialConfig.albums.find((item) => item.slug === slug);

  if (!album && !wantsLocalPreview(query)) notFound();

  return (
    <DjCarlosArtistPage
      initialAlbumSlug={slug}
      initialConfig={initialConfig}
      logoUrl={DJ_CARLOS_LOGO_URL}
    />
  );
}
