import type { Metadata } from "next";
import { DjCarlosAdminPage } from "@/components/dj-carlos-admin-page";
import {
  DJ_CARLOS_LOGO_URL,
  defaultDjCarlosPageConfig,
} from "@/lib/dj-carlos-page";

export const metadata: Metadata = {
  title: "Admin DJ Carlos Jimenez | First Listen",
  description:
    "Panel local para administrar la pagina de DJ Carlos Jimenez.",
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

export default function DjCarlosJimenezAdminRoute() {
  return (
    <DjCarlosAdminPage
      initialConfig={defaultDjCarlosPageConfig}
      logoUrl={DJ_CARLOS_LOGO_URL}
    />
  );
}
