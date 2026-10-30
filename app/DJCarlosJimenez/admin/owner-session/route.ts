import { NextRequest, NextResponse } from "next/server";
import { hasOwnerAccess } from "@/lib/admin-access";
import {
  createDjCarlosAdminSession,
  DJ_CARLOS_ADMIN_COOKIE_NAME,
  DJ_CARLOS_ADMIN_COOKIE_PATH,
  DJ_CARLOS_ADMIN_SESSION_MAX_AGE_SECONDS,
} from "@/lib/dj-carlos-admin-auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const canonicalOrigin = "https://www.firstlisten.net";

function isArtistSubdomain(hostname: string) {
  return hostname.toLowerCase() === "djcarlosjimenez.firstlisten.net";
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production" && isArtistSubdomain(request.nextUrl.hostname)) {
    return NextResponse.redirect(
      new URL("/DJCarlosJimenez/admin/owner-session", canonicalOrigin),
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "next",
      "/DJCarlosJimenez/admin/owner-session",
    );
    return NextResponse.redirect(loginUrl);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, founder_number")
    .eq("id", user.id)
    .maybeSingle();

  if (!hasOwnerAccess(profile, user.email)) {
    const deniedUrl = new URL("/DJCarlosJimenez/admin", request.url);
    deniedUrl.searchParams.set("owner", "denied");
    return NextResponse.redirect(deniedUrl);
  }

  const response = NextResponse.redirect(
    new URL("/DJCarlosJimenez/admin", request.url),
  );
  response.cookies.set(
    DJ_CARLOS_ADMIN_COOKIE_NAME,
    createDjCarlosAdminSession(),
    {
      httpOnly: true,
      maxAge: DJ_CARLOS_ADMIN_SESSION_MAX_AGE_SECONDS,
      path: DJ_CARLOS_ADMIN_COOKIE_PATH,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  );
  return response;
}
