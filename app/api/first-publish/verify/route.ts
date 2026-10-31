import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { FirstPublishVerificationType } from "@/lib/first-publish";
import {
  firstPublishHash,
  firstPublishSiteUrl,
  friendlyFirstPublishError,
  scheduleFirstPublishReminder,
} from "@/lib/first-publish-server";
import { createAdminClient } from "@/lib/supabase/admin";

type VerifyPayload = {
  token?: string;
  tokenHash?: string;
  type?: FirstPublishVerificationType;
};

export async function POST(request: Request) {
  let payload: VerifyPayload;
  try {
    payload = (await request.json()) as VerifyPayload;
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const rawTrialToken = String(payload.token ?? "").trim();
  const emailTokenHash = String(payload.tokenHash ?? "").trim();
  const verificationType = payload.type;
  if (
    rawTrialToken.length < 30 ||
    emailTokenHash.length < 20 ||
    (verificationType !== "magiclink" && verificationType !== "signup")
  ) {
    return NextResponse.json(
      { error: "Este enlace es inválido o está incompleto." },
      { status: 400 },
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ error: "First Listen no está configurado." }, { status: 503 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options: CookieOptions;
        }>,
      ) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  if (!currentUser) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: emailTokenHash,
      type: verificationType as EmailOtpType,
    });
    if (error) {
      return NextResponse.json(
        { error: "Este enlace venció o ya fue utilizado. Solicita uno nuevo." },
        { status: 400 },
      );
    }
  }

  const { data, error } = await supabase.rpc("claim_first_publish_trial", {
    trial_token_hash: firstPublishHash(rawTrialToken),
  });
  if (error) {
    return NextResponse.json(
      { error: friendlyFirstPublishError(error.message) },
      { status: 400 },
    );
  }

  const result = Array.isArray(data) ? data[0] : data;
  const songId = result?.published_song_id ?? null;
  const expiresAt = result?.publication_expires_at ?? null;
  const retained = Boolean(result?.retained);
  let song: Record<string, unknown> | null = null;

  if (songId) {
    const { data: liveRows } = await supabase.rpc("get_first_publish_live_song", {
      target_song_id: songId,
    });
    song = (Array.isArray(liveRows) ? liveRows[0] : liveRows) ?? null;
  }

  if (songId && expiresAt && !retained) {
    try {
      const admin = createAdminClient();
      const { data: trial } = await admin
        .from("first_publish_trials")
        .select("id,email,title,artist_name,reminder_email_id")
        .eq("song_id", songId)
        .maybeSingle();
      if (trial && !trial.reminder_email_id) {
        const reminder = await scheduleFirstPublishReminder({
          artistName: String(trial.artist_name),
          email: String(trial.email),
          expiresAt: String(expiresAt),
          songId: String(songId),
          title: String(trial.title),
          trialId: String(trial.id),
        });
        await admin
          .from("first_publish_trials")
          .update({
            reminder_email_id: reminder.emailId,
            reminder_scheduled_at: reminder.scheduledAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", trial.id)
          .is("reminder_email_id", null);
      }
    } catch (reminderError) {
      console.error("first publication reminder scheduling failed", {
        message: reminderError instanceof Error
          ? reminderError.message
          : "Unknown error",
      });
    }
  }

  const liveUrl = songId
    ? `${firstPublishSiteUrl(new URL(request.url).origin)}/first-publish/live/${songId}`
    : null;
  return NextResponse.json({
    artistName: song?.artist_name ?? null,
    coverImageUrl: song?.cover_image_url ?? null,
    expiresAt,
    liveUrl,
    ok: true,
    platform: song?.platform ?? null,
    retained,
    songId,
    title: song?.title ?? null,
  });
}
