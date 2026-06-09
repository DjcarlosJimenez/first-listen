"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3, Flag, Music2, ShieldCheck, Users } from "lucide-react";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/client";

type AdminUser = {
  id: string;
  display_name: string;
  role: "super_admin" | "admin" | "moderator" | "user";
  account_status: "active" | "suspended";
  credits: number;
  completed_reviews: number;
  created_at: string;
};

type AdminSong = {
  id: string;
  title: string;
  artist_name: string;
  platform: string;
  is_active: boolean;
  featured: boolean;
  created_at: string;
};

type AdminReport = {
  id: string;
  reason: string;
  status: string;
  details: string | null;
  created_at: string;
  songs: { title: string; artist_name: string } | null;
};

export function AdminPanel({
  role,
  users,
  songs,
  reports,
  initialSection = "users",
  statistics,
}: {
  role: "super_admin" | "admin" | "moderator";
  users: AdminUser[];
  songs: AdminSong[];
  reports: AdminReport[];
  initialSection?: "users" | "songs" | "reports" | "credits" | "statistics";
  statistics: {
    users: number;
    songs: number;
    active_songs: number;
    open_reports: number;
    reviews: number;
  } | null;
}) {
  const [section, setSection] = useState<"users" | "songs" | "reports" | "credits" | "statistics">(initialSection);
  const [notice, setNotice] = useState("");
  const isSuper = role === "super_admin";
  const supabase = createClient();

  const runRpc = async (name: string, params: Record<string, unknown>) => {
    if (!supabase) return;
    const { error } = await supabase.rpc(name, params);
    setNotice(error ? error.message : "Change saved. Refreshing...");
    if (!error) window.setTimeout(() => window.location.reload(), 500);
  };

  const resetPassword = async (userId: string) => {
    const response = await fetch(`/api/admin/users/${userId}/reset-password`, { method: "POST" });
    const data = await response.json();
    setNotice(
      response.ok
        ? "Password recovery email requested."
        : data.error,
    );
  };

  const allSections = [
    ["users", "Users", Users],
    ["songs", "Songs", Music2],
    ["reports", "Reports", Flag],
    ["credits", "Credits", ShieldCheck],
    ["statistics", "Statistics", BarChart3],
  ] as const;
  const sections = allSections.filter(([id]) => {
    if (role === "super_admin") return true;
    if (role === "admin") return !["users", "credits"].includes(id);
    return id === "reports";
  });

  return (
    <main className="admin-page">
      <header className="account-header">
        <Logo />
        <Link href="/dashboard"><ArrowLeft size={16} /> Dashboard</Link>
      </header>
      <div className="admin-shell">
        <aside className="admin-nav">
          <span className="eyebrow">{role.replace("_", " ")}</span>
          <h1>Administration</h1>
          {sections.map(([id, label, Icon]) => (
            <button className={section === id ? "active" : ""} key={id} onClick={() => setSection(id)}>
              <Icon size={17} /> {label}
            </button>
          ))}
        </aside>

        <section className="admin-content">
          {notice && <div className="admin-notice" role="status">{notice}</div>}

          {section === "users" && isSuper && (
            <>
              <h2>Users</h2>
              <div className="admin-table">
                {users.map((user) => (
                  <article key={user.id}>
                    <div><strong>{user.display_name}</strong><small>{user.role} / {user.account_status}</small></div>
                    <span>{user.credits} credits</span>
                    {isSuper && (
                      <div className="admin-actions">
                        <select
                          aria-label={`Role for ${user.display_name}`}
                          defaultValue={user.role}
                          onChange={(event) => void runRpc("admin_set_role", {
                            target_user_id: user.id,
                            new_role: event.target.value,
                          })}
                        >
                          <option value="user">User</option>
                          <option value="moderator">Moderator</option>
                          <option value="admin">Admin</option>
                          <option value="super_admin">Super Admin</option>
                        </select>
                        <button onClick={() => void runRpc("admin_set_account_status", {
                          target_user_id: user.id,
                          new_status: user.account_status === "active" ? "suspended" : "active",
                        })}>
                          {user.account_status === "active" ? "Suspend" : "Activate"}
                        </button>
                        <button onClick={() => void resetPassword(user.id)}>Send password reset</button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}

          {section === "songs" && (
            <>
              <h2>Songs</h2>
              <div className="admin-table">
                {songs.map((song) => (
                  <article key={song.id}>
                    <div><strong>{song.title}</strong><small>{song.artist_name} / {song.platform}</small></div>
                    <span>{song.is_active ? "Active" : "Removed"}</span>
                    <div className="admin-actions">
                      {role !== "moderator" && (
                        <button onClick={() => void runRpc("admin_set_song_state", {
                          target_song_id: song.id,
                          active: true,
                          feature: !song.featured,
                        })}>{song.featured ? "Unfeature" : "Feature"}</button>
                      )}
                      <button onClick={() => void runRpc("admin_set_song_state", {
                        target_song_id: song.id,
                        active: !song.is_active,
                        feature: false,
                      })}>{song.is_active ? "Remove" : "Restore"}</button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}

          {section === "reports" && (
            <>
              <h2>Reports</h2>
              <div className="admin-table">
                {reports.map((report) => (
                  <article key={report.id}>
                    <div>
                      <strong>{report.songs?.title ?? "Deleted song"}</strong>
                      <small>{report.reason.replace("_", " ")} / {report.status}</small>
                    </div>
                    <span>{report.details || "No details"}</span>
                    <div className="admin-actions">
                      <button onClick={() => void runRpc("admin_resolve_report", {
                        target_report_id: report.id,
                        new_status: "resolved",
                      })}>Resolve</button>
                      <button onClick={() => void runRpc("admin_resolve_report", {
                        target_report_id: report.id,
                        new_status: "dismissed",
                      })}>Dismiss</button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}

          {section === "credits" && isSuper && (
            <>
              <h2>Credits</h2>
              <div className="admin-table">
                  {users.map((user) => (
                    <article key={user.id}>
                      <div><strong>{user.display_name}</strong><small>{user.credits} credits</small></div>
                      <div className="admin-actions">
                        <button onClick={() => void runRpc("admin_adjust_credits", {
                          target_user_id: user.id,
                          credit_delta: 1,
                          adjustment_reason: "Admin adjustment",
                        })}>+1</button>
                        <button onClick={() => void runRpc("admin_adjust_credits", {
                          target_user_id: user.id,
                          credit_delta: -1,
                          adjustment_reason: "Admin adjustment",
                        })}>-1</button>
                      </div>
                    </article>
                  ))}
              </div>
            </>
          )}

          {section === "statistics" && (
            <>
              <h2>Statistics</h2>
              <div className="admin-stats">
                <div><strong>{statistics?.users ?? 0}</strong><span>Users</span></div>
                <div><strong>{statistics?.songs ?? songs.length}</strong><span>Songs</span></div>
                <div><strong>{statistics?.open_reports ?? reports.filter((report) => report.status === "open").length}</strong><span>Open reports</span></div>
                <div><strong>{statistics?.active_songs ?? songs.filter((song) => song.is_active).length}</strong><span>Active songs</span></div>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
