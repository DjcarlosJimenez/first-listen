import { NextRequest, NextResponse } from "next/server";
import { type DjCarlosUpcomingReactionKey } from "@/lib/dj-carlos-page";
import { recordDjCarlosUpcomingSignal } from "@/lib/dj-carlos-page-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const allowedReactions = new Set<DjCarlosUpcomingReactionKey>([
  "favorite",
  "video",
  "waiting",
]);

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const action =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).action
      : null;
  const reaction =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).reaction
      : null;

  try {
    if (action === "follow") {
      const signals = await recordDjCarlosUpcomingSignal({ follow: true });
      return NextResponse.json({ signals });
    }

    if (
      action === "reaction" &&
      typeof reaction === "string" &&
      allowedReactions.has(reaction as DjCarlosUpcomingReactionKey)
    ) {
      const signals = await recordDjCarlosUpcomingSignal({
        reaction: reaction as DjCarlosUpcomingReactionKey,
      });
      return NextResponse.json({ signals });
    }

    return NextResponse.json(
      { error: "Accion no permitida." },
      { status: 400 },
    );
  } catch {
    return NextResponse.json(
      { error: "No se pudo guardar la senal ahora." },
      { status: 503 },
    );
  }
}
