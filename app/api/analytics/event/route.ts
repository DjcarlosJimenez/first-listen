import { createHmac } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BOT_PATTERN = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|slurp/i;
const ID_PATTERN = /^[a-zA-Z0-9_-]{16,100}$/;

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function hashIdentifier(value: string) {
  const secret = process.env.SITE_ANALYTICS_HASH_SECRET?.trim()
    || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) throw new Error("Analytics secret is not configured.");
  return createHmac("sha256", secret).update(value).digest("hex");
}

function sourceLabel(referrer: string) {
  if (!referrer) return "Directo";
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (host.includes("facebook") || host === "fb.com") return "Facebook";
    if (host.includes("whatsapp")) return "WhatsApp";
    if (host.includes("google")) return "Google";
    if (host.endsWith("firstlisten.net") || host === "localhost") return "First Listen";
    return host.replace(/^www\./, "").slice(0, 80);
  } catch {
    return "Directo";
  }
}

function deviceType(userAgent: string) {
  if (/ipad|tablet/i.test(userAgent)) return "Tablet";
  if (/android|iphone|ipod|mobile/i.test(userAgent)) return "Movil";
  return "Computadora";
}

export async function POST(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") ?? "";
  if (!userAgent || BOT_PATTERN.test(userAgent)) {
    return new NextResponse(null, { status: 204 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Evento no valido." }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const scope = input.scope === "artist" ? "artist" : "platform";
  const artistSlug = scope === "artist"
    ? cleanText(input.artistSlug, 64).toLowerCase()
    : "";
  const eventType = input.eventType === "action" ? "action" : "page_view";
  const visitorId = cleanText(input.visitorId, 100);
  const sessionId = cleanText(input.sessionId, 100);
  const path = cleanText(input.path, 300).split("?")[0] || "/";

  if (
    !ID_PATTERN.test(visitorId)
    || !ID_PATTERN.test(sessionId)
    || (scope === "artist" && !/^[a-z0-9-]{1,64}$/.test(artistSlug))
  ) {
    return NextResponse.json({ error: "Evento no valido." }, { status: 400 });
  }

  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    userId = null;
  }

  try {
    const baseEvent = {
      content_kind: cleanText(input.contentKind, 60) || "Pagina",
      content_label: cleanText(input.contentLabel, 180) || path,
      device_type: deviceType(userAgent),
      event_type: eventType,
      path,
      session_hash: hashIdentifier(sessionId),
      source_label: sourceLabel(cleanText(input.referrer, 500)),
      user_id: userId,
      visitor_hash: hashIdentifier(visitorId),
    };
    const events = scope === "artist"
      ? [
          { ...baseEvent, artist_slug: artistSlug, scope: "artist" },
          { ...baseEvent, artist_slug: null, scope: "platform" },
        ]
      : [{ ...baseEvent, artist_slug: null, scope: "platform" }];
    const admin = createAdminClient();
    const { error } = await admin.from("site_analytics_events").insert(events);
    if (error) throw error;
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("site analytics insert failed", error);
    return NextResponse.json({ error: "No se pudo registrar la actividad." }, { status: 503 });
  }
}
