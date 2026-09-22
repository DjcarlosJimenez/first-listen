import type { MetadataRoute } from "next";
import { normalizeArtistSiteConfig } from "@/lib/artist-sites";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ artistSlug: string }> },
) {
  const { artistSlug } = await params;
  const supabase = await createClient();
  const { data: site, error } = await supabase
    .from("artist_sites")
    .select("slug,name,config")
    .eq("slug_key", artistSlug.trim().toLowerCase())
    .eq("published", true)
    .maybeSingle();

  if (error || !site) {
    return new Response("Artist app not found", { status: 404 });
  }

  const config = normalizeArtistSiteConfig(site.config);
  const startUrl = `/${site.slug}`;
  const iconPath = `${startUrl}/pwa-icon`;
  const manifest: MetadataRoute.Manifest = {
    id: startUrl,
    name: site.name,
    short_name: site.name.slice(0, 24),
    description: config.tagline || `Pagina oficial de ${site.name} en First Listen.`,
    start_url: startUrl,
    scope: startUrl,
    display: "standalone",
    display_override: ["standalone", "minimal-ui", "browser"],
    background_color: "#10100e",
    theme_color: config.accentColor,
    orientation: "any",
    lang: "es-US",
    categories: ["entertainment", "music", "social"],
    icons: [
      {
        src: `${iconPath}/192`,
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: `${iconPath}/512`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: site.name,
        short_name: site.name.slice(0, 24),
        description: `Abrir la pagina oficial de ${site.name}`,
        url: startUrl,
        icons: [
          {
            src: `${iconPath}/192`,
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
    ],
  };

  return Response.json(manifest, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "Content-Type": "application/manifest+json; charset=utf-8",
    },
  });
}
