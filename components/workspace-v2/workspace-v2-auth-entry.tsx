import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import { WorkspaceV2PreviewErrorBoundary } from "@/components/workspace-v2/workspace-v2-preview-error-boundary";
import { WorkspaceV2Shell, type WorkspaceV2ViewerMode } from "@/components/workspace-v2/workspace-v2-shell";
import type { InterfaceLocale } from "@/lib/catalog";
import { displayPlatform, getContentClassification } from "@/lib/content-economy";
import { safeCoverUrl } from "@/lib/media";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceV2Queue, WorkspaceV2Song } from "@/lib/workspace-v2";

type WorkspaceV2Profile = {
  founder_number: number | null;
  interface_language: string | null;
  role: string | null;
};

type WorkspaceV2SongRow = {
  artist_name: string | null;
  content_duration_seconds: number | null;
  cover_image_url: string | null;
  created_at: string | null;
  featured: boolean | null;
  id: string;
  music_url: string | null;
  platform: string | null;
  title: string | null;
  user_id: string | null;
};

function localeFromProfile(profile: WorkspaceV2Profile | null): InterfaceLocale {
  return profile?.interface_language === "es" ? "es" : "en";
}

function viewerModeFromProfile(profile: WorkspaceV2Profile | null): WorkspaceV2ViewerMode {
  if (profile?.role === "super_admin") return "founder";
  if (profile?.role === "admin") return "admin";
  return "member";
}

function toWorkspaceSong(row: WorkspaceV2SongRow): WorkspaceV2Song | null {
  const platform = displayPlatform[String(row.platform ?? "")] ?? "YouTube Music";
  const link = String(row.music_url ?? "").trim();
  if (!link) return null;
  return {
    artist: String(row.artist_name ?? "Unknown Artist"),
    artistId: row.user_id ?? undefined,
    coverUrl: safeCoverUrl(row.cover_image_url),
    durationSeconds:
      typeof row.content_duration_seconds === "number"
        ? row.content_duration_seconds
        : null,
    exposureScore: row.featured ? 0 : 50,
    id: row.id,
    link,
    playbackKind:
      getContentClassification(platform) === "internal" ? "internal" : "external",
    platform,
    title: String(row.title ?? "Untitled Song"),
  };
}

function buildPublicBetaQueue(rows: WorkspaceV2SongRow[], locale: InterfaceLocale): WorkspaceV2Queue {
  const songs = rows
    .map(toWorkspaceSong)
    .filter((song): song is WorkspaceV2Song => Boolean(song))
    .filter((song) => song.playbackKind === "internal");

  return {
    id: "workspace-v2-public-beta",
    mode: "discovery",
    songs,
    source: "featured",
    title:
      locale === "es"
        ? "Workspace V2 Public Beta"
        : "Workspace V2 Public Beta",
  };
}

export async function WorkspaceV2AuthEntry({
  loginRedirectPath = "/dashboard",
}: {
  loginRedirectPath?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/login?next=${encodeURIComponent(loginRedirectPath)}`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, founder_number, interface_language")
    .eq("id", user.id)
    .maybeSingle();

  const { data: rows, error } = await supabase
    .from("songs")
    .select(
      "id, user_id, title, artist_name, cover_image_url, music_url, platform, content_duration_seconds, featured, created_at",
    )
    .eq("is_active", true)
    .is("archived_at", null)
    .is("removed_at", null)
    .in("platform", ["youtube_music", "youtube", "soundcloud"])
    .order("featured", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);

  const typedProfile = profile as WorkspaceV2Profile | null;
  const locale = localeFromProfile(typedProfile);
  const spanish = locale === "es";
  const queue = buildPublicBetaQueue((rows ?? []) as WorkspaceV2SongRow[], locale);
  const viewerMode = viewerModeFromProfile(typedProfile);
  const canAccessAdmin = viewerMode === "founder" || viewerMode === "admin";

  return (
    <main className="workspace-v2-preview-page">
      <header className="account-header workspace-v2-preview-topbar">
        <Logo />
        <div className="owner-header-actions">
          <Link href="/review">
            <ArrowLeft size={16} />
            {spanish ? "Fallback V1" : "V1 fallback"}
          </Link>
          {canAccessAdmin && (
            <Link href="/owner">
              <ShieldCheck size={16} /> Owner Control Center
            </Link>
          )}
        </div>
      </header>

      <section className="workspace-v2-preview-intro">
        <span className="eyebrow">Public Beta</span>
        <h1>Workspace V2</h1>
        <p>
          {spanish
            ? "La nueva experiencia de escucha publica. Submit, Perfil y herramientas legacy permanecen disponibles."
            : "The new public listening experience. Submit, Profile and legacy tools remain available."}
        </p>
      </section>

      {error && (
        <section className="admin-notice" role="alert">
          {spanish
            ? "No se pudo cargar la cola beta:"
            : "Could not load the beta queue:"}{" "}
          {error.message}
        </section>
      )}

      {queue.songs.length === 0 ? (
        <section className="workspace-v2-empty">
          <h2>{spanish ? "No hay canciones internas disponibles" : "No internal songs available"}</h2>
          <p>
            {spanish
              ? "Workspace V2 necesita canciones que reproduzcan dentro de First Listen."
              : "Workspace V2 needs songs that play inside First Listen."}
          </p>
        </section>
      ) : (
        <WorkspaceV2PreviewErrorBoundary>
          <WorkspaceV2Shell
            economyMode="live"
            initialQueue={queue}
            locale={locale}
            viewerMode={viewerMode}
          />
        </WorkspaceV2PreviewErrorBoundary>
      )}
    </main>
  );
}
