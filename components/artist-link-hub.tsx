import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  Clapperboard,
  ExternalLink,
  Globe2,
  Headphones,
} from "lucide-react";
import { FaAmazon } from "react-icons/fa";
import {
  SiApplemusic,
  SiFacebook,
  SiInstagram,
  SiSpotify,
  SiTiktok,
  SiYoutube,
  SiYoutubemusic,
} from "react-icons/si";
import type { CSSProperties, ReactNode } from "react";
import type { ArtistPlatformLinks } from "@/lib/artist-link-hub";

type HubLink = {
  actionLabel: string;
  brand: string;
  description?: string;
  href: string;
  icon: ReactNode;
  label: string;
  verified?: boolean;
};

function isHubLink(item: HubLink | null): item is HubLink {
  return item !== null;
}

function PlatformCard({ featured = false, item }: { featured?: boolean; item: HubLink }) {
  return (
    <a
      className={featured ? "artist-link-card artist-link-card-featured" : "artist-link-card"}
      data-platform={item.brand}
      href={item.href}
      rel="noopener noreferrer external"
      target="_blank"
    >
      <span className="artist-link-card-icon">{item.icon}</span>
      <span className="artist-link-card-copy">
        <strong>
          {item.label}
          {item.verified && (
            <span className="artist-link-verified" title="Página verificada por Meta">
              <BadgeCheck aria-hidden="true" size={18} /> Verificada por Meta
            </span>
          )}
        </strong>
        {item.description && <small>{item.description}</small>}
      </span>
      <span className="artist-link-card-action">
        <span className="artist-link-card-action-label">{item.actionLabel}</span>
        <ArrowUpRight aria-hidden="true" size={17} />
      </span>
    </a>
  );
}

function LinkGroup({
  description,
  eyebrow,
  featured = false,
  items,
  title,
}: {
  description: string;
  eyebrow: string;
  featured?: boolean;
  items: HubLink[];
  title: string;
}) {
  if (!items.length) return null;
  return (
    <section className="artist-link-group">
      <header>
        <span>{eyebrow}</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </header>
      <div className={`artist-link-hub-grid${featured ? " artist-link-hub-grid-featured" : ""}`}>
        {items.map((item) => (
          <PlatformCard featured={featured} item={item} key={`${item.label}-${item.href}`} />
        ))}
      </div>
    </section>
  );
}

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
  const facebookCommunityMessage = links.facebookCommunityMessage?.trim();
  const facebookItems: HubLink[] = links.facebook ? [{
    actionLabel: "Visitar página",
    brand: "facebook",
    description: facebookCommunityMessage === "Únete a mis más de 47 mil seguidores."
      ? "Únete a mis más de 47 mil seguidores y contando."
      : facebookCommunityMessage || "Únete a mis más de 47 mil seguidores y contando.",
    href: links.facebook,
    icon: <SiFacebook aria-hidden="true" />,
    label: "Facebook",
    verified: links.facebookVerified,
  }] : [];
  const musicCandidates: Array<HubLink | null> = [
    links.youtubeMusic ? {
      actionLabel: "Escuchar",
      brand: "youtube-music",
      href: links.youtubeMusic,
      icon: <SiYoutubemusic aria-hidden="true" />,
      label: "YouTube Music",
    } : null,
    links.appleMusic ? {
      actionLabel: "Escuchar",
      brand: "apple-music",
      href: links.appleMusic,
      icon: <SiApplemusic aria-hidden="true" />,
      label: "Apple Music",
    } : null,
    links.spotify ? {
      actionLabel: "Escuchar",
      brand: "spotify",
      href: links.spotify,
      icon: <SiSpotify aria-hidden="true" />,
      label: "Spotify",
    } : null,
    links.amazonMusic ? {
      actionLabel: "Escuchar",
      brand: "amazon-music",
      href: links.amazonMusic,
      icon: <FaAmazon aria-hidden="true" />,
      label: "Amazon Music",
    } : null,
  ];
  const musicItems = musicCandidates.filter(isHubLink);
  const officialItems: HubLink[] = [
    {
      actionLabel: "Abrir página",
      brand: "artist",
      description: "Álbumes, videos, adelantos exclusivos y nuevos proyectos.",
      href: artistUrl,
      icon: artistLogoUrl ? (
        <Image alt="" height={140} src={artistLogoUrl} unoptimized width={210} />
      ) : <Globe2 aria-hidden="true" />,
      label: "Página oficial",
    },
    ...(links.website ? [{
      actionLabel: "Visitar sitio",
      brand: "website",
      description: "Visita mi sitio web personal.",
      href: links.website,
      icon: <Globe2 aria-hidden="true" />,
      label: "Sitio web",
    }] : []),
  ];
  const socialCandidates: Array<HubLink | null> = [
    links.youtube ? {
      actionLabel: "Ver perfil",
      brand: "youtube",
      href: links.youtube,
      icon: <SiYoutube aria-hidden="true" />,
      label: "YouTube",
    } : null,
    links.tiktok ? {
      actionLabel: "Ver perfil",
      brand: "tiktok",
      href: links.tiktok,
      icon: <SiTiktok aria-hidden="true" />,
      label: "TikTok",
    } : null,
    links.instagram ? {
      actionLabel: "Ver perfil",
      brand: "instagram",
      href: links.instagram,
      icon: <SiInstagram aria-hidden="true" />,
      label: "Instagram",
    } : null,
    links.lemon8 ? {
      actionLabel: "Ver perfil",
      brand: "lemon8",
      href: links.lemon8,
      icon: <b className="artist-link-monogram" aria-hidden="true">L8</b>,
      label: "Lemon8",
    } : null,
    links.clapper ? {
      actionLabel: "Ver perfil",
      brand: "clapper",
      href: links.clapper,
      icon: <Clapperboard aria-hidden="true" />,
      label: "Clapper",
    } : null,
  ];
  const socialItems = socialCandidates.filter(isHubLink);
  const customItems: HubLink[] = links.custom.map((link) => ({
      actionLabel: "Abrir",
      brand: "custom",
      href: link.url,
      icon: <ExternalLink aria-hidden="true" />,
      label: link.label,
    }));
  const firstListenItems: HubLink[] = [{
    actionLabel: "Explorar",
    brand: "firstlisten",
    description: "Descubre música nueva, escucha artistas independientes y comparte tus enlaces musicales.",
    href: "https://www.firstlisten.net",
    icon: <Image alt="" height={180} priority src="/brand/first-listen-link-logo.png" unoptimized width={540} />,
    label: "FirstListen",
  }];
  const style = accentColor
    ? { "--artist-link-accent": accentColor } as CSSProperties
    : undefined;

  return (
    <section className="artist-link-hub" id="escucha" style={style}>
      <div className="artist-link-hub-heading">
        <span>ENLACES OFICIALES</span>
        <h2>Todo mi contenido en un solo lugar</h2>
        <p>Elige dónde seguirme, escuchar mi música o conocer mis nuevos proyectos.</p>
      </div>
      <div className="artist-link-hub-sections">
        <LinkGroup
          description="Noticias, estrenos y comunicación directa con mi comunidad."
          eyebrow="COMUNIDAD PRINCIPAL"
          featured
          items={facebookItems}
          title="Acompáñame en Facebook"
        />
        <LinkGroup
          description="La música se abre directamente en el servicio que ya utilizas."
          eyebrow="MÚSICA"
          items={musicItems}
          title="Escucha mi música en tu plataforma favorita"
        />
        <LinkGroup
          description="Encuentra toda mi música y contenido organizado en mi espacio oficial."
          eyebrow="MI ESPACIO OFICIAL"
          featured
          items={officialItems}
          title="Conoce mi página oficial"
        />
        <LinkGroup
          description="Videos, novedades y contenido publicado en mis perfiles oficiales."
          eyebrow="VIDEOS Y REDES"
          items={socialItems}
          title="Sígueme en otras plataformas"
        />
        <LinkGroup
          description="Más sitios oficiales donde puedes encontrar mi contenido."
          eyebrow="MÁS ENLACES"
          items={customItems}
          title="Otras plataformas"
        />
        <LinkGroup
          description="Un espacio para descubrir música nueva y apoyar a creadores independientes."
          eyebrow="DESCUBRE Y CONECTA"
          featured
          items={firstListenItems}
          title="Explora FirstListen"
        />
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
      <section className={`artist-link-page-hero${artistLogoUrl ? " artist-link-page-hero-branded" : ""}`}>
        <div className="artist-link-page-copy">
          <span><Headphones size={15} /> CENTRO OFICIAL DE ENLACES</span>
          <h1 className={artistLogoUrl ? "artist-link-page-title-sr-only" : undefined}>{artistName}</h1>
          <p>{artistLogoUrl ? "Mis enlaces oficiales" : "Música, comunidad y plataformas oficiales en un solo lugar."}</p>
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
          <p className="artist-link-page-mobile-title">Mis enlaces oficiales</p>
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
