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
  Headphones,
  LayoutDashboard,
  Music2,
  Palette,
  Plus,
  Save,
  Send,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Users,
  WalletCards,
} from "lucide-react";
import {
  cardDensityLabels,
  defaultPlatformControlConfig,
  homepageModuleLabels,
  membershipPermissionLabels,
  membershipTierLabels,
  normalizePlatformControlConfig,
  uiComponentLabels,
  type CardDensityKey,
  type ControlAnnouncement,
  type HomepageModuleKey,
  type MembershipPermissionKey,
  type MembershipTierConfig,
  type MembershipTierKey,
  type PlatformControlConfig,
  type UiComponentKey,
  type UiResponsiveSize,
  type UiSizePreset,
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
  listening_bank?: {
    diagnostics: {
      total_listening_time_today?: number;
      approved_listening_time_today?: number;
      pending_listening_time?: number;
      rejected_listening_time?: number;
      current_listening_bank?: number;
      current_token_balance?: number;
      visible_activity_log_limit?: number;
      current_activity_entries?: number;
      archived_activity_entries?: number;
      auto_cleanup_enabled?: boolean;
      auto_cleanup_keep_visible?: number;
      last_approval_event?: string | null;
      last_rejection_event?: string | null;
      last_rejection_reason_code?: string | null;
      last_rejection_reason_description?: string | null;
      last_reward_event?: string | null;
      last_bank_update?: string | null;
      last_archive_event?: string | null;
      last_calculation_timestamp?: string | null;
      minutes_per_token?: number;
      daily_cap_minutes?: number;
      rewards_enabled?: boolean;
    };
    activity_log: Array<{
      id: string;
      user_id: string | null;
      event_key: string;
      event_type: string;
      status: string;
      amount_seconds: number;
      token_amount: number;
      title: string;
      details: Record<string, unknown>;
      created_at: string;
    }>;
    rejection_insights?: {
      last_100_rejections?: Array<{
        id: string;
        user_id: string | null;
        listening_session_id: string | null;
        song_id: string | null;
        reason_code: string;
        reason_description: string;
        created_at: string;
      }>;
      reason_frequency?: Array<{
        reason_code: string;
        reason_description: string;
        total: number;
      }>;
      most_common_failure_causes?: string[];
    };
    events: PlatformControlConfig["listeningBank"]["events"];
    active_event?: {
      event_id?: string;
      event_name?: string;
      listening_multiplier?: number;
      token_multiplier?: number;
      bonus_minutes?: number;
      mission_multiplier?: number;
    };
    test_scenarios: string[];
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

type ConfigSectionKey = Exclude<keyof PlatformControlConfig, "schemaVersion">;

type ControlTab =
  | "overview"
  | "interface"
  | "appearance"
  | "homepage"
  | "discovery"
  | "content"
  | "profiles"
  | "community"
  | "membership"
  | "listening"
  | "tokens"
  | "announcements"
  | "health"
  | "permissions"
  | "experiments"
  | "presets"
  | "history";

const tabs: Array<[ControlTab, string, typeof Gauge]> = [
  ["overview", "Publish", Gauge],
  ["interface", "Interface", SlidersHorizontal],
  ["appearance", "Appearance", Palette],
  ["homepage", "Page Builder", LayoutDashboard],
  ["discovery", "Discovery", Sparkles],
  ["content", "Content", Music2],
  ["profiles", "Artist Profiles", Users],
  ["community", "Community", Users],
  ["membership", "Membership", WalletCards],
  ["listening", "Time Bank", Headphones],
  ["tokens", "Token Economy", WalletCards],
  ["announcements", "Announcements", Bell],
  ["health", "Live Health", Activity],
  ["permissions", "Permissions", Shield],
  ["experiments", "Experiment Lab", FlaskConical],
  ["presets", "Presets", Blocks],
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

const configSectionLabels: Record<ConfigSectionKey, string> = {
  theme: "Theme",
  homepage: "Homepage",
  ui: "UI Controls",
  discovery: "Discovery",
  spotlight: "Spotlight",
  artistProfile: "Artist Profiles",
  membership: "Membership",
  listeningBank: "Time Bank",
  tokens: "Tokens",
  permissions: "Permissions",
  experiments: "Experiments",
  announcements: "Announcements",
};

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

const homepagePriorityLabels: Record<
  PlatformControlConfig["homepage"]["firstVisibleSection"],
  string
> = {
  review_queue: "Review Queue",
  spotlight: "Spotlight",
  discovery: "Discovery",
  rankings: "Rankings",
  community_activity: "Community Activity",
  artist_spotlight: "Artist Spotlight",
  custom: "Custom",
};

const reviewDensityLabels: Record<
  PlatformControlConfig["homepage"]["reviewLayoutDensity"],
  string
> = {
  compact: "Compact View",
  standard: "Standard View",
  expanded: "Expanded View",
  custom: "Custom View",
};

const actionDesktopLabels: Record<
  PlatformControlConfig["homepage"]["actionButtonLayout"]["desktop"],
  string
> = {
  vertical_stack: "Vertical Stack",
  grid_2x3: "2x3 Grid",
  single_row: "Single Row",
  compact_row: "Compact Row",
  icons_only: "Icons Only",
  custom: "Custom",
};

const actionMobileLabels: Record<
  PlatformControlConfig["homepage"]["actionButtonLayout"]["mobile"],
  string
> = {
  icons_only: "Icons Only",
  icons_labels: "Icons + Labels",
  two_row_grid: "Two Row Grid",
  grid: "Grid",
  single_row: "Single Row",
  compact_row: "Compact Row",
  custom: "Custom",
};

const reviewFormLabels: Record<
  PlatformControlConfig["homepage"]["reviewFormLayout"],
  string
> = {
  compact: "Compact",
  standard: "Standard",
  detailed: "Detailed",
  custom: "Custom",
};

const landingPlaybackLabels: Record<
  PlatformControlConfig["homepage"]["autoplay"]["defaultLandingPlayback"],
  string
> = {
  review_queue: "Review Queue",
  spotlight: "Spotlight",
  discovery: "Discovery",
  top_results: "Top Results",
  custom: "Custom",
};

const externalVisibilityLabels: Record<
  PlatformControlConfig["discovery"]["externalContent"]["visibility"],
  string
> = {
  mixed_with_queue: "Mixed With Queue",
  separate_section: "Separate Page / Section",
  both: "Both",
  hidden: "Hidden",
};

const externalBehaviorLabels: Record<
  PlatformControlConfig["discovery"]["externalContent"]["behavior"],
  string
> = {
  mix_normally: "Mix Normally",
  ask_user: "Ask User",
  skip_automatically: "Skip Automatically",
  internal_content_only: "Internal Content Only",
};

const externalPlacementLabels: Record<
  PlatformControlConfig["discovery"]["externalContent"]["placement"],
  string
> = {
  top: "Top",
  middle: "Middle",
  bottom: "Bottom",
  hidden: "Hidden",
};

const platformResolutionModeLabels: Record<
  PlatformControlConfig["discovery"]["platformResolution"]["engineMode"],
  string
> = {
  off: "Off",
  recommend: "Recommend",
  automatic: "Automatic",
};

const platformResolutionProviderLabels: Record<
  PlatformControlConfig["discovery"]["platformResolution"]["preferredPlatformOrder"][number],
  string
> = {
  youtube_music: "YouTube Music",
  youtube: "YouTube",
  spotify: "Spotify",
  apple_music: "Apple Music",
  tiktok: "TikTok",
  soundcloud: "SoundCloud",
};

const artistVisibilityLabels: Record<
  keyof PlatformControlConfig["artistProfile"]["visibility"],
  string
> = {
  followers: "Followers",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  savedCount: "Saved Count",
  communityActivity: "Community Activity",
  recentActivity: "Recent Activity",
  statistics: "Statistics",
  supporters: "Supporters",
  giftTokens: "Gift Tokens",
};

const artistDiscoveryLabels: Record<
  keyof PlatformControlConfig["artistProfile"]["discovery"],
  string
> = {
  showArtistNameLinks: "Show Artist Name Links",
  showArtistProfileButtons: "Show Artist Profile Buttons",
  showFollowArtistButton: "Show Follow Artist Button",
  showShareArtistButton: "Show Share Artist Button",
  showSupportArtistButton: "Show Support Artist Button",
  showArtistStatistics: "Show Artist Statistics",
};

const artistPremiumLabels: Record<
  keyof PlatformControlConfig["artistProfile"]["premium"],
  string
> = {
  enabled: "Enable Premium Artist Accounts",
  customBanner: "Custom Banner",
  customProfileImage: "Custom Profile Image",
  biography: "Artist Biography",
  customTheme: "Custom Theme",
  pinnedSong: "Pinned Song",
  socialLinks: "Social Media Links",
  featuredVideo: "Featured Video",
  customSections: "Custom Sections",
  premiumBadge: "Premium Badge",
};

const membershipVisibilityLabels: Record<
  PlatformControlConfig["membership"]["tiers"][MembershipTierKey]["visibility"],
  string
> = {
  public: "Public",
  private: "Private",
  hidden: "Hidden",
};

const badgePlacementLabels: Record<
  PlatformControlConfig["membership"]["tiers"][MembershipTierKey]["badge"]["placement"],
  string
> = {
  profile_header: "Profile Header",
  profile_card: "Profile Card",
  support_wall: "Support Wall",
  hidden: "Hidden",
};

const profileAppearanceLabels: Record<
  keyof PlatformControlConfig["membership"]["tiers"][MembershipTierKey]["profileAppearance"],
  string
> = {
  customFrame: "Custom Frame",
  customTheme: "Custom Theme",
  customBanner: "Custom Banner",
  profileAccent: "Profile Accent",
  recognitionStyling: "Recognition Styling",
};

const listeningModuleVisibilityLabels: Record<
  PlatformControlConfig["listeningBank"]["module"]["desktop"]["visibility"],
  string
> = {
  visible: "Visible",
  hidden: "Hidden",
  desktop_only: "Desktop Only",
  mobile_only: "Mobile Only",
};

const listeningModuleColumnLabels: Record<
  PlatformControlConfig["listeningBank"]["module"]["desktop"]["column"],
  string
> = {
  left: "Left Column",
  right: "Right Column",
  full_width: "Full Width",
};

const listeningModuleSizeLabels: Record<
  PlatformControlConfig["listeningBank"]["module"]["desktop"]["size"],
  string
> = {
  compact: "Compact",
  standard: "Standard",
  expanded: "Expanded",
  custom: "Custom",
};

const desktopValidationModeLabels: Record<
  PlatformControlConfig["listeningBank"]["validation"]["desktopValidationMode"],
  string
> = {
  strict: "Strict",
  balanced: "Balanced",
  playback_based: "Playback Based",
};

const listeningTestLabels: Record<string, string> = {
  simulate_5_minutes: "Simulate 5 Minutes",
  simulate_10_minutes: "Simulate 10 Minutes",
  simulate_30_minutes: "Simulate 30 Minutes",
  simulate_60_minutes: "Simulate 60 Minutes",
  simulate_approval_event: "Simulate Approval Event",
  simulate_reward_event: "Simulate Reward Event",
  simulate_token_award: "Simulate Token Award",
};

function formatBankSeconds(value?: number | null) {
  const totalSeconds = Math.max(0, Number(value ?? 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function listeningEventTemplate(): PlatformControlConfig["listeningBank"]["events"][number] {
  return {
    id: crypto.randomUUID(),
    name: "New Listening Event",
    startsAt: new Date().toISOString(),
    endsAt: null,
    enabled: false,
    visible: true,
    rewardTypes: {
      extraListeningMinutes: false,
      listeningMultiplier: true,
      tokenMultiplier: false,
      missionMultiplier: false,
    },
    bonusMinutes: 0,
    bonusThresholdMinutes: 60,
    listeningMultiplier: 2,
    tokenMultiplier: 1,
    missionMultiplier: 1,
    description: "",
    preview: true,
  };
}

const communityFeatureLabels: Record<
  keyof PlatformControlConfig["homepage"]["community"]["features"],
  string
> = {
  likes: "Likes",
  comments: "Comments",
  followers: "Followers",
  shares: "Shares",
  savedSongs: "Saved Songs",
  supporters: "Supporters",
  statistics: "Statistics",
  reviews: "Reviews",
};

const communityVisibilityLabels: Record<
  keyof PlatformControlConfig["homepage"]["community"]["visibility"],
  string
> = {
  communityActivity: "Community Activity",
  whileYouWereAway: "While You Were Away",
  topSupporters: "Top Supporters",
  recentSupporters: "Recent Supporters",
};

const uiDisplayLabels: Record<
  PlatformControlConfig["ui"]["components"][UiComponentKey]["display"],
  string
> = {
  hidden: "Hidden",
  icon_only: "Icon Only",
  text_only: "Text Only",
  icon_text: "Icon + Text",
};

const uiSizeLabels: Record<UiSizePreset, string> = {
  xs: "XS",
  small: "Small",
  medium: "Medium",
  large: "Large",
  custom: "Custom",
};

const uiDensityLabels = {
  compact: "Compact",
  standard: "Standard",
  expanded: "Expanded",
  custom: "Custom",
} satisfies Record<PlatformControlConfig["ui"]["desktop"]["cardLayout"], string>;

const uiActionLayoutLabels: Record<
  PlatformControlConfig["ui"]["desktop"]["actionLayout"],
  string
> = {
  grid: "Grid",
  single_row: "Single Row",
  compact_row: "Compact Row",
  icons_only: "Icons Only",
  custom: "Custom",
};

const artistHeaderLabels: Record<
  PlatformControlConfig["artistProfile"]["headerLayout"],
  string
> = {
  compact: "Compact",
  standard: "Standard",
  expanded: "Expanded",
};

const artistSongSortLabels: Record<
  PlatformControlConfig["artistProfile"]["songSortOrder"],
  string
> = {
  newest: "Newest",
  most_played: "Most Played",
  most_supported: "Most Supported",
  most_shared: "Most Shared",
  highest_rated: "Highest Rated",
};

const communitySectionLabels: Record<
  keyof PlatformControlConfig["homepage"]["community"]["sectionVisibility"],
  string
> = {
  homepage: "Homepage",
  artistProfile: "Artist Profile",
  reviewQueue: "Review Queue",
  discovery: "Discovery",
  rankings: "Rankings",
};

const communitySectionFieldLabels: Record<
  keyof PlatformControlConfig["homepage"]["community"]["sectionVisibility"]["homepage"],
  string
> = {
  likes: "Likes",
  comments: "Comments",
  followers: "Followers",
  shares: "Shares",
  savedSongs: "Saved Songs",
  supporters: "Supporters",
  communityActivity: "Community Activity",
  reviews: "Reviews",
  statistics: "Statistics",
};

const membershipTierOrder = Object.keys(
  membershipTierLabels,
) as MembershipTierKey[];

function MembershipTierEditor({
  tierKey,
  tier,
  onChange,
}: {
  tierKey: MembershipTierKey;
  tier: MembershipTierConfig;
  onChange: (updater: (tier: MembershipTierConfig) => MembershipTierConfig) => void;
}) {
  return (
    <article className="control-card control-card-wide membership-tier-card">
      <div className="control-heading">
        <div>
          <span className="eyebrow">
            {tier.enabled ? "Active tier" : "Prepared tier"}
          </span>
          <h3>{membershipTierLabels[tierKey]}</h3>
          <p>{tier.description}</p>
        </div>
        <label className="control-inline-toggle">
          <input
            checked={tier.enabled}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                enabled: event.target.checked,
                visibility: event.target.checked ? "public" : current.visibility,
              }))
            }
            type="checkbox"
          />
          Enabled
        </label>
      </div>

      <div className="control-number-grid">
        <label>
          Name
          <input
            maxLength={80}
            onChange={(event) =>
              onChange((current) => ({ ...current, name: event.target.value }))
            }
            value={tier.name}
          />
        </label>
        <label>
          Visibility
          <select
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                visibility: event.target.value as MembershipTierConfig["visibility"],
              }))
            }
            value={tier.visibility}
          >
            {Object.entries(membershipVisibilityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        Description
        <textarea
          maxLength={400}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              description: event.target.value,
            }))
          }
          value={tier.description}
        />
      </label>

      <div className="control-section-heading">
        <span className="eyebrow">Badge Manager</span>
        <h4>Badge name, color, icon, visibility, and placement</h4>
      </div>
      <div className="control-number-grid">
        <label>
          Badge Name
          <input
            maxLength={80}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                badge: { ...current.badge, name: event.target.value },
              }))
            }
            value={tier.badge.name}
          />
        </label>
        <label>
          Badge Icon
          <input
            maxLength={40}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                badge: { ...current.badge, icon: event.target.value },
              }))
            }
            value={tier.badge.icon}
          />
        </label>
        <label>
          Badge Color
          <input
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                badge: { ...current.badge, color: event.target.value },
              }))
            }
            type="color"
            value={tier.badge.color}
          />
        </label>
        <label>
          Badge Placement
          <select
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                badge: {
                  ...current.badge,
                  placement:
                    event.target.value as MembershipTierConfig["badge"]["placement"],
                },
              }))
            }
            value={tier.badge.placement}
          >
            {Object.entries(badgePlacementLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="control-inline-toggle">
          <input
            checked={tier.badge.visible}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                badge: { ...current.badge, visible: event.target.checked },
              }))
            }
            type="checkbox"
          />
          Badge Visible
        </label>
      </div>

      <div className="control-section-heading">
        <span className="eyebrow">Profile Appearance Manager</span>
        <h4>Per-tier visual recognition</h4>
      </div>
      <div className="control-toggle-grid">
        {(
          Object.keys(tier.profileAppearance) as Array<
            keyof MembershipTierConfig["profileAppearance"]
          >
        ).map((field) =>
          field === "profileAccent" ? (
            <label key={field}>
              {profileAppearanceLabels[field]}
              <input
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    profileAppearance: {
                      ...current.profileAppearance,
                      profileAccent: event.target.value,
                    },
                  }))
                }
                type="color"
                value={tier.profileAppearance.profileAccent}
              />
            </label>
          ) : (
            <label key={field}>
              <input
                checked={Boolean(tier.profileAppearance[field])}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    profileAppearance: {
                      ...current.profileAppearance,
                      [field]: event.target.checked,
                    },
                  }))
                }
                type="checkbox"
              />
              {profileAppearanceLabels[field]}
            </label>
          ),
        )}
      </div>

      <div className="control-section-heading">
        <span className="eyebrow">Membership Permission Manager</span>
        <h4>Individual permission controls</h4>
      </div>
      <div className="control-toggle-grid membership-permission-grid">
        {(
          Object.keys(membershipPermissionLabels) as MembershipPermissionKey[]
        ).map((permission) => (
          <label key={permission}>
            <input
              checked={tier.permissions[permission]}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  permissions: {
                    ...current.permissions,
                    [permission]: event.target.checked,
                  },
                }))
              }
              type="checkbox"
            />
            {membershipPermissionLabels[permission]}
          </label>
        ))}
      </div>
    </article>
  );
}

const announcementBannerLabels: Record<
  ControlAnnouncement["bannerPlacement"],
  string
> = {
  standard: "Standard",
  homepage: "Homepage Banner",
  artist: "Artist Banner",
  contest: "Contest Banner",
  emergency: "Emergency Banner",
};

const ownerPresetLabels = {
  compact_desktop: "Compact Desktop",
  mobile_first: "Mobile First",
  artist_focused: "Artist Focused",
  discovery_focused: "Discovery Focused",
  minimal: "Minimal",
  community_focused: "Community Focused",
  contest_mode: "Contest Mode",
} as const;

const experimentMetricLabels: Record<
  keyof PlatformControlConfig["experiments"]["metrics"],
  string
> = {
  listeningTime: "Play Time",
  reviewsCompleted: "Reviews Completed",
  followersGained: "Followers Gained",
  shares: "Shares",
  comments: "Comments",
  artistVisits: "Artist Visits",
};

const experimentFlagLabels: Array<
  [keyof Omit<PlatformControlConfig["experiments"], "metrics" | "layoutA" | "layoutB" | "activeVariant">, string]
> = [
  ["experimentalFeatures", "Experimental Features"],
  ["abTesting", "A/B Testing"],
  ["layoutTesting", "Layout Testing"],
  ["themeTesting", "Theme Testing"],
  ["newDiscoveryModules", "New Discovery Modules"],
  ["betaFeatures", "Beta Features"],
];

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
    pinned: false,
    bannerPlacement: "standard",
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
  const [presetName, setPresetName] = useState("");
  const [exportSection, setExportSection] =
    useState<ConfigSectionKey | "all">("all");
  const [importSection, setImportSection] =
    useState<ConfigSectionKey>("theme");
  const [previewUserId, setPreviewUserId] = useState("");
  const [listeningTestResult, setListeningTestResult] =
    useState<Record<string, unknown> | null>(null);
  const [draggedModule, setDraggedModule] =
    useState<HomepageModuleKey | null>(null);
  const [draggedSpotlightIndex, setDraggedSpotlightIndex] =
    useState<number | null>(null);
  const [songDirectory, setSongDirectory] = useState(songs);
  const [contentSearch, setContentSearch] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const sectionImportRef = useRef<HTMLInputElement>(null);

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

  const saveSection = async (section: ConfigSectionKey) => {
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

  const runListeningBankTest = async (testKey: string) => {
    setBusy(true);
    setNotice("");
    try {
      const supabase = createClient();
      if (!supabase) throw new Error("Supabase is not configured.");
      const { data: result, error } = await supabase.rpc(
        "admin_run_listening_bank_test",
        { test_key: testKey },
      );
      if (error) throw error;
      setListeningTestResult((result ?? {}) as Record<string, unknown>);
      setNotice("Time Bank test completed without permanent changes.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The test failed.");
    } finally {
      setBusy(false);
    }
  };

  const archiveListeningActivityLog = async () => {
    const retainNewest = Math.max(
      0,
      Number(config.listeningBank.diagnostics.autoCleanupKeepVisible ?? 30),
    );
    await run(
      "admin_archive_listening_bank_activity",
      { retain_newest: retainNewest },
      `Activity log archived. Newest ${retainNewest} records remain visible.`,
    );
  };

  const cleanupListeningActivityLog = async () => {
    await run(
      "admin_cleanup_old_listening_bank_activity",
      {},
      "Old activity log records archived.",
    );
  };

  const clearListeningActivityLog = async () => {
    if (
      !window.confirm(
        "Clear the visible Time Bank activity log? Records will be archived before they are removed from the active log.",
      )
    ) {
      return;
    }
    await run(
      "admin_clear_listening_bank_activity",
      {},
      "Activity log cleared and archived.",
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

  const updateUiComponent = (
    component: UiComponentKey,
    updater: (
      current: PlatformControlConfig["ui"]["components"][UiComponentKey],
    ) => PlatformControlConfig["ui"]["components"][UiComponentKey],
  ) => {
    setConfig((current) => ({
      ...current,
      ui: {
        ...current.ui,
        components: {
          ...current.ui.components,
          [component]: updater(current.ui.components[component]),
        },
      },
    }));
  };

  const updateComponentSize = (
    component: UiComponentKey,
    device: "desktop" | "mobile",
    field: keyof UiResponsiveSize,
    value: string | number,
  ) => {
    updateUiComponent(component, (current) => ({
      ...current,
      [device]: {
        ...current[device],
        [field]: value,
      } as UiResponsiveSize,
    }));
  };

  const updateCardDensity = (
    card: CardDensityKey,
    density: PlatformControlConfig["ui"]["cardDensity"][CardDensityKey],
  ) => {
    setConfig((current) => ({
      ...current,
      ui: {
        ...current.ui,
        cardDensity: {
          ...current.ui.cardDensity,
          [card]: density,
        },
      },
    }));
  };

  const uiPresetSnapshot = (source: PlatformControlConfig) => {
    return {
      theme: source.theme,
      homepage: source.homepage,
      ui: {
        components: source.ui.components,
        cardDensity: source.ui.cardDensity,
        desktop: source.ui.desktop,
        mobile: source.ui.mobile,
        preview: source.ui.preview,
      },
      discovery: source.discovery,
      artistProfile: source.artistProfile,
      membership: source.membership,
      listeningBank: source.listeningBank,
      tokens: source.tokens,
      announcements: source.announcements,
    };
  };

  const saveCurrentUiPreset = () => {
    const name = presetName.trim();
    if (name.length < 3) {
      setNotice("Preset name must be at least 3 characters.");
      return;
    }
    setConfig((current) => ({
      ...current,
      ui: {
        ...current.ui,
        presets: {
          ...current.ui.presets,
          active: name,
          custom: [
            ...current.ui.presets.custom,
            {
              id: crypto.randomUUID(),
              name,
              description,
              snapshot: uiPresetSnapshot(current),
              createdAt: new Date().toISOString(),
            },
          ],
        },
      },
    }));
    setPresetName("");
    setNotice("UI preset saved in this draft. Save the UI Controls draft when ready.");
  };

  const applyCustomPreset = (
    preset: PlatformControlConfig["ui"]["presets"]["custom"][number],
  ) => {
    setConfig((current) => {
      const snapshot = preset.snapshot as Partial<PlatformControlConfig>;
      const next = normalizePlatformControlConfig({
        ...current,
        ...snapshot,
        ui: {
          ...current.ui,
          ...(snapshot.ui && typeof snapshot.ui === "object"
            ? snapshot.ui
            : {}),
          presets: {
            ...current.ui.presets,
            active: preset.name,
          },
        },
      });
      return next;
    });
    setNotice(`${preset.name} applied to the draft.`);
  };

  const applyBuiltInPreset = (preset: keyof typeof ownerPresetLabels) => {
    setConfig((current) => {
      const next = structuredClone(current);
      next.ui.presets.active = preset;
      if (preset === "compact_desktop") {
        next.homepage.reviewLayoutDensity = "compact";
        next.homepage.reviewFormLayout = "compact";
        next.ui.desktop.actionLayout = "compact_row";
        next.homepage.actionButtonLayout.desktop = "compact_row";
        for (const card of Object.keys(next.ui.cardDensity) as CardDensityKey[]) {
          next.ui.cardDensity[card] = "compact";
        }
      }
      if (preset === "mobile_first") {
        next.ui.mobile.actionLayout = "icons_only";
        next.homepage.actionButtonLayout.mobile = "icons_only";
        next.ui.mobile.cardLayout = "compact";
        next.homepage.firstVisibleSection = "review_queue";
      }
      if (preset === "artist_focused") {
        next.homepage.firstVisibleSection = "artist_spotlight";
        next.artistProfile.layout = "premium_showcase";
        next.artistProfile.headerLayout = "expanded";
        next.artistProfile.songSortOrder = "most_supported";
        next.artistProfile.visibility.supporters = true;
        next.artistProfile.visibility.communityActivity = true;
      }
      if (preset === "discovery_focused") {
        next.homepage.firstVisibleSection = "discovery";
        next.discovery.externalContent.visibility = "both";
        next.discovery.externalContent.placement = "top";
        next.ui.cardDensity.discovery = "expanded";
      }
      if (preset === "minimal") {
        next.homepage.reviewLayoutDensity = "compact";
        next.ui.desktop.actionLayout = "icons_only";
        next.ui.mobile.actionLayout = "icons_only";
        next.ui.components.commentsButton.display = "hidden";
        next.ui.components.statisticsButton.display = "hidden";
      }
      if (preset === "community_focused") {
        for (const section of Object.keys(
          next.homepage.community.sectionVisibility,
        ) as Array<keyof PlatformControlConfig["homepage"]["community"]["sectionVisibility"]>) {
          for (const field of Object.keys(
            next.homepage.community.sectionVisibility[section],
          ) as Array<
            keyof PlatformControlConfig["homepage"]["community"]["sectionVisibility"]["homepage"]
          >) {
            next.homepage.community.sectionVisibility[section][field] = true;
          }
        }
        next.homepage.firstVisibleSection = "community_activity";
      }
      if (preset === "contest_mode") {
        next.tokens.rewardMultipliers.contest = 2;
        next.homepage.firstVisibleSection = "spotlight";
        next.announcements = [
          ...next.announcements,
          {
            ...emptyAnnouncement(),
            type: "contest_banner",
            title: "Contest Mode Active",
            message: "Featured contests and community events are highlighted.",
            pinned: true,
            bannerPlacement: "contest",
          },
        ];
      }
      return next;
    });
    setNotice(`${ownerPresetLabels[preset]} preset applied to the draft.`);
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

  const exportSelectedConfig = () => {
    if (exportSection === "all") {
      exportConfig();
      return;
    }
    const payload = {
      section: exportSection,
      value: config[exportSection],
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `first-listen-${exportSection}-draft.json`;
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

  const importSelectedSection = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const value =
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        "value" in parsed
          ? (parsed as { value: unknown }).value
          : parsed;
      const next = normalizePlatformControlConfig({
        ...config,
        [importSection]: value,
      });
      setConfig(next);
      setNotice(
        `${configSectionLabels[importSection]} imported into this draft. Save the section when ready.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Section import failed.",
      );
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
  const listeningBankPayload = data.listening_bank;
  const listeningDiagnostics = listeningBankPayload?.diagnostics ?? {};
  const listeningActivityLog = listeningBankPayload?.activity_log ?? [];
  const listeningTestScenarios =
    listeningBankPayload?.test_scenarios ?? Object.keys(listeningTestLabels);
  const activeListeningEvent = listeningBankPayload?.active_event;
  const rejectionInsights = listeningBankPayload?.rejection_insights ?? {};
  const rejectionFrequency = rejectionInsights.reason_frequency ?? [];
  const lastRejections = rejectionInsights.last_100_rejections ?? [];
  const commonFailureCauses =
    rejectionInsights.most_common_failure_causes ?? [];

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
            <div className="control-number-grid">
              <label>
                Preview target
                <select
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      ui: {
                        ...current.ui,
                        preview: {
                          ...current.ui.preview,
                          target: event.target
                            .value as PlatformControlConfig["ui"]["preview"]["target"],
                        },
                      },
                    }))
                  }
                  value={config.ui.preview.target}
                >
                  <option value="section">Individual Section</option>
                  <option value="homepage">Entire Homepage</option>
                  <option value="mobile">Mobile Preview</option>
                  <option value="desktop">Desktop Preview</option>
                </select>
              </label>
              <label>
                Preview section
                <select
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      ui: {
                        ...current.ui,
                        preview: {
                          ...current.ui.preview,
                          section: event.target
                            .value as PlatformControlConfig["ui"]["preview"]["section"],
                        },
                      },
                    }))
                  }
                  value={config.ui.preview.section}
                >
                  {Object.entries(homepageModuleLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                  <option value="artist_profile">Artist Profile</option>
                </select>
              </label>
            </div>
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
                onClick={() => {
                  const target =
                    config.ui.preview.section === "artist_profile"
                      ? "/"
                      : config.ui.preview.target === "section" &&
                          config.ui.preview.section === "review_queue"
                        ? "/review"
                        : "/";
                  window.open(target, "_blank", "noopener,noreferrer");
                }}
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
              <select
                aria-label="Export section"
                onChange={(event) =>
                  setExportSection(event.target.value as typeof exportSection)
                }
                value={exportSection}
              >
                <option value="all">Entire Configuration</option>
                {Object.entries(configSectionLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                className="secondary-button"
                onClick={exportSelectedConfig}
                type="button"
              >
                <Download size={15} /> Export JSON
              </button>
              <select
                aria-label="Import section"
                onChange={(event) =>
                  setImportSection(event.target.value as ConfigSectionKey)
                }
                value={importSection}
              >
                {Object.entries(configSectionLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                className="secondary-button"
                disabled={!data.founder_controller}
                onClick={() => importRef.current?.click()}
                type="button"
              >
                <Upload size={15} /> Import Full JSON
              </button>
              <button
                className="secondary-button"
                disabled={!data.founder_controller}
                onClick={() => sectionImportRef.current?.click()}
                type="button"
              >
                <Upload size={15} /> Import Section
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
              <input
                accept="application/json,.json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importSelectedSection(file);
                  event.target.value = "";
                }}
                ref={sectionImportRef}
                type="file"
              />
            </div>
          </article>
        </div>
      )}

      {tab === "interface" && (
        <div className="control-grid">
          <article className="control-card control-card-wide">
            <div className="control-heading">
              <div>
                <span className="eyebrow">Interface density</span>
                <h3>Review screen spacing and readability</h3>
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
            <div className="control-number-grid">
              <label>
                Review layout
                <select
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      homepage: {
                        ...current.homepage,
                        reviewLayoutDensity: event.target
                          .value as PlatformControlConfig["homepage"]["reviewLayoutDensity"],
                      },
                    }))
                  }
                  value={config.homepage.reviewLayoutDensity}
                >
                  {Object.entries(reviewDensityLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Review form layout
                <select
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      homepage: {
                        ...current.homepage,
                        reviewFormLayout: event.target
                          .value as PlatformControlConfig["homepage"]["reviewFormLayout"],
                      },
                    }))
                  }
                  value={config.homepage.reviewFormLayout}
                >
                  {Object.entries(reviewFormLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p>
              Compact reduces whitespace and card height. Standard keeps the
              current balance. Expanded increases spacing for readability.
            </p>
          </article>

          <article className="control-card">
            <span className="eyebrow">Action button layout</span>
            <h3>Desktop and mobile controls</h3>
            <label>
              Desktop
              <select
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    homepage: {
                      ...current.homepage,
                      actionButtonLayout: {
                        ...current.homepage.actionButtonLayout,
                        desktop: event.target
                          .value as PlatformControlConfig["homepage"]["actionButtonLayout"]["desktop"],
                      },
                    },
                  }))
                }
                value={config.homepage.actionButtonLayout.desktop}
              >
                {Object.entries(actionDesktopLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Mobile
              <select
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    homepage: {
                      ...current.homepage,
                      actionButtonLayout: {
                        ...current.homepage.actionButtonLayout,
                        mobile: event.target
                          .value as PlatformControlConfig["homepage"]["actionButtonLayout"]["mobile"],
                      },
                    },
                  }))
                }
                value={config.homepage.actionButtonLayout.mobile}
              >
                {Object.entries(actionMobileLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p>Defaults: desktop 2x3 grid and mobile icons only.</p>
          </article>

          <article className="control-card">
            <span className="eyebrow">Auto play settings</span>
            <h3>Default landing playback</h3>
            <label className="control-switch">
              <input
                checked={config.homepage.autoplay.autoPlayOnLoginDefault}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    homepage: {
                      ...current.homepage,
                      autoplay: {
                        ...current.homepage.autoplay,
                        autoPlayOnLoginDefault: event.target.checked,
                      },
                    },
                  }))
                }
                type="checkbox"
              />
              <span>
                {config.homepage.autoplay.autoPlayOnLoginDefault
                  ? "Auto Play On Login enabled"
                  : "Auto Play On Login disabled"}
              </span>
            </label>
            <label>
              Start playback from
              <select
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    homepage: {
                      ...current.homepage,
                      autoplay: {
                        ...current.homepage.autoplay,
                        defaultLandingPlayback: event.target
                          .value as PlatformControlConfig["homepage"]["autoplay"]["defaultLandingPlayback"],
                      },
                    },
                  }))
                }
                value={config.homepage.autoplay.defaultLandingPlayback}
              >
                {Object.entries(landingPlaybackLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="control-switch">
              <input
                checked={config.homepage.autoplay.autoPlayNextSongDefault}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    homepage: {
                      ...current.homepage,
                      autoplay: {
                        ...current.homepage.autoplay,
                        autoPlayNextSongDefault: event.target.checked,
                      },
                    },
                  }))
                }
                type="checkbox"
              />
              <span>
                {config.homepage.autoplay.autoPlayNextSongDefault
                  ? "Auto Play Next Song enabled"
                  : "Auto Play Next Song disabled"}
              </span>
            </label>
          </article>

          <article className="control-card">
            <div className="control-heading">
              <div>
                <span className="eyebrow">Desktop / mobile layout</span>
                <h3>Advanced action and card layout</h3>
              </div>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void saveSection("ui")}
                type="button"
              >
                <Save size={15} /> Save UI
              </button>
            </div>
            <div className="control-number-grid">
              <label>
                Desktop action layout
                <select
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      ui: {
                        ...current.ui,
                        desktop: {
                          ...current.ui.desktop,
                          actionLayout: event.target
                            .value as PlatformControlConfig["ui"]["desktop"]["actionLayout"],
                        },
                      },
                    }))
                  }
                  value={config.ui.desktop.actionLayout}
                >
                  {Object.entries(uiActionLayoutLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Desktop card layout
                <select
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      ui: {
                        ...current.ui,
                        desktop: {
                          ...current.ui.desktop,
                          cardLayout: event.target
                            .value as PlatformControlConfig["ui"]["desktop"]["cardLayout"],
                        },
                      },
                    }))
                  }
                  value={config.ui.desktop.cardLayout}
                >
                  {Object.entries(uiDensityLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Mobile action layout
                <select
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      ui: {
                        ...current.ui,
                        mobile: {
                          ...current.ui.mobile,
                          actionLayout: event.target
                            .value as PlatformControlConfig["ui"]["mobile"]["actionLayout"],
                        },
                      },
                    }))
                  }
                  value={config.ui.mobile.actionLayout}
                >
                  {Object.entries(uiActionLayoutLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Mobile card layout
                <select
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      ui: {
                        ...current.ui,
                        mobile: {
                          ...current.ui.mobile,
                          cardLayout: event.target
                            .value as PlatformControlConfig["ui"]["mobile"]["cardLayout"],
                        },
                      },
                    }))
                  }
                  value={config.ui.mobile.cardLayout}
                >
                  {Object.entries(uiDensityLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </article>

          <article className="control-card control-card-wide">
            <div className="control-heading">
              <div>
                <span className="eyebrow">Why Was This Rejected?</span>
                <h3>Last 100 rejection reasons</h3>
                <p>
                  Inspect failure causes so users can understand exactly why
                  listening time did not count.
                </p>
              </div>
            </div>
            <div className="rejection-insights-grid">
              <section>
                <h4>Reason Frequency</h4>
                {rejectionFrequency.map((reason) => (
                  <div key={reason.reason_code}>
                    <strong>{reason.reason_description}</strong>
                    <span>{reason.reason_code}</span>
                    <b>{reason.total}</b>
                  </div>
                ))}
                {!rejectionFrequency.length && (
                  <p>No rejection reasons have been recorded yet.</p>
                )}
              </section>
              <section>
                <h4>Most Common Failure Causes</h4>
                {commonFailureCauses.map((cause, index) => (
                  <div key={`${cause}-${index}`}>
                    <strong>{cause}</strong>
                  </div>
                ))}
                {!commonFailureCauses.length && (
                  <p>No failure causes are available yet.</p>
                )}
              </section>
            </div>
            <div className="listening-rejection-list">
              {lastRejections.map((rejection) => (
                <div key={rejection.id}>
                  <strong>{rejection.reason_description}</strong>
                  <span>{rejection.reason_code}</span>
                  <small>{new Date(rejection.created_at).toLocaleString()}</small>
                </div>
              ))}
              {!lastRejections.length && (
                <p>No rejected listening activity has been recorded yet.</p>
              )}
            </div>
          </article>

          <article className="control-card control-card-wide">
            <div className="control-heading">
              <div>
                <span className="eyebrow">Card density control</span>
                <h3>Set density by card type</h3>
              </div>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void saveSection("ui")}
                type="button"
              >
                <Save size={15} /> Save UI
              </button>
            </div>
            <div className="control-number-grid">
              {(
                Object.keys(config.ui.cardDensity) as CardDensityKey[]
              ).map((card) => (
                <label key={card}>
                  {cardDensityLabels[card]}
                  <select
                    onChange={(event) =>
                      updateCardDensity(
                        card,
                        event.target
                          .value as PlatformControlConfig["ui"]["cardDensity"][CardDensityKey],
                      )
                    }
                    value={config.ui.cardDensity[card]}
                  >
                    {Object.entries(uiDensityLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </article>

          <article className="control-card control-card-wide">
            <div className="control-heading">
              <div>
                <span className="eyebrow">UI component control</span>
                <h3>Visibility, display mode, and responsive sizes</h3>
              </div>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void saveSection("ui")}
                type="button"
              >
                <Save size={15} /> Save UI
              </button>
            </div>
            <div className="control-component-grid">
              {(Object.keys(config.ui.components) as UiComponentKey[]).map(
                (component) => {
                  const control = config.ui.components[component];
                  return (
                    <section key={component}>
                      <strong>{uiComponentLabels[component]}</strong>
                      <label>
                        Display
                        <select
                          onChange={(event) =>
                            updateUiComponent(component, (current) => ({
                              ...current,
                              display: event.target
                                .value as typeof current.display,
                            }))
                          }
                          value={control.display}
                        >
                          {Object.entries(uiDisplayLabels).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      {(["desktop", "mobile"] as const).map((device) => (
                        <div className="control-size-grid" key={device}>
                          <span>{device}</span>
                          {(
                            [
                              ["iconSize", "Icon"],
                              ["textSize", "Text"],
                              ["buttonSize", "Button"],
                            ] as const
                          ).map(([field, label]) => (
                            <label key={`${device}-${field}`}>
                              {label}
                              <select
                                onChange={(event) =>
                                  updateComponentSize(
                                    component,
                                    device,
                                    field,
                                    event.target.value as UiSizePreset,
                                  )
                                }
                                value={control[device][field]}
                              >
                                {Object.entries(uiSizeLabels).map(
                                  ([value, sizeLabel]) => (
                                    <option key={value} value={value}>
                                      {sizeLabel}
                                    </option>
                                  ),
                                )}
                              </select>
                            </label>
                          ))}
                          {(
                            [
                              ["iconCustomPx", "Icon px"],
                              ["textCustomPx", "Text px"],
                              ["buttonCustomPx", "Button px"],
                            ] as const
                          ).map(([field, label]) => (
                            <label key={`${device}-${field}`}>
                              {label}
                              <input
                                min={field === "buttonCustomPx" ? 4 : 6}
                                max={field === "buttonCustomPx" ? 28 : 48}
                                onChange={(event) =>
                                  updateComponentSize(
                                    component,
                                    device,
                                    field,
                                    Number(event.target.value),
                                  )
                                }
                                type="number"
                                value={control[device][field]}
                              />
                            </label>
                          ))}
                        </div>
                      ))}
                    </section>
                  );
                },
              )}
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
          <label className="control-priority-select">
            Choose first visible section
            <select
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  homepage: {
                    ...current.homepage,
                    firstVisibleSection: event.target
                      .value as PlatformControlConfig["homepage"]["firstVisibleSection"],
                  },
                }))
              }
              value={config.homepage.firstVisibleSection}
            >
              {Object.entries(homepagePriorityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
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

          <article className="control-card">
            <span className="eyebrow">External content control</span>
            <h3>Discovery and queue behavior</h3>
            <label>
              External content visibility
              <select
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    discovery: {
                      ...current.discovery,
                      externalContent: {
                        ...current.discovery.externalContent,
                        visibility: event.target
                          .value as PlatformControlConfig["discovery"]["externalContent"]["visibility"],
                      },
                    },
                  }))
                }
                value={config.discovery.externalContent.visibility}
              >
                {Object.entries(externalVisibilityLabels).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              External content ratio
              <select
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    discovery: {
                      ...current.discovery,
                      externalContent: {
                        ...current.discovery.externalContent,
                        ratio: Number(event.target.value) as
                          PlatformControlConfig["discovery"]["externalContent"]["ratio"],
                      },
                    },
                  }))
                }
                value={config.discovery.externalContent.ratio}
              >
                {[0, 10, 20, 30, 50].map((value) => (
                  <option key={value} value={value}>
                    {value}%
                  </option>
                ))}
              </select>
            </label>
            <label>
              External song behavior
              <select
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    discovery: {
                      ...current.discovery,
                      externalContent: {
                        ...current.discovery.externalContent,
                        behavior: event.target
                          .value as PlatformControlConfig["discovery"]["externalContent"]["behavior"],
                      },
                    },
                  }))
                }
                value={config.discovery.externalContent.behavior}
              >
                {Object.entries(externalBehaviorLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              External Discovery placement
              <select
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    discovery: {
                      ...current.discovery,
                      externalContent: {
                        ...current.discovery.externalContent,
                        placement: event.target
                          .value as PlatformControlConfig["discovery"]["externalContent"]["placement"],
                      },
                    },
                  }))
                }
                value={config.discovery.externalContent.placement}
              >
                {Object.entries(externalPlacementLabels).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="control-switch">
              <input
                checked={config.discovery.externalContent.userSkipExternalDefault}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    discovery: {
                      ...current.discovery,
                      externalContent: {
                        ...current.discovery.externalContent,
                        userSkipExternalDefault: event.target.checked,
                      },
                    },
                  }))
                }
                type="checkbox"
              />
              <span>Automatically skip external songs by default</span>
            </label>
            <div className="control-divider" />
            <span className="eyebrow">Platform Resolution Engine</span>
            <label>
              Resolution mode
              <select
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    discovery: {
                      ...current.discovery,
                      platformResolution: {
                        ...current.discovery.platformResolution,
                        engineMode: event.target
                          .value as PlatformControlConfig["discovery"]["platformResolution"]["engineMode"],
                      },
                    },
                  }))
                }
                value={config.discovery.platformResolution.engineMode}
              >
                {Object.entries(platformResolutionModeLabels).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </label>
            <div className="control-toggle-grid">
              <label>
                <input
                  checked={
                    config.discovery.platformResolution
                      .showPlatformRecommendations
                  }
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      discovery: {
                        ...current.discovery,
                        platformResolution: {
                          ...current.discovery.platformResolution,
                          showPlatformRecommendations: event.target.checked,
                        },
                      },
                    }))
                  }
                  type="checkbox"
                />
                Show Platform Recommendations
              </label>
              <label>
                <input
                  checked={
                    config.discovery.platformResolution.showSecondaryPlatforms
                  }
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      discovery: {
                        ...current.discovery,
                        platformResolution: {
                          ...current.discovery.platformResolution,
                          showSecondaryPlatforms: event.target.checked,
                        },
                      },
                    }))
                  }
                  type="checkbox"
                />
                Show Secondary Platforms
              </label>
            </div>
            <div className="control-mini-grid">
              {config.discovery.platformResolution.preferredPlatformOrder.map(
                (provider, index) => (
                  <label key={`platform-order-${index}`}>
                    Preferred #{index + 1}
                    <select
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          discovery: {
                            ...current.discovery,
                            platformResolution: {
                              ...current.discovery.platformResolution,
                              preferredPlatformOrder:
                                current.discovery.platformResolution
                                  .preferredPlatformOrder.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? (event.target
                                          .value as typeof provider)
                                      : item,
                                  ),
                            },
                          },
                        }))
                      }
                      value={provider}
                    >
                      {Object.entries(platformResolutionProviderLabels).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                ),
              )}
            </div>
            <span className="eyebrow">External Discovery modules</span>
            <div className="control-toggle-grid">
              {(
                Object.keys(config.discovery.externalDiscovery) as Array<
                  keyof PlatformControlConfig["discovery"]["externalDiscovery"]
                >
              ).map((field) => (
                <label key={field}>
                  <input
                    checked={config.discovery.externalDiscovery[field]}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        discovery: {
                          ...current.discovery,
                          externalDiscovery: {
                            ...current.discovery.externalDiscovery,
                            [field]: event.target.checked,
                          },
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  {field
                    .replace(/([A-Z])/g, " $1")
                    .replace(/^./, (letter) => letter.toUpperCase())}
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
        <div className="control-grid">
          <article className="control-card control-card-wide">
            <div className="control-heading">
              <div>
                <span className="eyebrow">Public artist profiles</span>
                <h3>Visibility, layout, and section order</h3>
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
            <label>
              Profile layout
              <select
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    artistProfile: {
                      ...current.artistProfile,
                      layout: event.target
                        .value as PlatformControlConfig["artistProfile"]["layout"],
                    },
                  }))
                }
                value={config.artistProfile.layout}
              >
                <option value="compact">Compact</option>
                <option value="standard">Standard</option>
                <option value="premium_showcase">Premium Showcase</option>
              </select>
            </label>
            <div className="control-number-grid">
              <label>
                Artist header layout
                <select
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      artistProfile: {
                        ...current.artistProfile,
                        headerLayout: event.target
                          .value as PlatformControlConfig["artistProfile"]["headerLayout"],
                      },
                    }))
                  }
                  value={config.artistProfile.headerLayout}
                >
                  {Object.entries(artistHeaderLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Artist song sort order
                <select
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      artistProfile: {
                        ...current.artistProfile,
                        songSortOrder: event.target
                          .value as PlatformControlConfig["artistProfile"]["songSortOrder"],
                      },
                    }))
                  }
                  value={config.artistProfile.songSortOrder}
                >
                  {Object.entries(artistSongSortLabels).map(
                    ([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>
            <div className="control-section-heading">
              <span className="eyebrow">Artist Discovery Settings</span>
              <h4>One-click profile entry points</h4>
              <p>
                Control how visible artist profiles are across review,
                discovery, rankings, search, and community surfaces.
              </p>
            </div>
            <div className="control-toggle-grid">
              {(
                Object.keys(config.artistProfile.discovery) as Array<
                  keyof PlatformControlConfig["artistProfile"]["discovery"]
                >
              ).map((field) => (
                <label key={field}>
                  <input
                    checked={config.artistProfile.discovery[field]}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        artistProfile: {
                          ...current.artistProfile,
                          discovery: {
                            ...current.artistProfile.discovery,
                            [field]: event.target.checked,
                          },
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  {artistDiscoveryLabels[field]}
                </label>
              ))}
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

          <article className="control-card">
            <span className="eyebrow">Artist premium features</span>
            <h3>Customization only</h3>
            <p>
              Premium options do not affect valid plays, rankings, reviews,
              followers, or queue fairness.
            </p>
            <div className="control-toggle-grid">
              {(
                Object.keys(config.artistProfile.premium) as Array<
                  keyof PlatformControlConfig["artistProfile"]["premium"]
                >
              ).map((field) => (
                <label key={field}>
                  <input
                    checked={config.artistProfile.premium[field]}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        artistProfile: {
                          ...current.artistProfile,
                          premium: {
                            ...current.artistProfile.premium,
                            [field]: event.target.checked,
                          },
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  {artistPremiumLabels[field]}
                </label>
              ))}
            </div>
          </article>

          <article className="control-card">
            <span className="eyebrow">Artist profile system</span>
            <h3>Top artist preview</h3>
            <div className="control-ranking-list">
              {data.top_artists.map((artist, index) => (
                <div key={artist.id}>
                  <span>{index + 1}</span>
                  <strong>{artist.display_name}</strong>
                  <small>
                    Artist verified / {artist.followers} followers /{" "}
                    {artist.songs} songs
                  </small>
                </div>
              ))}
              {!data.top_artists.length && <p>No artist activity yet.</p>}
            </div>
          </article>
        </div>
      )}

      {tab === "community" && (
        <div className="control-grid">
          <article className="control-card">
            <div className="control-heading">
              <div>
                <span className="eyebrow">Community control</span>
                <h3>Enable or disable participation</h3>
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
            <div className="control-toggle-grid">
              {(
                Object.keys(config.homepage.community.features) as Array<
                  keyof PlatformControlConfig["homepage"]["community"]["features"]
                >
              ).map((field) => (
                <label key={field}>
                  <input
                    checked={config.homepage.community.features[field]}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        homepage: {
                          ...current.homepage,
                          community: {
                            ...current.homepage.community,
                            features: {
                              ...current.homepage.community.features,
                              [field]: event.target.checked,
                            },
                          },
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  {communityFeatureLabels[field]}
                </label>
              ))}
            </div>
          </article>

          <article className="control-card">
            <span className="eyebrow">Community visibility</span>
            <h3>Activity surfaces</h3>
            <div className="control-toggle-grid">
              {(
                Object.keys(config.homepage.community.visibility) as Array<
                  keyof PlatformControlConfig["homepage"]["community"]["visibility"]
                >
              ).map((field) => (
                <label key={field}>
                  <input
                    checked={config.homepage.community.visibility[field]}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        homepage: {
                          ...current.homepage,
                          community: {
                            ...current.homepage.community,
                            visibility: {
                              ...current.homepage.community.visibility,
                              [field]: event.target.checked,
                            },
                          },
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  {communityVisibilityLabels[field]}
                </label>
              ))}
            </div>
          </article>

          <article className="control-card control-card-wide">
            <span className="eyebrow">Per-section visibility</span>
            <h3>Choose which community signals appear in each area</h3>
            <div className="control-section-visibility-grid">
              {(
                Object.keys(
                  config.homepage.community.sectionVisibility,
                ) as Array<
                  keyof PlatformControlConfig["homepage"]["community"]["sectionVisibility"]
                >
              ).map((section) => (
                <section key={section}>
                  <strong>{communitySectionLabels[section]}</strong>
                  <div className="control-toggle-grid">
                    {(
                      Object.keys(
                        config.homepage.community.sectionVisibility[section],
                      ) as Array<
                        keyof PlatformControlConfig["homepage"]["community"]["sectionVisibility"]["homepage"]
                      >
                    ).map((field) => (
                      <label key={`${section}-${field}`}>
                        <input
                          checked={
                            config.homepage.community.sectionVisibility[
                              section
                            ][field]
                          }
                          onChange={(event) =>
                            setConfig((current) => ({
                              ...current,
                              homepage: {
                                ...current.homepage,
                                community: {
                                  ...current.homepage.community,
                                  sectionVisibility: {
                                    ...current.homepage.community
                                      .sectionVisibility,
                                    [section]: {
                                      ...current.homepage.community
                                        .sectionVisibility[section],
                                      [field]: event.target.checked,
                                    },
                                  },
                                },
                              },
                            }))
                          }
                          type="checkbox"
                        />
                        {communitySectionFieldLabels[field]}
                      </label>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </article>
        </div>
      )}

      {tab === "membership" && (
        <div className="control-grid membership-manager">
          <article className="control-card control-card-wide">
            <div className="control-heading">
              <div>
                <span className="eyebrow">Membership Manager</span>
                <h3>Tier foundation and permission manager</h3>
                <p>
                  Guest Listener and Registered Member are active. Creator,
                  Community Supporter, and Founder Circle are prepared but
                  disabled until the Founder activates them.
                </p>
              </div>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void saveSection("membership")}
                type="button"
              >
                <Save size={15} /> Save Draft
              </button>
            </div>
            <div className="membership-tier-summary">
              {membershipTierOrder.map((tierKey) => {
                const tier = config.membership.tiers[tierKey];
                return (
                  <div
                    className={tier.enabled ? "enabled" : "disabled"}
                    key={tierKey}
                  >
                    <strong>{tier.name}</strong>
                    <span>{tier.enabled ? "Enabled" : "Disabled"}</span>
                    <small>{tier.badge.name}</small>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="control-card">
            <span className="eyebrow">Membership Preview</span>
            <h3>Preview before activation</h3>
            <label>
              Preview tier
              <select
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    membership: {
                      ...current.membership,
                      previewTier: event.target.value as MembershipTierKey,
                    },
                  }))
                }
                value={config.membership.previewTier}
              >
                {membershipTierOrder.map((tierKey) => (
                  <option key={tierKey} value={tierKey}>
                    {config.membership.tiers[tierKey].name}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Preview mode stores the selected tier in the platform config. It
              does not activate disabled tiers for public users.
            </p>
          </article>

          <article className="control-card">
            <span className="eyebrow">Support Wall</span>
            <h3>Prepared but disabled</h3>
            <div className="control-toggle-grid">
              {(
                Object.keys(config.membership.supportWall) as Array<
                  keyof PlatformControlConfig["membership"]["supportWall"]
                >
              ).map((field) => (
                <label key={field}>
                  <input
                    checked={config.membership.supportWall[field]}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        membership: {
                          ...current.membership,
                          supportWall: {
                            ...current.membership.supportWall,
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
            <span className="eyebrow">Donation Infrastructure</span>
            <h3>Prepared only</h3>
            <p>
              Payments and subscriptions remain disabled. These switches only
              prepare the structure for a future release.
            </p>
            <div className="control-toggle-grid">
              {(
                Object.keys(config.membership.donations) as Array<
                  keyof PlatformControlConfig["membership"]["donations"]
                >
              ).map((field) => (
                <label key={field}>
                  <input
                    checked={config.membership.donations[field]}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        membership: {
                          ...current.membership,
                          donations: {
                            ...current.membership.donations,
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

          {membershipTierOrder.map((tierKey) => (
            <MembershipTierEditor
              key={tierKey}
              tier={config.membership.tiers[tierKey]}
              tierKey={tierKey}
              onChange={(updater) =>
                setConfig((current) => ({
                  ...current,
                  membership: {
                    ...current.membership,
                    tiers: {
                      ...current.membership.tiers,
                      [tierKey]: updater(current.membership.tiers[tierKey]),
                    },
                  },
                }))
              }
            />
          ))}
        </div>
      )}

      {tab === "listening" && (
        <div className="control-grid listening-bank-manager">
          <article className="control-card control-card-wide">
            <div className="control-heading">
              <div>
                <span className="eyebrow">Time Bank Diagnostics</span>
                <h3>Real-time accumulation and reward health</h3>
                <p>
                  These values come from listening sessions, reward claims,
                  credit balances, and the Time Bank activity log.
                </p>
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
            <div className="control-stat-list listening-diagnostics-grid">
              <div>
                <strong>
                  {formatBankSeconds(
                    Number(listeningDiagnostics.total_listening_time_today ?? 0),
                  )}
                </strong>
                <span>Total Play Time Today</span>
              </div>
              <div>
                <strong>
                  {formatBankSeconds(
                    Number(listeningDiagnostics.approved_listening_time_today ?? 0),
                  )}
                </strong>
                <span>Approved Play Time Today</span>
              </div>
              <div>
                <strong>
                  {formatBankSeconds(
                    Number(listeningDiagnostics.pending_listening_time ?? 0),
                  )}
                </strong>
                <span>Pending Play Time</span>
              </div>
              <div>
                <strong>
                  {formatBankSeconds(
                    Number(listeningDiagnostics.rejected_listening_time ?? 0),
                  )}
                </strong>
                <span>Rejected Play Time</span>
              </div>
              <div>
                <strong>
                  {listeningDiagnostics.last_rejection_reason_description ??
                    "None"}
                </strong>
                <span>Last Rejection Reason</span>
              </div>
              <div>
                <strong>
                  {formatBankSeconds(
                    Number(listeningDiagnostics.current_listening_bank ?? 0),
                  )}
                </strong>
                <span>Current Time Bank</span>
              </div>
              <div>
                <strong>
                  {Number(listeningDiagnostics.current_token_balance ?? 0)}
                </strong>
                <span>Current Token Balance</span>
              </div>
              <div>
                <strong>
                  {listeningDiagnostics.last_approval_event
                    ? new Date(listeningDiagnostics.last_approval_event).toLocaleString()
                    : "None"}
                </strong>
                <span>Last Approval Event</span>
              </div>
              <div>
                <strong>
                  {listeningDiagnostics.last_reward_event
                    ? new Date(listeningDiagnostics.last_reward_event).toLocaleString()
                    : "None"}
                </strong>
                <span>Last Reward Event</span>
              </div>
              <div>
                <strong>
                  {listeningDiagnostics.last_bank_update
                    ? new Date(listeningDiagnostics.last_bank_update).toLocaleString()
                    : "None"}
                </strong>
                <span>Last Bank Update</span>
              </div>
              <div>
                <strong>
                  {listeningDiagnostics.last_calculation_timestamp
                    ? new Date(
                        listeningDiagnostics.last_calculation_timestamp,
                      ).toLocaleString()
                    : "Not calculated"}
                </strong>
                <span>Last Calculation Timestamp</span>
              </div>
            </div>
          </article>

          <article className="control-card control-card-wide">
            <div className="control-heading">
              <div>
                <span className="eyebrow">Time Bank Activity Log</span>
                <h3>Approval, rejection, bonus, and reward history</h3>
                <p>
                  Showing{" "}
                  {Number(
                    listeningDiagnostics.visible_activity_log_limit ??
                      config.listeningBank.diagnostics.activityLogLimit,
                  )}{" "}
                  records by default.{" "}
                  {Number(listeningDiagnostics.archived_activity_entries ?? 0)}{" "}
                  records are archived.
                </p>
              </div>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void saveSection("listeningBank")}
                type="button"
              >
                <Save size={15} /> Save Draft
              </button>
            </div>
            <div className="listening-activity-controls">
              <label>
                Visible records
                <select
                  onChange={(event) =>
                    setConfig((current) => {
                      const mode = event.target
                        .value as PlatformControlConfig["listeningBank"]["diagnostics"]["activityLogLimitMode"];
                      const nextLimit =
                        mode === "custom"
                          ? current.listeningBank.diagnostics.customActivityLogLimit
                          : Number(mode);
                      return {
                        ...current,
                        listeningBank: {
                          ...current.listeningBank,
                          diagnostics: {
                            ...current.listeningBank.diagnostics,
                            activityLogLimitMode: mode,
                            activityLogLimit: nextLimit,
                          },
                        },
                      };
                    })
                  }
                  value={config.listeningBank.diagnostics.activityLogLimitMode}
                >
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="30">30</option>
                  <option value="50">50</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {config.listeningBank.diagnostics.activityLogLimitMode ===
                "custom" && (
                <label>
                  Custom visible records
                  <input
                    min={10}
                    max={500}
                    onChange={(event) => {
                      const nextLimit = Number(event.target.value);
                      setConfig((current) => ({
                        ...current,
                        listeningBank: {
                          ...current.listeningBank,
                          diagnostics: {
                            ...current.listeningBank.diagnostics,
                            activityLogLimit: nextLimit,
                            customActivityLogLimit: nextLimit,
                          },
                        },
                      }));
                    }}
                    type="number"
                    value={
                      config.listeningBank.diagnostics.customActivityLogLimit
                    }
                  />
                </label>
              )}
              <label>
                <input
                  checked={
                    config.listeningBank.diagnostics.autoCleanupOldRecords
                  }
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      listeningBank: {
                        ...current.listeningBank,
                        diagnostics: {
                          ...current.listeningBank.diagnostics,
                          autoCleanupOldRecords: event.target.checked,
                        },
                      },
                    }))
                  }
                  type="checkbox"
                />
                Auto Cleanup Old Records
              </label>
              <label>
                Keep newest when archiving
                <input
                  min={10}
                  max={500}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      listeningBank: {
                        ...current.listeningBank,
                        diagnostics: {
                          ...current.listeningBank.diagnostics,
                          autoCleanupKeepVisible: Number(event.target.value),
                        },
                      },
                    }))
                  }
                  type="number"
                  value={config.listeningBank.diagnostics.autoCleanupKeepVisible}
                />
              </label>
            </div>
            <div className="control-actions listening-activity-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void cleanupListeningActivityLog()}
                type="button"
              >
                <Activity size={14} /> Auto Cleanup Old Records
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void archiveListeningActivityLog()}
                type="button"
              >
                <ArchiveRestore size={14} /> Archive Activity Log
              </button>
              <button
                className="danger-button"
                disabled={busy}
                onClick={() => void clearListeningActivityLog()}
                type="button"
              >
                <Trash2 size={14} /> Clear Activity Log
              </button>
            </div>
            <div className="listening-activity-log">
              {listeningActivityLog.map((entry) => (
                <div key={entry.id}>
                  <strong>{entry.title}</strong>
                  <span>{entry.status}</span>
                  {entry.status === "rejected" && (
                    <p className="listening-rejection-detail">
                      Reason:{" "}
                      <b>
                        {String(
                          entry.details?.reason_description ??
                            "Reason unavailable",
                        )}
                      </b>
                      <small>
                        {String(
                          entry.details?.reason_code ??
                            "legacy_reason_unavailable",
                        )}
                      </small>
                    </p>
                  )}
                  <small>
                    {formatBankSeconds(Math.abs(Number(entry.amount_seconds ?? 0)))} /{" "}
                    {Number(entry.token_amount ?? 0)} tokens /{" "}
                    {new Date(entry.created_at).toLocaleString()}
                  </small>
                </div>
              ))}
              {!listeningActivityLog.length && (
                <p>
                  No Time Bank activity has been logged yet. New approvals,
                  rejections, reward claims, and event bonuses will appear here.
                </p>
              )}
            </div>
          </article>

          <article className="control-card control-card-wide">
            <div className="control-heading">
              <div>
                <span className="eyebrow">Time Bank Test Center</span>
                <h3>Rollback-safe simulations</h3>
                <p>
                  Tests calculate before, after, and expected results without
                  permanently changing production balances.
                </p>
              </div>
            </div>
            <div className="control-actions listening-test-actions">
              {listeningTestScenarios.map((scenario) => (
                <button
                  className="secondary-button"
                  disabled={busy || !config.listeningBank.testing.enabled}
                  key={scenario}
                  onClick={() => void runListeningBankTest(scenario)}
                  type="button"
                >
                  <FlaskConical size={14} />
                  {listeningTestLabels[scenario] ?? scenario}
                </button>
              ))}
            </div>
            {listeningTestResult && (
              <pre className="listening-test-result">
                {JSON.stringify(listeningTestResult, null, 2)}
              </pre>
            )}
          </article>

          <article className="control-card control-card-wide">
            <div className="control-heading">
              <div>
                <span className="eyebrow">Event Bonus Manager</span>
                <h3>Temporary Listening Events</h3>
                <p>
                  Configure visible or hidden events, schedule windows,
                  listening multipliers, token multipliers, and prepared mission
                  multipliers.
                </p>
              </div>
              <button
                className="secondary-button"
                onClick={() =>
                  setConfig((current) => ({
                    ...current,
                    listeningBank: {
                      ...current.listeningBank,
                      events: [
                        ...current.listeningBank.events,
                        listeningEventTemplate(),
                      ],
                    },
                  }))
                }
                type="button"
              >
                <Plus size={15} /> Add Event
              </button>
            </div>
            {activeListeningEvent?.event_name && (
              <div className="admin-notice">
                Active event: {activeListeningEvent.event_name} /{" "}
                {activeListeningEvent.listening_multiplier ?? 1}x listening /{" "}
                {activeListeningEvent.token_multiplier ?? 1}x tokens
              </div>
            )}
            <div className="listening-event-list">
              {config.listeningBank.events.map((event, index) => (
                <section key={event.id} className="control-card nested-control-card">
                  <div className="control-heading">
                    <div>
                      <span className="eyebrow">Listening Event</span>
                      <h3>{event.name}</h3>
                    </div>
                    <div className="control-actions">
                      <button
                        className="secondary-button"
                        onClick={() =>
                          setConfig((current) => ({
                            ...current,
                            listeningBank: {
                              ...current.listeningBank,
                              events: current.listeningBank.events.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, enabled: !item.enabled }
                                  : item,
                              ),
                            },
                          }))
                        }
                        type="button"
                      >
                        {event.enabled ? "Disable Event" : "Enable Event"}
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() =>
                          setConfig((current) => ({
                            ...current,
                            listeningBank: {
                              ...current.listeningBank,
                              events: current.listeningBank.events.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, preview: !item.preview }
                                  : item,
                              ),
                            },
                          }))
                        }
                        type="button"
                      >
                        {event.preview ? "Exit Preview" : "Preview Event"}
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() =>
                          setConfig((current) => ({
                            ...current,
                            listeningBank: {
                              ...current.listeningBank,
                              events: current.listeningBank.events.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      enabled: true,
                                      preview: false,
                                      startsAt: new Date().toISOString(),
                                    }
                                  : item,
                              ),
                            },
                          }))
                        }
                        type="button"
                      >
                        Schedule Event
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() =>
                          setConfig((current) => ({
                            ...current,
                            listeningBank: {
                              ...current.listeningBank,
                              events: current.listeningBank.events.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      enabled: false,
                                      endsAt: new Date().toISOString(),
                                    }
                                  : item,
                              ),
                            },
                          }))
                        }
                        type="button"
                      >
                        End Event
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() =>
                          setConfig((current) => ({
                            ...current,
                            listeningBank: {
                              ...current.listeningBank,
                              events: [
                                ...current.listeningBank.events,
                                {
                                  ...event,
                                  id: crypto.randomUUID(),
                                  name: `${event.name} Copy`,
                                  enabled: false,
                                  preview: true,
                                },
                              ],
                            },
                          }))
                        }
                        type="button"
                      >
                        Duplicate Event
                      </button>
                      <button
                        className="secondary-button danger-button"
                        onClick={() =>
                          setConfig((current) => ({
                            ...current,
                            listeningBank: {
                              ...current.listeningBank,
                              events: current.listeningBank.events.filter(
                                (_, itemIndex) => itemIndex !== index,
                              ),
                            },
                          }))
                        }
                        type="button"
                      >
                        <Trash2 size={14} /> Remove
                      </button>
                    </div>
                  </div>
                  <div className="control-announcement-grid">
                    <label>
                      Event Name
                      <input
                        onChange={(eventInput) =>
                          setConfig((current) => ({
                            ...current,
                            listeningBank: {
                              ...current.listeningBank,
                              events: current.listeningBank.events.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, name: eventInput.target.value }
                                  : item,
                              ),
                            },
                          }))
                        }
                        value={event.name}
                      />
                    </label>
                    <label>
                      Start Date
                      <input
                        onChange={(eventInput) =>
                          setConfig((current) => ({
                            ...current,
                            listeningBank: {
                              ...current.listeningBank,
                              events: current.listeningBank.events.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      startsAt: dateTimeStorageValue(eventInput.target.value),
                                    }
                                  : item,
                              ),
                            },
                          }))
                        }
                        type="datetime-local"
                        value={dateTimeInputValue(event.startsAt)}
                      />
                    </label>
                    <label>
                      End Date
                      <input
                        onChange={(eventInput) =>
                          setConfig((current) => ({
                            ...current,
                            listeningBank: {
                              ...current.listeningBank,
                              events: current.listeningBank.events.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      endsAt: dateTimeStorageValue(eventInput.target.value),
                                    }
                                  : item,
                              ),
                            },
                          }))
                        }
                        type="datetime-local"
                        value={dateTimeInputValue(event.endsAt)}
                      />
                    </label>
                    <label>
                      Visible
                      <input
                        checked={event.visible}
                        onChange={(eventInput) =>
                          setConfig((current) => ({
                            ...current,
                            listeningBank: {
                              ...current.listeningBank,
                              events: current.listeningBank.events.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, visible: eventInput.target.checked }
                                  : item,
                              ),
                            },
                          }))
                        }
                        type="checkbox"
                      />
                    </label>
                    <label>
                      Bonus Minutes
                      <input
                        min={0}
                        max={1440}
                        onChange={(eventInput) =>
                          setConfig((current) => ({
                            ...current,
                            listeningBank: {
                              ...current.listeningBank,
                              events: current.listeningBank.events.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, bonusMinutes: Number(eventInput.target.value) }
                                  : item,
                              ),
                            },
                          }))
                        }
                        type="number"
                        value={event.bonusMinutes}
                      />
                    </label>
                    <label>
                      Threshold Minutes
                      <input
                        min={0}
                        max={1440}
                        onChange={(eventInput) =>
                          setConfig((current) => ({
                            ...current,
                            listeningBank: {
                              ...current.listeningBank,
                              events: current.listeningBank.events.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      bonusThresholdMinutes: Number(eventInput.target.value),
                                    }
                                  : item,
                              ),
                            },
                          }))
                        }
                        type="number"
                        value={event.bonusThresholdMinutes}
                      />
                    </label>
                    <label>
                      Listening Multiplier
                      <input
                        max={10}
                        min={1}
                        onChange={(eventInput) =>
                          setConfig((current) => ({
                            ...current,
                            listeningBank: {
                              ...current.listeningBank,
                              events: current.listeningBank.events.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      listeningMultiplier: Number(eventInput.target.value),
                                    }
                                  : item,
                              ),
                            },
                          }))
                        }
                        step={0.1}
                        type="number"
                        value={event.listeningMultiplier}
                      />
                    </label>
                    <label>
                      Token Multiplier
                      <input
                        max={10}
                        min={1}
                        onChange={(eventInput) =>
                          setConfig((current) => ({
                            ...current,
                            listeningBank: {
                              ...current.listeningBank,
                              events: current.listeningBank.events.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      tokenMultiplier: Number(eventInput.target.value),
                                    }
                                  : item,
                              ),
                            },
                          }))
                        }
                        step={0.1}
                        type="number"
                        value={event.tokenMultiplier}
                      />
                    </label>
                    <label>
                      Mission Multiplier
                      <input
                        max={10}
                        min={1}
                        onChange={(eventInput) =>
                          setConfig((current) => ({
                            ...current,
                            listeningBank: {
                              ...current.listeningBank,
                              events: current.listeningBank.events.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      missionMultiplier: Number(eventInput.target.value),
                                    }
                                  : item,
                              ),
                            },
                          }))
                        }
                        step={0.1}
                        type="number"
                        value={event.missionMultiplier}
                      />
                    </label>
                  </div>
                  <div className="control-toggle-grid">
                    {(
                      Object.keys(event.rewardTypes) as Array<
                        keyof PlatformControlConfig["listeningBank"]["events"][number]["rewardTypes"]
                      >
                    ).map((field) => (
                      <label key={field}>
                        <input
                          checked={event.rewardTypes[field]}
                          onChange={(eventInput) =>
                            setConfig((current) => ({
                              ...current,
                              listeningBank: {
                                ...current.listeningBank,
                                events: current.listeningBank.events.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        rewardTypes: {
                                          ...item.rewardTypes,
                                          [field]: eventInput.target.checked,
                                        },
                                      }
                                    : item,
                                ),
                              },
                            }))
                          }
                          type="checkbox"
                        />
                        {field.replace(/([A-Z])/g, " $1")}
                      </label>
                    ))}
                  </div>
                  <label>
                    Description
                    <textarea
                      onChange={(eventInput) =>
                        setConfig((current) => ({
                          ...current,
                          listeningBank: {
                            ...current.listeningBank,
                            events: current.listeningBank.events.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, description: eventInput.target.value }
                                : item,
                            ),
                          },
                        }))
                      }
                      rows={2}
                      value={event.description}
                    />
                  </label>
                </section>
              ))}
              {!config.listeningBank.events.length && (
                <p>No Listening Events are configured yet.</p>
              )}
            </div>
          </article>

          <article className="control-card control-card-wide">
            <div className="control-heading">
              <div>
                <span className="eyebrow">Time Bank Module Control</span>
                <h3>Visibility, placement, and sizing</h3>
              </div>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void saveSection("listeningBank")}
                type="button"
              >
                <Save size={15} /> Save Draft
              </button>
            </div>
            <div className="control-toggle-grid">
              <label>
                <input
                  checked={config.listeningBank.module.show}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      listeningBank: {
                        ...current.listeningBank,
                        module: {
                          ...current.listeningBank.module,
                          show: event.target.checked,
                        },
                      },
                    }))
                  }
                  type="checkbox"
                />
                Show Time Bank
              </label>
              {(
                Object.keys(config.listeningBank.module.visibility) as Array<
                  keyof PlatformControlConfig["listeningBank"]["module"]["visibility"]
                >
              ).map((field) => (
                <label key={field}>
                  <input
                    checked={config.listeningBank.module.visibility[field]}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        listeningBank: {
                          ...current.listeningBank,
                          module: {
                            ...current.listeningBank.module,
                            visibility: {
                              ...current.listeningBank.module.visibility,
                              [field]: event.target.checked,
                            },
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
            <div className="owner-device-layout-grid">
              {(["desktop", "mobile"] as const).map((device) => (
                <section key={device} className="control-card nested-control-card">
                  <span className="eyebrow">{device} layout</span>
                  <label>
                    Visibility
                    <select
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          listeningBank: {
                            ...current.listeningBank,
                            module: {
                              ...current.listeningBank.module,
                              [device]: {
                                ...current.listeningBank.module[device],
                                visibility: event.target
                                  .value as PlatformControlConfig["listeningBank"]["module"][typeof device]["visibility"],
                              },
                            },
                          },
                        }))
                      }
                      value={config.listeningBank.module[device].visibility}
                    >
                      {Object.entries(listeningModuleVisibilityLabels).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    Position
                    <input
                      min={1}
                      max={50}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          listeningBank: {
                            ...current.listeningBank,
                            module: {
                              ...current.listeningBank.module,
                              [device]: {
                                ...current.listeningBank.module[device],
                                position: Number(event.target.value),
                              },
                            },
                          },
                        }))
                      }
                      type="number"
                      value={config.listeningBank.module[device].position}
                    />
                  </label>
                  <div className="control-actions">
                    <button
                      className="secondary-button"
                      onClick={() =>
                        setConfig((current) => ({
                          ...current,
                          listeningBank: {
                            ...current.listeningBank,
                            module: {
                              ...current.listeningBank.module,
                              [device]: {
                                ...current.listeningBank.module[device],
                                position: Math.max(
                                  1,
                                  current.listeningBank.module[device].position - 1,
                                ),
                              },
                            },
                          },
                        }))
                      }
                      type="button"
                    >
                      <ArrowUp size={14} /> Move Up
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() =>
                        setConfig((current) => ({
                          ...current,
                          listeningBank: {
                            ...current.listeningBank,
                            module: {
                              ...current.listeningBank.module,
                              [device]: {
                                ...current.listeningBank.module[device],
                                position:
                                  current.listeningBank.module[device].position + 1,
                              },
                            },
                          },
                        }))
                      }
                      type="button"
                    >
                      <ArrowDown size={14} /> Move Down
                    </button>
                  </div>
                  <label>
                    Column
                    <select
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          listeningBank: {
                            ...current.listeningBank,
                            module: {
                              ...current.listeningBank.module,
                              [device]: {
                                ...current.listeningBank.module[device],
                                column: event.target
                                  .value as PlatformControlConfig["listeningBank"]["module"][typeof device]["column"],
                              },
                            },
                          },
                        }))
                      }
                      value={config.listeningBank.module[device].column}
                    >
                      {Object.entries(listeningModuleColumnLabels).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    Size
                    <select
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          listeningBank: {
                            ...current.listeningBank,
                            module: {
                              ...current.listeningBank.module,
                              [device]: {
                                ...current.listeningBank.module[device],
                                size: event.target
                                  .value as PlatformControlConfig["listeningBank"]["module"][typeof device]["size"],
                              },
                            },
                          },
                        }))
                      }
                      value={config.listeningBank.module[device].size}
                    >
                      {Object.entries(listeningModuleSizeLabels).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                </section>
              ))}
            </div>
          </article>

          <article className="control-card control-card-wide">
            <div className="control-heading">
              <div>
                <span className="eyebrow">Reward Settings</span>
                <h3>Conversion and transparency controls</h3>
              </div>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void saveSection("listeningBank")}
                type="button"
              >
                <Save size={15} /> Save Draft
              </button>
            </div>
            <div className="control-number-grid">
              <label>
                Desktop Validation Mode
                <select
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      listeningBank: {
                        ...current.listeningBank,
                        validation: {
                          ...current.listeningBank.validation,
                          desktopValidationMode: event.target
                            .value as PlatformControlConfig["listeningBank"]["validation"]["desktopValidationMode"],
                        },
                      },
                    }))
                  }
                  value={
                    config.listeningBank.validation.desktopValidationMode
                  }
                >
                  {Object.entries(desktopValidationModeLabels).map(
                    ([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Minutes per token
                <input
                  min={15}
                  max={1440}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      listeningBank: {
                        ...current.listeningBank,
                        rewards: {
                          ...current.listeningBank.rewards,
                          minutesPerToken: Number(event.target.value),
                        },
                      },
                    }))
                  }
                  type="number"
                  value={config.listeningBank.rewards.minutesPerToken}
                />
              </label>
              <label>
                Daily cap minutes
                <input
                  min={30}
                  max={1440}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      listeningBank: {
                        ...current.listeningBank,
                        rewards: {
                          ...current.listeningBank.rewards,
                          dailyCapMinutes: Number(event.target.value),
                        },
                      },
                    }))
                  }
                  type="number"
                  value={config.listeningBank.rewards.dailyCapMinutes}
                />
              </label>
              <label>
                Cleanup keep-visible records
                <input
                  min={10}
                  max={500}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      listeningBank: {
                        ...current.listeningBank,
                        diagnostics: {
                          ...current.listeningBank.diagnostics,
                          autoCleanupKeepVisible: Number(event.target.value),
                        },
                      },
                    }))
                  }
                  type="number"
                  value={config.listeningBank.diagnostics.autoCleanupKeepVisible}
                />
              </label>
            </div>
            <div className="control-toggle-grid">
              {(
                Object.keys(config.listeningBank.rewards) as Array<
                  keyof PlatformControlConfig["listeningBank"]["rewards"]
                >
              )
                .filter((field) => typeof config.listeningBank.rewards[field] === "boolean")
                .map((field) => (
                  <label key={field}>
                    <input
                      checked={Boolean(config.listeningBank.rewards[field])}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          listeningBank: {
                            ...current.listeningBank,
                            rewards: {
                              ...current.listeningBank.rewards,
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
        </div>
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

            <h4>Submission cost by content type</h4>
            <div className="control-number-grid">
              {(
                Object.keys(config.tokens.contentTypeCosts) as Array<
                  keyof PlatformControlConfig["tokens"]["contentTypeCosts"]
                >
              ).map((field) => (
                <label key={field}>
                  {field.replace(/([A-Z])/g, " $1")}
                  <input
                    min={0}
                    max={100}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        tokens: {
                          ...current.tokens,
                          contentTypeCosts: {
                            ...current.tokens.contentTypeCosts,
                            [field]: Number(event.target.value),
                          },
                        },
                      }))
                    }
                    type="number"
                    value={config.tokens.contentTypeCosts[field]}
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

            <h4>Reward multipliers</h4>
            <div className="control-number-grid">
              {(
                Object.keys(config.tokens.rewardMultipliers) as Array<
                  keyof PlatformControlConfig["tokens"]["rewardMultipliers"]
                >
              ).map((field) => (
                <label key={field}>
                  {field.replace(/([A-Z])/g, " $1")}
                  <input
                    min={0}
                    max={10}
                    step={0.1}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        tokens: {
                          ...current.tokens,
                          rewardMultipliers: {
                            ...current.tokens.rewardMultipliers,
                            [field]: Number(event.target.value),
                          },
                        },
                      }))
                    }
                    type="number"
                    value={config.tokens.rewardMultipliers[field]}
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
                      <option value="homepage_banner">Homepage Banner</option>
                      <option value="artist_banner">Artist Banner</option>
                      <option value="contest_banner">Contest Banner</option>
                      <option value="emergency_banner">Emergency Banner</option>
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
                  <label>
                    Pinned
                    <input
                      checked={announcement.pinned}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          announcements: current.announcements.map(
                            (item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, pinned: event.target.checked }
                                : item,
                          ),
                        }))
                      }
                      type="checkbox"
                    />
                  </label>
                  <label>
                    Banner placement
                    <select
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          announcements: current.announcements.map(
                            (item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    bannerPlacement: event.target
                                      .value as ControlAnnouncement["bannerPlacement"],
                                  }
                                : item,
                          ),
                        }))
                      }
                      value={announcement.bannerPlacement}
                    >
                      {Object.entries(announcementBannerLabels).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
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
            {experimentFlagLabels.map(([field, label]) => (
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
                {label}
              </label>
            ))}
          </div>
          <h4>A/B layout variants</h4>
          <div className="control-number-grid">
            <label>
              Layout A
              <input
                maxLength={120}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    experiments: {
                      ...current.experiments,
                      layoutA: event.target.value,
                    },
                  }))
                }
                value={config.experiments.layoutA}
              />
            </label>
            <label>
              Layout B
              <input
                maxLength={120}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    experiments: {
                      ...current.experiments,
                      layoutB: event.target.value,
                    },
                  }))
                }
                value={config.experiments.layoutB}
              />
            </label>
            <label>
              Active variant
              <select
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    experiments: {
                      ...current.experiments,
                      activeVariant: event.target
                        .value as PlatformControlConfig["experiments"]["activeVariant"],
                    },
                  }))
                }
                value={config.experiments.activeVariant}
              >
                <option value="none">No active test</option>
                <option value="layout_a">Layout A</option>
                <option value="layout_b">Layout B</option>
              </select>
            </label>
          </div>
          <h4>Track experiment metrics</h4>
          <div className="control-toggle-grid">
            {(
              Object.keys(config.experiments.metrics) as Array<
                keyof PlatformControlConfig["experiments"]["metrics"]
              >
            ).map((field) => (
              <label key={field}>
                <input
                  checked={config.experiments.metrics[field]}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      experiments: {
                        ...current.experiments,
                        metrics: {
                          ...current.experiments.metrics,
                          [field]: event.target.checked,
                        },
                      },
                    }))
                  }
                  type="checkbox"
                />
                {experimentMetricLabels[field]}
              </label>
            ))}
          </div>
        </article>
      )}

      {tab === "presets" && (
        <div className="control-grid">
          <article className="control-card control-card-wide">
            <div className="control-heading">
              <div>
                <span className="eyebrow">No-code presets</span>
                <h3>Apply complete UI configurations in one click</h3>
              </div>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void saveSection("ui")}
                type="button"
              >
                <Save size={15} /> Save UI Presets
              </button>
            </div>
            <p>
              Presets update layout, spacing, component visibility, discovery
              emphasis, and related UI controls in the draft. Publish only after
              previewing.
            </p>
            <div className="control-preset-grid">
              {Object.entries(ownerPresetLabels).map(([preset, label]) => (
                <button
                  className={
                    config.ui.presets.active === preset ? "active" : ""
                  }
                  key={preset}
                  onClick={() =>
                    applyBuiltInPreset(preset as keyof typeof ownerPresetLabels)
                  }
                  type="button"
                >
                  <Sparkles size={15} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </article>

          <article className="control-card">
            <span className="eyebrow">Save current draft</span>
            <h3>Create a custom UI preset</h3>
            <label>
              Preset name
              <input
                maxLength={80}
                onChange={(event) => setPresetName(event.target.value)}
                placeholder="Weekend contest layout"
                value={presetName}
              />
            </label>
            <button
              className="secondary-button"
              disabled={presetName.trim().length < 3}
              onClick={saveCurrentUiPreset}
              type="button"
            >
              <Save size={15} /> Save Preset
            </button>
          </article>

          <article className="control-card">
            <span className="eyebrow">Custom presets</span>
            <h3>Apply saved owner layouts</h3>
            <div className="control-saved-list">
              {config.ui.presets.custom.map((preset) => (
                <div key={preset.id}>
                  <span>
                    <strong>{preset.name}</strong>
                    <small>
                      {new Date(preset.createdAt).toLocaleString()}
                      {preset.description ? ` / ${preset.description}` : ""}
                    </small>
                  </span>
                  <button
                    onClick={() => applyCustomPreset(preset)}
                    type="button"
                  >
                    Apply
                  </button>
                </div>
              ))}
              {!config.ui.presets.custom.length && (
                <p>No custom presets saved in this draft.</p>
              )}
            </div>
          </article>
        </div>
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
