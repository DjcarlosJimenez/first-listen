import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { createDjCarlosManifest } from "@/lib/dj-carlos-manifest";
import { findPublicArtistPageByHost } from "@/lib/public-artist-pages";

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
    background_color: "#f3f4ee",
    theme_color: "#171a18",
    orientation: "any",
    categories: ["music", "entertainment", "social"],
    icons: [
      {
        src: "/icons/first-listen-180x180.png",
        sizes: "180x180",
        type: "image/png",
      },
      {
        src: "/icons/first-listen-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/first-listen-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    screenshots: [
      {
        src: "/icons/first-listen-512x512.png",
        sizes: "512x512",
        type: "image/png",
        form_factor: "narrow",
        label: "First Listen app icon",
      },
    ],
  };
}
