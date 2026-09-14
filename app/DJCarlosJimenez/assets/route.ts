import { NextRequest, NextResponse } from "next/server";
import {
  DJ_CARLOS_ADMIN_COOKIE_NAME,
  hasDjCarlosAdminSession,
} from "@/lib/dj-carlos-admin-auth";
import { writeDjCarlosImageFile } from "@/lib/dj-carlos-page-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (
    !hasDjCarlosAdminSession(
      request.cookies.getAll(DJ_CARLOS_ADMIN_COOKIE_NAME),
    )
  ) {
    return NextResponse.json(
      { error: "Necesitas entrar al panel antes de subir imagen." },
      { status: 401 },
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const kind = formData?.get("kind");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Selecciona una imagen JPG, PNG o WEBP." },
      { status: 400 },
    );
  }

  try {
    const folder = kind === "identity" ? "identity" : "covers";
    const assetUrl = await writeDjCarlosImageFile(file, folder);
    return NextResponse.json({ assetUrl, coverUrl: assetUrl });
  } catch (error) {
    const message =
      error instanceof Error &&
      !error.message.toLowerCase().includes("supabase")
        ? error.message
        : "No se pudo subir la imagen ahora. Intenta otra vez en un momento.";
    return NextResponse.json(
      { error: message },
      { status: 400 },
    );
  }
}
