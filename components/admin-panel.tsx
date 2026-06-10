"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CopyCheck,
  Eye,
  Flag,
  Headphones,
  Link2,
  Megaphone,
  Music2,
  Palette,
  RotateCcw,
  Rocket,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { Logo } from "@/components/logo";
import {
  compactClassificationLabel,
  displayPlatform,
} from "@/lib/content-economy";
import {
  platformThemePresetLabels,
  platformThemePresets,
  type PlatformTheme,
  type PlatformThemePreset,
} from "@/lib/platform-theme";
import { createClient } from "@/lib/supabase/client";

type AdminSection =
  | "users"
  | "songs"
  | "reports"
  | "credits"
  | "listening"
  | "economy"
  | "discovery"
  | "appearance"
  | "announcements"
  | "health"
  | "statistics";

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
  music_url: string;
  is_active: boolean;
  featured: boolean;
  archived_at: string | null;
  removed_at: string | null;
  merged_into_song_id: string | null;
  content_kind: string;
  content_duration_seconds: number | null;
  queue_tier: string;
  approval_status: string;
  created_at: string;
  creator_activity_status: "active" | "paused" | "archived";
  founder: boolean;
  report_count: number;
};

type DuplicateCandidate = {
  canonical_song_id: string;
  canonical_title: string;
  canonical_owner_id: string;
  canonical_owner_name: string;
  duplicate_song_id: string;
  duplicate_title: string;
  duplicate_owner_id: string;
  duplicate_owner_name: string;
  platform: string;
  match_type: "exact_url" | "similar_title";
  similarity_score: number;
  same_owner: boolean;
  duplicate_activity: number;
  duplicate_can_delete: boolean;
  duplicate_status: string;
};

type DuplicateStatistics = {
  exact_url_pairs?: number;
  possible_title_pairs?: number;
  abandoned_duplicates?: number;
  archived_songs?: number;
  removed_songs?: number;
  merged_songs?: number;
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

type ExternalPricingSetting = {
  platform: "spotify" | "apple_music" | "tiktok";
  classification: "external";
  compatibility_status: string;
  current_token_cost: number;
  scheduled_token_cost: number;
  activation_at: string | null;
  effective_token_cost: number;
  activation_pending: boolean;
};

type ExternalPricingDraft = {
  currentCost: number;
  scheduledCost: number;
  activationAt: string;
};

type AdminAnnouncement = {
  id: string;
  announcement_type:
    | "platform_update"
    | "scheduled_change"
    | "contest"
    | "community_news"
    | "maintenance"
    | "special_event";
  title: string;
  message: string;
  starts_at: string;
  ends_at: string | null;
  priority: number;
  audience: "guests" | "members" | "creators" | "everyone";
  is_active: boolean;
};

type CommunityHealth = {
  generated_at?: string;
  active_guests?: number;
  active_members?: number;
  valid_listens_today?: number;
  listening_hours_today?: number;
  comments_today?: number;
  likes_today?: number;
  followers_today?: number;
  shares_today?: number;
  songs_submitted_today?: number;
  songs_archived_today?: number;
  new_guest_profiles_today?: number;
  new_accounts_today?: number;
  total_guest_profiles?: number;
  converted_guest_profiles?: number;
  guest_to_member_conversion_rate?: number;
};

const emptyAnnouncement: Omit<AdminAnnouncement, "id"> = {
  announcement_type: "platform_update",
  title: "",
  message: "",
  starts_at: "",
  ends_at: null,
  priority: 3,
  audience: "everyone",
  is_active: true,
};

function localDateTimeValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

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
  contentEconomy,
  duplicateCandidates,
  duplicateStatistics,
  statistics,
  theme,
  announcements,
  communityHealth,
}: {
  role: "super_admin" | "admin" | "moderator";
  users: AdminUser[];
  songs: AdminSong[];
  reports: AdminReport[];
  commentReports: AdminCommentReport[];
  initialSection?: AdminSection;
  listeningSettings: {
    minutes_per_credit: number;
    daily_cap_minutes: number;
    enabled: boolean;
  };
  spotlightSlots: SpotlightSlot[];
  boosts: AdminBoost[];
  contentEconomy: ExternalPricingSetting[];
  duplicateCandidates: DuplicateCandidate[];
  duplicateStatistics: DuplicateStatistics;
  statistics: {
    users: number;
    songs: number;
    active_songs: number;
    open_reports: number;
    reviews: number;
    listening_minutes?: number;
  } | null;
  theme: PlatformTheme;
  announcements: AdminAnnouncement[];
  communityHealth: CommunityHealth | null;
}) {
  const [section, setSection] = useState<AdminSection>(initialSection);
  const [notice, setNotice] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userFilter, setUserFilter] = useState<
    "all" | "active" | "paused" | "archived" | "founder" | "admin" | "moderator" | "banned"
  >("all");
  const [songSearch, setSongSearch] = useState("");
  const [songFilter, setSongFilter] = useState<
    | "all"
    | "active"
    | "paused"
    | "archived"
    | "removed"
    | "merged"
    | "duplicates"
    | "spotlight"
    | "founder"
    | "reported"
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
  const [themeDraft, setThemeDraft] = useState<PlatformTheme>(theme);
  const [announcementDraft, setAnnouncementDraft] = useState<
    Omit<AdminAnnouncement, "id"> & { id?: string }
  >(emptyAnnouncement);
  const [healthSnapshot, setHealthSnapshot] =
    useState<CommunityHealth | null>(communityHealth);
  const externalSettings = contentEconomy.filter(
    (setting) => setting.classification === "external",
  );
  const [pricingDrafts, setPricingDrafts] = useState<
    Record<string, ExternalPricingDraft>
  >(
    Object.fromEntries(
      externalSettings.map((setting) => [
        setting.platform,
        {
          currentCost: Number(setting.current_token_cost),
          scheduledCost: Number(setting.scheduled_token_cost),
          activationAt: localDateTimeValue(setting.activation_at),
        },
      ]),
    ),
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

  useEffect(() => {
    if (section !== "health") return;
    let active = true;
    const refreshHealth = async () => {
      const client = createClient();
      if (!client) return;
      const { data, error } = await client.rpc("admin_get_community_health");
      if (active && !error) setHealthSnapshot(data as CommunityHealth);
    };
    void refreshHealth();
    const interval = window.setInterval(() => void refreshHealth(), 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [section]);
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
    const duplicateIds = new Set(
      duplicateCandidates.flatMap((candidate) => [
        candidate.canonical_song_id,
        candidate.duplicate_song_id,
      ]),
    );
    return songs.filter((song) => {
      const effectiveStatus = song.merged_into_song_id
        ? "merged"
        : song.removed_at
          ? "removed"
          : song.archived_at
            ? "archived"
            : song.is_active
              ? song.creator_activity_status
              : song.approval_status;
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
      if (songFilter === "duplicates") return duplicateIds.has(song.id);
      if (songFilter === "removed") return Boolean(song.removed_at);
      if (songFilter === "merged") return Boolean(song.merged_into_song_id);
      if (songFilter === "archived") return Boolean(song.archived_at);
      if (songFilter === "active") {
        return (
          song.is_active &&
          !song.removed_at &&
          !song.archived_at &&
          !song.merged_into_song_id &&
          song.creator_activity_status === "active"
        );
      }
      return song.creator_activity_status === songFilter;
    });
  }, [duplicateCandidates, songFilter, songSearch, songs]);

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

  const updateThemeColor = (
    field: keyof Pick<
      PlatformTheme,
      | "backgroundColor"
      | "cardColor"
      | "textColor"
      | "accentColor"
      | "buttonColor"
      | "linkColor"
      | "borderColor"
    >,
    value: string,
  ) => {
    setThemeDraft((current) => ({
      ...current,
      preset: "custom",
      [field]: value.toUpperCase(),
    }));
  };

  const saveTheme = () =>
    runRpc("admin_update_platform_theme", {
      target_preset: themeDraft.preset,
      target_background_color: themeDraft.backgroundColor,
      target_card_color: themeDraft.cardColor,
      target_text_color: themeDraft.textColor,
      target_accent_color: themeDraft.accentColor,
      target_button_color: themeDraft.buttonColor,
      target_link_color: themeDraft.linkColor,
      target_border_color: themeDraft.borderColor,
    });

  const saveAnnouncement = () => {
    const startsAt = announcementDraft.starts_at
      ? new Date(announcementDraft.starts_at).toISOString()
      : new Date().toISOString();
    const endsAt = announcementDraft.ends_at
      ? new Date(announcementDraft.ends_at).toISOString()
      : null;
    return runRpc("admin_save_platform_announcement", {
      target_id: announcementDraft.id ?? null,
      target_type: announcementDraft.announcement_type,
      target_title: announcementDraft.title,
      target_message: announcementDraft.message,
      target_starts_at: startsAt,
      target_ends_at: endsAt,
      target_priority: announcementDraft.priority,
      target_audience: announcementDraft.audience,
      target_is_active: announcementDraft.is_active,
    });
  };

  const allSections = [
    ["users", "Users", Users],
    ["songs", "Songs", Music2],
    ["reports", "Reports", Flag],
    ["credits", "Credits", ShieldCheck],
    ["listening", "Listening", Headphones],
    ["economy", "Economy", Link2],
    ["discovery", "Discovery", Sparkles],
    ["appearance", "Appearance", Palette],
    ["announcements", "Announcements", Megaphone],
    ["health", "Community Health", Activity],
    ["statistics", "Statistics", BarChart3],
  ] as const;
  const sections = allSections.filter(([id]) => {
    if (role === "super_admin") return true;
    if (role === "admin") return !["credits", "listening", "economy"].includes(id);
    return ["users", "reports"].includes(id);
  });

  return (
    <main className="admin-page">
      <header className="account-header">
        <Logo />
        <Link href="/review"><ArrowLeft size={16} /> Review Songs</Link>
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
              <div className="admin-duplicate-stat-grid">
                <article>
                  <strong>{duplicateStatistics.exact_url_pairs ?? 0}</strong>
                  <span>Exact URL pairs</span>
                </article>
                <article>
                  <strong>
                    {duplicateStatistics.possible_title_pairs ?? 0}
                  </strong>
                  <span>Possible title pairs</span>
                </article>
                <article>
                  <strong>
                    {duplicateStatistics.abandoned_duplicates ?? 0}
                  </strong>
                  <span>Abandoned duplicates</span>
                </article>
                <article>
                  <strong>{duplicateStatistics.merged_songs ?? 0}</strong>
                  <span>Merged records</span>
                </article>
              </div>
              <div className="admin-duplicate-panel">
                <div>
                  <span className="eyebrow">
                    <CopyCheck size={14} /> Duplicate cleanup
                  </span>
                  <h3>Catalog duplicate candidates</h3>
                  <p>
                    Similar titles are warnings. Permanent deletion is enabled
                    only for server-verified abandoned duplicates.
                  </p>
                </div>
                {duplicateCandidates.length ? (
                  <div className="admin-duplicate-list">
                    {duplicateCandidates.map((candidate) => (
                      <article
                        key={`${candidate.canonical_song_id}-${candidate.duplicate_song_id}`}
                      >
                        <div>
                          <strong>{candidate.canonical_title}</strong>
                          <small>
                            Keep / {candidate.canonical_owner_name}
                          </small>
                        </div>
                        <span>
                          {candidate.match_type.replaceAll("_", " ")} /{" "}
                          {Math.round(
                            Number(candidate.similarity_score) * 100,
                          )}
                          %
                        </span>
                        <div>
                          <strong>{candidate.duplicate_title}</strong>
                          <small>
                            Candidate / {candidate.duplicate_owner_name} /{" "}
                            {candidate.duplicate_activity} activity
                          </small>
                        </div>
                        <div className="admin-actions">
                          {candidate.same_owner && (
                            <button
                              onClick={() =>
                                void runRpc(
                                  "admin_merge_duplicate_songs",
                                  {
                                    canonical_song_id:
                                      candidate.canonical_song_id,
                                    duplicate_song_id:
                                      candidate.duplicate_song_id,
                                  },
                                )
                              }
                            >
                              <CopyCheck size={14} /> Merge
                            </button>
                          )}
                          {candidate.duplicate_can_delete && (
                            <button
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Delete abandoned duplicate "${candidate.duplicate_title}"? Its original token cost will be refunded.`,
                                  )
                                ) {
                                  void runRpc(
                                    "admin_delete_abandoned_duplicate",
                                    {
                                      target_song_id:
                                        candidate.duplicate_song_id,
                                      matching_song_id:
                                        candidate.canonical_song_id,
                                    },
                                  );
                                }
                              }}
                            >
                              <Trash2 size={14} /> Delete abandoned
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    No duplicate candidates found.
                  </div>
                )}
              </div>
              <div className="admin-filter-row" aria-label="Song filters">
                {(["all", "active", "paused", "archived", "removed", "merged", "duplicates", "spotlight", "founder", "reported"] as const).map((filter) => (
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
                    <div>
                      <strong>{song.title}</strong>
                      <small>
                        {song.artist_name} /{" "}
                        {displayPlatform[song.platform] ?? song.platform}
                        {displayPlatform[song.platform]
                          ? ` / ${compactClassificationLabel(displayPlatform[song.platform])}`
                          : ""}
                      </small>
                    </div>
                    <span>
                      {song.approval_status === "pending"
                          ? "Pending long-form approval"
                        : song.merged_into_song_id
                          ? "Merged"
                          : song.removed_at
                            ? "Removed"
                            : song.archived_at
                              ? "Archived"
                              : song.is_active
                                ? song.creator_activity_status
                                : "Inactive"}
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
                      })} disabled={Boolean(song.merged_into_song_id)}>
                        {song.is_active ? "Remove" : "Restore"}
                      </button>
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

          {section === "economy" && isSuper && (
            <>
              <h2>External Content Pricing</h2>
              <p className="admin-section-copy">
                Schedule token pricing without a future deployment. Existing
                submissions keep the token cost recorded when they were
                created.
              </p>
              <div className="admin-pricing-grid">
                {externalSettings.map((setting) => {
                  const draft = pricingDrafts[setting.platform];
                  const label =
                    displayPlatform[setting.platform] ?? setting.platform;
                  return (
                    <article key={setting.platform}>
                      <div className="admin-pricing-heading">
                        <span><Link2 size={15} /> {label}</span>
                        <strong>
                          Effective now: {setting.effective_token_cost} tokens
                        </strong>
                      </div>
                      <small>
                        {setting.compatibility_status} / External Content
                      </small>
                      <label>
                        Current price
                        <input
                          min={1}
                          onChange={(event) =>
                            setPricingDrafts((current) => ({
                              ...current,
                              [setting.platform]: {
                                ...current[setting.platform],
                                currentCost: Number(event.target.value),
                              },
                            }))
                          }
                          type="number"
                          value={draft?.currentCost ?? 1}
                        />
                      </label>
                      <label>
                        Scheduled price
                        <input
                          min={1}
                          onChange={(event) =>
                            setPricingDrafts((current) => ({
                              ...current,
                              [setting.platform]: {
                                ...current[setting.platform],
                                scheduledCost: Number(event.target.value),
                              },
                            }))
                          }
                          type="number"
                          value={draft?.scheduledCost ?? 8}
                        />
                      </label>
                      <label>
                        Activation date
                        <input
                          onChange={(event) =>
                            setPricingDrafts((current) => ({
                              ...current,
                              [setting.platform]: {
                                ...current[setting.platform],
                                activationAt: event.target.value,
                              },
                            }))
                          }
                          type="datetime-local"
                          value={draft?.activationAt ?? ""}
                        />
                      </label>
                      <button
                        className="primary-button"
                        onClick={() =>
                          void runRpc(
                            "admin_update_external_content_pricing",
                            {
                              target_platform: setting.platform,
                              new_current_token_cost:
                                draft?.currentCost ?? 1,
                              new_scheduled_token_cost:
                                draft?.scheduledCost ?? 8,
                              new_activation_at: draft?.activationAt
                                ? new Date(draft.activationAt).toISOString()
                                : null,
                            },
                          )
                        }
                        type="button"
                      >
                        Save {label} pricing
                      </button>
                    </article>
                  );
                })}
              </div>
            </>
          )}

          {section === "appearance" && role !== "moderator" && (
            <>
              <div className="admin-section-heading">
                <div>
                  <h2>Appearance</h2>
                  <span>Manage the site-wide visual theme without a deployment.</span>
                </div>
              </div>
              <div className="admin-theme-layout">
                <section className="admin-theme-controls">
                  <div className="admin-theme-presets">
                    {(
                      Object.keys(platformThemePresetLabels) as PlatformThemePreset[]
                    ).map((preset) => (
                      <button
                        className={themeDraft.preset === preset ? "active" : ""}
                        disabled={preset === "custom"}
                        key={preset}
                        onClick={() => {
                          if (preset === "custom") return;
                          setThemeDraft(platformThemePresets[preset]);
                        }}
                        type="button"
                      >
                        {platformThemePresetLabels[preset]}
                      </button>
                    ))}
                  </div>
                  <div className="admin-theme-color-grid">
                    {[
                      ["backgroundColor", "Background"],
                      ["cardColor", "Cards"],
                      ["textColor", "Text"],
                      ["accentColor", "Accent"],
                      ["buttonColor", "Buttons"],
                      ["linkColor", "Links"],
                      ["borderColor", "Borders"],
                    ].map(([field, label]) => (
                      <label key={field}>
                        <span>{label}</span>
                        <input
                          aria-label={`${label} color`}
                          onChange={(event) =>
                            updateThemeColor(
                              field as keyof Pick<
                                PlatformTheme,
                                | "backgroundColor"
                                | "cardColor"
                                | "textColor"
                                | "accentColor"
                                | "buttonColor"
                                | "linkColor"
                                | "borderColor"
                              >,
                              event.target.value,
                            )
                          }
                          type="color"
                          value={String(themeDraft[field as keyof PlatformTheme])}
                        />
                        <input
                          maxLength={7}
                          onChange={(event) =>
                            updateThemeColor(
                              field as keyof Pick<
                                PlatformTheme,
                                | "backgroundColor"
                                | "cardColor"
                                | "textColor"
                                | "accentColor"
                                | "buttonColor"
                                | "linkColor"
                                | "borderColor"
                              >,
                              event.target.value,
                            )
                          }
                          pattern="^#[0-9A-Fa-f]{6}$"
                          value={String(themeDraft[field as keyof PlatformTheme])}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="admin-theme-actions">
                    <button
                      className="primary-button"
                      onClick={() => void saveTheme()}
                      type="button"
                    >
                      <Save size={15} /> Save theme
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() =>
                        void runRpc("admin_restore_platform_theme", {})
                      }
                      type="button"
                    >
                      <RotateCcw size={15} /> Restore default
                    </button>
                  </div>
                </section>
                <section
                  className="admin-theme-preview"
                  style={
                    {
                      "--preview-bg": themeDraft.backgroundColor,
                      "--preview-card": themeDraft.cardColor,
                      "--preview-text": themeDraft.textColor,
                      "--preview-accent": themeDraft.accentColor,
                      "--preview-button": themeDraft.buttonColor,
                      "--preview-link": themeDraft.linkColor,
                      "--preview-border": themeDraft.borderColor,
                    } as React.CSSProperties
                  }
                >
                  <span className="eyebrow"><Eye size={13} /> Live Preview</span>
                  <div className="theme-preview-brand">
                    <Logo />
                    <span>Public Beta</span>
                  </div>
                  <article className="theme-preview-song">
                    <div className="theme-preview-cover"><Music2 size={22} /></div>
                    <div>
                      <strong>Community spotlight song</strong>
                      <a href="#appearance">View artist profile</a>
                      <small>128 listens / 14 comments / Hook Score 84</small>
                    </div>
                  </article>
                  <blockquote>
                    “The first 30 seconds pulled me in. The vocal and hook feel
                    ready for another listen.”
                  </blockquote>
                  <div className="theme-preview-stats">
                    <span><strong>92%</strong> Listen full</span>
                    <span><strong>84</strong> Hook Score</span>
                    <span><strong>37</strong> Followers</span>
                  </div>
                  <button type="button">Review this song</button>
                </section>
              </div>
            </>
          )}

          {section === "announcements" && role !== "moderator" && (
            <>
              <div className="admin-section-heading">
                <div>
                  <h2>Announcements</h2>
                  <span>Schedule targeted platform messages for the community.</span>
                </div>
                {announcementDraft.id && (
                  <button
                    className="secondary-button"
                    onClick={() => setAnnouncementDraft(emptyAnnouncement)}
                    type="button"
                  >
                    New announcement
                  </button>
                )}
              </div>
              <section className="admin-announcement-editor">
                <label>
                  Type
                  <select
                    onChange={(event) =>
                      setAnnouncementDraft((current) => ({
                        ...current,
                        announcement_type: event.target
                          .value as AdminAnnouncement["announcement_type"],
                      }))
                    }
                    value={announcementDraft.announcement_type}
                  >
                    <option value="platform_update">Platform update</option>
                    <option value="scheduled_change">Scheduled change</option>
                    <option value="contest">Contest</option>
                    <option value="community_news">Community news</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="special_event">Special event</option>
                  </select>
                </label>
                <label>
                  Audience
                  <select
                    onChange={(event) =>
                      setAnnouncementDraft((current) => ({
                        ...current,
                        audience: event.target
                          .value as AdminAnnouncement["audience"],
                      }))
                    }
                    value={announcementDraft.audience}
                  >
                    <option value="everyone">Everyone</option>
                    <option value="guests">Guests</option>
                    <option value="members">Members</option>
                    <option value="creators">Creators</option>
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    onChange={(event) =>
                      setAnnouncementDraft((current) => ({
                        ...current,
                        priority: Number(event.target.value),
                      }))
                    }
                    value={announcementDraft.priority}
                  >
                    {[1, 2, 3, 4, 5].map((priority) => (
                      <option key={priority} value={priority}>
                        {priority}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-announcement-wide">
                  Title
                  <input
                    maxLength={120}
                    onChange={(event) =>
                      setAnnouncementDraft((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    value={announcementDraft.title}
                  />
                </label>
                <label className="admin-announcement-wide">
                  Message
                  <textarea
                    maxLength={1000}
                    onChange={(event) =>
                      setAnnouncementDraft((current) => ({
                        ...current,
                        message: event.target.value,
                      }))
                    }
                    rows={4}
                    value={announcementDraft.message}
                  />
                </label>
                <label>
                  Start
                  <input
                    onChange={(event) =>
                      setAnnouncementDraft((current) => ({
                        ...current,
                        starts_at: event.target.value,
                      }))
                    }
                    type="datetime-local"
                    value={localDateTimeValue(announcementDraft.starts_at)}
                  />
                </label>
                <label>
                  End
                  <input
                    onChange={(event) =>
                      setAnnouncementDraft((current) => ({
                        ...current,
                        ends_at: event.target.value || null,
                      }))
                    }
                    type="datetime-local"
                    value={localDateTimeValue(announcementDraft.ends_at)}
                  />
                </label>
                <label className="admin-setting-toggle">
                  <input
                    checked={announcementDraft.is_active}
                    onChange={(event) =>
                      setAnnouncementDraft((current) => ({
                        ...current,
                        is_active: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  Active
                </label>
                <button
                  className="primary-button"
                  disabled={
                    announcementDraft.title.trim().length < 3 ||
                    announcementDraft.message.trim().length < 3
                  }
                  onClick={() => void saveAnnouncement()}
                  type="button"
                >
                  <Megaphone size={15} />
                  {announcementDraft.id ? "Update announcement" : "Publish announcement"}
                </button>
              </section>
              <div className="admin-table admin-announcement-list">
                {announcements.map((announcement) => (
                  <article key={announcement.id}>
                    <div>
                      <strong>{announcement.title}</strong>
                      <small>
                        {announcement.announcement_type.replaceAll("_", " ")} /{" "}
                        {announcement.audience} / priority {announcement.priority}
                      </small>
                    </div>
                    <span>{announcement.message}</span>
                    <div className="admin-actions">
                      <button
                        onClick={() =>
                          setAnnouncementDraft({
                            ...announcement,
                            starts_at: announcement.starts_at,
                            ends_at: announcement.ends_at,
                          })
                        }
                        type="button"
                      >
                        Edit
                      </button>
                      {announcement.is_active && (
                        <button
                          onClick={() =>
                            void runRpc(
                              "admin_remove_platform_announcement",
                              { target_id: announcement.id },
                            )
                          }
                          type="button"
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {!announcements.length && (
                  <div className="empty-state">No announcements have been created.</div>
                )}
              </div>
            </>
          )}

          {section === "health" && role !== "moderator" && (
            <>
              <div className="admin-section-heading">
                <div>
                  <h2>Community Health</h2>
                  <span>
                    Live activity and today&apos;s participation across guests
                    and members.
                  </span>
                </div>
                <span className="admin-health-updated">
                  Auto-refreshes every 30 seconds
                  {healthSnapshot?.generated_at
                    ? ` / ${new Date(healthSnapshot.generated_at).toLocaleTimeString()}`
                    : ""}
                </span>
              </div>
              <div className="admin-health-grid">
                {[
                  ["Active guests", healthSnapshot?.active_guests ?? 0],
                  ["Active members", healthSnapshot?.active_members ?? 0],
                  ["Valid listens today", healthSnapshot?.valid_listens_today ?? 0],
                  ["Listening hours today", healthSnapshot?.listening_hours_today ?? 0],
                  ["Comments today", healthSnapshot?.comments_today ?? 0],
                  ["Likes today", healthSnapshot?.likes_today ?? 0],
                  ["Followers today", healthSnapshot?.followers_today ?? 0],
                  ["Shares today", healthSnapshot?.shares_today ?? 0],
                  ["Songs submitted", healthSnapshot?.songs_submitted_today ?? 0],
                  ["Songs archived", healthSnapshot?.songs_archived_today ?? 0],
                  ["New guest profiles", healthSnapshot?.new_guest_profiles_today ?? 0],
                  ["New accounts", healthSnapshot?.new_accounts_today ?? 0],
                ].map(([label, value]) => (
                  <article key={label}>
                    <strong>{value}</strong>
                    <span>{label}</span>
                  </article>
                ))}
              </div>
              <section className="admin-conversion-card">
                <div>
                  <span className="eyebrow">Guest conversion</span>
                  <strong>
                    {healthSnapshot?.guest_to_member_conversion_rate ?? 0}%
                  </strong>
                </div>
                <p>
                  {healthSnapshot?.converted_guest_profiles ?? 0} of{" "}
                  {healthSnapshot?.total_guest_profiles ?? 0} guest identities
                  have converted to member accounts.
                </p>
              </section>
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
