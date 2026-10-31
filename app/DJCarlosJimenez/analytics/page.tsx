import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SiteAnalyticsDashboard } from "@/components/site-analytics-dashboard";
import { hasOwnerAccess } from "@/lib/admin-access";
import {
  DJ_CARLOS_ADMIN_COOKIE_NAME,
  hasDjCarlosAdminSession,
} from "@/lib/dj-carlos-admin-auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function hasOwnerSession() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
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

export default async function DjCarlosAnalyticsPage() {
  const cookieStore = await cookies();
  const artistAccess = hasDjCarlosAdminSession(
    cookieStore.getAll(DJ_CARLOS_ADMIN_COOKIE_NAME),
  );
  const ownerAccess = await hasOwnerSession();
  if (!artistAccess && !ownerAccess) redirect("/DJCarlosJimenez/admin");

  return (
    <SiteAnalyticsDashboard
      allowedScopes={ownerAccess ? ["artist", "platform"] : ["artist"]}
      artistSlug="djcarlosjimenez"
      backHref="/DJCarlosJimenez/admin"
      initialScope="artist"
    />
  );
}
