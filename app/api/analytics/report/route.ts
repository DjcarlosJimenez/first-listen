import { NextRequest, NextResponse } from "next/server";
import { hasOwnerAccess } from "@/lib/admin-access";
import {
  DJ_CARLOS_ADMIN_COOKIE_NAME,
  hasDjCarlosAdminSession,
} from "@/lib/dj-carlos-admin-auth";
import { normalizeSiteAnalyticsReport } from "@/lib/site-analytics";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function currentAccess(artistSlug: string | null) {
  let owner = false;
  let artistOwner = false;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, founder_number")
        .eq("id", user.id)
        .maybeSingle();
      owner = hasOwnerAccess(profile, user.email);
      if (!owner && artistSlug) {
        const { data: site } = await supabase
          .from("artist_sites")
          .select("id")
          .eq("slug_key", artistSlug.toLowerCase())
          .eq("owner_user_id", user.id)
          .maybeSingle();
        artistOwner = Boolean(site);
      }
    }
  } catch {
    // The DJ Carlos cookie below remains a valid artist-only fallback.
  }
  return { owner, artistOwner };
}

export async function GET(request: NextRequest) {
  const scope = request.nextUrl.searchParams.get("scope") === "platform"
    ? "platform"
    : "artist";
  const artistSlug = scope === "artist"
    ? (request.nextUrl.searchParams.get("artist") ?? "djcarlosjimenez")
        .trim().toLowerCase().slice(0, 64)
    : null;
  const periodParam = request.nextUrl.searchParams.get("period") ?? "30";
  const periodDays = periodParam === "all"
    ? 0
    : [7, 30, 90].includes(Number(periodParam))
      ? Number(periodParam)
      : 30;

  const { owner, artistOwner } = await currentAccess(artistSlug);
  const djCookieAccess = artistSlug === "djcarlosjimenez"
    && hasDjCarlosAdminSession(
      request.cookies.getAll(DJ_CARLOS_ADMIN_COOKIE_NAME),
    );

  if (scope === "platform" ? !owner : !(owner || artistOwner || djCookieAccess)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("get_site_analytics_report", {
      period_days: periodDays,
      report_artist_slug: artistSlug,
      report_scope: scope,
    });
    if (error) throw error;
    return NextResponse.json({ report: normalizeSiteAnalyticsReport(data) });
  } catch (error) {
    console.error("site analytics report failed", error);
    return NextResponse.json(
      { error: "Las estadisticas no estan disponibles ahora." },
      { status: 503 },
    );
  }
}
