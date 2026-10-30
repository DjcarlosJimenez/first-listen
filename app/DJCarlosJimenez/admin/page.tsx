import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DjCarlosAdminLogin } from "@/components/dj-carlos-admin-login";
import { DjCarlosAdminPage } from "@/components/dj-carlos-admin-page";
import { hasOwnerAccess } from "@/lib/admin-access";
import {
  DJ_CARLOS_LOGO_URL,
  defaultDjCarlosPageConfig,
} from "@/lib/dj-carlos-page";
import { readDjCarlosPageConfig } from "@/lib/dj-carlos-page-store";
import {
  DJ_CARLOS_ADMIN_COOKIE_NAME,
  hasDjCarlosAdminSession,
} from "@/lib/dj-carlos-admin-auth";
import { createClient } from "@/lib/supabase/server";

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

async function hasCurrentOwnerSession() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, founder_number")
      .eq("id", user.id)
      .maybeSingle();
    return hasOwnerAccess(profile, user.email);
  } catch {
    return false;
  }
}

export default async function DjCarlosJimenezAdminRoute({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const cookieStore = await cookies();
  const authenticated = hasDjCarlosAdminSession(
    cookieStore.getAll(DJ_CARLOS_ADMIN_COOKIE_NAME),
  );

  if (!authenticated) {
    if (await hasCurrentOwnerSession()) {
      redirect("/DJCarlosJimenez/admin/owner-session");
    }
    const query = searchParams ? await searchParams : {};
    const ownerAccessDenied = query.owner === "denied";
    return (
      <DjCarlosAdminLogin
        logoUrl={DJ_CARLOS_LOGO_URL}
        ownerAccessDenied={ownerAccessDenied}
      />
    );
  }

  const initialConfig = await readDjCarlosPageConfig(defaultDjCarlosPageConfig);

  return (
    <DjCarlosAdminPage
      initialConfig={initialConfig}
      logoUrl={DJ_CARLOS_LOGO_URL}
    />
  );
}
