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
