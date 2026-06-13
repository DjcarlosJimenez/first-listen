"use client";

import Link from "next/link";
import { WifiOff, RefreshCw, Home, MessageSquareText } from "lucide-react";
import { Logo } from "@/components/logo";

export default function OfflinePage() {
  return (
    <main className="offline-page">
      <header className="account-header">
        <Logo />
      </header>
      <section className="offline-shell-card">
        <span className="install-icon" aria-hidden="true">
          <WifiOff size={26} />
        </span>
        <span className="eyebrow">Offline Shell</span>
        <h1>You are offline.</h1>
        <p>
          First Listen is installed and ready to reopen, but music playback,
          login, Time Bank updates, and feedback submission need an internet
          connection.
        </p>
        <div className="offline-shell-actions">
          <Link href="/">
            <Home size={15} /> Go Home
          </Link>
          <Link href="/help">
            <MessageSquareText size={15} /> Help Center
          </Link>
          <button type="button" onClick={() => globalThis.location?.reload()}>
            <RefreshCw size={15} /> Try Again
          </button>
        </div>
      </section>
    </main>
  );
}
