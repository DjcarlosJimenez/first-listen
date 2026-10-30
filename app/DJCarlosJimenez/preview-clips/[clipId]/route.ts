import { NextRequest, NextResponse } from "next/server";
import {
  DJ_CARLOS_ADMIN_COOKIE_NAME,
  hasDjCarlosAdminSession,
} from "@/lib/dj-carlos-admin-auth";
import {
  createDjCarlosPreviewClipSignedUrl,
  readDjCarlosPageConfig,
} from "@/lib/dj-carlos-page-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function releaseLooksAvailable(status: string) {
  const value = status.toLocaleLowerCase("es");
  return value.includes("disponible") || value.includes("publicado");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clipId: string }> },
) {
  const { clipId } = await params;
  const config = await readDjCarlosPageConfig();
  const release = config.upcomingRelease;
  const clip = release.previewClips.find((item) => item.id === clipId);
  const isAdmin = hasDjCarlosAdminSession(
    request.cookies.getAll(DJ_CARLOS_ADMIN_COOKIE_NAME),
  );
  const publiclyAvailable =
    release.enabled &&
    release.showPreviewClips &&
    clip?.enabled === true &&
    !(
      release.hidePreviewClipsWhenAvailable &&
      releaseLooksAvailable(release.status)
    );

  if (!clip || (!isAdmin && !publiclyAvailable)) {
    return NextResponse.json(
      { error: "Adelanto no encontrado." },
      { status: 404 },
    );
  }

  try {
    const signedUrl = await createDjCarlosPreviewClipSignedUrl(clip.storagePath);
    const response = NextResponse.redirect(signedUrl, 307);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    return NextResponse.json(
      { error: "El adelanto no esta disponible ahora." },
      { status: 503 },
    );
  }
}
