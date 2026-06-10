import type { Metadata } from "next";
import { PlatformRuntime } from "@/components/platform-runtime";
import {
  defaultPlatformTheme,
  mapPlatformThemeRow,
} from "@/lib/platform-theme";
import { createClient } from "@/lib/supabase/server";
import "./globals.css";
import "./unified.css";

export const metadata: Metadata = {
  title: "First Listen - Real Listeners. Real Viewers. Real Reactions.",
  description:
    "Get your first listens, views, reactions, and engagement from real people before spending money on promotion.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      {
        url: "/icons/first-listen-16x16.png",
        sizes: "16x16",
        type: "image/png",
      },
      {
        url: "/icons/first-listen-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/icons/first-listen-48x48.png",
        sizes: "48x48",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/icons/first-listen-180x180.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let initialTheme = defaultPlatformTheme;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("platform_theme_settings")
      .select(
        "preset, background_color, card_color, text_color, accent_color, button_color, link_color, border_color, updated_at",
      )
      .eq("id", true)
      .maybeSingle();
    initialTheme = mapPlatformThemeRow(
      data as Record<string, unknown> | null,
    );
  } catch {
    initialTheme = defaultPlatformTheme;
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <PlatformRuntime initialTheme={initialTheme} />
        {children}
      </body>
    </html>
  );
}
