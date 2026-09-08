import { headers } from "next/headers";
import { createDjCarlosManifest } from "@/lib/dj-carlos-manifest";
import { findPublicArtistPageByHost } from "@/lib/public-artist-pages";

export async function GET() {
  const headerStore = await headers();
  const artistRoute = findPublicArtistPageByHost(headerStore.get("host"));
  const manifest = createDjCarlosManifest({
    rootScope: artistRoute?.kind === "dj-carlos",
  });

  return new Response(JSON.stringify(manifest), {
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Content-Type": "application/manifest+json; charset=utf-8",
    },
  });
}
