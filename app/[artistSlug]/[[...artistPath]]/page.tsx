import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { ArtistSiteEditor } from "@/components/artist-site-editor";
import { ArtistSitePage } from "@/components/artist-site-page";
import { normalizeArtistSiteConfig } from "@/lib/artist-sites";
import { hasOwnerAccess } from "@/lib/admin-access";
import {
  findPublicArtistPageBySlug,
  publicArtistPathFor,
} from "@/lib/public-artist-pages";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteParams = { artistSlug: string; artistPath?: string[] };
type RouteSearchParams = Record<string, string | string[] | undefined>;

function serializeSearchParams(
  searchParams: RouteSearchParams,
) {
  const params = new URLSearchParams();

  Object.entries(searchParams).forEach(([key, value]) => {
    if (typeof value === "string") {
      params.append(key, value);
      return;
    }
    value?.forEach((item) => params.append(key, item));
  });

  const query = params.toString();
  return query ? `?${query}` : "";
}

async function findArtistSite(slug: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("artist_sites")
    .select("id,slug,name,published,config,updated_at")
    .eq("slug_key", slug.trim().toLowerCase())
    .maybeSingle();
  return error ? null : data;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { artistSlug, artistPath = [] } = await params;
  const site = await findArtistSite(artistSlug);
  if (!site) return {};
  const config = normalizeArtistSiteConfig(site.config);
  const canonicalPath = `/${site.slug}${artistPath.length ? `/${artistPath.map(encodeURIComponent).join("/")}` : ""}`;
  const pwaIconPath = `/${site.slug}/pwa-icon`;
  return {
    title: `${site.name} | First Listen`,
    description: config.tagline || `Pagina oficial de ${site.name} en First Listen.`,
    applicationName: site.name,
    alternates: { canonical: `https://www.firstlisten.net${canonicalPath}` },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: site.name,
    },
    icons: {
      apple: [{ url: `${pwaIconPath}/192`, sizes: "192x192", type: "image/png" }],
      icon: [
        { url: `${pwaIconPath}/192`, sizes: "192x192", type: "image/png" },
        { url: `${pwaIconPath}/512`, sizes: "512x512", type: "image/png" },
      ],
    },
    manifest: `/${site.slug}/manifest.webmanifest`,
    openGraph: config.logoUrl ? { images: [{ url: config.logoUrl }] } : undefined,
    robots: { index: site.published && artistPath[0] !== "admin" },
  };
}

export default async function PublicArtistSlugRoute({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>;
  searchParams: Promise<RouteSearchParams>;
}) {
  const { artistSlug, artistPath = [] } = await params;
  const djCarlosRoute = findPublicArtistPageBySlug(artistSlug);

  if (djCarlosRoute) {
    const requestedPath = publicArtistPathFor(artistSlug, artistPath);
    const canonicalPath = publicArtistPathFor(djCarlosRoute.slug, artistPath);
    if (requestedPath !== canonicalPath) {
      permanentRedirect(`${canonicalPath}${serializeSearchParams(await searchParams)}`);
    }
    notFound();
  }

  const isAdminRoute = artistPath.length === 1 && artistPath[0] === "admin";
  if (isAdminRoute) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const requestedAdminPath = publicArtistPathFor(artistSlug, ["admin"]);
      redirect(`/login?next=${encodeURIComponent(requestedAdminPath)}`);
    }
  }

  const site = await findArtistSite(artistSlug);
  if (!site) notFound();
  const config = normalizeArtistSiteConfig(site.config);

  let canonicalPath = `/${site.slug}`;
  let albumSlug: string | undefined;
  if (artistPath.length === 1 && artistPath[0] === "admin") {
    canonicalPath += "/admin";
  } else if (artistPath.length === 2 && artistPath[0] === "album") {
    const album = config.albums.find((item) =>
      item.slug.toLowerCase() === artistPath[1].toLowerCase(),
    );
    if (!album) notFound();
    albumSlug = album.slug;
    canonicalPath += `/album/${album.slug}`;
  } else if (artistPath.length) {
    notFound();
  }

  const requestedPath = publicArtistPathFor(artistSlug, artistPath);

  if (requestedPath !== canonicalPath) {
    permanentRedirect(`${canonicalPath}${serializeSearchParams(await searchParams)}`);
  }

  if (isAdminRoute) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect(`/login?next=${encodeURIComponent(canonicalPath)}`);
    const [{ data: profile }, { data: assignment }] = await Promise.all([
      supabase.from("profiles").select("role, founder_number, account_status, force_password_change").eq("id", user.id).maybeSingle(),
      supabase.from("artist_sites").select("owner_user_id").eq("id", site.id).maybeSingle(),
    ]);
    if (profile?.force_password_change) {
      redirect(`/change-password?next=${encodeURIComponent(canonicalPath)}`);
    }
    if (
      profile?.account_status !== "active" ||
      (assignment?.owner_user_id !== user.id && !hasOwnerAccess(profile, user.email))
    ) notFound();
    return <ArtistSiteEditor site={{ ...site, config }} />;
  }

  return <ArtistSitePage albumSlug={albumSlug} config={config} site={site} />;
}
