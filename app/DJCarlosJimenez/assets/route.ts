import { NextRequest, NextResponse } from "next/server";
import {
  DJ_CARLOS_ADMIN_COOKIE_NAME,
  isDjCarlosAdminSession,
} from "@/lib/dj-carlos-admin-auth";
import { writeDjCarlosCoverFile } from "@/lib/dj-carlos-page-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (
    !isDjCarlosAdminSession(
      request.cookies.get(DJ_CARLOS_ADMIN_COOKIE_NAME)?.value,
    )
  ) {
    return NextResponse.json(
      { error: "Necesitas entrar al panel antes de subir portada." },
      { status: 401 },
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Selecciona una imagen JPG, PNG o WEBP." },
      { status: 400 },
    );
  }

  try {
    const coverUrl = await writeDjCarlosCoverFile(file);
    return NextResponse.json({ coverUrl });
  } catch (error) {
    const message =
      error instanceof Error &&
      !error.message.toLowerCase().includes("supabase")
        ? error.message
        : "No se pudo subir la portada ahora. Intenta otra vez en un momento.";
    return NextResponse.json(
      { error: message },
      { status: 400 },
    );
  }
}
