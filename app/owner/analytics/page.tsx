import { redirect } from "next/navigation";
import { SiteAnalyticsDashboard } from "@/components/site-analytics-dashboard";
import { hasOwnerAccess } from "@/lib/admin-access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OwnerAnalyticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/owner/analytics");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, founder_number")
    .eq("id", user.id)
    .maybeSingle();
  if (!hasOwnerAccess(profile, user.email)) redirect("/dashboard");

  return (
    <SiteAnalyticsDashboard
      allowedScopes={["platform", "artist"]}
      artistSlug="djcarlosjimenez"
      backHref="/owner"
      initialScope="platform"
    />
  );
}
