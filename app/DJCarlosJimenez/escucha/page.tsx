import type { Metadata } from "next";
import { headers } from "next/headers";
import { ArtistLinkHubPage } from "@/components/artist-link-hub";
import {
  DJ_CARLOS_LOGO_URL,
  normalizeDjCarlosPageConfig,
} from "@/lib/dj-carlos-page";
import djCarlosProductionSnapshot from "@/lib/dj-carlos-page-production-snapshot.json";
import { readDjCarlosPageConfig } from "@/lib/dj-carlos-page-store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: {
    canonical: "https://www.firstlisten.net/DJCarlosJimenez/escucha",
  },
  description: "Enlaces oficiales para escuchar la musica de DJ Carlos Jimenez.",
  title: "Escucha a DJ Carlos Jimenez | First Listen",
};

export default async function DjCarlosListenPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const headerStore = await headers();
  const host = (headerStore.get("host") ?? "").toLowerCase();
  const localPreview = params.localPreview;
  const useProductionSnapshot =
    (host.startsWith("127.0.0.1") || host.startsWith("localhost")) &&
    (localPreview === "1" ||
      (Array.isArray(localPreview) && localPreview.includes("1")));
  const config = useProductionSnapshot
    ? normalizeDjCarlosPageConfig(djCarlosProductionSnapshot)
    : await readDjCarlosPageConfig();

  return (
    <ArtistLinkHubPage
      accentColor="#2ee8ff"
      artistLogoUrl={config.identity.logoUrl || DJ_CARLOS_LOGO_URL}
      artistName="DJ Carlos Jimenez"
      artistPortraitUrl={
        config.identity.showPortrait ? config.identity.portraitUrl : undefined
      }
      artistUrl="/DJCarlosJimenez"
      links={config.platformLinks}
    />
  );
}
