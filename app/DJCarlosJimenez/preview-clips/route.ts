import { NextRequest, NextResponse } from "next/server";
import {
  DJ_CARLOS_ADMIN_COOKIE_NAME,
  hasDjCarlosAdminSession,
} from "@/lib/dj-carlos-admin-auth";
import {
  DJ_CARLOS_PREVIEW_CLIP_MAX_SECONDS,
  type DjCarlosUpcomingPreviewClip,
} from "@/lib/dj-carlos-page";
import {
  deleteDjCarlosPreviewClipFile,
  writeDjCarlosPreviewClipFile,
} from "@/lib/dj-carlos-page-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (
    !hasDjCarlosAdminSession(
      request.cookies.getAll(DJ_CARLOS_ADMIN_COOKIE_NAME),
    )
  ) {
    return NextResponse.json(
      { error: "Necesitas entrar al panel antes de subir un adelanto." },
      { status: 401 },
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const title = String(formData?.get("title") ?? "").trim().slice(0, 160);
  const requestedId = String(formData?.get("clipId") ?? "").trim();
  const durationSeconds = Number(formData?.get("durationSeconds"));
  const clipId = /^[a-zA-Z0-9_-]{8,80}$/.test(requestedId)
    ? requestedId
    : `preview-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;

  if (!(file instanceof File) || !title) {
    return NextResponse.json(
      { error: "Selecciona un audio y una cancion." },
      { status: 400 },
    );
  }
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > DJ_CARLOS_PREVIEW_CLIP_MAX_SECONDS + 0.5
  ) {
    return NextResponse.json(
      { error: "El adelanto debe durar 30 segundos o menos." },
      { status: 400 },
    );
  }

  try {
    const storagePath = await writeDjCarlosPreviewClipFile(file, clipId);
    const clip: DjCarlosUpcomingPreviewClip = {
      durationSeconds: Math.min(
        DJ_CARLOS_PREVIEW_CLIP_MAX_SECONDS,
        Math.round(durationSeconds * 10) / 10,
      ),
      enabled: true,
      id: clipId,
      storagePath,
      title,
      uploadedAt: new Date().toISOString(),
    };
    return NextResponse.json({ clip });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && !error.message.toLowerCase().includes("supabase")
            ? error.message
            : "No se pudo subir el adelanto ahora.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (
    !hasDjCarlosAdminSession(
      request.cookies.getAll(DJ_CARLOS_ADMIN_COOKIE_NAME),
    )
  ) {
    return NextResponse.json(
      { error: "Necesitas entrar al panel antes de quitar un adelanto." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const storagePath =
    body && typeof body === "object" && typeof body.storagePath === "string"
      ? body.storagePath.trim()
      : "";
  if (!storagePath.startsWith("previews/") || storagePath.includes("..")) {
    return NextResponse.json({ error: "Ruta no valida." }, { status: 400 });
  }

  try {
    await deleteDjCarlosPreviewClipFile(storagePath);
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json(
      { error: "El adelanto se oculto, pero el archivo no pudo limpiarse." },
      { status: 503 },
    );
  }
}
