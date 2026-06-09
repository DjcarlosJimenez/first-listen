import { redirect } from "next/navigation";
import { AdminPanel } from "@/components/admin-panel";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function AdminPageContent({
  initialSection = "users",
  allowModerator = false,
}: {
  initialSection?: "users" | "songs" | "reports" | "credits" | "listening" | "discovery" | "statistics";
  allowModerator?: boolean;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const allowedRoles = allowModerator
    ? ["super_admin", "admin", "moderator"]
    : ["super_admin", "admin"];
  if (!profile || !allowedRoles.includes(profile.role)) {
    redirect("/dashboard");
  }
  await supabase.rpc("refresh_creator_activity_status", {
    target_user_id: null,
  });
  const effectiveInitialSection =
    profile.role === "super_admin"
      ? initialSection
      : profile.role === "admin"
        ? ["songs", "reports", "discovery", "statistics"].includes(initialSection)
          ? initialSection
          : "songs"
        : "reports";

  const [
    { data: users },
    { data: songs },
    { data: commentReports },
    { data: reports },
    { data: statistics },
    { data: listeningRows },
    { data: spotlightSlots },
    { data: boosts },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, role, account_status, creator_activity_status, founder_number, banned_at, warning_count, credits, completed_reviews, created_at")
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("songs")
      .select("id, user_id, title, artist_name, platform, is_active, featured, content_kind, content_duration_seconds, queue_tier, approval_status, created_at")
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("review_comment_reports")
      .select(
        "id, review_id, reported_user_id, reason, status, details, created_at, reviews(comment, songs(title, artist_name)), profiles!review_comment_reports_reported_user_id_fkey(display_name)",
      )
      .order("created_at", { ascending: false })
      .limit(250),
    supabase
      .from("song_reports")
      .select("id, song_id, reason, status, details, created_at, songs(title, artist_name)")
      .order("created_at", { ascending: false })
      .limit(250),
    profile.role === "moderator"
      ? Promise.resolve({ data: null })
      : supabase.rpc("admin_get_statistics"),
    supabase
      .from("listening_reward_settings")
      .select("minutes_per_credit, daily_cap_minutes, enabled")
      .eq("id", true)
      .maybeSingle(),
    supabase
      .from("spotlight_slots")
      .select("slot_number, song_id, placement_kind, custom_label")
      .order("slot_number"),
    supabase
      .from("song_boosts")
      .select(
        "id, credit_cost, status, requested_at, songs(title, artist_name), profiles!song_boosts_requested_by_fkey(display_name)",
      )
      .order("requested_at", { ascending: false })
      .limit(100),
  ]);

  let authUsers: Array<{
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  }> = [];
  try {
    const adminClient = createAdminClient();
    const { data } = await adminClient.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    authUsers = data.users;
  } catch {
    authUsers = [];
  }
  const authById = new Map(authUsers.map((authUser) => [authUser.id, authUser]));
  const profileById = new Map(
    (users ?? []).map((listedProfile) => [listedProfile.id, listedProfile]),
  );
  const reportCountBySong = new Map<string, number>();
  for (const report of reports ?? []) {
    reportCountBySong.set(
      report.song_id,
      (reportCountBySong.get(report.song_id) ?? 0) + 1,
    );
  }
  const enrichedUsers = (users ?? []).map((listedProfile) => {
    const authUser = authById.get(listedProfile.id);
    const email = authUser?.email ?? "";
    const metadataUsername =
      typeof authUser?.user_metadata?.username === "string"
        ? authUser.user_metadata.username
        : "";
    return {
      ...listedProfile,
      email,
      username: metadataUsername || email.split("@")[0] || "",
    };
  });
  const enrichedSongs = (songs ?? []).map((song) => {
    const owner = profileById.get(song.user_id);
    return {
      ...song,
      creator_activity_status:
        owner?.creator_activity_status ?? "active",
      founder: owner?.founder_number !== null && owner?.founder_number !== undefined,
      report_count: reportCountBySong.get(song.id) ?? 0,
    };
  });

  return (
    <AdminPanel
      initialSection={effectiveInitialSection as "users" | "songs" | "reports" | "credits" | "listening" | "discovery" | "statistics"}
      listeningSettings={{
        minutes_per_credit: Number(listeningRows?.minutes_per_credit ?? 120),
        daily_cap_minutes: Number(listeningRows?.daily_cap_minutes ?? 180),
        enabled: Boolean(listeningRows?.enabled ?? true),
      }}
      reports={(reports ?? []) as never}
      commentReports={(commentReports ?? []) as never}
      spotlightSlots={(spotlightSlots ?? []) as never}
      boosts={(boosts ?? []) as never}
      role={profile.role}
      songs={enrichedSongs}
      statistics={(statistics as {
        users: number;
        songs: number;
        active_songs: number;
        open_reports: number;
        reviews: number;
        listening_minutes?: number;
      } | null) ?? null}
      users={enrichedUsers}
    />
  );
}

export default function AdminPage() {
  return <AdminPageContent />;
}
