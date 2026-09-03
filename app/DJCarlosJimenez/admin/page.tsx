import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DjCarlosAdminLogin } from "@/components/dj-carlos-admin-login";
import { DjCarlosAdminPage } from "@/components/dj-carlos-admin-page";
import {
  DJ_CARLOS_LOGO_URL,
  defaultDjCarlosPageConfig,
} from "@/lib/dj-carlos-page";
import { readDjCarlosPageConfig } from "@/lib/dj-carlos-page-store";
import {
  DJ_CARLOS_ADMIN_COOKIE_NAME,
  isDjCarlosAdminSession,
} from "@/lib/dj-carlos-admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export default async function DjCarlosJimenezAdminRoute() {
  const cookieStore = await cookies();
  const authenticated = isDjCarlosAdminSession(
    cookieStore.get(DJ_CARLOS_ADMIN_COOKIE_NAME)?.value,
  );

  if (!authenticated) {
    return <DjCarlosAdminLogin logoUrl={DJ_CARLOS_LOGO_URL} />;
  }

  const initialConfig = await readDjCarlosPageConfig(defaultDjCarlosPageConfig);

  return (
    <DjCarlosAdminPage
      initialConfig={initialConfig}
      logoUrl={DJ_CARLOS_LOGO_URL}
    />
  );
}
