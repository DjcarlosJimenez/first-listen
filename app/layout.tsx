import type { Metadata } from "next";
import { PlatformRuntime } from "@/components/platform-runtime";
import {
  defaultPlatformControlConfig,
  mapPlatformControlState,
  type PlatformControlState,
} from "@/lib/platform-control";
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
  let initialState: PlatformControlState = {
    config: defaultPlatformControlConfig,
    previewActive: false,
    publishedVersion: 1,
    draftRevision: 1,
  };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_platform_runtime");
    if (!error) initialState = mapPlatformControlState(data);
  } catch {
    initialState = {
      config: defaultPlatformControlConfig,
      previewActive: false,
      publishedVersion: 1,
      draftRevision: 1,
    };
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <PlatformRuntime initialState={initialState} />
        {children}
      </body>
    </html>
  );
}
