import { notFound } from "next/navigation";
import { ArtistSitePage } from "@/components/artist-site-page";
import { preview } from "@/lib/artist-site-preview";

export default async function ArtistTemplateAlbumPreview({
  params,
}: {
  params: Promise<{ albumSlug: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { albumSlug } = await params;
  if (!preview.albums.some((album) => album.slug === albumSlug)) notFound();

  return (
    <ArtistSitePage
      albumSlug={albumSlug}
      config={preview}
      site={{ id: "preview", name: "DJ Carlos Jimenez", slug: "artist-template-preview" }}
    />
  );
}
