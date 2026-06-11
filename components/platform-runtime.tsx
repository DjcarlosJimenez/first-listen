"use client";

import { useCallback, useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";
import {
  mapPlatformThemeRow,
  type PlatformTheme,
} from "@/lib/platform-theme";
import {
  defaultPlatformControlConfig,
  mapPlatformControlState,
  type HomepageModuleKey,
  type PlatformControlConfig,
  type PlatformControlState,
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

function applyControlConfig(config: PlatformControlConfig) {
  applyTheme(config.theme);
  const root = document.documentElement;
  root.style.setProperty("--primary-color", config.theme.primaryColor);
  root.style.setProperty("--secondary-color", config.theme.secondaryColor);
  root.style.setProperty("--hover-color", config.theme.hoverColor);
  for (const [index, module] of config.homepage.order.entries()) {
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
