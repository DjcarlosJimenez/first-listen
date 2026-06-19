import type {
  FounderDiscoveryAnalyticsReport,
  FounderOperationsSnapshot,
} from "@/lib/founder-operations-types";
import { createClient } from "@/lib/supabase/server";

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

function songTitle(row: { artist_name: string | null; title: string | null } | null) {
  if (!row) return "Deleted content";
  return [row.title ?? "Untitled", row.artist_name].filter(Boolean).join(" / ");
}

export async function loadFounderOperationsSnapshot(): Promise<FounderOperationsSnapshot> {
  const supabase = await createClient();
  const [
    usersResult,
    operationsSongsResult,
    songReportsResult,
    commentReportsResult,
    statisticsResult,
    feedbackResult,
    discoveryAnalyticsResult,
  ] = await Promise.all([
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
    supabase.rpc("get_founder_discovery_analytics_report"),
  ]);

  const founderOperationsErrors = [
    usersResult.error ? `users: ${usersResult.error.message}` : null,
    operationsSongsResult.error ? `songs: ${operationsSongsResult.error.message}` : null,
    songReportsResult.error ? `song reports: ${songReportsResult.error.message}` : null,
    commentReportsResult.error
      ? `comment reports: ${commentReportsResult.error.message}`
      : null,
    statisticsResult.error ? `statistics: ${statisticsResult.error.message}` : null,
    feedbackResult.error ? `feedback: ${feedbackResult.error.message}` : null,
    discoveryAnalyticsResult.error
      ? `discovery analytics: ${discoveryAnalyticsResult.error.message}`
      : null,
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
  const discoveryAnalytics =
    (discoveryAnalyticsResult.data ?? null) as FounderDiscoveryAnalyticsReport | null;
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

  return {
    discoveryAnalytics,
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
}
