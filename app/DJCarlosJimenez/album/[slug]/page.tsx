import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DjCarlosArtistPage } from "@/components/dj-carlos-artist-page";
import { DJ_CARLOS_LOGO_URL } from "@/lib/dj-carlos-page";
import { readDjCarlosPageConfig } from "@/lib/dj-carlos-page-store";

export const dynamic = "force-dynamic";

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

  return {
    applicationName: "DJ Carlos Jimenez",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "DJ Carlos",
    },
    description: album.description,
    icons: artistIcons,
    manifest: "/DJCarlosJimenez/manifest.webmanifest",
    title: `${album.title} | DJ Carlos Jimenez`,
  };
}

export default async function DjCarlosAlbumPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const initialConfig = await readDjCarlosPageConfig();
  const album = initialConfig.albums.find((item) => item.slug === slug);

  if (!album) notFound();

  return (
    <DjCarlosArtistPage
      initialAlbumSlug={slug}
      initialConfig={initialConfig}
      logoUrl={DJ_CARLOS_LOGO_URL}
    />
  );
}
