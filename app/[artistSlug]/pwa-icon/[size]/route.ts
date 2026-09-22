import sharp from "sharp";
import { normalizeArtistSiteConfig } from "@/lib/artist-sites";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SAFE_REMOTE_LOGO_HOSTS = new Set([
  "i.ytimg.com",
  "yt3.ggpht.com",
  "yt3.googleusercontent.com",
]);

function canProxyLogo(url: URL) {
  const hostname = url.hostname.toLowerCase();
  return SAFE_REMOTE_LOGO_HOSTS.has(hostname) || hostname.endsWith(".supabase.co");
}

function fallbackIcon(name: string, accentColor: string) {
  const initial = name.trim().charAt(0).toUpperCase().replace(/[<>&"']/g, "");
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <rect width="512" height="512" rx="96" fill="#10100e"/>
      <circle cx="256" cy="256" r="176" fill="${accentColor}"/>
      <text x="256" y="320" text-anchor="middle" font-family="Arial, sans-serif"
        font-size="220" font-weight="800" fill="#10100e">${initial}</text>
    </svg>
  `);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ artistSlug: string; size: string }> },
) {
  const { artistSlug, size: requestedSize } = await params;
  const size = Number(requestedSize);
  if (size !== 192 && size !== 512) {
    return new Response("Icon size not found", { status: 404 });
  }

  const supabase = await createClient();
  const { data: site, error } = await supabase
    .from("artist_sites")
    .select("name,config")
    .eq("slug_key", artistSlug.trim().toLowerCase())
    .eq("published", true)
    .maybeSingle();

  if (error || !site) {
    return new Response("Artist icon not found", { status: 404 });
  }

  const config = normalizeArtistSiteConfig(site.config);
  let source = fallbackIcon(site.name, config.accentColor);

  if (config.logoUrl) {
    const logoUrl = new URL(config.logoUrl, request.url);
    if (!canProxyLogo(logoUrl)) {
      return Response.redirect(logoUrl, 307);
    }

    try {
      const logoResponse = await fetch(logoUrl, {
        headers: { "User-Agent": "FirstListenArtistPwa/1.0" },
        next: { revalidate: 3600 },
      });
      const contentType = logoResponse.headers.get("content-type") ?? "";
      const contentLength = Number(logoResponse.headers.get("content-length") ?? 0);
      if (
        logoResponse.ok &&
        contentType.startsWith("image/") &&
        (!contentLength || contentLength <= 10 * 1024 * 1024)
      ) {
        source = Buffer.from(await logoResponse.arrayBuffer());
      }
    } catch {
      // Keep the generated fallback when the remote logo is temporarily unavailable.
    }
  }

  const icon = await sharp(source)
    .resize(size, size, {
      fit: "contain",
      background: { r: 16, g: 16, b: 14, alpha: 1 },
    })
    .png()
    .toBuffer();

  return new Response(new Uint8Array(icon), {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Content-Type": "image/png",
    },
  });
}
