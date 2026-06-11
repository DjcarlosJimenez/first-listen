"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Bell,
  Blocks,
  Download,
  Eye,
  EyeOff,
  FlaskConical,
  Gauge,
  History,
  LayoutDashboard,
  Music2,
  Palette,
  Plus,
  Save,
  Send,
  Shield,
  Sparkles,
  Trash2,
  Upload,
  Users,
  WalletCards,
} from "lucide-react";
import {
  defaultPlatformControlConfig,
  homepageModuleLabels,
  normalizePlatformControlConfig,
  type ControlAnnouncement,
  type HomepageModuleKey,
  type PlatformControlConfig,
} from "@/lib/platform-control";
import {
  platformThemePresetLabels,
  platformThemePresets,
  type PlatformThemePreset,
} from "@/lib/platform-theme";
import { createClient } from "@/lib/supabase/client";

export type ControlCenterPayload = {
  state: {
    published_config: unknown;
    draft_config: unknown;
    stable_config: unknown;
    published_version: number;
    draft_revision: number;
    has_unpublished_changes: boolean;
    updated_at: string;
    published_at: string;
  };
  founder_controller: boolean;
  preview_enabled: boolean;
  snapshots: Array<{
    id: string;
    name: string;
    description: string;
    snapshot_kind: string;
    source_version: number;
    created_at: string;
  }>;
  preview_access: Array<{
    user_id: string;
    display_name: string;
    email: string;
    can_preview: boolean;
    preview_enabled: boolean;
  }>;
  audit_history: Array<{
    id: string;
    action: string;
    details: Record<string, unknown>;
    created_at: string;
  }>;
  token_analytics: {
    tokens_generated_today?: number;
    tokens_gifted_today?: number;
    tokens_spent_today?: number;
    tokens_burned_today?: number;
    tokens_in_circulation?: number;
    tokens_earned?: number;
    tokens_spent?: number;
    reward_claims?: number;
    average_balance?: number;
  };
  health: Record<string, number | string | null>;
  top_songs: Array<{
    id: string;
    title: string;
    artist_name: string;
    reviews: number;
  }>;
  top_artists: Array<{
    id: string;
    display_name: string;
    songs: number;
    followers: number;
  }>;
  most_shared_songs: Array<{
    id: string;
    title: string;
    artist_name: string;
    total: number;
  }>;
  most_commented_songs: Array<{
    id: string;
    title: string;
    artist_name: string;
    total: number;
  }>;
  most_supported_artists: Array<{
    id: string;
    display_name: string;
    total: number;
  }>;
};

type DirectoryUser = {
  id: string;
  display_name: string;
  email: string;
  role: string;
};

type DirectorySong = {
  id: string;
  title: string;
  artist_name: string;
  is_active: boolean;
  featured?: boolean;
  archived_at?: string | null;
  removed_at?: string | null;
  report_count?: number;
  platform?: string;
  created_at?: string;
};

type ControlTab =
  | "overview"
  | "appearance"
  | "homepage"
  | "discovery"
  | "content"
  | "profiles"
  | "tokens"
  | "announcements"
  | "health"
  | "permissions"
  | "experiments"
  | "history";

const tabs: Array<[ControlTab, string, typeof Gauge]> = [
  ["overview", "Publish", Gauge],
  ["appearance", "Appearance", Palette],
  ["homepage", "Page Builder", LayoutDashboard],
  ["discovery", "Discovery", Sparkles],
  ["content", "Content", Music2],
  ["profiles", "Artist Profiles", Users],
  ["tokens", "Token Economy", WalletCards],
  ["announcements", "Announcements", Bell],
  ["health", "Live Health", Activity],
  ["permissions", "Permissions", Shield],
  ["experiments", "Experiment Lab", FlaskConical],
  ["history", "Snapshots", History],
];

const themeFields = [
  ["backgroundColor", "Background"],
  ["cardColor", "Cards"],
  ["textColor", "Text"],
  ["accentColor", "Accent"],
  ["buttonColor", "Buttons"],
  ["linkColor", "Links"],
  ["borderColor", "Borders"],
  ["primaryColor", "Primary"],
  ["secondaryColor", "Secondary"],
  ["hoverColor", "Hover"],
] as const;

const discoveryLabels: Record<
  keyof PlatformControlConfig["discovery"]["modules"],
  string
> = {
  spotlight: "Spotlight",
  rankings: "Rankings",
  topResults: "Top 10",
  organicRankings: "Organic Rankings",
  trending: "Trending",
  mostShared: "Most Shared",
  mostSupported: "Community Picks",
  newestSongs: "New Releases",
};

const artistVisibilityLabels: Record<
  keyof PlatformControlConfig["artistProfile"]["visibility"],
  string
> = {
  followers: "Followers",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  recentActivity: "Recent Activity",
  statistics: "Statistics",
  supporters: "Supporters",
  giftTokens: "Gift Tokens",
};

function cloneConfig(value: unknown) {
  return structuredClone(normalizePlatformControlConfig(value));
}

function emptyAnnouncement(): ControlAnnouncement {
  return {
    id: crypto.randomUUID(),
    type: "platform_update",
    title: "",
    message: "",
    priority: 3,
    audience: "everyone",
    startsAt: new Date().toISOString(),
    endsAt: null,
    active: true,
  };
}

function renumberSpotlightSlots(config: PlatformControlConfig["spotlight"]) {
  return config.map((slot, index) => ({
    ...slot,
    slot: (index + 1) as 1 | 2 | 3,
  }));
}

function dateTimeInputValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function dateTimeStorageValue(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function SuperAdminControlCenter({
  initialData,
  users,
  songs,
}: {
  initialData: ControlCenterPayload;
  users: DirectoryUser[];
  songs: DirectorySong[];
}) {
  const [data, setData] = useState(initialData);
  const [config, setConfig] = useState<PlatformControlConfig>(() =>
    cloneConfig(initialData.state.draft_config),
  );
  const [tab, setTab] = useState<ControlTab>("overview");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState("");
  const [snapshotName, setSnapshotName] = useState("");
  const [previewUserId, setPreviewUserId] = useState("");
  const [draggedModule, setDraggedModule] =
    useState<HomepageModuleKey | null>(null);
  const [draggedSpotlightIndex, setDraggedSpotlightIndex] =
    useState<number | null>(null);
  const [songDirectory, setSongDirectory] = useState(songs);
  const [contentSearch, setContentSearch] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSongDirectory(songs);
  }, [songs]);

  const refresh = async () => {
    const supabase = createClient();
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data: next, error } = await supabase.rpc(
      "admin_get_control_center",
    );
    if (error) throw error;
    const payload = next as ControlCenterPayload;
    setData(payload);
    setConfig(cloneConfig(payload.state.draft_config));
    return payload;
  };

  const run = async (
    name: string,
    parameters: Record<string, unknown> = {},
    success = "Saved.",
  ) => {
    setBusy(true);
    setNotice("");
    try {
      const supabase = createClient();
      if (!supabase) throw new Error("Supabase is not configured.");
      const { data: next, error } = await supabase.rpc(name, parameters);
      if (error) throw error;
      if (name === "set_my_platform_preview_mode") {
        await refresh();
      } else if (next && typeof next === "object" && "state" in next) {
        const payload = next as ControlCenterPayload;
        setData(payload);
        setConfig(cloneConfig(payload.state.draft_config));
      } else {
        await refresh();
      }
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The action failed.");
    } finally {
      setBusy(false);
    }
  };

  const saveSection = async (section: keyof PlatformControlConfig) => {
    await run(
      "admin_update_control_draft",
      {
        section_key: section,
        section_value: config[section],
        change_description: description,
      },
      `${section} draft saved. Preview it before publishing.`,
    );
  };

  const updateTheme = (
    field: (typeof themeFields)[number][0],
    value: string,
  ) => {
    setConfig((current) => ({
      ...current,
      theme: { ...current.theme, [field]: value, preset: "custom" },
    }));
  };

  const moveModule = (module: HomepageModuleKey, direction: -1 | 1) => {
    setConfig((current) => {
      const order = [...current.homepage.order];
      const index = order.indexOf(module);
      const next = index + direction;
      if (next < 0 || next >= order.length) return current;
      [order[index], order[next]] = [order[next], order[index]];
      return {
        ...current,
        homepage: { ...current.homepage, order },
      };
    });
  };

  const dropModule = (target: HomepageModuleKey) => {
    if (!draggedModule || draggedModule === target) return;
    setConfig((current) => {
      const order = current.homepage.order.filter(
        (item) => item !== draggedModule,
      );
      order.splice(order.indexOf(target), 0, draggedModule);
      return {
        ...current,
        homepage: { ...current.homepage, order },
      };
    });
    setDraggedModule(null);
  };

  const moveSpotlightSlot = (index: number, direction: -1 | 1) => {
    setConfig((current) => {
      const spotlight = [...current.spotlight];
      const next = index + direction;
      if (next < 0 || next >= spotlight.length) return current;
      [spotlight[index], spotlight[next]] = [spotlight[next], spotlight[index]];
      return { ...current, spotlight: renumberSpotlightSlots(spotlight) };
    });
  };

  const dropSpotlightSlot = (targetIndex: number) => {
    if (draggedSpotlightIndex === null || draggedSpotlightIndex === targetIndex) {
      return;
    }
    setConfig((current) => {
      const spotlight = [...current.spotlight];
      const [dragged] = spotlight.splice(draggedSpotlightIndex, 1);
      spotlight.splice(targetIndex, 0, dragged);
      return { ...current, spotlight: renumberSpotlightSlots(spotlight) };
    });
    setDraggedSpotlightIndex(null);
  };

  const placeSongInFeaturedSection = (
    songId: string,
    section: "spotlight" | "new_release" | "community_pick",
  ) => {
    const song = songDirectory.find((candidate) => candidate.id === songId);
    setConfig((current) => {
      const existingIndex = current.spotlight.findIndex(
        (slot) => slot.songId === songId,
      );
      const firstEmptyIndex = current.spotlight.findIndex((slot) => !slot.songId);
      const index = existingIndex >= 0 ? existingIndex : Math.max(0, firstEmptyIndex);
      const label =
        section === "new_release"
          ? "New Release"
          : section === "community_pick"
            ? "Community Pick"
            : "Spotlight";
      const placement =
        section === "new_release" ? "new_release" : "editor_pick";
      return {
        ...current,
        spotlight: current.spotlight.map((slot, slotIndex) =>
          slotIndex === index
            ? {
                ...slot,
                songId,
                placement,
                label,
                pinned: section === "spotlight" ? slot.pinned : true,
              }
            : slot,
        ),
      };
    });
    setNotice(
      `${song?.title ?? "Song"} was added to the Spotlight draft as ${
        section === "new_release"
          ? "New Release"
          : section === "community_pick"
            ? "Community Pick"
            : "Spotlight"
      }. Save the Spotlight draft, then publish.`,
    );
  };

  const updateSongVisibility = async (
    song: DirectorySong,
    active: boolean,
    featured: boolean,
  ) => {
    setBusy(true);
    setNotice("");
    try {
      const supabase = createClient();
      if (!supabase) throw new Error("Supabase is not configured.");
      const { error } = await supabase.rpc("admin_set_song_state", {
        target_song_id: song.id,
        active,
        feature: featured,
      });
      if (error) throw error;
      setSongDirectory((current) =>
        current.map((item) =>
          item.id === song.id
            ? {
                ...item,
                is_active: active,
                featured: active ? featured : false,
                removed_at: active ? null : new Date().toISOString(),
                archived_at: active ? item.archived_at ?? null : item.archived_at,
              }
            : item,
        ),
      );
      setNotice(
        active
          ? featured
            ? `${song.title} was promoted.`
            : `${song.title} was restored.`
          : `${song.title} was hidden from public discovery.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The action failed.");
    } finally {
      setBusy(false);
    }
  };

  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `first-listen-platform-v${data.state.published_version}-draft.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importConfig = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      await run(
        "admin_replace_control_draft",
        {
          target_config: parsed,
          change_description: `Imported from ${file.name}`,
        },
        "Configuration imported into the draft.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Import failed.");
    }
  };

  const activeSongs = useMemo(
    () =>
      songDirectory.filter(
        (song) => song.is_active && !song.removed_at && !song.archived_at,
      ),
    [songDirectory],
  );

  const filteredContentSongs = useMemo(() => {
    const query = contentSearch.trim().toLowerCase();
    return songDirectory.filter((song) => {
      if (!query) return true;
      return (
        song.title.toLowerCase().includes(query) ||
        song.artist_name.toLowerCase().includes(query) ||
        song.id.toLowerCase().includes(query)
      );
    });
  }, [contentSearch, songDirectory]);

  const healthCards = [
    ["Active guests", data.health?.active_guests ?? 0],
    ["Active members", data.health?.active_members ?? 0],
    ["Artists online", data.health?.artists_online ?? 0],
    ["Valid listens today", data.health?.valid_listens_today ?? 0],
    ["Listening hours", data.health?.listening_hours_today ?? 0],
    ["Reviews today", data.health?.reviews_today ?? 0],
    ["Comments today", data.health?.comments_today ?? 0],
    ["Likes today", data.health?.likes_today ?? 0],
    ["Followers today", data.health?.followers_today ?? 0],
    ["Shares today", data.health?.shares_today ?? 0],
    ["Submissions today", data.health?.songs_submitted_today ?? 0],
    ["Guest registrations", data.health?.new_guest_profiles_today ?? 0],
    [
      "Guest to member",
      `${data.health?.guest_to_member_conversion_rate ?? 0}%`,
    ],
  ];

  return (
    <section className="control-center">
      <header className="control-center-hero">
        <div>
          <span className="eyebrow">
            <Shield size={14} /> Owner-level controls
          </span>
          <h2>Owner Control Center</h2>
          <p>
            Configure, preview, publish, and restore First Listen without a
            deployment.
          </p>
        </div>
        <div className="control-version-card">
          <span>Production</span>
          <strong>Version {data.state.published_version}</strong>
          <small>
            Draft revision {data.state.draft_revision}
            {data.state.has_unpublished_changes ? " / unpublished" : " / synced"}
          </small>
        </div>
      </header>

      {notice && (
        <div className="admin-notice" role="status">
          {notice}
        </div>
      )}

      <nav className="control-tabs" aria-label="Control center sections">
        {tabs
          .filter(
            ([id]) =>
              data.founder_controller ||
              !["permissions", "experiments"].includes(id),
          )
          .map(([id, label, Icon]) => (
            <button
              className={tab === id ? "active" : ""}
              key={id}
              onClick={() => setTab(id)}
              type="button"
            >
              <Icon size={15} /> {label}
            </button>
          ))}
      </nav>

      {tab === "overview" && (
        <div className="control-grid control-overview">
          <article className="control-card control-card-wide">
            <span className="eyebrow">Safe publishing workflow</span>
            <h3>Draft, preview, then publish</h3>
            <p>
              Changes stay private until they are published. Every publish
              automatically captures the current production configuration.
            </p>
            <label>
              Change note
              <textarea
                maxLength={500}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Describe this release for the audit history."
                value={description}
              />
            </label>
            <div className="control-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void run(
                    "set_my_platform_preview_mode",
                    { enabled: !data.preview_enabled },
                    data.preview_enabled
                      ? "Preview mode disabled."
                      : "Preview mode enabled.",
                  )
                }
                type="button"
              >
                {data.preview_enabled ? <EyeOff size={15} /> : <Eye size={15} />}
                {data.preview_enabled ? "Exit Preview" : "Enable Preview"}
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => window.open("/", "_blank", "noopener,noreferrer")}
                type="button"
              >
                <Eye size={15} /> Open Site Preview
              </button>
              <button
                className="primary-button"
                disabled={busy || !data.state.has_unpublished_changes}
                onClick={() => {
                  if (
                    window.confirm(
                      "Publish this draft to every First Listen visitor?",
                    )
                  ) {
                    void run(
                      "admin_publish_control_draft",
                      { change_description: description },
                      "Production configuration published.",
                    );
                  }
                }}
                type="button"
              >
                <Send size={15} /> Publish Changes
              </button>
            </div>
          </article>

          <article className="control-card">
            <span className="eyebrow">Draft recovery</span>
            <h3>Reset unpublished work</h3>
            <p>Restore the draft to the configuration currently in production.</p>
            <button
              className="secondary-button"
              disabled={busy || !data.state.has_unpublished_changes}
              onClick={() =>
                void run(
                  "admin_reset_control_draft",
                  {},
                  "Draft reset to production.",
                )
              }
              type="button"
            >
              <ArchiveRestore size={15} /> Reset Draft
            </button>
          </article>

          <article className="control-card danger-card">
            <span className="eyebrow">Founder emergency restore</span>
            <h3>Restore previous stable release</h3>
            <p>
              Creates an emergency backup, then restores the production
              configuration from immediately before the latest publish.
            </p>
            <button
              className="danger-button"
              disabled={busy || !data.founder_controller}
              onClick={() => {
                if (
                  window.confirm(
                    "Emergency restore the previous stable configuration?",
                  )
                ) {
                  void run(
                    "admin_emergency_restore_platform",
                    {},
                    "Emergency restore completed.",
                  );
                }
              }}
              type="button"
            >
              <ArchiveRestore size={15} /> Emergency Restore
            </button>
          </article>

          <article className="control-card control-card-wide">
            <span className="eyebrow">Configuration portability</span>
            <h3>Export or import a complete draft</h3>
            <p>
              Imports are validated and remain unpublished until reviewed.
            </p>
            <div className="control-actions">
              <button
                className="secondary-button"
                onClick={exportConfig}
                type="button"
              >
                <Download size={15} /> Export JSON
              </button>
              <button
                className="secondary-button"
                disabled={!data.founder_controller}
                onClick={() => importRef.current?.click()}
                type="button"
              >
                <Upload size={15} /> Import JSON
              </button>
              <input
                accept="application/json,.json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importConfig(file);
                  event.target.value = "";
                }}
                ref={importRef}
                type="file"
              />
            </div>
          </article>
        </div>
      )}

      {tab === "appearance" && (
        <div className="control-grid control-appearance">
          <article className="control-card control-card-wide">
            <div className="control-heading">
              <div>
                <span className="eyebrow">Appearance manager</span>
                <h3>Brand colors and themes</h3>
              </div>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void saveSection("theme")}
                type="button"
              >
                <Save size={15} /> Save Draft
              </button>
            </div>
            <div className="control-preset-row">
              {(
                Object.keys(platformThemePresetLabels) as PlatformThemePreset[]
              )
                .filter((preset) => preset !== "custom")
                .map((preset) => (
                  <button
                    className={config.theme.preset === preset ? "active" : ""}
                    key={preset}
                    onClick={() =>
                      setConfig((current) => ({
                        ...current,
                        theme: {
                          ...current.theme,
                          ...platformThemePresets[preset],
                        },
                      }))
                    }
                    type="button"
                  >
                    {platformThemePresetLabels[preset]}
                  </button>
                ))}
            </div>
            <div className="control-color-grid">
              {themeFields.map(([field, label]) => (
                <label key={field}>
                  <span>{label}</span>
                  <input
                    aria-label={`${label} color picker`}
                    onChange={(event) => updateTheme(field, event.target.value)}
                    type="color"
                    value={config.theme[field]}
                  />
                  <input
                    maxLength={7}
                    onChange={(event) => updateTheme(field, event.target.value)}
                    pattern="^#[0-9A-Fa-f]{6}$"
                    value={config.theme[field]}
                  />
                </label>
              ))}
            </div>
            <div className="control-actions">
              <button
                className="secondary-button"
                onClick={() =>
                  setConfig((current) => ({
                    ...current,
                    theme: {
                      ...defaultPlatformControlConfig.theme,
                      customThemes: current.theme.customThemes,
                    },
                  }))
                }
                type="button"
              >
                Reset First Listen Default
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  const name = window.prompt("Name this custom theme:");
                  if (!name?.trim()) return;
                  setConfig((current) => {
                    const colors = {
                      preset: current.theme.preset,
                      backgroundColor: current.theme.backgroundColor,
                      cardColor: current.theme.cardColor,
                      textColor: current.theme.textColor,
                      accentColor: current.theme.accentColor,
                      buttonColor: current.theme.buttonColor,
                      linkColor: current.theme.linkColor,
                      borderColor: current.theme.borderColor,
                      primaryColor: current.theme.primaryColor,
                      secondaryColor: current.theme.secondaryColor,
                      hoverColor: current.theme.hoverColor,
                    };
                    return {
                      ...current,
                      theme: {
                        ...current.theme,
                        customThemes: [
                          ...current.theme.customThemes,
                          {
                            id: crypto.randomUUID(),
                            name: name.trim(),
                            colors,
                          },
                        ],
                      },
                    };
                  });
                }}
                type="button"
              >
                <Plus size={15} /> Duplicate as Theme
              </button>
            </div>
          </article>

          <article
            className="control-card control-theme-preview"
            style={
              {
                "--control-bg": config.theme.backgroundColor,
                "--control-card": config.theme.cardColor,
                "--control-text": config.theme.textColor,
                "--control-accent": config.theme.accentColor,
                "--control-button": config.theme.buttonColor,
                "--control-link": config.theme.linkColor,
                "--control-border": config.theme.borderColor,
              } as React.CSSProperties
            }
          >
            <span className="eyebrow">Live preview</span>
            <div className="control-preview-canvas">
              <strong>First Listen</strong>
              <p>Real listeners. Honest music feedback.</p>
              <a href="#appearance">View artist profile</a>
              <button type="button">Review this song</button>
            </div>
          </article>

          <article className="control-card">
            <span className="eyebrow">Saved themes</span>
            <h3>Custom library</h3>
            <div className="control-saved-list">
              {config.theme.customThemes.map((theme) => (
                <div key={theme.id}>
                  <button
                    onClick={() =>
                      setConfig((current) => ({
                        ...current,
                        theme: {
                          ...current.theme,
                          ...theme.colors,
                          preset: "custom",
                        },
                      }))
                    }
                    type="button"
                  >
                    {theme.name}
                  </button>
                  <button
                    aria-label={`Delete ${theme.name}`}
                    onClick={() =>
                      setConfig((current) => ({
                        ...current,
                        theme: {
                          ...current.theme,
                          customThemes: current.theme.customThemes.filter(
                            (item) => item.id !== theme.id,
                          ),
                        },
                      }))
                    }
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {!config.theme.customThemes.length && (
                <p>No custom themes saved in this draft.</p>
              )}
            </div>
          </article>
        </div>
      )}

      {tab === "homepage" && (
        <article className="control-card">
          <div className="control-heading">
            <div>
              <span className="eyebrow">Visual page builder</span>
              <h3>Homepage module order and visibility</h3>
            </div>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void saveSection("homepage")}
              type="button"
            >
              <Save size={15} /> Save Draft
            </button>
          </div>
          <p>Drag modules, use the arrow controls, or hide them from the site.</p>
          <p>
            Key public sections include Spotlight, Top 10, Trending, New
            Releases, and Community Picks.
          </p>
          <div className="control-module-list">
            {config.homepage.order.map((module, index) => (
              <article
                data-owner-dnd="homepage-module"
                draggable
                key={module}
                onDragOver={(event) => event.preventDefault()}
                onDragStart={() => setDraggedModule(module)}
                onDrop={() => dropModule(module)}
              >
                <Blocks size={17} />
                <div>
                  <strong>{homepageModuleLabels[module]}</strong>
                  <small>Position {index + 1}</small>
                </div>
                <button
                  aria-label={`Move ${homepageModuleLabels[module]} up`}
                  disabled={index === 0}
                  onClick={() => moveModule(module, -1)}
                  type="button"
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  aria-label={`Move ${homepageModuleLabels[module]} down`}
                  disabled={index === config.homepage.order.length - 1}
                  onClick={() => moveModule(module, 1)}
                  type="button"
                >
                  <ArrowDown size={15} />
                </button>
                <label className="control-switch">
                  <input
                    checked={config.homepage.visibility[module]}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        homepage: {
                          ...current.homepage,
                          visibility: {
                            ...current.homepage.visibility,
                            [module]: event.target.checked,
                          },
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  <span>
                    {config.homepage.visibility[module] ? "Visible" : "Hidden"}
                  </span>
                </label>
              </article>
            ))}
          </div>
        </article>
      )}

      {tab === "discovery" && (
        <div className="control-grid">
          <article className="control-card">
            <div className="control-heading">
              <div>
                <span className="eyebrow">Discovery controls</span>
                <h3>Feed density and modules</h3>
              </div>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void saveSection("discovery")}
                type="button"
              >
                <Save size={15} /> Save Draft
              </button>
            </div>
            <label>
              Songs per page
              <select
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    discovery: {
                      ...current.discovery,
                      songsPerPage: Number(event.target.value) as
                        | 10
                        | 20
                        | 50
                        | 100,
                    },
                  }))
                }
                value={config.discovery.songsPerPage}
              >
                {[10, 20, 50, 100].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <div className="control-toggle-grid">
              {(
                Object.keys(config.discovery.modules) as Array<
                  keyof PlatformControlConfig["discovery"]["modules"]
                >
              ).map((module) => (
                <label key={module}>
                  <input
                    checked={config.discovery.modules[module]}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        discovery: {
                          ...current.discovery,
                          modules: {
                            ...current.discovery.modules,
                            [module]: event.target.checked,
                          },
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  {discoveryLabels[module]}
                </label>
              ))}
            </div>
          </article>

          <article className="control-card control-card-wide">
            <div className="control-heading">
              <div>
                <span className="eyebrow">Spotlight manager</span>
                <h3>Drag, pin, and schedule editorial placements</h3>
              </div>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void saveSection("spotlight")}
                type="button"
              >
                <Save size={15} /> Save Draft
              </button>
            </div>
            <div className="control-spotlight-grid">
              {config.spotlight.map((slot, index) => (
                <section
                  data-owner-dnd="spotlight-slot"
                  draggable
                  key={slot.slot}
                  onDragOver={(event) => event.preventDefault()}
                  onDragStart={() => setDraggedSpotlightIndex(index)}
                  onDrop={() => dropSpotlightSlot(index)}
                >
                  <div className="control-slot-heading">
                    <strong>Spotlight #{slot.slot}</strong>
                    <span>Position {index + 1}</span>
                  </div>
                  <div className="control-slot-actions">
                    <button
                      aria-label={`Move Spotlight #${slot.slot} up`}
                      disabled={index === 0}
                      onClick={() => moveSpotlightSlot(index, -1)}
                      type="button"
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      aria-label={`Move Spotlight #${slot.slot} down`}
                      disabled={index === config.spotlight.length - 1}
                      onClick={() => moveSpotlightSlot(index, 1)}
                      type="button"
                    >
                      <ArrowDown size={15} />
                    </button>
                  </div>
                  <label>
                    Song
                    <select
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          spotlight: current.spotlight.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, songId: event.target.value || null }
                              : item,
                          ),
                        }))
                      }
                      value={slot.songId ?? ""}
                    >
                      <option value="">Empty slot</option>
                      {activeSongs.map((song) => (
                        <option key={song.id} value={song.id}>
                          {song.title} / {song.artist_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Placement
                    <select
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          spotlight: current.spotlight.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  placement: event.target
                                    .value as typeof item.placement,
                                }
                              : item,
                          ),
                        }))
                      }
                      value={slot.placement}
                    >
                      <option value="editor_pick">Editor Pick</option>
                      <option value="new_release">New Release</option>
                      <option value="founder_artist">Founder Artist</option>
                      <option value="sponsored">Sponsored</option>
                      <option value="contest_winner">Contest Winner</option>
                      <option value="special_event">Special Event</option>
                    </select>
                  </label>
                  <label>
                    Public label
                    <input
                      maxLength={80}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          spotlight: current.spotlight.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, label: event.target.value }
                              : item,
                          ),
                        }))
                      }
                      value={slot.label}
                    />
                  </label>
                  <label className="control-switch">
                    <input
                      checked={slot.pinned}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          spotlight: current.spotlight.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, pinned: event.target.checked }
                              : item,
                          ),
                        }))
                      }
                      type="checkbox"
                    />
                    <span>{slot.pinned ? "Pinned" : "Not pinned"}</span>
                  </label>
                  <label>
                    Starts
                    <input
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          spotlight: current.spotlight.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  startsAt: dateTimeStorageValue(
                                    event.target.value,
                                  ),
                                }
                              : item,
                          ),
                        }))
                      }
                      type="datetime-local"
                      value={dateTimeInputValue(slot.startsAt)}
                    />
                  </label>
                  <label>
                    Ends
                    <input
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          spotlight: current.spotlight.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  endsAt: dateTimeStorageValue(
                                    event.target.value,
                                  ),
                                }
                              : item,
                          ),
                        }))
                      }
                      type="datetime-local"
                      value={dateTimeInputValue(slot.endsAt)}
                    />
                  </label>
                </section>
              ))}
            </div>
          </article>
        </div>
      )}

      {tab === "content" && (
        <article className="control-card control-card-wide">
          <div className="control-heading">
            <div>
              <span className="eyebrow">Content management</span>
              <h3>Promote, demote, hide, and place songs</h3>
            </div>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void saveSection("spotlight")}
              type="button"
            >
              <Save size={15} /> Save Spotlight Draft
            </button>
          </div>
          <p>
            Move songs into editorial sections from here. Top 10 and Trending
            remain performance-based, while their homepage position and
            visibility are managed in Page Builder.
          </p>
          <label className="control-search">
            Search songs
            <input
              onChange={(event) => setContentSearch(event.target.value)}
              placeholder="Song, artist, or song ID"
              value={contentSearch}
            />
          </label>
          <div className="control-content-list">
            {filteredContentSongs.map((song) => {
              const hidden = !song.is_active || Boolean(song.removed_at);
              const archived = Boolean(song.archived_at);
              return (
                <section key={song.id}>
                  <div>
                    <strong>{song.title}</strong>
                    <small>
                      {song.artist_name}
                      {song.platform ? ` / ${song.platform}` : ""}
                      {song.report_count ? ` / ${song.report_count} reports` : ""}
                    </small>
                  </div>
                  <span className="control-song-status">
                    {archived
                      ? "Archived"
                      : hidden
                        ? "Hidden"
                        : song.featured
                          ? "Promoted"
                          : "Active"}
                  </span>
                  <div className="control-content-actions">
                    <button
                      disabled={busy || hidden || archived}
                      onClick={() => placeSongInFeaturedSection(song.id, "spotlight")}
                      type="button"
                    >
                      Spotlight
                    </button>
                    <button
                      disabled={busy || hidden || archived}
                      onClick={() =>
                        placeSongInFeaturedSection(song.id, "new_release")
                      }
                      type="button"
                    >
                      New Releases
                    </button>
                    <button
                      disabled={busy || hidden || archived}
                      onClick={() =>
                        placeSongInFeaturedSection(song.id, "community_pick")
                      }
                      type="button"
                    >
                      Community Picks
                    </button>
                    <button
                      disabled={busy || hidden || archived}
                      onClick={() => void updateSongVisibility(song, true, true)}
                      type="button"
                    >
                      Promote
                    </button>
                    <button
                      disabled={busy || hidden || archived}
                      onClick={() => void updateSongVisibility(song, true, false)}
                      type="button"
                    >
                      Demote
                    </button>
                    <button
                      disabled={busy || archived}
                      onClick={() =>
                        void updateSongVisibility(song, hidden, false)
                      }
                      type="button"
                    >
                      {hidden ? "Unhide" : "Hide"}
                    </button>
                  </div>
                </section>
              );
            })}
            {!filteredContentSongs.length && (
              <p>No songs match this search.</p>
            )}
          </div>
        </article>
      )}

      {tab === "profiles" && (
        <article className="control-card">
          <div className="control-heading">
            <div>
              <span className="eyebrow">Public artist profiles</span>
              <h3>Visibility and section order</h3>
            </div>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void saveSection("artistProfile")}
              type="button"
            >
              <Save size={15} /> Save Draft
            </button>
          </div>
          <div className="control-toggle-grid">
            {(
              Object.keys(config.artistProfile.visibility) as Array<
                keyof PlatformControlConfig["artistProfile"]["visibility"]
              >
            ).map((field) => (
              <label key={field}>
                <input
                  checked={config.artistProfile.visibility[field]}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      artistProfile: {
                        ...current.artistProfile,
                        visibility: {
                          ...current.artistProfile.visibility,
                          [field]: event.target.checked,
                        },
                      },
                    }))
                  }
                  type="checkbox"
                />
                {artistVisibilityLabels[field]}
              </label>
            ))}
          </div>
          <div className="control-module-list">
            {config.artistProfile.order.map((section, index) => (
              <article key={section}>
                <Blocks size={17} />
                <div>
                  <strong>{section.replace(/([A-Z])/g, " $1")}</strong>
                  <small>Position {index + 1}</small>
                </div>
                <button
                  disabled={index === 0}
                  onClick={() =>
                    setConfig((current) => {
                      const order = [...current.artistProfile.order];
                      [order[index - 1], order[index]] = [
                        order[index],
                        order[index - 1],
                      ];
                      return {
                        ...current,
                        artistProfile: {
                          ...current.artistProfile,
                          order,
                        },
                      };
                    })
                  }
                  type="button"
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  disabled={index === config.artistProfile.order.length - 1}
                  onClick={() =>
                    setConfig((current) => {
                      const order = [...current.artistProfile.order];
                      [order[index], order[index + 1]] = [
                        order[index + 1],
                        order[index],
                      ];
                      return {
                        ...current,
                        artistProfile: {
                          ...current.artistProfile,
                          order,
                        },
                      };
                    })
                  }
                  type="button"
                >
                  <ArrowDown size={15} />
                </button>
              </article>
            ))}
          </div>
        </article>
      )}

      {tab === "tokens" && (
        <div className="control-grid">
          <article className="control-card control-card-wide">
            <div className="control-heading">
              <div>
                <span className="eyebrow">Token economy</span>
                <h3>Rates, caps, bonuses, and emergency controls</h3>
              </div>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void saveSection("tokens")}
                type="button"
              >
                <Save size={15} /> Save Draft
              </button>
            </div>
            <div className="control-number-grid">
              {[
                ["minutesPerToken", "Minutes per token", 30, 1440],
                ["dailyListeningLimit", "Daily listening cap", 30, 1440],
                ["maxTokensPerDay", "Max tokens per day", 1, 100],
                ["submissionCost", "Song submission cost", 0, 100],
              ].map(([field, label, min, max]) => (
                <label key={String(field)}>
                  {label}
                  <input
                    max={Number(max)}
                    min={Number(min)}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        tokens: {
                          ...current.tokens,
                          [String(field)]: Number(event.target.value),
                        },
                      }))
                    }
                    type="number"
                    value={Number(
                      config.tokens[
                        field as keyof Pick<
                          PlatformControlConfig["tokens"],
                          | "minutesPerToken"
                          | "dailyListeningLimit"
                          | "maxTokensPerDay"
                          | "submissionCost"
                        >
                      ],
                    )}
                  />
                </label>
              ))}
            </div>

            <h4>Token gifting limits</h4>
            <div className="control-number-grid">
              <label>
                <input
                  checked={config.tokens.gifting.enabled}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      tokens: {
                        ...current.tokens,
                        gifting: {
                          ...current.tokens.gifting,
                          enabled: event.target.checked,
                        },
                      },
                    }))
                  }
                  type="checkbox"
                />
                Enable gifting
              </label>
              {(
                [
                  ["minimum", "Minimum gift"],
                  ["maximum", "Maximum gift"],
                  ["dailyLimit", "Daily gift limit"],
                  ["cooldownMinutes", "Cooldown minutes"],
                ] as const
              ).map(([field, label]) => (
                <label key={field}>
                  {label}
                  <input
                    min={0}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        tokens: {
                          ...current.tokens,
                          gifting: {
                            ...current.tokens.gifting,
                            [field]: Number(event.target.value),
                          },
                        },
                      }))
                    }
                    type="number"
                    value={config.tokens.gifting[field]}
                  />
                </label>
              ))}
            </div>

            <h4>Reward bonuses</h4>
            <div className="control-number-grid">
              {(
                Object.keys(config.tokens.bonuses) as Array<
                  keyof PlatformControlConfig["tokens"]["bonuses"]
                >
              ).map((field) => (
                <label key={field}>
                  {field[0].toUpperCase() + field.slice(1)}
                  <input
                    min={0}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        tokens: {
                          ...current.tokens,
                          bonuses: {
                            ...current.tokens.bonuses,
                            [field]: Number(event.target.value),
                          },
                        },
                      }))
                    }
                    type="number"
                    value={config.tokens.bonuses[field]}
                  />
                </label>
              ))}
            </div>

            <h4>Engagement rewards</h4>
            <div className="control-toggle-grid">
              {(
                Object.keys(config.tokens.engagement) as Array<
                  keyof PlatformControlConfig["tokens"]["engagement"]
                >
              ).map((field) => (
                <label key={field}>
                  <input
                    checked={config.tokens.engagement[field]}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        tokens: {
                          ...current.tokens,
                          engagement: {
                            ...current.tokens.engagement,
                            [field]: event.target.checked,
                          },
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  {field.replace(/([A-Z])/g, " $1")}
                </label>
              ))}
            </div>

            <h4>Emergency switches</h4>
            <div className="control-toggle-grid danger-toggles">
              {(
                Object.keys(config.tokens.emergency) as Array<
                  keyof PlatformControlConfig["tokens"]["emergency"]
                >
              ).map((field) => (
                <label key={field}>
                  <input
                    checked={config.tokens.emergency[field]}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        tokens: {
                          ...current.tokens,
                          emergency: {
                            ...current.tokens.emergency,
                            [field]: event.target.checked,
                          },
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  {field.replace(/([A-Z])/g, " $1")}
                </label>
              ))}
            </div>

            <h4>Future community support</h4>
            <div className="control-toggle-grid">
              {(
                Object.keys(config.tokens.futureSupport) as Array<
                  keyof PlatformControlConfig["tokens"]["futureSupport"]
                >
              ).map((field) => (
                <label key={field}>
                  <input
                    checked={config.tokens.futureSupport[field]}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        tokens: {
                          ...current.tokens,
                          futureSupport: {
                            ...current.tokens.futureSupport,
                            [field]: event.target.checked,
                          },
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  {field.replace(/([A-Z])/g, " $1")}
                </label>
              ))}
            </div>
          </article>

          <article className="control-card">
            <span className="eyebrow">Live token analytics</span>
            <div className="control-stat-list">
              <div>
                <strong>
                  {data.token_analytics.tokens_generated_today ?? 0}
                </strong>
                <span>Generated today</span>
              </div>
              <div>
                <strong>{data.token_analytics.tokens_gifted_today ?? 0}</strong>
                <span>Gifted today</span>
              </div>
              <div>
                <strong>{data.token_analytics.tokens_spent_today ?? 0}</strong>
                <span>Spent today</span>
              </div>
              <div>
                <strong>{data.token_analytics.tokens_burned_today ?? 0}</strong>
                <span>Burned today</span>
              </div>
              <div>
                <strong>
                  {data.token_analytics.tokens_in_circulation ?? 0}
                </strong>
                <span>In circulation</span>
              </div>
              <div>
                <strong>{data.token_analytics.tokens_earned ?? 0}</strong>
                <span>Earned</span>
              </div>
              <div>
                <strong>{data.token_analytics.tokens_spent ?? 0}</strong>
                <span>Spent</span>
              </div>
              <div>
                <strong>{data.token_analytics.reward_claims ?? 0}</strong>
                <span>Reward claims</span>
              </div>
              <div>
                <strong>{data.token_analytics.average_balance ?? 0}</strong>
                <span>Average balance</span>
              </div>
            </div>
          </article>
        </div>
      )}

      {tab === "announcements" && (
        <article className="control-card">
          <div className="control-heading">
            <div>
              <span className="eyebrow">Announcements</span>
              <h3>Scheduled messages by audience</h3>
            </div>
            <div className="control-actions">
              <button
                className="secondary-button"
                onClick={() =>
                  setConfig((current) => ({
                    ...current,
                    announcements: [
                      ...current.announcements,
                      emptyAnnouncement(),
                    ],
                  }))
                }
                type="button"
              >
                <Plus size={15} /> Add
              </button>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void saveSection("announcements")}
                type="button"
              >
                <Save size={15} /> Save Draft
              </button>
            </div>
          </div>
          <div className="control-announcement-list">
            {config.announcements.map((announcement, index) => (
              <section key={announcement.id}>
                <div className="control-announcement-grid">
                  <label>
                    Type
                    <select
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          announcements: current.announcements.map(
                            (item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    type: event.target
                                      .value as ControlAnnouncement["type"],
                                  }
                                : item,
                          ),
                        }))
                      }
                      value={announcement.type}
                    >
                      <option value="platform_update">Platform Update</option>
                      <option value="contest">Contest</option>
                      <option value="maintenance">Maintenance</option>
                      <option value="community_news">Community News</option>
                      <option value="special_event">Special Event</option>
                      <option value="founder_message">Founder Message</option>
                    </select>
                  </label>
                  <label>
                    Audience
                    <select
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          announcements: current.announcements.map(
                            (item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    audience: event.target
                                      .value as ControlAnnouncement["audience"],
                                  }
                                : item,
                          ),
                        }))
                      }
                      value={announcement.audience}
                    >
                      <option value="everyone">Everyone</option>
                      <option value="guests">Guests</option>
                      <option value="members">Members</option>
                      <option value="artists">Artists</option>
                      <option value="moderators">Moderators</option>
                    </select>
                  </label>
                  <label>
                    Priority
                    <input
                      max={5}
                      min={1}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          announcements: current.announcements.map(
                            (item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    priority: Number(event.target.value),
                                  }
                                : item,
                          ),
                        }))
                      }
                      type="number"
                      value={announcement.priority}
                    />
                  </label>
                  <label>
                    Active
                    <input
                      checked={announcement.active}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          announcements: current.announcements.map(
                            (item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, active: event.target.checked }
                                : item,
                          ),
                        }))
                      }
                      type="checkbox"
                    />
                  </label>
                  <label className="control-field-wide">
                    Title
                    <input
                      maxLength={120}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          announcements: current.announcements.map(
                            (item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, title: event.target.value }
                                : item,
                          ),
                        }))
                      }
                      value={announcement.title}
                    />
                  </label>
                  <label className="control-field-wide">
                    Message
                    <textarea
                      maxLength={1000}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          announcements: current.announcements.map(
                            (item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, message: event.target.value }
                                : item,
                          ),
                        }))
                      }
                      value={announcement.message}
                    />
                  </label>
                  <label>
                    Start date
                    <input
                      onChange={(event) =>
                        event.target.value &&
                        setConfig((current) => ({
                          ...current,
                          announcements: current.announcements.map(
                            (item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    startsAt: new Date(
                                      event.target.value,
                                    ).toISOString(),
                                  }
                                : item,
                          ),
                        }))
                      }
                      required
                      type="datetime-local"
                      value={announcement.startsAt.slice(0, 16)}
                    />
                  </label>
                  <label>
                    End date
                    <input
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          announcements: current.announcements.map(
                            (item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    endsAt: event.target.value
                                      ? new Date(
                                          event.target.value,
                                        ).toISOString()
                                      : null,
                                  }
                                : item,
                          ),
                        }))
                      }
                      type="datetime-local"
                      value={announcement.endsAt?.slice(0, 16) ?? ""}
                    />
                  </label>
                </div>
                <button
                  className="icon-button"
                  onClick={() =>
                    setConfig((current) => ({
                      ...current,
                      announcements: current.announcements.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    }))
                  }
                  type="button"
                >
                  <Trash2 size={15} /> Remove
                </button>
              </section>
            ))}
            {!config.announcements.length && (
              <p>No control-center announcements in this draft.</p>
            )}
          </div>
        </article>
      )}

      {tab === "health" && (
        <div className="control-grid">
          <article className="control-card control-card-wide">
            <div className="control-heading">
              <div>
                <span className="eyebrow">Live platform health</span>
                <h3>Community activity</h3>
              </div>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void refresh()}
                type="button"
              >
                <Activity size={15} /> Refresh
              </button>
            </div>
            <div className="control-health-grid">
              {healthCards.map(([label, value]) => (
                <div key={String(label)}>
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </article>
          <article className="control-card">
            <span className="eyebrow">Top songs</span>
            <div className="control-ranking-list">
              {data.top_songs.map((song, index) => (
                <div key={song.id}>
                  <span>{index + 1}</span>
                  <strong>{song.title}</strong>
                  <small>
                    {song.artist_name} / {song.reviews} reviews
                  </small>
                </div>
              ))}
            </div>
          </article>
          <article className="control-card">
            <span className="eyebrow">Top artists</span>
            <div className="control-ranking-list">
              {data.top_artists.map((artist, index) => (
                <div key={artist.id}>
                  <span>{index + 1}</span>
                  <strong>{artist.display_name}</strong>
                  <small>
                    {artist.followers} followers / {artist.songs} songs
                  </small>
                </div>
              ))}
            </div>
          </article>
          <article className="control-card">
            <span className="eyebrow">Most shared songs</span>
            <div className="control-ranking-list">
              {data.most_shared_songs.map((song, index) => (
                <div key={song.id}>
                  <span>{index + 1}</span>
                  <strong>{song.title}</strong>
                  <small>{song.artist_name} / {song.total} shares</small>
                </div>
              ))}
            </div>
          </article>
          <article className="control-card">
            <span className="eyebrow">Most commented songs</span>
            <div className="control-ranking-list">
              {data.most_commented_songs.map((song, index) => (
                <div key={song.id}>
                  <span>{index + 1}</span>
                  <strong>{song.title}</strong>
                  <small>{song.artist_name} / {song.total} comments</small>
                </div>
              ))}
            </div>
          </article>
          <article className="control-card">
            <span className="eyebrow">Most supported artists</span>
            <div className="control-ranking-list">
              {data.most_supported_artists.map((artist, index) => (
                <div key={artist.id}>
                  <span>{index + 1}</span>
                  <strong>{artist.display_name}</strong>
                  <small>{artist.total} support events</small>
                </div>
              ))}
            </div>
          </article>
        </div>
      )}

      {tab === "permissions" && data.founder_controller && (
        <article className="control-card">
          <div className="control-heading">
            <div>
              <span className="eyebrow">Founder only</span>
              <h3>Permission matrix</h3>
            </div>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void saveSection("permissions")}
              type="button"
            >
              <Save size={15} /> Save Draft
            </button>
          </div>
          <div className="control-permission-grid">
            {Object.entries(config.permissions).map(([role, permissions]) => (
              <section key={role}>
                <strong>{role.replace("_", " ")}</strong>
                {Object.entries(permissions).map(([permission, enabled]) => (
                  <label key={permission}>
                    <input
                      checked={enabled}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          permissions: {
                            ...current.permissions,
                            [role]: {
                              ...current.permissions[role],
                              [permission]: event.target.checked,
                            },
                          },
                        }))
                      }
                      type="checkbox"
                    />
                    {permission.replace(/([A-Z])/g, " $1")}
                  </label>
                ))}
              </section>
            ))}
          </div>

          <hr />
          <h3>Preview testers</h3>
          <div className="control-actions">
            <select
              onChange={(event) => setPreviewUserId(event.target.value)}
              value={previewUserId}
            >
              <option value="">Select a user</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.display_name} / {user.email || user.role}
                </option>
              ))}
            </select>
            <button
              className="secondary-button"
              disabled={busy || !previewUserId}
              onClick={() =>
                void run(
                  "admin_set_platform_preview_access",
                  { target_user_id: previewUserId, allowed: true },
                  "Preview access granted.",
                )
              }
              type="button"
            >
              Grant Preview
            </button>
          </div>
          <div className="control-saved-list">
            {data.preview_access.map((access) => (
              <div key={access.user_id}>
                <span>
                  <strong>{access.display_name}</strong>
                  <small>
                    {access.email} /{" "}
                    {access.preview_enabled ? "previewing" : "not previewing"}
                  </small>
                </span>
                <button
                  onClick={() =>
                    void run(
                      "admin_set_platform_preview_access",
                      { target_user_id: access.user_id, allowed: false },
                      "Preview access revoked.",
                    )
                  }
                  type="button"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </article>
      )}

      {tab === "experiments" && data.founder_controller && (
        <article className="control-card">
          <div className="control-heading">
            <div>
              <span className="eyebrow">Founder only</span>
              <h3>Experiment Lab</h3>
            </div>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void saveSection("experiments")}
              type="button"
            >
              <Save size={15} /> Save Draft
            </button>
          </div>
          <p>
            These flags prepare controlled experiments. They do not expose
            unfinished product features by themselves.
          </p>
          <div className="control-toggle-grid">
            {(
              Object.keys(config.experiments) as Array<
                keyof PlatformControlConfig["experiments"]
              >
            ).map((field) => (
              <label key={field}>
                <input
                  checked={config.experiments[field]}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      experiments: {
                        ...current.experiments,
                        [field]: event.target.checked,
                      },
                    }))
                  }
                  type="checkbox"
                />
                {field.replace(/([A-Z])/g, " $1")}
              </label>
            ))}
          </div>
        </article>
      )}

      {tab === "history" && (
        <div className="control-grid">
          <article className="control-card">
            <span className="eyebrow">Manual snapshot</span>
            <h3>Save the current draft</h3>
            <label>
              Snapshot name
              <input
                maxLength={120}
                onChange={(event) => setSnapshotName(event.target.value)}
                placeholder="Before homepage refresh"
                value={snapshotName}
              />
            </label>
            <button
              className="primary-button"
              disabled={busy || snapshotName.trim().length < 3}
              onClick={() =>
                void run(
                  "admin_create_control_snapshot",
                  {
                    snapshot_name: snapshotName,
                    snapshot_description: description,
                  },
                  "Snapshot created.",
                )
              }
              type="button"
            >
              <Save size={15} /> Create Snapshot
            </button>
          </article>

          <article className="control-card control-card-wide">
            <span className="eyebrow">Backups and versions</span>
            <div className="control-history-list">
              {data.snapshots.map((snapshot) => (
                <div key={snapshot.id}>
                  <div>
                    <strong>{snapshot.name}</strong>
                    <small>
                      {snapshot.snapshot_kind} / version{" "}
                      {snapshot.source_version} /{" "}
                      {new Date(snapshot.created_at).toLocaleString()}
                    </small>
                    {snapshot.description && <p>{snapshot.description}</p>}
                  </div>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        "admin_restore_control_snapshot",
                        { snapshot_id: snapshot.id },
                        "Snapshot restored to the draft.",
                      )
                    }
                    type="button"
                  >
                    Restore to Draft
                  </button>
                </div>
              ))}
            </div>
          </article>

          <article className="control-card control-card-wide">
            <span className="eyebrow">Audit history</span>
            <div className="control-history-list">
              {data.audit_history.map((entry) => (
                <div key={entry.id}>
                  <div>
                    <strong>{entry.action.replaceAll("_", " ")}</strong>
                    <small>{new Date(entry.created_at).toLocaleString()}</small>
                    <p>{JSON.stringify(entry.details)}</p>
                  </div>
                </div>
              ))}
              {!data.audit_history.length && <p>No control changes recorded.</p>}
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
