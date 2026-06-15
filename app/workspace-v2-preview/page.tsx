import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import { WorkspaceV2Shell } from "@/components/workspace-v2/workspace-v2-shell";
import { isFounderOneIdentity } from "@/lib/admin-access";
import type { InterfaceLocale } from "@/lib/catalog";
import { displayPlatform, getContentClassification } from "@/lib/content-economy";
import { safeCoverUrl } from "@/lib/media";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceV2Queue, WorkspaceV2Song } from "@/lib/workspace-v2";

export const dynamic = "force-dynamic";

type PreviewProfile = {
  founder_number: number | null;
  interface_language: string | null;
  role: string | null;
};

type PreviewSongRow = {
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

function localeFromProfile(profile: PreviewProfile | null): InterfaceLocale {
  return profile?.interface_language === "es" ? "es" : "en";
}

function toWorkspaceSong(row: PreviewSongRow): WorkspaceV2Song | null {
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

function buildPreviewQueue(rows: PreviewSongRow[]): WorkspaceV2Queue {
  const songs = rows
    .map(toWorkspaceSong)
    .filter((song): song is WorkspaceV2Song => Boolean(song))
    .filter((song) => song.playbackKind === "internal");

  return {
    id: "founder-workspace-v2-preview",
    mode: "discovery",
    songs,
    source: "featured",
    title: "Founder Workspace V2 Preview Sandbox",
  };
}

export default async function WorkspaceV2PreviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/workspace-v2-preview");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, founder_number, interface_language")
    .eq("id", user.id)
    .maybeSingle();

  if (!isFounderOneIdentity(profile, user.email)) redirect("/dashboard");

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

  const locale = localeFromProfile(profile);
  const spanish = locale === "es";
  const queue = buildPreviewQueue((rows ?? []) as PreviewSongRow[]);

  return (
    <main className="workspace-v2-preview-page">
      <header className="account-header workspace-v2-preview-topbar">
        <Logo />
        <div className="owner-header-actions">
          <Link href="/dashboard">
            <ArrowLeft size={16} /> {spanish ? "Volver al Workspace" : "Back to Workspace"}
          </Link>
          <Link href="/owner">
            <ShieldCheck size={16} /> Owner Control Center
          </Link>
        </div>
      </header>

      <section className="workspace-v2-preview-intro">
        <span className="eyebrow">Founder-only Preview</span>
        <h1>Workspace V2 Preview</h1>
        <p>
          {spanish
            ? "Esta ruta permite validar el nuevo motor de reproduccion sin activar cambios para usuarios."
            : "This route validates the new playback engine without switching production users."}
        </p>
      </section>

      {error && (
        <section className="admin-notice" role="alert">
          {spanish
            ? "No se pudo cargar la cola de prueba:"
            : "Could not load the preview queue:"}{" "}
          {error.message}
        </section>
      )}

      {queue.songs.length === 0 ? (
        <section className="workspace-v2-empty">
          <h2>{spanish ? "No hay canciones internas disponibles" : "No internal songs available"}</h2>
          <p>
            {spanish
              ? "La preview requiere canciones con reproduccion dentro de First Listen para medir autoplay, telemetria y memoria."
              : "The preview needs songs that play inside First Listen to test autoplay, telemetry and memory."}
          </p>
        </section>
      ) : (
        <WorkspaceV2Shell initialQueue={queue} locale={locale} />
      )}
    </main>
  );
}
