import { notFound } from "next/navigation";
import { ArtistSitePage } from "@/components/artist-site-page";
import { preview } from "@/lib/artist-site-preview";

export default function ArtistTemplatePreview() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <ArtistSitePage
      config={preview}
      site={{ id: "preview", name: "DJ Carlos Jimenez", slug: "artist-template-preview" }}
    />
  );
}
