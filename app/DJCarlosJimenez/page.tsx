import type { Metadata } from "next";
import { headers } from "next/headers";
import { DjCarlosArtistPage } from "@/components/dj-carlos-artist-page";
import {
  DJ_CARLOS_LOGO_URL,
  normalizeDjCarlosPageConfig,
} from "@/lib/dj-carlos-page";
import djCarlosProductionSnapshot from "@/lib/dj-carlos-page-production-snapshot.json";
import {
  readDjCarlosPageConfig,
  readDjCarlosVideoPlayCounts,
} from "@/lib/dj-carlos-page-store";
import {
  findPublicArtistPageByHost,
  PUBLIC_ARTIST_HOST_HEADER,
  publicArtistUrlFor,
} from "@/lib/public-artist-pages";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const headerStore = await headers();
  const artistRoute = findPublicArtistPageByHost(
    headerStore.get(PUBLIC_ARTIST_HOST_HEADER) ?? headerStore.get("host"),
  );
  const onArtistHost = artistRoute?.kind === "dj-carlos";

  return {
    alternates: {
      canonical: onArtistHost
        ? publicArtistUrlFor(artistRoute)
        : "https://www.firstlisten.net/DJCarlosJimenez",
    },
    title: "DJ Carlos Jimenez | First Listen",
    description:
      "Pagina oficial de DJ Carlos Jimenez en First Listen, con reproductor, album, Top Ten y videos oficiales.",
    manifest: onArtistHost ? "/manifest.webmanifest" : "/DJCarlosJimenez/manifest.webmanifest",
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
}

type DjCarlosJimenezPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DjCarlosJimenezPage({
  searchParams,
}: DjCarlosJimenezPageProps) {
  const headerStore = await headers();
  const params: Record<string, string | string[] | undefined> = searchParams
    ? await searchParams
    : {};
  const host = (headerStore.get("host") ?? "").toLowerCase();
  const localPreview = params.localPreview;
  const useProductionSnapshot =
    (host.startsWith("127.0.0.1") || host.startsWith("localhost")) &&
    (localPreview === "1" ||
      (Array.isArray(localPreview) && localPreview.includes("1")));
  const [initialConfig, initialVideoPlayCounts] = await Promise.all([
    useProductionSnapshot
      ? Promise.resolve(normalizeDjCarlosPageConfig(djCarlosProductionSnapshot))
      : readDjCarlosPageConfig(),
    readDjCarlosVideoPlayCounts(),
  ]);

  return (
    <DjCarlosArtistPage
      initialConfig={initialConfig}
      initialVideoPlayCounts={initialVideoPlayCounts}
      logoUrl={DJ_CARLOS_LOGO_URL}
    />
  );
}
