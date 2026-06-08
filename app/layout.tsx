import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "First Listen - Know if your song hooks listeners",
  description:
    "Get honest first-impression feedback before spending money on music promotion.",
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
