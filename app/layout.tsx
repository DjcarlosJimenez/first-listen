import type { Metadata } from "next";
import "./globals.css";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
