import "server-only";

import { createHmac } from "node:crypto";

export function normalizeFirstPublishEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function firstPublishHash(value: string) {
  const secret =
    process.env.FIRST_PUBLISH_HASH_SECRET?.trim() ||
    process.env.SITE_ANALYTICS_HASH_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) {
    throw new Error("First-publication hashing is not configured.");
  }
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function firstPublishSiteUrl(requestOrigin?: string) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return (configured || requestOrigin || "https://www.firstlisten.net").replace(
    /\/$/,
    "",
  );
}

export function escapeFirstPublishHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function firstPublishEmailConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const senderEmail = process.env.AUTH_SENDER_EMAIL?.trim();
  const senderName = process.env.AUTH_SENDER_NAME?.trim() || "First Listen";
  if (!apiKey || !senderEmail) {
    throw new Error("Email delivery is not configured.");
  }
  return { apiKey, from: `${senderName} <${senderEmail}>` };
}

export async function scheduleFirstPublishReminder({
  artistName,
  email,
  expiresAt,
  songId,
  title,
  trialId,
}: {
  artistName: string;
  email: string;
  expiresAt: string;
  songId: string;
  title: string;
  trialId: string;
}) {
  const expiration = Date.parse(expiresAt);
  if (!Number.isFinite(expiration)) throw new Error("Invalid reminder expiration.");
  const scheduledAt = new Date(expiration - 48 * 60 * 60 * 1000).toISOString();
  const { apiKey, from } = firstPublishEmailConfig();
  const siteUrl = firstPublishSiteUrl();
  const liveUrl = `${siteUrl}/first-publish/live/${songId}`;
  const safeArtist = escapeFirstPublishHtml(artistName);
  const safeTitle = escapeFirstPublishHtml(title);
  const safeLiveUrl = escapeFirstPublishHtml(liveUrl);
  const safeDashboardUrl = escapeFirstPublishHtml(`${siteUrl}/dashboard`);
  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from,
      html: `
        <div style="background:#f3f6ed;padding:32px 16px;font-family:Arial,sans-serif;color:#151815">
          <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #dfe5d7;border-radius:24px;padding:28px">
            <p style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#56761e">FIRST LISTEN</p>
            <h1 style="font-size:28px;line-height:1.1;margin:18px 0 10px">Tu canción vence en 2 días</h1>
            <p style="line-height:1.55">Hola ${safeArtist}. <strong>${safeTitle}</strong> continúa activa en First Listen.</p>
            <p style="line-height:1.55">Entra gratis para conservarla, revisar sus reacciones y seguir administrando tu música. No necesitas tarjeta.</p>
            <p style="margin:28px 0"><a href="${safeDashboardUrl}" style="display:inline-block;background:#b9ff2f;color:#111;border-radius:999px;padding:14px 22px;text-decoration:none;font-weight:800">Conservar mi canción</a></p>
            <p style="font-size:13px;line-height:1.5;color:#5d6659">También puedes <a href="${safeLiveUrl}" style="color:#416b17">abrir y compartir tu publicación</a>. Si ya la conservaste, no necesitas hacer nada.</p>
          </div>
        </div>`,
      scheduled_at: scheduledAt,
      subject: `Tu canción “${title.slice(0, 80)}” vence en 2 días`,
      tags: [{ name: "category", value: "first_publish_reminder" }],
      to: [email],
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `first-publish-reminder/${trialId}`,
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Reminder scheduling failed (${response.status}).`);
  }
  const payload = (await response.json()) as { id?: string };
  if (!payload.id) throw new Error("Reminder scheduling returned no email ID.");
  return { emailId: payload.id, scheduledAt };
}

export async function cancelFirstPublishReminder(emailId: string) {
  if (!emailId) return false;
  const { apiKey } = firstPublishEmailConfig();
  const response = await fetch(
    `https://api.resend.com/emails/${encodeURIComponent(emailId)}/cancel`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      method: "POST",
    },
  );
  return response.ok;
}

export function friendlyFirstPublishError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("already been published")) {
    return "Esta canción ya fue publicada en First Listen.";
  }
  if (normalized.includes("only for your first publication")) {
    return "Esta prueba gratuita está disponible únicamente antes de tu primera publicación.";
  }
  if (normalized.includes("invalid or expired")) {
    return "Este enlace ya venció o fue reemplazado. Solicita uno nuevo.";
  }
  if (normalized.includes("same email")) {
    return "Abre el enlace usando el mismo correo con el que solicitaste la publicación.";
  }
  if (normalized.includes("another account")) {
    return "Esta publicación pertenece a otra cuenta.";
  }
  if (normalized.includes("unsupported") || normalized.includes("invalid music")) {
    return "Usa un enlace válido de YouTube, YouTube Music o SoundCloud.";
  }
  return message || "No pudimos completar la publicación. Intenta nuevamente.";
}
