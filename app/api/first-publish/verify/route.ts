import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { FirstPublishVerificationType } from "@/lib/first-publish";
import {
  firstPublishHash,
  friendlyFirstPublishError,
} from "@/lib/first-publish-server";

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
  return NextResponse.json({
    expiresAt: result?.publication_expires_at ?? null,
    ok: true,
    retained: Boolean(result?.retained),
    songId: result?.published_song_id ?? null,
  });
}
