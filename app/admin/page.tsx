import { redirect } from "next/navigation";
import { AdminPanel } from "@/components/admin-panel";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function AdminPageContent({
  initialSection = "users",
  allowModerator = false,
}: {
  initialSection?: "users" | "songs" | "reports" | "credits" | "statistics";
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
        ? ["songs", "reports", "statistics"].includes(initialSection)
          ? initialSection
          : "songs"
        : "reports";

  const [{ data: users }, { data: songs }, { data: reports }, { data: statistics }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, role, account_status, credits, completed_reviews, created_at")
      .order("created_at", { ascending: false })
      .limit(250),
    supabase
      .from("songs")
      .select("id, title, artist_name, platform, is_active, featured, created_at")
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
  ]);

  return (
    <AdminPanel
      initialSection={effectiveInitialSection as "users" | "songs" | "reports" | "credits" | "statistics"}
      reports={(reports ?? []) as never}
      role={profile.role}
      songs={songs ?? []}
      statistics={(statistics as {
        users: number;
        songs: number;
        active_songs: number;
        open_reports: number;
        reviews: number;
      } | null) ?? null}
      users={users ?? []}
    />
  );
}

export default function AdminPage() {
  return <AdminPageContent />;
}
