"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Flag,
  Headphones,
  Music2,
  Rocket,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
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

type SpotlightSlot = {
  slot_number: number;
  song_id: string | null;
  placement_kind:
    | "sponsored"
    | "new_release"
    | "founder_artist"
    | "contest_winner"
    | "special_event"
    | "editor_pick";
  custom_label: string;
};

type AdminBoost = {
  id: string;
  credit_cost: number;
  status: string;
  requested_at: string;
  songs: { title: string; artist_name: string } | null;
  profiles: { display_name: string } | null;
};

type SpotlightDraft = {
  songId: string;
  placement: SpotlightSlot["placement_kind"];
  label: string;
};

export function AdminPanel({
  role,
  users,
  songs,
  reports,
  initialSection = "users",
  listeningSettings,
  spotlightSlots,
  boosts,
  statistics,
}: {
  role: "super_admin" | "admin" | "moderator";
  users: AdminUser[];
  songs: AdminSong[];
  reports: AdminReport[];
  initialSection?: "users" | "songs" | "reports" | "credits" | "listening" | "discovery" | "statistics";
  listeningSettings: {
    minutes_per_credit: number;
    daily_cap_minutes: number;
    enabled: boolean;
  };
  spotlightSlots: SpotlightSlot[];
  boosts: AdminBoost[];
  statistics: {
    users: number;
    songs: number;
    active_songs: number;
    open_reports: number;
    reviews: number;
    listening_minutes?: number;
  } | null;
}) {
  const [section, setSection] = useState<"users" | "songs" | "reports" | "credits" | "listening" | "discovery" | "statistics">(initialSection);
  const [notice, setNotice] = useState("");
  const [minutesPerCredit, setMinutesPerCredit] = useState(
    listeningSettings.minutes_per_credit,
  );
  const [dailyCapMinutes, setDailyCapMinutes] = useState(
    listeningSettings.daily_cap_minutes,
  );
  const [rewardsEnabled, setRewardsEnabled] = useState(
    listeningSettings.enabled,
  );
  const [spotlightDrafts, setSpotlightDrafts] = useState<
    Record<number, SpotlightDraft>
  >(
    Object.fromEntries(
      [1, 2].map((slotNumber) => {
        const slot = spotlightSlots.find(
          (candidate) => candidate.slot_number === slotNumber,
        );
        return [
          slotNumber,
          {
            songId: slot?.song_id ?? "",
            placement: slot?.placement_kind ?? "editor_pick",
            label: slot?.custom_label ?? "",
          },
        ];
      }),
    ),
  );
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
    ["listening", "Listening", Headphones],
    ["discovery", "Discovery", Sparkles],
    ["statistics", "Statistics", BarChart3],
  ] as const;
  const sections = allSections.filter(([id]) => {
    if (role === "super_admin") return true;
    if (role === "admin") return !["users", "credits", "listening"].includes(id);
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
                    <span>
                      {song.is_active ? "Active" : "Removed"}
                      {song.featured ? " / Spotlight" : ""}
                    </span>
                    <div className="admin-actions">
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
                <div><strong>{statistics?.listening_minutes ?? 0}</strong><span>Listening minutes</span></div>
              </div>
            </>
          )}

          {section === "discovery" && role !== "moderator" && (
            <>
              <h2>Discovery Controls</h2>
              <p className="admin-section-copy">
                Spotlight has two editorial slots. Top 10 remains automatic and
                cannot be edited here.
              </p>
              <div className="admin-spotlight-grid">
                {[1, 2].map((slotNumber) => {
                  const draft = spotlightDrafts[slotNumber];
                  return (
                    <article key={slotNumber}>
                      <span className="eyebrow">
                        <Sparkles size={13} /> Spotlight #{slotNumber}
                      </span>
                      <label>
                        Song
                        <select
                          onChange={(event) =>
                            setSpotlightDrafts((current) => ({
                              ...current,
                              [slotNumber]: {
                                ...current[slotNumber],
                                songId: event.target.value,
                              },
                            }))
                          }
                          value={draft.songId}
                        >
                          <option value="">Empty slot</option>
                          {songs
                            .filter((song) => song.is_active)
                            .map((song) => (
                              <option key={song.id} value={song.id}>
                                {song.title} / {song.artist_name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Placement type
                        <select
                          onChange={(event) =>
                            setSpotlightDrafts((current) => ({
                              ...current,
                              [slotNumber]: {
                                ...current[slotNumber],
                                placement: event.target
                                  .value as SpotlightDraft["placement"],
                              },
                            }))
                          }
                          value={draft.placement}
                        >
                          <option value="editor_pick">Editor Pick</option>
                          <option value="new_release">New Release</option>
                          <option value="founder_artist">Founder Artist</option>
                          <option value="sponsored">Sponsored Song</option>
                          <option value="contest_winner">Contest Winner</option>
                          <option value="special_event">Special Event</option>
                        </select>
                      </label>
                      <label>
                        Public badge
                        <input
                          maxLength={80}
                          onChange={(event) =>
                            setSpotlightDrafts((current) => ({
                              ...current,
                              [slotNumber]: {
                                ...current[slotNumber],
                                label: event.target.value,
                              },
                            }))
                          }
                          placeholder="Editor Pick"
                          value={draft.label}
                        />
                      </label>
                      <button
                        className="primary-button"
                        onClick={() =>
                          void runRpc("admin_set_spotlight_slot", {
                            target_slot: slotNumber,
                            target_song_id: draft.songId || null,
                            placement: draft.placement,
                            label: draft.label,
                            starts_at: null,
                            ends_at: null,
                          })
                        }
                        type="button"
                      >
                        Save Spotlight #{slotNumber}
                      </button>
                    </article>
                  );
                })}
              </div>

              <div className="admin-discovery-divider">
                <span className="eyebrow">
                  <Rocket size={13} /> Boost requests
                </span>
                <h3>Pending approval</h3>
              </div>
              <div className="admin-table">
                {boosts.filter((boost) => boost.status === "pending").length ? (
                  boosts
                    .filter((boost) => boost.status === "pending")
                    .map((boost) => (
                      <article key={boost.id}>
                        <div>
                          <strong>{boost.songs?.title ?? "Unavailable song"}</strong>
                          <small>
                            {boost.songs?.artist_name} /{" "}
                            {boost.profiles?.display_name ?? "Artist"}
                          </small>
                        </div>
                        <span>{boost.credit_cost} credit</span>
                        <div className="admin-actions">
                          <button
                            onClick={() =>
                              void runRpc("admin_review_song_boost", {
                                target_boost_id: boost.id,
                                approve: true,
                                note: "Approved from admin panel",
                              })
                            }
                          >
                            Approve
                          </button>
                          <button
                            onClick={() =>
                              void runRpc("admin_review_song_boost", {
                                target_boost_id: boost.id,
                                approve: false,
                                note: "Rejected from admin panel",
                              })
                            }
                          >
                            Reject
                          </button>
                        </div>
                      </article>
                    ))
                ) : (
                  <div className="empty-state">No pending boost requests.</div>
                )}
              </div>
            </>
          )}

          {section === "listening" && isSuper && (
            <>
              <h2>Listen-to-Earn Settings</h2>
              <div className="admin-settings-card">
                <label>
                  Minutes per credit
                  <input
                    min={30}
                    max={1440}
                    onChange={(event) =>
                      setMinutesPerCredit(Number(event.target.value))
                    }
                    type="number"
                    value={minutesPerCredit}
                  />
                </label>
                <label>
                  Daily cap in minutes
                  <input
                    min={30}
                    max={1440}
                    onChange={(event) =>
                      setDailyCapMinutes(Number(event.target.value))
                    }
                    type="number"
                    value={dailyCapMinutes}
                  />
                </label>
                <label className="admin-setting-toggle">
                  <input
                    checked={rewardsEnabled}
                    onChange={(event) => setRewardsEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  Listening rewards enabled
                </label>
                <button
                  className="primary-button"
                  onClick={() =>
                    void runRpc("admin_update_listening_settings", {
                      new_minutes_per_credit: minutesPerCredit,
                      new_daily_cap_minutes: dailyCapMinutes,
                      rewards_enabled: rewardsEnabled,
                    })
                  }
                  type="button"
                >
                  Save settings
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
