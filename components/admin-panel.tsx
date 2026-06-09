"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Flag,
  Headphones,
  Music2,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/client";

type AdminUser = {
  id: string;
  display_name: string;
  email: string;
  username: string;
  role: "super_admin" | "admin" | "moderator" | "user";
  account_status: "active" | "suspended";
  creator_activity_status: "active" | "paused" | "archived";
  founder_number: number | null;
  banned_at: string | null;
  warning_count: number;
  credits: number;
  completed_reviews: number;
  created_at: string;
};

type AdminSong = {
  id: string;
  user_id: string;
  title: string;
  artist_name: string;
  platform: string;
  is_active: boolean;
  featured: boolean;
  content_kind: string;
  content_duration_seconds: number | null;
  queue_tier: string;
  approval_status: string;
  created_at: string;
  creator_activity_status: "active" | "paused" | "archived";
  founder: boolean;
  report_count: number;
};

type AdminReport = {
  id: string;
  reason: string;
  status: string;
  details: string | null;
  created_at: string;
  songs: { title: string; artist_name: string } | null;
};

type AdminCommentReport = {
  id: string;
  review_id: string;
  reported_user_id: string;
  reason: string;
  status: string;
  details: string | null;
  created_at: string;
  reviews: {
    comment: string;
    songs: { title: string; artist_name: string } | null;
  } | null;
  profiles: { display_name: string } | null;
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
  commentReports,
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
  commentReports: AdminCommentReport[];
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
  const [userSearch, setUserSearch] = useState("");
  const [userFilter, setUserFilter] = useState<
    "all" | "active" | "paused" | "archived" | "founder" | "admin" | "moderator" | "banned"
  >("all");
  const [songSearch, setSongSearch] = useState("");
  const [songFilter, setSongFilter] = useState<
    "all" | "active" | "paused" | "archived" | "spotlight" | "founder" | "reported"
  >("all");
  const [creditChanges, setCreditChanges] = useState<Record<string, string>>({});
  const [creditReasons, setCreditReasons] = useState<Record<string, string>>({});
  const [moderationReasons, setModerationReasons] = useState<
    Record<string, string>
  >({});
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
  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch =
        !query ||
        user.display_name.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query) ||
        user.username.toLowerCase().includes(query) ||
        user.id.toLowerCase().includes(query);
      if (!matchesSearch) return false;
      if (userFilter === "all") return true;
      if (userFilter === "banned") return Boolean(user.banned_at);
      if (userFilter === "founder") return user.founder_number !== null;
      if (userFilter === "admin") {
        return user.role === "admin" || user.role === "super_admin";
      }
      if (userFilter === "moderator") return user.role === "moderator";
      return user.creator_activity_status === userFilter;
    });
  }, [userFilter, userSearch, users]);
  const filteredSongs = useMemo(() => {
    const query = songSearch.trim().toLowerCase();
    return songs.filter((song) => {
      const effectiveStatus = !song.is_active
        ? "removed"
        : song.creator_activity_status;
      const matchesSearch =
        !query ||
        song.title.toLowerCase().includes(query) ||
        song.artist_name.toLowerCase().includes(query) ||
        song.platform.toLowerCase().includes(query) ||
        effectiveStatus.includes(query) ||
        song.approval_status.toLowerCase().includes(query);
      if (!matchesSearch) return false;
      if (songFilter === "all") return true;
      if (songFilter === "spotlight") return song.featured;
      if (songFilter === "founder") return song.founder;
      if (songFilter === "reported") return song.report_count > 0;
      if (songFilter === "active") {
        return song.is_active && song.creator_activity_status === "active";
      }
      return song.creator_activity_status === songFilter;
    });
  }, [songFilter, songSearch, songs]);

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
    if (role === "admin") return !["credits", "listening"].includes(id);
    return ["users", "reports"].includes(id);
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

          {section === "users" && (
            <>
              <div className="admin-section-heading">
                <div><h2>Users</h2><span>Total Users: {statistics?.users ?? users.length}</span></div>
                <label className="admin-search">
                  <Search size={16} />
                  <input
                    aria-label="Search users"
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder="Search name, email, username, or user ID"
                    value={userSearch}
                  />
                </label>
              </div>
              <div className="admin-filter-row" aria-label="User filters">
                {(["all", "active", "paused", "archived", "founder", "admin", "moderator", "banned"] as const).map((filter) => (
                  <button
                    className={userFilter === filter ? "active" : ""}
                    key={filter}
                    onClick={() => setUserFilter(filter)}
                    type="button"
                  >
                    {filter === "all" ? "All Users" : filter.replace("_", " ")}
                  </button>
                ))}
                <span>{filteredUsers.length} shown</span>
              </div>
              <div className="admin-table">
                {filteredUsers.map((user) => (
                  <article key={user.id}>
                    <div>
                      <strong>{user.display_name}</strong>
                      <small>
                        {user.email || user.username || user.id} / {user.role} /{" "}
                        {user.banned_at ? "banned" : user.account_status} /{" "}
                        creator {user.creator_activity_status} / {user.warning_count} warnings
                      </small>
                    </div>
                    <span>{user.credits} tokens</span>
                    <div className="admin-actions admin-user-actions">
                      {isSuper && (
                        <>
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
                          <button onClick={() => void resetPassword(user.id)}>Send password reset</button>
                        </>
                      )}
                      <input
                        aria-label={`Moderation reason for ${user.display_name}`}
                        onChange={(event) =>
                          setModerationReasons((current) => ({
                            ...current,
                            [user.id]: event.target.value,
                          }))
                        }
                        placeholder="Moderation reason"
                        value={moderationReasons[user.id] ?? ""}
                      />
                      <button
                        onClick={() =>
                          void runRpc("admin_issue_user_warning", {
                            target_user_id: user.id,
                            warning_reason:
                              moderationReasons[user.id] ||
                              "Community guideline violation",
                          })
                        }
                      >
                        Warn
                      </button>
                      <button
                        onClick={() =>
                          void runRpc("admin_enforce_account", {
                            target_user_id: user.id,
                            enforcement:
                              user.account_status === "active"
                                ? "suspend"
                                : "activate",
                            enforcement_reason:
                              moderationReasons[user.id] ||
                              "Moderator account action",
                          })
                        }
                      >
                        {user.account_status === "active" ? "Suspend" : "Activate"}
                      </button>
                      <button
                        onClick={() =>
                          void runRpc("admin_enforce_account", {
                            target_user_id: user.id,
                            enforcement: "ban",
                            enforcement_reason:
                              moderationReasons[user.id] ||
                              "Repeated community guideline violations",
                          })
                        }
                      >
                        Ban
                      </button>
                    </div>
                  </article>
                ))}
                {!filteredUsers.length && <div className="empty-state">No users match this search.</div>}
              </div>
            </>
          )}

          {section === "songs" && (
            <>
              <div className="admin-section-heading">
                <div><h2>Songs</h2><span>Total Songs: {statistics?.songs ?? songs.length}</span></div>
                <label className="admin-search">
                  <Search size={16} />
                  <input
                    aria-label="Search songs"
                    onChange={(event) => setSongSearch(event.target.value)}
                    placeholder="Search title, artist, platform, or status"
                    value={songSearch}
                  />
                </label>
              </div>
              <div className="admin-filter-row" aria-label="Song filters">
                {(["all", "active", "paused", "archived", "spotlight", "founder", "reported"] as const).map((filter) => (
                  <button
                    className={songFilter === filter ? "active" : ""}
                    key={filter}
                    onClick={() => setSongFilter(filter)}
                    type="button"
                  >
                    {filter === "all" ? "All Songs" : filter}
                  </button>
                ))}
                <span>{filteredSongs.length} shown</span>
              </div>
              <div className="admin-table">
                {filteredSongs.map((song) => (
                  <article key={song.id}>
                    <div><strong>{song.title}</strong><small>{song.artist_name} / {song.platform}</small></div>
                    <span>
                      {song.approval_status === "pending"
                          ? "Pending long-form approval"
                        : song.is_active
                          ? song.creator_activity_status
                          : "Removed"}
                      {song.featured ? " / Spotlight" : ""}
                      {song.founder ? " / Founder" : ""}
                      {song.report_count ? ` / ${song.report_count} reports` : ""}
                      {song.content_duration_seconds
                        ? ` / ${Math.floor(song.content_duration_seconds / 60)}:${String(
                            song.content_duration_seconds % 60,
                          ).padStart(2, "0")}`
                        : ""}
                    </span>
                    <div className="admin-actions">
                      {song.approval_status === "pending" &&
                        role !== "moderator" && (
                          <>
                            <button
                              onClick={() =>
                                void runRpc("admin_approve_long_form_song", {
                                  target_song_id: song.id,
                                  approve: true,
                                  approval_reason:
                                    "Approved for the long-form queue",
                                })
                              }
                            >
                              Approve
                            </button>
                            <button
                              onClick={() =>
                                void runRpc("admin_approve_long_form_song", {
                                  target_song_id: song.id,
                                  approve: false,
                                  approval_reason:
                                    "Not approved for the public queue",
                                })
                              }
                            >
                              Reject
                            </button>
                          </>
                        )}
                      <button onClick={() => void runRpc("admin_set_song_state", {
                        target_song_id: song.id,
                        active: !song.is_active,
                        feature: false,
                      })}>{song.is_active ? "Remove" : "Restore"}</button>
                    </div>
                  </article>
                ))}
                {!filteredSongs.length && <div className="empty-state">No songs match this search.</div>}
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
              <div className="admin-discovery-divider">
                <span className="eyebrow">Comment moderation</span>
                <h3>Reported review comments</h3>
              </div>
              <div className="admin-table">
                {commentReports.length ? (
                  commentReports.map((report) => (
                    <article key={report.id}>
                      <div>
                        <strong>
                          {report.reviews?.songs?.title ?? "Deleted song"}
                        </strong>
                        <small>
                          {report.profiles?.display_name ?? "Listener"} /{" "}
                          {report.reason.replaceAll("_", " ")} / {report.status}
                        </small>
                      </div>
                      <span>
                        {report.reviews?.comment ?? report.details ?? "No comment"}
                      </span>
                      <div className="admin-actions">
                        <button
                          onClick={() =>
                            void runRpc("admin_moderate_review_comment", {
                              target_review_id: report.review_id,
                              moderation_action: "remove",
                              moderation_reason: report.reason.replaceAll("_", " "),
                            })
                          }
                        >
                          Remove comment
                        </button>
                        <button
                          onClick={() =>
                            void runRpc("admin_issue_user_warning", {
                              target_user_id: report.reported_user_id,
                              warning_reason: `Reported comment: ${report.reason.replaceAll("_", " ")}`,
                            })
                          }
                        >
                          Warn user
                        </button>
                        <button
                          onClick={() =>
                            void runRpc("admin_enforce_account", {
                              target_user_id: report.reported_user_id,
                              enforcement: "suspend",
                              enforcement_reason: `Reported comment: ${report.reason.replaceAll("_", " ")}`,
                            })
                          }
                        >
                          Suspend
                        </button>
                        <button
                          onClick={() =>
                            void runRpc("admin_resolve_comment_report", {
                              target_report_id: report.id,
                              new_status: "resolved",
                            })
                          }
                        >
                          Resolve
                        </button>
                        <button
                          onClick={() =>
                            void runRpc("admin_resolve_comment_report", {
                              target_report_id: report.id,
                              new_status: "dismissed",
                            })
                          }
                        >
                          Dismiss
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">No comment reports.</div>
                )}
              </div>
            </>
          )}

          {section === "credits" && isSuper && (
            <>
              <h2>Credits</h2>
              <p className="admin-section-copy">
                Submission credits are displayed to members as Tokens. Enter a
                positive or negative amount; every change remains in the audit
                and credit ledgers.
              </p>
              <div className="admin-table">
                {users.map((user) => {
                  const delta = Number(creditChanges[user.id] ?? 0);
                  const nextBalance = user.credits + (Number.isFinite(delta) ? delta : 0);
                  return (
                    <article key={user.id}>
                      <div>
                        <strong>{user.display_name}</strong>
                        <small>Current balance: {user.credits} tokens</small>
                      </div>
                      <div className="credit-adjustment-preview">
                        <span>Change: {delta > 0 ? `+${delta}` : delta}</span>
                        <strong>New balance: {nextBalance}</strong>
                      </div>
                      <div className="admin-actions credit-adjustment-actions">
                        <input
                          aria-label={`Token change for ${user.display_name}`}
                          onChange={(event) =>
                            setCreditChanges((current) => ({
                              ...current,
                              [user.id]: event.target.value,
                            }))
                          }
                          placeholder="+10 or -3"
                          type="number"
                          value={creditChanges[user.id] ?? ""}
                        />
                        <input
                          aria-label={`Reason for ${user.display_name}`}
                          onChange={(event) =>
                            setCreditReasons((current) => ({
                              ...current,
                              [user.id]: event.target.value,
                            }))
                          }
                          placeholder="Adjustment reason"
                          value={creditReasons[user.id] ?? ""}
                        />
                        {[3, 10, 25, 50, 100].map((amount) => (
                          <button
                            key={amount}
                            onClick={() =>
                              setCreditChanges((current) => ({
                                ...current,
                                [user.id]: String(amount),
                              }))
                            }
                            type="button"
                          >
                            +{amount}
                          </button>
                        ))}
                        <button
                          disabled={
                            !Number.isInteger(delta) ||
                            delta === 0 ||
                            nextBalance < 0
                          }
                          onClick={() =>
                            void runRpc("admin_adjust_credits", {
                              target_user_id: user.id,
                              credit_delta: delta,
                              adjustment_reason:
                                creditReasons[user.id] || "Admin token adjustment",
                            })
                          }
                          type="button"
                        >
                          Apply change
                        </button>
                      </div>
                    </article>
                  );
                })}
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
                        <span>{boost.credit_cost} tokens</span>
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
                  Minutes per token
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
