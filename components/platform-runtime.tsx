"use client";

import { useCallback, useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";
import {
  mapPlatformThemeRow,
  type PlatformTheme,
} from "@/lib/platform-theme";
import {
  defaultPlatformControlConfig,
  uiComponentLabels,
  mapPlatformControlState,
  type HomepageModuleKey,
  type PlatformControlConfig,
  type PlatformControlState,
  type UiResponsiveSize,
  type UiSizePreset,
} from "@/lib/platform-control";
import { createClient } from "@/lib/supabase/client";

type PlatformAnnouncement = {
  id: string;
  announcement_type: string;
  title: string;
  message: string;
  starts_at: string;
  ends_at: string | null;
  priority: number;
  audience: string;
};

function applyTheme(theme: PlatformTheme) {
  const root = document.documentElement;
  root.style.setProperty("--bg", theme.backgroundColor);
  root.style.setProperty("--surface", theme.cardColor);
  root.style.setProperty("--surface-strong", theme.cardColor);
  root.style.setProperty("--ink", theme.textColor);
  root.style.setProperty("--acid", theme.accentColor);
  root.style.setProperty("--button-color", theme.buttonColor);
  root.style.setProperty("--link-color", theme.linkColor);
  root.style.setProperty("--line", theme.borderColor);
  root.style.setProperty("--line-strong", theme.borderColor);
  root.dataset.platformTheme = theme.preset;
}

function kebabCase(value: string) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function cssSize(size: UiSizePreset, customPx: number, kind: "icon" | "text") {
  if (size === "custom") return `${Math.max(6, Math.min(48, customPx))}px`;
  const scale =
    kind === "icon"
      ? { xs: 12, small: 14, medium: 15, large: 18 }
      : { xs: 10, small: 11, medium: 12, large: 14 };
  return `${scale[size]}px`;
}

function cssPadding(size: UiSizePreset, customPx: number) {
  if (size === "custom") {
    const value = Math.max(4, Math.min(28, customPx));
    return `${value}px ${Math.round(value * 1.25)}px`;
  }
  const scale = {
    xs: "6px 8px",
    small: "8px 10px",
    medium: "9px 11px",
    large: "12px 15px",
  };
  return scale[size];
}

function applyComponentSizing(
  root: HTMLElement,
  component: string,
  device: "desktop" | "mobile",
  size: UiResponsiveSize,
) {
  const prefix = `--ui-${kebabCase(component)}`;
  root.style.setProperty(
    `${prefix}-icon-${device}`,
    cssSize(size.iconSize, size.iconCustomPx, "icon"),
  );
  root.style.setProperty(
    `${prefix}-text-${device}`,
    cssSize(size.textSize, size.textCustomPx, "text"),
  );
  root.style.setProperty(
    `${prefix}-button-${device}`,
    cssPadding(size.buttonSize, size.buttonCustomPx),
  );
}

function applyControlConfig(config: PlatformControlConfig) {
  applyTheme(config.theme);
  const root = document.documentElement;
  root.style.setProperty("--primary-color", config.theme.primaryColor);
  root.style.setProperty("--secondary-color", config.theme.secondaryColor);
  root.style.setProperty("--hover-color", config.theme.hoverColor);
  root.dataset.reviewLayoutDensity = config.homepage.reviewLayoutDensity;
  root.dataset.actionLayoutDesktop = config.homepage.actionButtonLayout.desktop;
  root.dataset.actionLayoutMobile = config.homepage.actionButtonLayout.mobile;
  root.dataset.reviewFormLayout = config.homepage.reviewFormLayout;
  root.dataset.defaultLandingPlayback =
    config.homepage.autoplay.defaultLandingPlayback;
  root.dataset.autoPlayOnLogin = String(
    config.homepage.autoplay.autoPlayOnLoginDefault,
  );
  root.dataset.autoPlayNextSongDefault = String(
    config.homepage.autoplay.autoPlayNextSongDefault,
  );
  root.dataset.artistProfileLayout = config.artistProfile.layout;
  root.dataset.artistHeaderLayout = config.artistProfile.headerLayout;
  root.dataset.artistSongSortOrder = config.artistProfile.songSortOrder;
  root.dataset.artistNameLinks = String(
    config.artistProfile.discovery.showArtistNameLinks,
  );
  root.dataset.artistProfileButtons = String(
    config.artistProfile.discovery.showArtistProfileButtons,
  );
  root.dataset.artistFollowButtons = String(
    config.artistProfile.discovery.showFollowArtistButton,
  );
  root.dataset.artistShareButtons = String(
    config.artistProfile.discovery.showShareArtistButton,
  );
  root.dataset.artistSupportButtons = String(
    config.artistProfile.discovery.showSupportArtistButton,
  );
  root.dataset.artistDiscoveryStatistics = String(
    config.artistProfile.discovery.showArtistStatistics,
  );
  root.dataset.externalContentVisibility =
    config.discovery.externalContent.visibility;
  root.dataset.externalSongBehavior = config.discovery.externalContent.behavior;
  root.dataset.externalDiscoveryPlacement =
    config.discovery.externalContent.placement;
  root.dataset.platformResolutionMode =
    config.discovery.platformResolution.engineMode;
  root.dataset.showPlatformRecommendations = String(
    config.discovery.platformResolution.showPlatformRecommendations,
  );
  root.dataset.showSecondaryPlatforms = String(
    config.discovery.platformResolution.showSecondaryPlatforms,
  );
  for (const [field, enabled] of Object.entries(
    config.discovery.externalDiscovery,
  )) {
    root.dataset[
      `externalDiscovery${field[0].toUpperCase()}${field.slice(1)}`
    ] = String(enabled);
  }
  root.dataset.membershipPreviewTier = config.membership.previewTier;
  root.dataset.membershipSupportWallEnabled = String(
    config.membership.supportWall.enabled,
  );
  root.dataset.membershipDonationsEnabled = String(
    config.membership.donations.enabled,
  );
  root.dataset.membershipMonthlySupportEnabled = String(
    config.membership.donations.monthlySupportEnabled,
  );
  root.dataset.listeningBankVisible = String(config.listeningBank.module.show);
  root.dataset.listeningBankDesktopVisibility =
    config.listeningBank.module.desktop.visibility;
  root.dataset.listeningBankMobileVisibility =
    config.listeningBank.module.mobile.visibility;
  root.dataset.listeningBankDesktopColumn =
    config.listeningBank.module.desktop.column;
  root.dataset.listeningBankMobileColumn =
    config.listeningBank.module.mobile.column;
  root.dataset.listeningBankDesktopSize =
    config.listeningBank.module.desktop.size;
  root.dataset.listeningBankMobileSize =
    config.listeningBank.module.mobile.size;
  root.dataset.listeningBankShowApprovedMinutes = String(
    config.listeningBank.module.visibility.showApprovedMinutes,
  );
  root.dataset.listeningBankShowPendingMinutes = String(
    config.listeningBank.module.visibility.showPendingMinutes,
  );
  root.dataset.listeningBankShowRejectedMinutes = String(
    config.listeningBank.module.visibility.showRejectedMinutes,
  );
  root.dataset.listeningBankShowTokenConversion = String(
    config.listeningBank.module.visibility.showTokenConversion,
  );
  root.dataset.listeningBankShowNextRewardThreshold = String(
    config.listeningBank.module.visibility.showNextRewardThreshold,
  );
  root.style.setProperty(
    "--listening-bank-desktop-order",
    String(config.listeningBank.module.desktop.position),
  );
  root.style.setProperty(
    "--listening-bank-mobile-order",
    String(config.listeningBank.module.mobile.position),
  );
  root.dataset.desktopActionLayout = config.ui.desktop.actionLayout;
  root.dataset.mobileActionLayout = config.ui.mobile.actionLayout;
  root.dataset.desktopCardLayout = config.ui.desktop.cardLayout;
  root.dataset.mobileCardLayout = config.ui.mobile.cardLayout;
  root.dataset.previewTarget = config.ui.preview.target;
  root.dataset.previewSection = config.ui.preview.section;

  for (const component of Object.keys(uiComponentLabels)) {
    const control =
      config.ui.components[component as keyof typeof config.ui.components];
    const dataKey = `ui${component[0].toUpperCase()}${component.slice(1)}Mode`;
    root.dataset[dataKey] = control.display;
    applyComponentSizing(root, component, "desktop", control.desktop);
    applyComponentSizing(root, component, "mobile", control.mobile);
  }

  for (const [card, density] of Object.entries(config.ui.cardDensity)) {
    root.dataset[`${card}CardDensity`] = density;
  }

  const priorityModule: Partial<
    Record<PlatformControlConfig["homepage"]["firstVisibleSection"], HomepageModuleKey>
  > = {
    review_queue: "review_queue",
    spotlight: "spotlight",
    discovery: "external_discovery",
    rankings: "top_results",
    community_activity: "community_activity",
    artist_spotlight: "artist_spotlight",
    custom: "review_queue",
  };
  const promotedModule =
    priorityModule[config.homepage.firstVisibleSection] ?? "review_queue";
  const orderedModules = [
    promotedModule,
    ...config.homepage.order.filter((module) => module !== promotedModule),
  ];

  for (const [index, module] of orderedModules.entries()) {
    root.style.setProperty(`--module-order-${module}`, String(index + 1));
    root.style.setProperty(
      `--module-display-${module}`,
      config.homepage.visibility[module] ? "" : "none",
    );
  }
  const discoveryVisibility: Partial<
    Record<keyof PlatformControlConfig["discovery"]["modules"], HomepageModuleKey>
  > = {
    spotlight: "spotlight",
    rankings: "organic_rankings",
    topResults: "top_results",
    organicRankings: "organic_rankings",
    trending: "trending",
    mostShared: "most_shared",
    mostSupported: "most_supported",
    newestSongs: "newest_songs",
  };
  for (const [field, module] of Object.entries(discoveryVisibility)) {
    if (!module) continue;
    if (
      config.discovery.modules[
        field as keyof PlatformControlConfig["discovery"]["modules"]
      ] === false
    ) {
      root.style.setProperty(`--module-display-${module}`, "none");
    }
  }
  for (const [field, visible] of Object.entries(
    config.artistProfile.visibility,
  )) {
    root.style.setProperty(
      `--artist-field-${field}`,
      visible ? "" : "none",
    );
  }
  for (const [tier, tierConfig] of Object.entries(config.membership.tiers)) {
    root.dataset[
      `membership${tier[0].toUpperCase()}${tier.slice(1)}Enabled`
    ] = String(tierConfig.enabled);
    for (const [permission, enabled] of Object.entries(tierConfig.permissions)) {
      root.dataset[
        `membership${tier[0].toUpperCase()}${tier.slice(1)}${permission[0].toUpperCase()}${permission.slice(1)}`
      ] = String(enabled);
    }
  }
  for (const [field, enabled] of Object.entries(
    config.homepage.community.features,
  )) {
    root.style.setProperty(`--community-feature-${field}`, enabled ? "" : "none");
    root.dataset[`communityFeature${field[0].toUpperCase()}${field.slice(1)}`] =
      String(enabled);
  }
  for (const [field, visible] of Object.entries(
    config.homepage.community.visibility,
  )) {
    root.style.setProperty(
      `--community-visibility-${field}`,
      visible ? "" : "none",
    );
  }
  for (const [section, visibility] of Object.entries(
    config.homepage.community.sectionVisibility,
  )) {
    for (const [field, visible] of Object.entries(visibility)) {
      root.dataset[
        `community${section[0].toUpperCase()}${section.slice(1)}${field[0].toUpperCase()}${field.slice(1)}`
      ] = String(visible);
    }
  }
  for (const [index, section] of config.artistProfile.order.entries()) {
    root.style.setProperty(`--artist-order-${section}`, String(index + 1));
  }
  root.dataset.platformSongsPerPage = String(config.discovery.songsPerPage);
  root.dataset.platformConfigVersion = String(config.schemaVersion);
}

export function PlatformRuntime({
  initialState = {
    config: defaultPlatformControlConfig,
    previewActive: false,
    publishedVersion: 1,
    draftRevision: 1,
  },
}: {
  initialState?: PlatformControlState;
}) {
  const [announcements, setAnnouncements] = useState<PlatformAnnouncement[]>(
    [],
  );
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [previewActive, setPreviewActive] = useState(
    initialState.previewActive,
  );

  const refresh = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return;
    const [runtimeResult, announcementResult, userResult] = await Promise.all([
      supabase.rpc("get_platform_runtime"),
      supabase.rpc("get_active_platform_announcements"),
      supabase.auth.getUser(),
    ]);
    if (!runtimeResult.error) {
      const state = mapPlatformControlState(runtimeResult.data);
      applyControlConfig(state.config);
      setPreviewActive(state.previewActive);
      const now = Date.now();
      const user = userResult.data.user;
      const signedIn = Boolean(user);
      let role = "";
      let artist = false;
      if (user) {
        const [profileResult, songsResult] = await Promise.all([
          supabase
            .from("profiles")
            .select("role")
            .eq("id", user.id)
            .maybeSingle(),
          supabase
            .from("songs")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id),
        ]);
        role = String(profileResult.data?.role ?? "");
        artist = Number(songsResult.count ?? 0) > 0;
      }
      const configured = state.config.announcements
        .filter((announcement) => {
          const starts = Date.parse(announcement.startsAt);
          const ends = announcement.endsAt
            ? Date.parse(announcement.endsAt)
            : null;
          const audienceMatches =
            announcement.audience === "everyone" ||
            (announcement.audience === "guests" && !signedIn) ||
            (announcement.audience === "members" && signedIn) ||
            (announcement.audience === "artists" && artist) ||
            (announcement.audience === "moderators" &&
              ["moderator", "admin", "super_admin"].includes(role));
          return (
            announcement.active &&
            audienceMatches &&
            (!Number.isFinite(starts) || starts <= now) &&
            (ends === null || !Number.isFinite(ends) || ends > now)
          );
        })
        .map(
          (announcement): PlatformAnnouncement => ({
            id: announcement.id,
            announcement_type: announcement.type,
            title: announcement.title,
            message: announcement.message,
            starts_at: announcement.startsAt,
            ends_at: announcement.endsAt,
            priority: announcement.priority,
            audience: announcement.audience,
          }),
        );
      const legacy = announcementResult.error
        ? []
        : ((announcementResult.data ?? []) as PlatformAnnouncement[]);
      setAnnouncements([
        ...configured,
        ...legacy.filter(
          (item) =>
            !configured.some((configuredItem) => configuredItem.id === item.id),
        ),
      ]);
      return;
    }
    const themeResult = await supabase.rpc("get_platform_theme");
    if (!themeResult.error) {
      const row = Array.isArray(themeResult.data)
        ? themeResult.data[0]
        : themeResult.data;
      applyTheme(mapPlatformThemeRow(row as Record<string, unknown> | null));
    }
    if (!announcementResult.error) {
      setAnnouncements(
        (announcementResult.data ?? []) as PlatformAnnouncement[],
      );
    }
  }, []);

  useEffect(() => {
    applyControlConfig(initialState.config);
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    const supabase = createClient();
    const channel = supabase
      ?.channel("platform-theme-runtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "platform_control_state",
        },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      window.clearInterval(interval);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [initialState, refresh]);

  const visible = announcements.filter(
    (announcement) => !dismissed.includes(announcement.id),
  );

  return (
    <>
      {previewActive && (
        <div className="platform-preview-banner" role="status">
          Preview Mode: you are viewing the unpublished platform draft.
        </div>
      )}
      {visible.length > 0 && (
        <div className="platform-announcement-stack" aria-live="polite">
          {visible.map((announcement) => (
            <aside
              className={`platform-announcement priority-${announcement.priority}`}
              key={announcement.id}
            >
              <Megaphone aria-hidden="true" size={17} />
              <div>
                <strong>{announcement.title}</strong>
                <span>{announcement.message}</span>
              </div>
              <button
                aria-label={`Dismiss ${announcement.title}`}
                onClick={() =>
                  setDismissed((current) => [...current, announcement.id])
                }
                type="button"
              >
                <X size={15} />
              </button>
            </aside>
          ))}
        </div>
      )}
    </>
  );
}
