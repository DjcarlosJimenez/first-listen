import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { genreOptions, songLanguageOptions } from "@/lib/catalog";
import { databasePlatform } from "@/lib/content-economy";
import {
  FIRST_PUBLISH_VERIFICATION_MINUTES,
  firstPublishContentKinds,
  firstPublishPlatforms,
  type FirstPublishRequest,
  type FirstPublishVerificationType,
} from "@/lib/first-publish";
import {
  escapeFirstPublishHtml,
  firstPublishHash,
  firstPublishSiteUrl,
  normalizeFirstPublishEmail,
} from "@/lib/first-publish-server";
import { detectMusicPlatform } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";

const DEVICE_COOKIE = "first-listen-first-publish-device";
const DEFAULT_COVER = "https://www.firstlisten.net/covers/default-song.svg";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requestIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function validHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function generateVerification(
  email: string,
  artistName: string,
  redirectTo: string,
) {
  const admin = createAdminClient();
  const options = {
    data: {
      full_name: artistName,
      guest_first_publish: true,
      legal_accepted: true,
      system_bootstrap: true,
    },
    redirectTo,
  };

  const attempts: FirstPublishVerificationType[] = ["magiclink", "signup"];
  let lastMessage = "Verification link could not be created.";
  for (const type of attempts) {
    const { data, error } =
      type === "magiclink"
        ? await admin.auth.admin.generateLink({ email, options, type: "magiclink" })
        : await admin.auth.admin.generateLink({
            email,
            options,
            password: randomBytes(24).toString("base64url"),
            type: "signup",
          });
    const hashedToken = data?.properties?.hashed_token;
    if (!error && hashedToken) return { hashedToken, type };
    lastMessage = error?.message || lastMessage;
  }
  throw new Error(lastMessage);
}

async function sendVerificationEmail({
  artistName,
  email,
  title,
  verificationUrl,
}: {
  artistName: string;
  email: string;
  title: string;
  verificationUrl: string;
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const senderEmail = process.env.AUTH_SENDER_EMAIL?.trim();
  const senderName = process.env.AUTH_SENDER_NAME?.trim() || "First Listen";
  if (!apiKey || !senderEmail) {
    throw new Error("Email delivery is not configured.");
  }

  const safeArtist = escapeFirstPublishHtml(artistName);
  const safeTitle = escapeFirstPublishHtml(title);
  const safeUrl = escapeFirstPublishHtml(verificationUrl);
  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from: `${senderName} <${senderEmail}>`,
      html: `
        <div style="background:#f3f6ed;padding:32px 16px;font-family:Arial,sans-serif;color:#151815">
          <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #dfe5d7;border-radius:24px;padding:28px">
            <p style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#56761e">FIRST LISTEN</p>
            <h1 style="font-size:28px;line-height:1.1;margin:18px 0 10px">Confirma tu primera publicación</h1>
            <p style="line-height:1.55">Hola ${safeArtist}. Recibimos <strong>${safeTitle}</strong>.</p>
            <p style="line-height:1.55">Pulsa el botón para confirmar tu correo y publicar la canción durante 7 días. Después podrás mantenerla activa gratis, sin tarjeta.</p>
            <p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#b9ff2f;color:#111;border-radius:999px;padding:14px 22px;text-decoration:none;font-weight:800">Confirmar y publicar</a></p>
            <p style="font-size:13px;line-height:1.5;color:#5d6659">Este enlace vence en ${FIRST_PUBLISH_VERIFICATION_MINUTES} minutos. Si pediste varios enlaces, usa solamente el correo más reciente. Revisa también Spam o Correo no deseado.</p>
            <p style="font-size:12px;color:#7a8276;margin-top:24px">Abrir este correo no publica nada automáticamente. La publicación solo se completa cuando presionas el botón de confirmación en First Listen.</p>
          </div>
        </div>`,
      subject: "Confirma tu primera publicación en First Listen",
      to: [email],
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Email delivery failed (${response.status}).`);
  }
}

export async function POST(request: Request) {
  let payload: FirstPublishRequest;
  try {
    payload = (await request.json()) as FirstPublishRequest;
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  if (String(payload.honeypot ?? "").trim()) {
    return NextResponse.json({ ok: true });
  }

  const email = normalizeFirstPublishEmail(payload.email);
  const artistName = String(payload.artistName ?? "").trim();
  const title = String(payload.title ?? "").trim();
  const musicUrl = String(payload.musicUrl ?? "").trim();
  const country = String(payload.country ?? "").trim();
  const coverImageUrl = String(payload.coverImageUrl ?? "").trim() || DEFAULT_COVER;
  const durationSeconds = Number(payload.durationSeconds);
  const detection = detectMusicPlatform(musicUrl);
  const platform = detection.platform;

  if (!payload.termsAccepted) {
    return NextResponse.json(
      { error: "Debes aceptar los términos y la publicación visible por 7 días." },
      { status: 400 },
    );
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return NextResponse.json({ error: "Escribe un correo válido." }, { status: 400 });
  }
  if (!artistName || artistName.length > 120 || !title || title.length > 120) {
    return NextResponse.json(
      { error: "Revisa el nombre del artista y el título." },
      { status: 400 },
    );
  }
  if (
    !detection.valid ||
    !platform ||
    !firstPublishPlatforms.includes(platform as (typeof firstPublishPlatforms)[number])
  ) {
    return NextResponse.json(
      { error: "Usa un enlace válido de YouTube, YouTube Music o SoundCloud." },
      { status: 400 },
    );
  }
  if (musicUrl.length > 2000 || !detection.parsedUrl) {
    return NextResponse.json({ error: "El enlace es demasiado largo." }, { status: 400 });
  }
  if (!genreOptions.includes(payload.genre) || !songLanguageOptions.includes(payload.songLanguage)) {
    return NextResponse.json({ error: "Selecciona género e idioma." }, { status: 400 });
  }
  if (!country || country.length > 120) {
    return NextResponse.json({ error: "Selecciona un país." }, { status: 400 });
  }
  if (!firstPublishContentKinds.includes(payload.contentKind)) {
    return NextResponse.json({ error: "Selecciona canción o video musical." }, { status: 400 });
  }
  if (payload.explicitContent) {
    return NextResponse.json(
      { error: "La primera publicación debe ser apta para todo público. Crea una cuenta para administrar contenido explícito." },
      { status: 400 },
    );
  }
  if (!Number.isInteger(durationSeconds) || durationSeconds < 15 || durationSeconds > 480) {
    return NextResponse.json(
      { error: "La duración debe estar entre 15 segundos y 8 minutos." },
      { status: 400 },
    );
  }
  if (!validHttpsUrl(coverImageUrl) || coverImageUrl.length > 2000) {
    return NextResponse.json({ error: "La portada no es válida." }, { status: 400 });
  }

  const admin = createAdminClient();
  const deviceId =
    request.headers.get("cookie")
      ?.split(";")
      .map((part) => part.trim().split("="))
      .find(([key]) => key === DEVICE_COOKIE)?.[1] || randomUUID();
  const ipHash = firstPublishHash(`ip:${requestIp(request)}`);
  const deviceHash = firstPublishHash(`device:${deviceId}`);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [{ count: ipCount }, { count: deviceCount }, completed, duplicate] =
    await Promise.all([
      admin
        .from("first_publish_trials")
        .select("id", { count: "exact", head: true })
        .eq("source_ip_hash", ipHash)
        .gte("created_at", dayAgo),
      admin
        .from("first_publish_trials")
        .select("id", { count: "exact", head: true })
        .eq("device_hash", deviceHash)
        .gte("created_at", dayAgo),
      admin
        .from("first_publish_trials")
        .select("id,status")
        .eq("email", email)
        .in("status", ["published", "retained"])
        .limit(1),
      admin
        .from("songs")
        .select("id")
        .eq("music_url", detection.parsedUrl)
        .is("removed_at", null)
        .is("archived_at", null)
        .limit(1),
    ]);

  if ((ipCount ?? 0) >= 8 || (deviceCount ?? 0) >= 3) {
    return NextResponse.json(
      { error: "Se alcanzó el límite de intentos. Intenta nuevamente mañana." },
      { status: 429 },
    );
  }
  if ((completed.data?.length ?? 0) > 0) {
    return NextResponse.json(
      { error: "Este correo ya utilizó su primera publicación gratuita. Entra a tu cuenta para publicar más." },
      { status: 409 },
    );
  }
  if ((duplicate.data?.length ?? 0) > 0) {
    return NextResponse.json(
      { error: "Esta canción ya fue publicada en First Listen." },
      { status: 409 },
    );
  }

  const rawClaimToken = randomBytes(32).toString("base64url");
  const claimTokenHash = firstPublishHash(rawClaimToken);
  const verificationExpiresAt = new Date(
    Date.now() + FIRST_PUBLISH_VERIFICATION_MINUTES * 60 * 1000,
  ).toISOString();
  const trialValues = {
    artist_name: artistName,
    claim_token_hash: claimTokenHash,
    content_kind: payload.contentKind,
    country,
    cover_image_url: coverImageUrl,
    device_hash: deviceHash,
    duration_seconds: durationSeconds,
    email,
    explicit_content: false,
    feedback_focus: ["General Feedback"],
    genre: payload.genre,
    music_url: detection.parsedUrl,
    platform: databasePlatform[platform],
    song_language: payload.songLanguage,
    source_ip_hash: ipHash,
    status: "pending_email",
    title,
    updated_at: new Date().toISOString(),
    verification_expires_at: verificationExpiresAt,
  };

  const { data: pendingRows } = await admin
    .from("first_publish_trials")
    .select("id")
    .eq("email", email)
    .eq("status", "pending_email")
    .order("created_at", { ascending: false })
    .limit(1);

  let trialId = pendingRows?.[0]?.id as string | undefined;
  if (trialId) {
    const { error } = await admin
      .from("first_publish_trials")
      .update(trialValues)
      .eq("id", trialId);
    if (error) {
      return NextResponse.json({ error: "No pudimos preparar la publicación." }, { status: 500 });
    }
  } else {
    const { data, error } = await admin
      .from("first_publish_trials")
      .insert(trialValues)
      .select("id")
      .single();
    if (error || !data) {
      return NextResponse.json({ error: "No pudimos preparar la publicación." }, { status: 500 });
    }
    trialId = String(data.id);
  }

  try {
    const siteUrl = firstPublishSiteUrl(new URL(request.url).origin);
    const placeholderRedirect = `${siteUrl}/first-publish/verify`;
    const verification = await generateVerification(
      email,
      artistName,
      placeholderRedirect,
    );
    const verificationUrl = new URL("/first-publish/verify", siteUrl);
    verificationUrl.searchParams.set("token_hash", verification.hashedToken);
    verificationUrl.searchParams.set("token", rawClaimToken);
    verificationUrl.searchParams.set("type", verification.type);
    await sendVerificationEmail({
      artistName,
      email,
      title,
      verificationUrl: verificationUrl.toString(),
    });
  } catch (error) {
    await admin
      .from("first_publish_trials")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", trialId);
    console.error("first publication email failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "No pudimos enviar el correo. Intenta nuevamente en unos minutos." },
      { status: 503 },
    );
  }

  const response = NextResponse.json({
    message: "Enviamos el enlace. Usa únicamente el correo más reciente y revisa también Spam.",
    ok: true,
  });
  response.cookies.set(DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
