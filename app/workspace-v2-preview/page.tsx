import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import { WorkspaceV2PreviewErrorBoundary } from "@/components/workspace-v2/workspace-v2-preview-error-boundary";
import {
  WorkspaceV2Shell,
  type FounderOperationsSnapshot,
} from "@/components/workspace-v2/workspace-v2-shell";
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

type FounderOperationsUserRow = {
  account_status: string | null;
  banned_at: string | null;
  credits: number | null;
  display_name: string | null;
  email: string | null;
  id: string;
  role: string | null;
  username: string | null;
};

type FounderOperationsSongRow = {
  approval_status: string | null;
  archived_at: string | null;
  id: string;
  is_active: boolean | null;
  removed_at: string | null;
};

type FounderOperationsReportRow = {
  created_at: string;
  id: string;
  reason: string | null;
  status: string | null;
  songs: { artist_name: string | null; title: string | null } | null;
};

type FounderOperationsCommentReportRow = {
  created_at: string;
  id: string;
  reason: string | null;
  reviews: {
    comment: string | null;
    songs: { artist_name: string | null; title: string | null } | null;
  } | null;
  status: string | null;
};

type FounderOperationsFeedbackRow = {
  id: string;
  status: string | null;
};

type FounderOperationsStatistics = {
  active_songs?: number;
  open_reports?: number;
  songs?: number;
  users?: number;
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

function songTitle(row: { artist_name: string | null; title: string | null } | null) {
  if (!row) return "Deleted content";
  return [row.title ?? "Untitled", row.artist_name].filter(Boolean).join(" / ");
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

  const [
    previewSongsResult,
    usersResult,
    operationsSongsResult,
    songReportsResult,
    commentReportsResult,
    statisticsResult,
    feedbackResult,
  ] = await Promise.all([
    supabase
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
      .limit(100),
    supabase.rpc("admin_list_users", { result_limit: 1000 }),
    supabase
      .from("songs")
      .select("id, approval_status, is_active, archived_at, removed_at")
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("song_reports")
      .select("id, reason, status, created_at, songs(title, artist_name)")
      .order("created_at", { ascending: false })
      .limit(250),
    supabase
      .from("review_comment_reports")
      .select("id, reason, status, created_at, reviews(comment, songs(title, artist_name))")
      .order("created_at", { ascending: false })
      .limit(250),
    supabase.rpc("admin_get_statistics"),
    supabase.rpc("admin_list_feedback", {
      feedback_status: "all",
      result_limit: 1000,
    }),
  ]);

  const locale = localeFromProfile(profile);
  const spanish = locale === "es";
  const rows = previewSongsResult.data;
  const error = previewSongsResult.error;
  const queue = buildPreviewQueue((rows ?? []) as PreviewSongRow[]);
  const founderOperationsErrors = [
    usersResult.error ? `users: ${usersResult.error.message}` : null,
    operationsSongsResult.error ? `songs: ${operationsSongsResult.error.message}` : null,
    songReportsResult.error ? `song reports: ${songReportsResult.error.message}` : null,
    commentReportsResult.error
      ? `comment reports: ${commentReportsResult.error.message}`
      : null,
    statisticsResult.error ? `statistics: ${statisticsResult.error.message}` : null,
    feedbackResult.error ? `feedback: ${feedbackResult.error.message}` : null,
  ].filter((message): message is string => Boolean(message));
  const operationsUsers = (usersResult.data ?? []) as FounderOperationsUserRow[];
  const operationsSongs =
    (operationsSongsResult.data ?? []) as FounderOperationsSongRow[];
  const songReports =
    (songReportsResult.data ?? []) as unknown as FounderOperationsReportRow[];
  const commentReports =
    (commentReportsResult.data ??
      []) as unknown as FounderOperationsCommentReportRow[];
  const feedbackRows =
    (feedbackResult.data ?? []) as FounderOperationsFeedbackRow[];
  const statistics =
    (statisticsResult.data ?? null) as FounderOperationsStatistics | null;
  const openSongReports = songReports.filter((report) => report.status === "open");
  const openCommentReports = commentReports.filter(
    (report) => report.status === "open",
  );
  const openFeedback = feedbackRows.filter((item) => item.status === "open").length;
  const inProgressFeedback = feedbackRows.filter(
    (item) => item.status === "in_progress",
  ).length;
  const resolvedFeedback = feedbackRows.filter(
    (item) => item.status === "resolved",
  ).length;
  const founderOperations: FounderOperationsSnapshot = {
    errors: founderOperationsErrors.length ? founderOperationsErrors : undefined,
    feedback: {
      inProgress: inProgressFeedback,
      open: openFeedback,
      resolved: resolvedFeedback,
    },
    reports: [
      ...openSongReports.map((report) => ({
        createdAt: report.created_at,
        id: `song-${report.id}`,
        reportType: report.reason ?? "song_report",
        status: report.status ?? "open",
        targetContent: songTitle(report.songs),
      })),
      ...openCommentReports.map((report) => ({
        createdAt: report.created_at,
        id: `comment-${report.id}`,
        reportType: `comment_${report.reason ?? "report"}`,
        status: report.status ?? "open",
        targetContent: songTitle(report.reviews?.songs ?? null),
      })),
    ],
    summary: {
      activeUsers: operationsUsers.filter(
        (listedUser) =>
          listedUser.account_status === "active" && !listedUser.banned_at,
      ).length,
      openFeedbackItems: openFeedback + inProgressFeedback,
      openReports: openSongReports.length + openCommentReports.length,
      songsPendingReview: operationsSongs.filter(
        (song) => song.approval_status === "pending",
      ).length,
      totalSongs: Number(statistics?.songs ?? operationsSongs.length),
      totalUsers: Number(statistics?.users ?? operationsUsers.length),
    },
    users: operationsUsers.map((listedUser) => ({
      email: listedUser.email ?? "",
      id: listedUser.id,
      role: listedUser.role ?? "user",
      tokenBalance: Number(listedUser.credits ?? 0),
      username:
        listedUser.username ||
        listedUser.display_name ||
        listedUser.email ||
        listedUser.id,
    })),
  };

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
        <h1>Workspace V2 Product Shell</h1>
        <p>
          {spanish
            ? "Vista Founder para validar el shell de producto antes de activarlo para usuarios."
            : "Founder view for validating the product shell before enabling it for users."}
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
        <WorkspaceV2PreviewErrorBoundary>
          <WorkspaceV2Shell
            economyMode="live"
            founderOperations={founderOperations}
            initialQueue={queue}
            locale={locale}
            viewerMode="founder"
          />
        </WorkspaceV2PreviewErrorBoundary>
      )}
    </main>
  );
}
