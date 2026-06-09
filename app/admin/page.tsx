import { redirect } from "next/navigation";
import { AdminPanel } from "@/components/admin-panel";
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
      .select("id, display_name, role, account_status, banned_at, warning_count, credits, completed_reviews, created_at")
      .order("created_at", { ascending: false })
      .limit(250),
    supabase
      .from("songs")
      .select("id, title, artist_name, platform, is_active, featured, content_kind, content_duration_seconds, queue_tier, approval_status, created_at")
      .order("created_at", { ascending: false })
      .limit(250),
    supabase
      .from("review_comment_reports")
      .select(
        "id, review_id, reported_user_id, reason, status, details, created_at, reviews(comment, songs(title, artist_name)), profiles!review_comment_reports_reported_user_id_fkey(display_name)",
      )
      .order("created_at", { ascending: false })
      .limit(250),
    supabase
      .from("song_reports")
      .select("id, reason, status, details, created_at, songs(title, artist_name)")
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
      songs={songs ?? []}
      statistics={(statistics as {
        users: number;
        songs: number;
        active_songs: number;
        open_reports: number;
        reviews: number;
        listening_minutes?: number;
      } | null) ?? null}
      users={users ?? []}
    />
  );
}

export default function AdminPage() {
  return <AdminPageContent />;
}
