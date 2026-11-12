import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Globe2, Headphones } from "lucide-react";
import { SiApplemusic, SiFacebook, SiSpotify, SiYoutubemusic } from "react-icons/si";
import type { CSSProperties, ReactNode } from "react";
import type { ArtistPlatformLinks } from "@/lib/artist-link-hub";

type HubLink = {
  brand: string;
  href: string;
  icon: ReactNode;
  label: string;
};

export function ArtistLinkHub({
  accentColor,
  artistLogoUrl,
  artistUrl,
  links,
}: {
  accentColor?: string;
  artistLogoUrl?: string;
  artistUrl: string;
  links: ArtistPlatformLinks;
}) {
  const candidateItems: Array<HubLink | null> = [
    links.youtubeMusic ? {
      brand: "youtube-music",
      href: links.youtubeMusic,
      icon: <SiYoutubemusic aria-hidden="true" />,
      label: "YouTube Music",
    } : null,
    links.appleMusic ? {
      brand: "apple-music",
      href: links.appleMusic,
      icon: <SiApplemusic aria-hidden="true" />,
      label: "Apple Music",
    } : null,
    links.spotify ? {
      brand: "spotify",
      href: links.spotify,
      icon: <SiSpotify aria-hidden="true" />,
      label: "Spotify",
    } : null,
    links.facebook ? {
      brand: "facebook",
      href: links.facebook,
      icon: <SiFacebook aria-hidden="true" />,
      label: "Facebook",
    } : null,
    links.website ? {
      brand: "website",
      href: links.website,
      icon: <Globe2 aria-hidden="true" />,
      label: "Sitio oficial",
    } : null,
    ...links.custom.map((link) => ({
      brand: "custom",
      href: link.url,
      icon: <ExternalLink aria-hidden="true" />,
      label: link.label,
    })),
    {
      brand: "artist",
      href: artistUrl,
      icon: artistLogoUrl ? (
        <Image alt="" height={30} src={artistLogoUrl} unoptimized width={30} />
      ) : <Globe2 aria-hidden="true" />,
      label: "Página del artista",
    },
    {
      brand: "firstlisten",
      href: "https://www.firstlisten.net",
      icon: <Image alt="" height={30} src="/brand/first-listen-icon.svg" width={30} />,
      label: "FirstListen",
    },
  ];
  const items = candidateItems.filter((item): item is HubLink => item !== null);
  const style = accentColor
    ? { "--artist-link-accent": accentColor } as CSSProperties
    : undefined;

  return (
    <section className="artist-link-hub" id="escucha" style={style}>
      <div className="artist-link-hub-heading">
        <span>ESCUCHA MI MÚSICA</span>
        <h2>Elige tu plataforma favorita</h2>
        <p>La música se abre directamente en el servicio que ya utilizas.</p>
      </div>
      <div className="artist-link-hub-grid">
        {items.map((item) => (
          <a
            data-platform={item.brand}
            href={item.href}
            key={`${item.label}-${item.href}`}
            rel="noopener noreferrer external"
            target="_blank"
          >
            <span>{item.icon}</span>
            <strong>{item.label}</strong>
            <ExternalLink aria-hidden="true" className="artist-link-hub-external" size={16} />
          </a>
        ))}
      </div>
    </section>
  );
}

export function ArtistLinkHubPage({
  accentColor,
  artistLogoUrl,
  artistName,
  artistPortraitUrl,
  artistUrl,
  links,
}: {
  accentColor?: string;
  artistLogoUrl?: string;
  artistName: string;
  artistPortraitUrl?: string;
  artistUrl: string;
  links: ArtistPlatformLinks;
}) {
  const style = accentColor
    ? { "--artist-link-accent": accentColor } as CSSProperties
    : undefined;

  return (
    <main className="artist-link-page" style={style}>
      <header className="artist-link-page-topbar">
        <Link href={artistUrl}><ArrowLeft size={17} /> Página del artista</Link>
        <span>FIRST LISTEN</span>
        <Link href="/paginas-de-artistas">Artistas</Link>
      </header>
      <section className="artist-link-page-hero">
        <div className="artist-link-page-copy">
          <span><Headphones size={15} /> CENTRO OFICIAL DE ENLACES</span>
          <h1>{artistName}</h1>
          <p>Escucha mi música desde tu plataforma favorita.</p>
        </div>
        <div className="artist-link-page-identity" aria-hidden="true">
          {artistLogoUrl && (
            <div className="artist-link-page-logo">
              <Image alt="" fill priority sizes="(max-width: 720px) 55vw, 300px" src={artistLogoUrl} unoptimized />
            </div>
          )}
          {artistPortraitUrl && (
            <div className="artist-link-page-portrait">
              <Image alt="" fill priority sizes="(max-width: 720px) 34vw, 150px" src={artistPortraitUrl} unoptimized />
            </div>
          )}
        </div>
      </section>
      <ArtistLinkHub
        accentColor={accentColor}
        artistLogoUrl={artistLogoUrl}
        artistUrl={artistUrl}
        links={links}
      />
      <footer className="artist-link-page-footer">
        <p>Los enlaces abren los perfiles oficiales del artista en cada plataforma.</p>
        <Link href={artistUrl}>Volver a la página completa</Link>
      </footer>
    </main>
  );
}
