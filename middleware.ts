import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canAccessAdminRoute, hasOwnerAccess } from "@/lib/admin-access";
import {
  findPublicArtistPageByHost,
  PUBLIC_ARTIST_HOST_HEADER,
  publicArtistSlugKey,
} from "@/lib/public-artist-pages";

const privatePaths = [
  "/dashboard",
  "/review",
  "/submit",
  "/profile",
  "/admin",
  "/owner",
];
const authPaths = ["/login", "/signup"];

const passThroughArtistHostPaths = [
  "/_next",
  "/artist",
  "/icons",
  "/apple-icon.png",
  "/favicon.ico",
  "/icon.png",
  "/manifest.webmanifest",
  "/offline",
  "/service-worker.js",
];

function rewriteArtistHostRequest(request: NextRequest) {
  const route = findPublicArtistPageByHost(request.headers.get("host"));
  if (!route) return null;

  const path = request.nextUrl.pathname;
  if (passThroughArtistHostPaths.some((prefix) => path.startsWith(prefix))) {
    return null;
  }

  const segments = path.split("/").filter(Boolean);
  if (segments[0] && publicArtistSlugKey(segments[0]) === publicArtistSlugKey(route.slug)) {
    const redirectUrl = request.nextUrl.clone();
    const host = request.headers.get("host");
    if (host) redirectUrl.host = host;
    redirectUrl.pathname = `/${segments.slice(1).join("/")}`;
    if (redirectUrl.pathname === "/") {
      redirectUrl.pathname = "/";
    }
    return NextResponse.redirect(redirectUrl, 308);
  }

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname =
    path === "/" ? `/${route.slug}` : `/${route.slug}${path}`;
  const requestHeaders = new Headers(request.headers);
  const host = request.headers.get("host");
  if (host) requestHeaders.set(PUBLIC_ARTIST_HOST_HEADER, host);
  return NextResponse.rewrite(rewriteUrl, {
    request: {
      headers: requestHeaders,
    },
  });
}

export async function middleware(request: NextRequest) {
  const artistHostResponse = rewriteArtistHostRequest(request);
  if (artistHostResponse) return artistHostResponse;

  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const path = request.nextUrl.pathname;
  const authRelevantPath =
    privatePaths.some((prefix) => path.startsWith(prefix)) ||
    authPaths.includes(path) ||
    path === "/change-password";

  if (!authRelevantPath) return response;

  if (!url || !anonKey) {
    if (privatePaths.some((prefix) => path.startsWith(prefix))) {
      return NextResponse.redirect(new URL("/login?error=config", request.url));
    }
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options: CookieOptions;
        }>,
      ) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isPrivate = privatePaths.some((prefix) => path.startsWith(prefix));

  if (isPrivate && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${path}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, founder_number, account_status, force_password_change")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.account_status === "suspended") {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/login?error=suspended", request.url));
    }

    if (
      profile?.force_password_change &&
      path !== "/change-password" &&
      isPrivate
    ) {
      return NextResponse.redirect(new URL("/change-password", request.url));
    }

    if (path.startsWith("/owner")) {
      if (!hasOwnerAccess(profile, user.email)) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
    }

    if (path.startsWith("/admin")) {
      const isModerationPath = path.startsWith("/admin/reports");
      if (
        !canAccessAdminRoute(profile, user.email, {
          allowModerator: isModerationPath,
        })
      ) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
    }

    if (authPaths.includes(path) && !profile?.force_password_change) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|txt|xml|json)$).*)",
    "/dashboard/:path*",
    "/review/:path*",
    "/submit/:path*",
    "/profile/:path*",
    "/admin/:path*",
    "/owner/:path*",
    "/change-password",
    "/reset-password",
    "/login",
    "/signup",
  ],
};
