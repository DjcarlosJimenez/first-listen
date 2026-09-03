import { notFound, permanentRedirect } from "next/navigation";
import {
  findPublicArtistPageBySlug,
  publicArtistPathFor,
} from "@/lib/public-artist-pages";

export const dynamic = "force-dynamic";

function serializeSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
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

export default async function PublicArtistSlugRoute({
  params,
  searchParams,
}: {
  params: Promise<{ artistSlug: string; artistPath?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { artistSlug, artistPath = [] } = await params;
  const route = findPublicArtistPageBySlug(artistSlug);

  if (!route) notFound();

  const requestedPath = publicArtistPathFor(artistSlug, artistPath);
  const canonicalPath = publicArtistPathFor(route.slug, artistPath);

  if (requestedPath !== canonicalPath) {
    const queryString = serializeSearchParams(await searchParams);
    permanentRedirect(`${canonicalPath}${queryString}`);
  }

  notFound();
}
