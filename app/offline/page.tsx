"use client";

import Link from "next/link";
import { WifiOff, RefreshCw, Home, MessageSquareText } from "lucide-react";
import { Logo } from "@/components/logo";
import { useInterfaceLocale } from "@/lib/use-interface-locale";

export default function OfflinePage() {
  const locale = useInterfaceLocale();
  const spanish = locale === "es";

  return (
    <main className="offline-page">
      <header className="account-header">
        <Logo />
      </header>
      <section className="offline-shell-card">
        <span className="install-icon" aria-hidden="true">
          <WifiOff size={26} />
        </span>
        <span className="eyebrow">{spanish ? "Modo sin conexión" : "Offline Shell"}</span>
        <h1>{spanish ? "Estás sin conexión." : "You are offline."}</h1>
        <p>
          {spanish
            ? "First Listen está instalado y listo para abrirse, pero la reproducción, el inicio de sesión, el Banco de Tiempo y el feedback necesitan internet."
            : "First Listen is installed and ready to reopen, but music playback, login, Time Bank updates, and feedback submission need an internet connection."}
        </p>
        <div className="offline-shell-actions">
          <Link href="/">
            <Home size={15} /> {spanish ? "Inicio" : "Go Home"}
          </Link>
          <Link href="/help">
            <MessageSquareText size={15} /> {spanish ? "Centro de ayuda" : "Help Center"}
          </Link>
          <button type="button" onClick={() => globalThis.location?.reload()}>
            <RefreshCw size={15} /> {spanish ? "Intentar de nuevo" : "Try Again"}
          </button>
        </div>
      </section>
    </main>
  );
}
