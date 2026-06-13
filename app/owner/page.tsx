import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import {
  SuperAdminControlCenter,
  type ControlCenterPayload,
} from "@/components/super-admin-control-center";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type OwnerDirectoryUser = {
  id: string;
  display_name: string;
  email: string;
  role: string;
};

type OwnerSongRow = {
  id: string;
  title: string;
  artist_name: string;
  platform: string;
  is_active: boolean;
  featured: boolean;
  archived_at: string | null;
  removed_at: string | null;
  created_at: string;
};

type OwnerFeedbackRow = {
  id: string;
  user_id: string | null;
  submitter_name: string;
  submitter_email: string | null;
  category: string;
  status: string;
  subject: string;
  message: string;
  screenshot_url: string | null;
  page_url: string | null;
  contact_email: string | null;
  notify_by_email: boolean;
  founder_reply: string | null;
  replied_at: string | null;
  resolved_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export default async function OwnerControlCenterPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/owner");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "super_admin") redirect("/review");

  const [
    { data: controlCenterData, error: controlError },
    { data: users },
    { data: songs },
    { data: reports },
    { data: feedback, error: feedbackError },
  ] = await Promise.all([
    supabase.rpc("admin_get_control_center"),
    supabase.rpc("admin_list_users", { result_limit: 1000 }),
    supabase
      .from("songs")
      .select(
        "id, title, artist_name, platform, is_active, featured, archived_at, removed_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("song_reports")
      .select("song_id")
      .eq("status", "open")
      .limit(5000),
    supabase.rpc("admin_list_feedback", {
      feedback_status: "all",
      result_limit: 100,
    }),
  ]);

  if (controlError || !controlCenterData) {
    return (
      <main className="admin-page">
        <header className="account-header">
          <Logo />
          <Link href="/admin">
            <ArrowLeft size={16} /> Admin Panel
          </Link>
        </header>
        <section className="admin-content">
          <div className="admin-notice" role="alert">
            Owner Control Center is unavailable:{" "}
            {controlError?.message ?? "No control payload returned."}
          </div>
        </section>
      </main>
    );
  }

  const reportCountBySong = new Map<string, number>();
  for (const report of reports ?? []) {
    reportCountBySong.set(
      report.song_id,
      (reportCountBySong.get(report.song_id) ?? 0) + 1,
    );
  }
  const ownerSongs = ((songs ?? []) as OwnerSongRow[]).map((song) => ({
    ...song,
    report_count: reportCountBySong.get(song.id) ?? 0,
  }));

  return (
    <main className="admin-page owner-page">
      <header className="account-header">
        <Logo />
        <div className="owner-header-actions">
          <Link href="/admin">
            <ShieldCheck size={16} /> Admin Panel
          </Link>
          <Link href="/review">
            <ArrowLeft size={16} /> Review Songs
          </Link>
        </div>
      </header>
      {feedbackError && (
        <section className="admin-content">
          <div className="admin-notice" role="alert">
            Feedback Inbox is unavailable: {feedbackError.message}
          </div>
        </section>
      )}
      <SuperAdminControlCenter
        initialData={controlCenterData as ControlCenterPayload}
        feedback={(feedback ?? []) as OwnerFeedbackRow[]}
        songs={ownerSongs}
        users={(users ?? []) as OwnerDirectoryUser[]}
      />
    </main>
  );
}
