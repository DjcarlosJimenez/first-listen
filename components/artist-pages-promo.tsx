"use client";

import Image from "next/image";
import Link from "next/link";
import { Bell, ExternalLink, MessageCircle, Music2, Sparkles, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { InterfaceLocale } from "@/lib/catalog";

const DJ_CARLOS_PAGE_PATH = "/DJCarlosJimenez";
const DJ_CARLOS_LOGO_URL = "/artist/dj-carlos-jimenez/icon-192.png";
const ARTIST_PAGES_WHATSAPP_URL =
  "https://wa.me/16127017420?text=Hola%2C%20quiero%20informacion%20sobre%20una%20pagina%20de%20artista%20en%20First%20Listen";
const ARTIST_NOTICE_KEY = "first-listen-artist-page-notice:dj-carlos-sonidero-2027";
const ARTIST_NOTICE_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

type ArtistPagesPromoProps = {
  locale: InterfaceLocale;
  surface?: "landing" | "workspace";
};

function isStandaloneApp() {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = window.navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

function recentlySawArtistNotice() {
  try {
    const value = window.localStorage.getItem(ARTIST_NOTICE_KEY);
    if (!value) return false;
    const dismissedAt = Number(value);
    return (
      Number.isFinite(dismissedAt) &&
      Date.now() - dismissedAt < ARTIST_NOTICE_INTERVAL_MS
    );
  } catch {
    return false;
  }
}

function markArtistNoticeSeen() {
  try {
    window.localStorage.setItem(ARTIST_NOTICE_KEY, String(Date.now()));
  } catch {
    // The visible state still closes the notice when storage is blocked.
  }
}

export function ArtistPagesPromo({
  locale,
  surface = "workspace",
}: ArtistPagesPromoProps) {
  const spanish = locale === "es";

  return (
    <section
      className={`artist-pages-promo artist-pages-promo-${surface}`}
      aria-label={
        spanish ? "Paginas de artista en First Listen" : "Artist pages on First Listen"
      }
    >
      <div className="artist-pages-promo-copy">
        <span className="eyebrow">
          <Sparkles size={13} />
          {spanish ? "Paginas de artista" : "Artist pages"}
        </span>
        <h2>
          {spanish
            ? "Una pagina propia para presentar tu musica."
            : "A custom page for your music."}
        </h2>
        <p>
          {spanish
            ? "Albumes en orden, Top Ten, videos oficiales y reproductor siempre activo. Disponible solo por solicitud directa."
            : "Ordered albums, Top Ten picks, official videos, and an always-on player. Available by direct request only."}
        </p>
      </div>

      <Link className="artist-pages-example" href={DJ_CARLOS_PAGE_PATH}>
        <Image
          alt=""
          height={58}
          src={DJ_CARLOS_LOGO_URL}
          unoptimized
          width={58}
        />
        <span>
          <small>{spanish ? "Ejemplo oficial" : "Official example"}</small>
          <strong>DJ Carlos Jimenez</strong>
        </span>
        <ExternalLink size={15} />
      </Link>

      <div className="artist-pages-promo-actions">
        <Link href={DJ_CARLOS_PAGE_PATH}>
          <Music2 size={15} />
          {spanish ? "Ver ejemplo" : "View example"}
        </Link>
        <a href={ARTIST_PAGES_WHATSAPP_URL} rel="noreferrer" target="_blank">
          <MessageCircle size={15} />
          {spanish ? "Solicitar por WhatsApp" : "Request by WhatsApp"}
        </a>
      </div>
    </section>
  );
}

export function ArtistPagesAppNotice({ locale }: { locale: InterfaceLocale }) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const spanish = locale === "es";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (pathname?.toLowerCase().startsWith(DJ_CARLOS_PAGE_PATH.toLowerCase())) {
      return;
    }

    const params = new URL(window.location.href).searchParams;
    const preview = params.get("artistNotice") === "1";
    if (!preview && !isStandaloneApp()) return;
    if (recentlySawArtistNotice()) return;

    const timer = window.setTimeout(() => setVisible(true), 1200);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  const closeNotice = () => {
    markArtistNoticeSeen();
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <aside className="artist-pages-app-notice" aria-live="polite">
      <Bell size={16} aria-hidden="true" />
      <div>
        <strong>
          {spanish
            ? "DJ Carlos tiene musica nueva en su pagina oficial."
            : "DJ Carlos has new music on his official page."}
        </strong>
        <span>
          {spanish
            ? "Escucha el album y mira como funcionan las paginas de artista."
            : "Play the album and see how artist pages work."}
        </span>
      </div>
      <Link href={DJ_CARLOS_PAGE_PATH} onClick={closeNotice}>
        {spanish ? "Escuchar ahora" : "Listen now"}
      </Link>
      <button
        aria-label={spanish ? "Cerrar aviso" : "Close notice"}
        onClick={closeNotice}
        type="button"
      >
        <X size={15} />
      </button>
    </aside>
  );
}
