import { NextResponse } from "next/server";
import {
  cancelFirstPublishReminder,
  friendlyFirstPublishError,
} from "@/lib/first-publish-server";
import { createAdminClient } from "@/lib/supabase/admin";
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
  try {
    const admin = createAdminClient();
    const { data: trial } = await admin
      .from("first_publish_trials")
      .select("id,reminder_email_id,reminder_cancelled_at")
      .eq("song_id", songId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (trial?.reminder_email_id && !trial.reminder_cancelled_at) {
      const cancelled = await cancelFirstPublishReminder(trial.reminder_email_id);
      if (cancelled) {
        await admin
          .from("first_publish_trials")
          .update({
            reminder_cancelled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", trial.id);
      }
    }
  } catch (reminderError) {
    console.error("first publication reminder cancellation failed", {
      message: reminderError instanceof Error
        ? reminderError.message
        : "Unknown error",
    });
  }
  return NextResponse.json({
    ok: true,
    retainedAt: result?.retained_at ?? null,
    songId: result?.retained_song_id ?? songId,
  });
}
