import type { Metadata } from "next";
import { DjCarlosArtistPage } from "@/components/dj-carlos-artist-page";
import {
  DJ_CARLOS_LOGO_URL,
} from "@/lib/dj-carlos-page";
import { readDjCarlosPageConfig } from "@/lib/dj-carlos-page-store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "DJ Carlos Jimenez | First Listen",
  description:
    "Pagina oficial de DJ Carlos Jimenez en First Listen, con reproductor, album, Top Ten y videos oficiales.",
  manifest: "/DJCarlosJimenez/manifest.webmanifest",
  applicationName: "DJ Carlos Jimenez",
  appleWebApp: {
    capable: true,
    title: "DJ Carlos",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      {
        url: "/artist/dj-carlos-jimenez/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/artist/dj-carlos-jimenez/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
  },
};

export default async function DjCarlosJimenezPage() {
  const initialConfig = await readDjCarlosPageConfig();

  return (
    <DjCarlosArtistPage
      initialConfig={initialConfig}
      logoUrl={DJ_CARLOS_LOGO_URL}
    />
  );
}
