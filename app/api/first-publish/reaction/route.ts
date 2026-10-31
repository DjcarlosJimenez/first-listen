import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  firstPublishReactionKeys,
  type FirstPublishReactionKey,
} from "@/lib/first-publish";
import { firstPublishHash } from "@/lib/first-publish-server";
import { createClient } from "@/lib/supabase/server";

const REACTION_COOKIE = "first-listen-first-publish-listener";

export async function POST(request: Request) {
  let songId = "";
  let reaction = "";
  try {
    const body = (await request.json()) as { reaction?: string; songId?: string };
    songId = String(body.songId ?? "").trim();
    reaction = String(body.reaction ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  if (!/^[0-9a-f-]{36}$/i.test(songId)) {
    return NextResponse.json({ error: "Publicación inválida." }, { status: 400 });
  }
  if (!firstPublishReactionKeys.includes(reaction as FirstPublishReactionKey)) {
    return NextResponse.json({ error: "Reacción inválida." }, { status: 400 });
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const existingDevice = cookieHeader
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === REACTION_COOKIE)?.[1];
  const deviceId = existingDevice || randomUUID();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_first_publish_reaction", {
    submitted_device_hash: firstPublishHash(`reaction:${deviceId}`),
    submitted_reaction: reaction,
    target_song_id: songId,
  });
  if (error) {
    return NextResponse.json(
      { error: "No pudimos guardar la reacción. Intenta nuevamente." },
      { status: 400 },
    );
  }
  const row = Array.isArray(data) ? data[0] : data;
  const response = NextResponse.json({
    accepted: Boolean(row?.accepted),
    counts: {
      good_rhythm: Number(row?.good_rhythm_count ?? 0),
      good_voice: Number(row?.good_voice_count ?? 0),
      liked: Number(row?.liked_count ?? 0),
      listen_again: Number(row?.listen_again_count ?? 0),
    },
    ok: true,
  });
  response.cookies.set(REACTION_COOKIE, deviceId, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
