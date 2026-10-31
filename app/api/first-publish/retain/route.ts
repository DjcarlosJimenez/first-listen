import { NextResponse } from "next/server";
import { friendlyFirstPublishError } from "@/lib/first-publish-server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let songId = "";
  try {
    const body = (await request.json()) as { songId?: string };
    songId = String(body.songId ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  if (!/^[0-9a-f-]{36}$/i.test(songId)) {
    return NextResponse.json({ error: "Publicación inválida." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Vuelve a confirmar tu correo." }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("retain_first_publish_trial", {
    target_song_id: songId,
  });
  if (error) {
    return NextResponse.json(
      { error: friendlyFirstPublishError(error.message) },
      { status: 400 },
    );
  }

  const result = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    ok: true,
    retainedAt: result?.retained_at ?? null,
    songId: result?.retained_song_id ?? songId,
  });
}
