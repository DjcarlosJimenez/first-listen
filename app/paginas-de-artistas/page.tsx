import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, MessageCircle, Music2 } from "lucide-react";
import {
  ArtistDirectoryBrowser,
  type ArtistDirectoryEntry,
} from "@/components/artist-directory-browser";
import { Logo } from "@/components/logo";
import { normalizeArtistSiteConfig } from "@/lib/artist-sites";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Paginas de artistas | First Listen",
  description: "Descubre las paginas oficiales de artistas en First Listen.",
  alternates: { canonical: "https://www.firstlisten.net/paginas-de-artistas" },
};

const contactUrl = "https://wa.me/16127017420?text=Hola%2C%20quiero%20informacion%20sobre%20una%20pagina%20de%20artista%20en%20First%20Listen";

export default async function ArtistPagesDirectory() {
  const supabase = await createClient();
  const { data: sites } = await supabase
    .from("artist_sites")
    .select("id,slug,name,config")
    .eq("published", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const artists: ArtistDirectoryEntry[] = [
    {
      description: "Página oficial · Música, álbumes y videos",
      href: "/DJCarlosJimenez",
      id: "dj-carlos-jimenez",
      imageUrl: "/artist/dj-carlos-jimenez/icon-192.png",
      name: "DJ Carlos Jimenez",
      searchText: "cumbia sonidera compositor",
    },
    ...(sites ?? [])
      .filter((site) => site.slug.toLocaleLowerCase("en-US") !== "djcarlosjimenez")
      .map((site) => {
        const config = normalizeArtistSiteConfig(site.config);
        return {
          accentColor: config.accentColor,
          description:
            config.tagline ||
            (config.albums.length
              ? `${config.albums.length} álbumes disponibles`
              : "Página oficial en First Listen"),
          href: `/${site.slug}`,
          id: site.id,
          imageUrl: config.logoUrl,
          name: site.name,
          searchText: [
            config.tagline,
            ...config.albums.flatMap((album) => [
              album.title,
              album.rhythm,
              ...album.tracks.map((track) => track.rhythm),
            ]),
            ...config.videos.map((video) => video.rhythm),
          ]
            .filter(Boolean)
            .join(" "),
        } satisfies ArtistDirectoryEntry;
      }),
  ];

  return (
    <main className="artist-directory">
      <header className="artist-directory-header">
        <Logo />
        <Link href="/"><ArrowLeft size={16} /> First Listen</Link>
      </header>
      <div className="artist-directory-heading">
        <span className="eyebrow">DIRECTORIO OFICIAL</span>
        <h1>Conoce a nuestros artistas</h1>
        <p>Encuentra rápidamente su página, música, álbumes y videos oficiales.</p>
      </div>
      <ArtistDirectoryBrowser artists={artists} />
      <div className="artist-directory-contact">
        <Music2 size={20} />
        <div><strong>Tu musica merece su propio espacio.</strong><span>Paginas creadas y publicadas por First Listen.</span></div>
        <a href={contactUrl} rel="noreferrer" target="_blank"><MessageCircle size={16} /> Solicitar pagina</a>
      </div>
    </main>
  );
}
