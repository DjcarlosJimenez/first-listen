"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { Logo } from "@/components/logo";
import { WorkspaceV2PreviewErrorBoundary } from "@/components/workspace-v2/workspace-v2-preview-error-boundary";
import { WorkspaceV2Shell } from "@/components/workspace-v2/workspace-v2-shell";
import type { InterfaceLocale } from "@/lib/catalog";
import {
  displayPlatform,
  getContentClassification,
  isExternalPlatform,
} from "@/lib/content-economy";
import { safeCoverUrl } from "@/lib/media";
import { createClient } from "@/lib/supabase/client";
import type { Platform } from "@/lib/types";
import type {
  WorkspaceV2ExternalDiscoveryItem,
  WorkspaceV2Queue,
  WorkspaceV2Song,
} from "@/lib/workspace-v2";

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
  category?: string | null;
  content_duration_seconds?: number | null;
  content_type?: string | null;
  cover_image_url?: string | null;
  genre?: string | null;
  music_url?: string | null;
  platform?: string | null;
  song_id?: string | null;
  subcategory?: string | null;
  title?: string | null;
};

type GuestExternalDiscoveryRow = GuestQueueRow & {
  artist_id?: string | null;
  badge?: string | null;
  feed_kind?: string | null;
  platform_links?: unknown;
  recommended_platform?: string | null;
};

function firstRow<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function storedLocale(): InterfaceLocale {
  if (typeof window === "undefined") return "es";
  const stored = window.localStorage.getItem("first-listen-locale");
  return stored === "es" || stored === "en" ? stored : "es";
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
    category: row.category ?? row.content_type ?? null,
    coverUrl: safeCoverUrl(row.cover_image_url),
    durationSeconds:
      typeof row.content_duration_seconds === "number"
        ? row.content_duration_seconds
        : null,
    exposureScore: 25,
    genre: row.genre ?? row.subcategory ?? null,
    id,
    link,
    playbackKind:
      getContentClassification(platform) === "internal" ? "internal" : "external",
    platform,
    subcategory: row.subcategory ?? row.genre ?? null,
    title: String(row.title ?? "Untitled Song"),
  };
}

function normalizePlatformLink(row: unknown) {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const platform =
    displayPlatform[String(record.platform ?? "")] ??
    displayPlatform[String(record.platform_key ?? "")] ??
    null;
  const url = String(record.music_url ?? record.url ?? "").trim();
  if (!platform || !url) return null;
  return { platform, url };
}

function pickExternalDiscoveryDestination(row: GuestExternalDiscoveryRow) {
  const links = Array.isArray(row.platform_links)
    ? row.platform_links.map(normalizePlatformLink).filter(Boolean)
    : [];
  const external = links.find((link) =>
    isExternalPlatform(link!.platform as Platform),
  );
  if (external) return external;

  const fallbackPlatform =
    displayPlatform[String(row.recommended_platform ?? row.platform ?? "")] ??
    "Spotify";
  return {
    platform: fallbackPlatform,
    url: String(row.music_url ?? "").trim(),
  };
}

function mapExternalDiscoveryItem(
  row: GuestExternalDiscoveryRow,
): WorkspaceV2ExternalDiscoveryItem | null {
  const id = String(row.song_id ?? "").trim();
  const destination = pickExternalDiscoveryDestination(row);
  if (!id || !destination.url) return null;
  return {
    artist: String(row.artist_name ?? "Unknown Artist"),
    artistId: row.artist_id ? String(row.artist_id) : undefined,
    badge: row.badge ?? undefined,
    category: row.category ?? row.content_type ?? null,
    coverUrl: safeCoverUrl(row.cover_image_url),
    feedKind: row.feed_kind ?? undefined,
    genre: row.genre ?? row.subcategory ?? null,
    id,
    link: destination.url,
    platform: destination.platform,
    subcategory: row.subcategory ?? row.genre ?? null,
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
  const [locale, setLocale] = useState<InterfaceLocale>("es");
  const [queue, setQueue] = useState<WorkspaceV2Queue | null>(null);
  const [externalDiscoveryItems, setExternalDiscoveryItems] = useState<
    WorkspaceV2ExternalDiscoveryItem[]
  >([]);

  const loadQueue = useCallback(
    async (token: string, nextLocale: InterfaceLocale) => {
      const supabase = createClient();
      if (!supabase) throw new Error("First Listen is not configured.");
      const { data, error } = await supabase.rpc("get_guest_song_queue", {
        guest_access_token: token,
        queue_limit: 200,
      });
      if (error) throw error;
      setQueue(
        buildGuestQueue((data ?? []) as GuestQueueRow[], nextLocale),
      );
    },
    [],
  );

  const loadExternalDiscovery = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return;
    const { data } = await supabase.rpc("get_external_discovery_feed", {
      feed_limit: 200,
    });
    setExternalDiscoveryItems(
      ((data ?? []) as GuestExternalDiscoveryRow[])
        .map(mapExternalDiscoveryItem)
        .filter((item): item is WorkspaceV2ExternalDiscoveryItem =>
          Boolean(item),
        ),
    );
  }, []);

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
          identity = {
            ...mapGuestIdentity(row, token),
            locale: nextLocale,
          };
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
        await Promise.all([
          loadQueue(identity.token, identity.locale),
          loadExternalDiscovery(),
        ]);
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
  }, [loadExternalDiscovery, loadQueue]);

  const spanish = locale === "es";
  const guestIdentity = guest
    ? `${guest.nickname} #${guest.listenerId.slice(0, 8)}`
    : null;

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
          <Link href="/workspace-v2/guest">
            {spanish ? "Intentar de nuevo" : "Try again"}
          </Link>
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
        </div>
      </header>

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
            externalDiscoveryItems={externalDiscoveryItems}
            initialQueue={queue}
            locale={locale}
            viewerIdentity={guestIdentity}
            viewerMode="guest"
          />
        </WorkspaceV2PreviewErrorBoundary>
      )}
    </main>
  );
}
