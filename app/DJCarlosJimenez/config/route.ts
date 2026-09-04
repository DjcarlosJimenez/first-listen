import { NextRequest, NextResponse } from "next/server";
import {
  DJ_CARLOS_ADMIN_COOKIE_NAME,
  hasDjCarlosAdminSession,
} from "@/lib/dj-carlos-admin-auth";
import {
  defaultDjCarlosPageConfig,
  normalizeDjCarlosPageConfig,
} from "@/lib/dj-carlos-page";
import {
  readDjCarlosPageConfig,
  writeDjCarlosPageConfig,
} from "@/lib/dj-carlos-page-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const config = await readDjCarlosPageConfig(defaultDjCarlosPageConfig);
  return NextResponse.json({ config });
}

export async function PUT(request: NextRequest) {
  if (
    !hasDjCarlosAdminSession(
      request.cookies.getAll(DJ_CARLOS_ADMIN_COOKIE_NAME),
    )
  ) {
    return NextResponse.json(
      { error: "Necesitas entrar al panel antes de guardar." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const cleanConfig = normalizeDjCarlosPageConfig(
    body,
    defaultDjCarlosPageConfig,
  );

  try {
    const config = await writeDjCarlosPageConfig(cleanConfig);
    return NextResponse.json({ config });
  } catch {
    return NextResponse.json(
      {
        error:
          "No se pudo publicar el cambio ahora. El borrador quedo guardado en este navegador.",
      },
      { status: 503 },
    );
  }
}
