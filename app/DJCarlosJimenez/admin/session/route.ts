import { NextRequest, NextResponse } from "next/server";
import {
  createDjCarlosAdminSession,
  DJ_CARLOS_ADMIN_COOKIE_NAME,
  DJ_CARLOS_ADMIN_COOKIE_PATH,
  DJ_CARLOS_ADMIN_SESSION_MAX_AGE_SECONDS,
  hasDjCarlosAdminSession,
  isDjCarlosAdminPasswordReady,
  verifyDjCarlosAdminPassword,
} from "@/lib/dj-carlos-admin-auth";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const authenticated = hasDjCarlosAdminSession(
    request.cookies.getAll(DJ_CARLOS_ADMIN_COOKIE_NAME),
  );
  const response = NextResponse.json({
    authenticated,
    configured: isDjCarlosAdminPasswordReady(),
  });

  if (authenticated) {
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
  }

  return response;
}

export async function POST(request: NextRequest) {
  if (!isDjCarlosAdminPasswordReady()) {
    return NextResponse.json(
      { error: "La contrasena del panel no esta configurada." },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const password =
    body && typeof body === "object" && "password" in body
      ? String(body.password ?? "")
      : "";
  const remember =
    body && typeof body === "object" && "remember" in body
      ? body.remember === true
      : false;

  if (!verifyDjCarlosAdminPassword(password)) {
    return NextResponse.json(
      { error: "Contrasena incorrecta." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ authenticated: true });
  const cookieOptions = {
    httpOnly: true,
    path: DJ_CARLOS_ADMIN_COOKIE_PATH,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    ...(remember ? { maxAge: DJ_CARLOS_ADMIN_SESSION_MAX_AGE_SECONDS } : {}),
  } as const;
  response.cookies.set(
    DJ_CARLOS_ADMIN_COOKIE_NAME,
    createDjCarlosAdminSession(),
    cookieOptions,
  );
  return response;
}

export function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(DJ_CARLOS_ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: DJ_CARLOS_ADMIN_COOKIE_PATH,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  response.cookies.set(DJ_CARLOS_ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/DJCarlosJimenez/admin",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  response.cookies.set(DJ_CARLOS_ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
