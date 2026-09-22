import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, MessageCircle, Music2 } from "lucide-react";
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

  return (
    <main className="artist-directory">
      <header className="artist-directory-header">
        <Logo />
        <Link href="/"><ArrowLeft size={16} /> First Listen</Link>
      </header>
      <div className="artist-directory-heading">
        <span className="eyebrow">PAGINAS OFICIALES</span>
        <h1>Artistas en First Listen</h1>
      </div>
      <div className="artist-directory-grid">
        <Link className="artist-directory-card" href="/DJCarlosJimenez">
          <Image alt="Logo de DJ Carlos Jimenez" height={88} src="/artist/dj-carlos-jimenez/icon-192.png" width={88} />
          <span><strong>DJ Carlos Jimenez</strong><small>Pagina de ejemplo</small></span>
          <ArrowUpRight size={18} />
        </Link>
        {(sites ?? []).map((site) => {
          const config = normalizeArtistSiteConfig(site.config);
          return (
            <Link className="artist-directory-card" href={`/${site.slug}`} key={site.id}>
              {config.logoUrl ? (
                <Image alt="" height={88} src={config.logoUrl} unoptimized width={88} />
              ) : (
                <span aria-hidden="true" className="artist-directory-initial">{site.name.slice(0, 1)}</span>
              )}
              <span><strong>{site.name}</strong><small>{config.tagline || `${config.albums.length} albumes`}</small></span>
              <ArrowUpRight size={18} />
            </Link>
          );
        })}
      </div>
      <div className="artist-directory-contact">
        <Music2 size={20} />
        <div><strong>Tu musica merece su propio espacio.</strong><span>Paginas creadas y publicadas por First Listen.</span></div>
        <a href={contactUrl} rel="noreferrer" target="_blank"><MessageCircle size={16} /> Solicitar pagina</a>
      </div>
    </main>
  );
}
