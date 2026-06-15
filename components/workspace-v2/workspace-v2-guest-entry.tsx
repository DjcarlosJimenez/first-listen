"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Headphones, LockKeyhole } from "lucide-react";
import { Logo } from "@/components/logo";
import { WorkspaceV2PreviewErrorBoundary } from "@/components/workspace-v2/workspace-v2-preview-error-boundary";
import { WorkspaceV2Shell } from "@/components/workspace-v2/workspace-v2-shell";
import type { InterfaceLocale } from "@/lib/catalog";
import { displayPlatform, getContentClassification } from "@/lib/content-economy";
import { safeCoverUrl } from "@/lib/media";
import { createClient } from "@/lib/supabase/client";
import type { WorkspaceV2Queue, WorkspaceV2Song } from "@/lib/workspace-v2";

type GuestSession = {
  listenerId: string;
  locale: InterfaceLocale;
  nickname: string;
  recoveryCode: string;
  token: string;
};

type GuestQueueRow = {
  artist_id?: string | null;
  artist_name?: string | null;
  content_duration_seconds?: number | null;
  cover_image_url?: string | null;
  music_url?: string | null;
  platform?: string | null;
  song_id?: string | null;
  title?: string | null;
};

function firstRow<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function browserLocale(): InterfaceLocale {
  if (typeof navigator === "undefined") return "en";
  return navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
}

function storedLocale(): InterfaceLocale {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem("first-listen-locale");
  return stored === "es" || stored === "en" ? stored : browserLocale();
}

function mapGuestIdentity(
  row: Record<string, unknown>,
  token?: string,
): GuestSession {
  return {
    listenerId: String(row.guest_listener_id ?? ""),
    locale: row.interface_language === "es" ? "es" : "en",
    nickname: String(row.nickname ?? "Guest Listener"),
    recoveryCode: String(row.recovery_code ?? ""),
    token: token ?? String(row.guest_access_token ?? ""),
  };
}

function persistGuest(guest: GuestSession) {
  window.localStorage.setItem("first-listen-guest-token", guest.token);
  window.localStorage.setItem(
    "first-listen-guest-recovery-code",
    guest.recoveryCode,
  );
  window.localStorage.setItem("first-listen-locale", guest.locale);
  document.cookie = `first-listen-guest-token=${guest.token}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`;
}

function mapQueueSong(row: GuestQueueRow): WorkspaceV2Song | null {
  const link = String(row.music_url ?? "").trim();
  const id = String(row.song_id ?? "").trim();
  if (!id || !link) return null;
  const platform = displayPlatform[String(row.platform ?? "")] ?? "YouTube Music";
  return {
    artist: String(row.artist_name ?? "Unknown Artist"),
    artistId: row.artist_id ? String(row.artist_id) : undefined,
    coverUrl: safeCoverUrl(row.cover_image_url),
    durationSeconds:
      typeof row.content_duration_seconds === "number"
        ? row.content_duration_seconds
        : null,
    exposureScore: 25,
    id,
    link,
    playbackKind:
      getContentClassification(platform) === "internal" ? "internal" : "external",
    platform,
    title: String(row.title ?? "Untitled Song"),
  };
}

function buildGuestQueue(rows: GuestQueueRow[], locale: InterfaceLocale): WorkspaceV2Queue {
  return {
    id: "guest-workspace-v2",
    mode: "discovery",
    songs: rows
      .map(mapQueueSong)
      .filter((song): song is WorkspaceV2Song => Boolean(song)),
    source: "random",
    title:
      locale === "es"
        ? "Cola de descubrimiento invitado"
        : "Guest discovery queue",
  };
}

export function WorkspaceV2GuestEntry() {
  const [fatalError, setFatalError] = useState("");
  const [guest, setGuest] = useState<GuestSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [locale, setLocale] = useState<InterfaceLocale>("en");
  const [queue, setQueue] = useState<WorkspaceV2Queue | null>(null);

  const loadQueue = useCallback(
    async (token: string, nextLocale: InterfaceLocale) => {
      const supabase = createClient();
      if (!supabase) throw new Error("First Listen is not configured.");
      const { data, error } = await supabase.rpc("get_guest_song_queue", {
        guest_access_token: token,
        queue_limit: 50,
      });
      if (error) throw error;
      setQueue(
        buildGuestQueue((data ?? []) as GuestQueueRow[], nextLocale),
      );
    },
    [],
  );

  useEffect(() => {
    let active = true;
    const initializeGuest = async () => {
      const nextLocale = storedLocale();
      setLocale(nextLocale);
      document.documentElement.lang = nextLocale;

      const supabase = createClient();
      if (!supabase) {
        setFatalError("First Listen is not configured.");
        setLoading(false);
        return;
      }

      let token = window.localStorage.getItem("first-listen-guest-token");
      let identity: GuestSession | null = null;

      if (token) {
        const { data, error } = await supabase.rpc("get_guest_identity", {
          guest_access_token: token,
        });
        const row = firstRow(data as Record<string, unknown>[] | Record<string, unknown> | null);
        if (!error && row) {
          identity = mapGuestIdentity(row, token);
        } else {
          window.localStorage.removeItem("first-listen-guest-token");
          token = null;
        }
      }

      if (!identity) {
        const { data, error } = await supabase.rpc("create_guest_identity", {
          guest_language: nextLocale,
          guest_nickname: "",
        });
        const row = firstRow(data as Record<string, unknown>[] | Record<string, unknown> | null);
        if (error || !row) {
          setFatalError(error?.message ?? "Guest access could not be created.");
          setLoading(false);
          return;
        }
        identity = mapGuestIdentity(row);
        token = identity.token;
      }

      persistGuest(identity);
      if (!active) return;
      setGuest(identity);
      setLocale(identity.locale);
      document.documentElement.lang = identity.locale;
      try {
        await loadQueue(identity.token, identity.locale);
      } catch (error) {
        setFatalError(
          error instanceof Error ? error.message : "Music could not be loaded.",
        );
      } finally {
        if (active) setLoading(false);
      }
    };

    void initializeGuest();
    return () => {
      active = false;
    };
  }, [loadQueue]);

  const spanish = locale === "es";

  if (loading) {
    return (
      <main className="workspace-v2-preview-page">
        <section className="workspace-v2-empty">
          <h2>{spanish ? "Preparando Workspace invitado" : "Preparing guest Workspace"}</h2>
          <p>{spanish ? "Cargando musica para descubrir." : "Loading music to discover."}</p>
        </section>
      </main>
    );
  }

  if (fatalError || !guest || !queue) {
    return (
      <main className="workspace-v2-preview-page">
        <section className="workspace-v2-empty">
          <h2>{spanish ? "No pudimos abrir el Workspace" : "We could not open the Workspace"}</h2>
          <p>{fatalError || "Guest access is unavailable."}</p>
          <Link href="/legacy/guest">{spanish ? "Abrir modo invitado clasico" : "Open classic guest mode"}</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="workspace-v2-preview-page">
      <header className="account-header workspace-v2-preview-topbar">
        <Logo />
        <div className="owner-header-actions">
          <Link href="/signup">
            <LockKeyhole size={16} />
            {spanish ? "Crear cuenta gratis" : "Create free account"}
          </Link>
          <Link href="/legacy/guest">
            <Headphones size={16} />
            {spanish ? "Modo invitado clasico" : "Classic guest mode"}
          </Link>
        </div>
      </header>

      <section className="workspace-v2-preview-intro">
        <span className="eyebrow">
          {spanish ? "Invitado" : "Guest Listener"} / {guest.listenerId}
        </span>
        <h1>Workspace V2</h1>
        <p>
          {spanish
            ? "Escucha, descubre, sigue y guarda musica sin crear cuenta. Las recompensas se activan al registrarte."
            : "Listen, discover, follow and save music without creating an account. Rewards activate when you join."}
        </p>
      </section>

      {queue.songs.length === 0 ? (
        <section className="workspace-v2-empty">
          <h2>{spanish ? "No hay canciones disponibles" : "No songs available"}</h2>
          <p>{spanish ? "Vuelve pronto para descubrir musica nueva." : "Come back soon to discover new music."}</p>
        </section>
      ) : (
        <WorkspaceV2PreviewErrorBoundary>
          <WorkspaceV2Shell
            economyMode="guest"
            guestToken={guest.token}
            initialQueue={queue}
            locale={locale}
            viewerMode="guest"
          />
        </WorkspaceV2PreviewErrorBoundary>
      )}
    </main>
  );
}
