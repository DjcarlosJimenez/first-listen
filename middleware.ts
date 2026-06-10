import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const privatePaths = [
  "/dashboard",
  "/review",
  "/submit",
  "/profile",
  "/admin",
  "/reset-password",
];
const authPaths = ["/login", "/signup"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const path = request.nextUrl.pathname;

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
      .select("role, account_status, force_password_change")
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

    if (path.startsWith("/admin")) {
      const role = profile?.role ?? "";
      const isModerationPath = path.startsWith("/admin/reports");
      const allowed = isModerationPath
        ? ["super_admin", "admin", "moderator"].includes(role)
        : ["super_admin", "admin"].includes(role);
      if (!allowed) {
        return NextResponse.redirect(new URL("/review", request.url));
      }
    }

    if (authPaths.includes(path) && !profile?.force_password_change) {
      return NextResponse.redirect(new URL("/review", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/review/:path*",
    "/submit/:path*",
    "/profile/:path*",
    "/admin/:path*",
    "/change-password",
    "/reset-password",
    "/login",
    "/signup",
  ],
};
