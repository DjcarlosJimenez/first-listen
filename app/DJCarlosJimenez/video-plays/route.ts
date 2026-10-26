import { NextRequest, NextResponse } from "next/server";
import {
  readDjCarlosPageConfig,
  readDjCarlosVideoPlayCounts,
  recordDjCarlosVideoPlay,
} from "@/lib/dj-carlos-page-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const countedVisitors = new Map<string, number>();
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function cleanCountedVisitors(now: number) {
  countedVisitors.forEach((expiresAt, key) => {
    if (expiresAt <= now) countedVisitors.delete(key);
  });
}

export async function GET() {
  return NextResponse.json(
    { counts: await readDjCarlosVideoPlayCounts() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const trackId =
    body && typeof body === "object" && typeof body.trackId === "string"
      ? body.trackId.trim()
      : "";
  const visitorId =
    body && typeof body === "object" && typeof body.visitorId === "string"
      ? body.visitorId.trim()
      : "";

  if (!trackId || !/^[a-zA-Z0-9_-]{16,80}$/.test(visitorId)) {
    return NextResponse.json({ error: "Solicitud no valida." }, { status: 400 });
  }

  const config = await readDjCarlosPageConfig();
  const officialVideoExists = config.tracks.some(
    (track) => track.id === trackId && track.section === "official-video",
  );
  if (!officialVideoExists) {
    return NextResponse.json({ error: "Video no encontrado." }, { status: 404 });
  }

  const now = Date.now();
  cleanCountedVisitors(now);
  const today = new Date(now).toISOString().slice(0, 10);
  const visitorKey = `${today}:${trackId}:${visitorId}`;
  if (countedVisitors.has(visitorKey)) {
    return NextResponse.json(
      { counted: false, counts: await readDjCarlosVideoPlayCounts() },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  countedVisitors.set(visitorKey, now + ONE_DAY_MS);
  try {
    const counts = await recordDjCarlosVideoPlay(trackId);
    return NextResponse.json(
      { counted: true, counts },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    countedVisitors.delete(visitorKey);
    return NextResponse.json(
      { error: "No se pudo registrar la reproduccion." },
      { status: 503 },
    );
  }
}
