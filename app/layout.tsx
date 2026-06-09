import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "First Listen - Real Listeners. Real Viewers. Real Reactions.",
  description:
    "Get your first listens, views, reactions, and engagement from real people before spending money on promotion.",
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
