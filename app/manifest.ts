import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { createDjCarlosManifest } from "@/lib/dj-carlos-manifest";
import { findPublicArtistPageByHost } from "@/lib/public-artist-pages";
import { firstListenBrandAsset } from "@/lib/first-listen-brand";

export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const headerStore = await headers();
  const artistRoute = findPublicArtistPageByHost(headerStore.get("host"));
  if (artistRoute?.kind === "dj-carlos") {
    return createDjCarlosManifest({ rootScope: true });
  }

  return {
    id: "/",
    name: "First Listen",
    short_name: "First Listen",
    description:
      "Honest music feedback and verified listener support for independent artists.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui", "browser"],
    background_color: "#030812",
    theme_color: "#030812",
    orientation: "any",
    categories: ["music", "entertainment", "social"],
    icons: [
      {
        src: firstListenBrandAsset("/icons/first-listen-180x180.png"),
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
      {
        src: firstListenBrandAsset("/icons/first-listen-192x192.png"),
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: firstListenBrandAsset("/icons/first-listen-512x512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: firstListenBrandAsset("/icons/first-listen-maskable-192x192.png"),
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: firstListenBrandAsset("/icons/first-listen-maskable-512x512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    screenshots: [
      {
        src: firstListenBrandAsset("/icons/first-listen-512x512.png"),
        sizes: "512x512",
        type: "image/png",
        form_factor: "narrow",
        label: "First Listen app icon",
      },
    ],
  };
}
