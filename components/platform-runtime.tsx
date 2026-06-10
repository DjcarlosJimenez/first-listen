"use client";

import { useCallback, useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";
import {
  defaultPlatformTheme,
  mapPlatformThemeRow,
  type PlatformTheme,
} from "@/lib/platform-theme";
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

export function PlatformRuntime({
  initialTheme = defaultPlatformTheme,
}: {
  initialTheme?: PlatformTheme;
}) {
  const [announcements, setAnnouncements] = useState<PlatformAnnouncement[]>(
    [],
  );
  const [dismissed, setDismissed] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return;
    const [themeResult, announcementResult] = await Promise.all([
      supabase.rpc("get_platform_theme"),
      supabase.rpc("get_active_platform_announcements"),
    ]);
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
    applyTheme(initialTheme);
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
          table: "platform_theme_settings",
        },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      window.clearInterval(interval);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [initialTheme, refresh]);

  const visible = announcements.filter(
    (announcement) => !dismissed.includes(announcement.id),
  );
  if (!visible.length) return null;

  return (
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
  );
}

