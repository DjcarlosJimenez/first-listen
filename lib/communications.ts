import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export const MINIMUM_EXTERNAL_CONTACT_DAYS = 14;
export const ACTIVE_MEMBER_WINDOW_DAYS = 7;
export const DEFAULT_QUIET_START_HOUR = 21;
export const DEFAULT_QUIET_END_HOUR = 9;

export type CommunicationSong = {
  artistName: string;
  coverImageUrl: string;
  genre: string;
  id: string;
  musicUrl: string;
  title: string;
};

function communicationSecret() {
  const secret =
    process.env.COMMUNICATIONS_SIGNING_SECRET?.trim() ||
    process.env.FIRST_PUBLISH_HASH_SECRET?.trim() ||
    process.env.SITE_ANALYTICS_HASH_SECRET?.trim();
  if (!secret) throw new Error("Communications signing is not configured.");
  return secret;
}

export function communicationsSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://www.firstlisten.net").replace(
    /\/$/,
    "",
  );
}

export function signCommunicationToken(userId: string) {
  const signature = createHmac("sha256", communicationSecret())
    .update(`unsubscribe:${userId}`)
    .digest("base64url");
  return `${userId}.${signature}`;
}

export function verifyCommunicationToken(token: string) {
  const separator = token.indexOf(".");
  if (separator < 1) return null;
  const userId = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(userId) || !signature) return null;
  const expected = signCommunicationToken(userId).slice(separator + 1);
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return null;
  }
  return userId;
}

export function communicationUnsubscribeUrl(userId: string) {
  const token = signCommunicationToken(userId);
  return `${communicationsSiteUrl()}/communications/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function communicationOneClickUnsubscribeUrl(userId: string) {
  const token = signCommunicationToken(userId);
  return `${communicationsSiteUrl()}/api/communications/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function escapeCommunicationHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function hourInTimeZone(date: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    return Number.isInteger(hour) ? hour : date.getUTCHours();
  } catch {
    return date.getUTCHours();
  }
}

export function isQuietHour(
  date: Date,
  timeZone: string,
  startHour = DEFAULT_QUIET_START_HOUR,
  endHour = DEFAULT_QUIET_END_HOUR,
) {
  const hour = hourInTimeZone(date, timeZone);
  if (startHour === endHour) return false;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

function emailConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const senderEmail = process.env.AUTH_SENDER_EMAIL?.trim();
  const senderName = process.env.AUTH_SENDER_NAME?.trim() || "First Listen";
  const postalAddress = process.env.COMMUNICATIONS_POSTAL_ADDRESS?.trim();
  if (!apiKey || !senderEmail || !postalAddress) {
    throw new Error("Communications email delivery is not fully configured.");
  }
  return {
    apiKey,
    from: `${senderName} <${senderEmail}>`,
    postalAddress,
  };
}

function songCards(songs: CommunicationSong[]) {
  return songs
    .map((song) => {
      const safeTitle = escapeCommunicationHtml(song.title);
      const safeArtist = escapeCommunicationHtml(song.artistName);
      const safeGenre = escapeCommunicationHtml(song.genre);
      const safeUrl = escapeCommunicationHtml(song.musicUrl);
      return `<tr><td style="padding:12px 0;border-top:1px solid #30363d">
        <a href="${safeUrl}" style="color:#b9ff2f;font-size:16px;font-weight:800;text-decoration:none">${safeTitle}</a>
        <div style="color:#b6bdc5;font-size:13px;margin-top:4px">${safeArtist}${safeGenre ? ` · ${safeGenre}` : ""}</div>
      </td></tr>`;
    })
    .join("");
}

export async function sendMusicDigestEmail({
  email,
  eventKey,
  locale,
  songs,
  unsubscribeUrl,
}: {
  email: string;
  eventKey: string;
  locale: "en" | "es";
  songs: CommunicationSong[];
  unsubscribeUrl: string;
}) {
  const { apiKey, from, postalAddress } = emailConfig();
  const spanish = locale === "es";
  const siteUrl = communicationsSiteUrl();
  const userId = verifyCommunicationToken(new URL(unsubscribeUrl).searchParams.get("token") ?? "");
  if (!userId) throw new Error("Invalid unsubscribe URL.");
  const oneClickUrl = communicationOneClickUnsubscribeUrl(userId);
  const safeUnsubscribeUrl = escapeCommunicationHtml(unsubscribeUrl);
  const safePostalAddress = escapeCommunicationHtml(postalAddress);
  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from,
      headers: {
        "List-Unsubscribe": `<${oneClickUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      html: `<div style="background:#0d0f11;padding:30px 14px;font-family:Arial,sans-serif;color:#f4f6f2">
        <div style="max-width:580px;margin:0 auto;background:#171a1e;border:1px solid #343a40;border-radius:22px;padding:26px">
          <p style="font-size:11px;font-weight:900;letter-spacing:.14em;color:#b9ff2f">FIRST LISTEN</p>
          <h1 style="font-size:27px;line-height:1.15;margin:16px 0 9px">${spanish ? "Música nueva que puede gustarte" : "New music you may enjoy"}</h1>
          <p style="color:#c3c9cf;line-height:1.55">${spanish ? "Elegimos pocas novedades según tus estilos. Este es el único mensaje externo de FirstListen para este periodo." : "We picked a few releases based on your styles. This is FirstListen's only external message for this period."}</p>
          <table style="border-collapse:collapse;width:100%;margin:18px 0">${songCards(songs)}</table>
          <p style="margin:24px 0"><a href="${siteUrl}/guest" style="display:inline-block;background:#b9ff2f;color:#10130d;border-radius:999px;padding:13px 20px;text-decoration:none;font-weight:900">${spanish ? "Escuchar en FirstListen" : "Listen on FirstListen"}</a></p>
          <p style="color:#8f979f;font-size:11px;line-height:1.55">${spanish ? "Recibes este correo porque lo autorizaste. FirstListen no enviará correo y notificación push por el mismo evento." : "You receive this because you opted in. FirstListen will not send email and push for the same event."}</p>
          <p style="color:#8f979f;font-size:11px;line-height:1.55"><a href="${safeUnsubscribeUrl}" style="color:#b9ff2f">${spanish ? "Cancelar correos" : "Unsubscribe from email"}</a><br>${safePostalAddress}</p>
        </div>
      </div>`,
      subject: spanish
        ? "Hay música nueva para descubrir en FirstListen"
        : "New music to discover on FirstListen",
      tags: [{ name: "category", value: "conservative_music_digest" }],
      to: [email],
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `communications/${eventKey}`,
    },
    method: "POST",
  });
  if (!response.ok) throw new Error(`Digest delivery failed (${response.status}).`);
  const payload = (await response.json()) as { id?: string };
  if (!payload.id) throw new Error("Digest delivery returned no email ID.");
  return payload.id;
}

export async function sendInactiveReminderEmail({
  email,
  eventKey,
  locale,
  unsubscribeUrl,
}: {
  email: string;
  eventKey: string;
  locale: "en" | "es";
  unsubscribeUrl: string;
}) {
  const { apiKey, from, postalAddress } = emailConfig();
  const spanish = locale === "es";
  const siteUrl = communicationsSiteUrl();
  const userId = verifyCommunicationToken(new URL(unsubscribeUrl).searchParams.get("token") ?? "");
  if (!userId) throw new Error("Invalid unsubscribe URL.");
  const oneClickUrl = communicationOneClickUnsubscribeUrl(userId);
  const safeUnsubscribeUrl = escapeCommunicationHtml(unsubscribeUrl);
  const safePostalAddress = escapeCommunicationHtml(postalAddress);
  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from,
      headers: {
        "List-Unsubscribe": `<${oneClickUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      html: `<div style="background:#0d0f11;padding:30px 14px;font-family:Arial,sans-serif;color:#f4f6f2">
        <div style="max-width:560px;margin:0 auto;background:#171a1e;border:1px solid #343a40;border-radius:22px;padding:26px">
          <p style="font-size:11px;font-weight:900;letter-spacing:.14em;color:#b9ff2f">FIRST LISTEN</p>
          <h1 style="font-size:27px;line-height:1.15;margin:16px 0 9px">${spanish ? "Tu comunidad tiene música nueva" : "Your community has new music"}</h1>
          <p style="color:#c3c9cf;line-height:1.55">${spanish ? "Hace tiempo que no visitas FirstListen. Si quieres, vuelve a descubrir canciones según tus preferencias. No necesitas publicar nada ni completar tareas." : "It has been a while since your last FirstListen visit. Come back whenever you want to discover music based on your preferences. No tasks or publishing are required."}</p>
          <p style="margin:24px 0"><a href="${siteUrl}/guest" style="display:inline-block;background:#b9ff2f;color:#10130d;border-radius:999px;padding:13px 20px;text-decoration:none;font-weight:900">${spanish ? "Volver a FirstListen" : "Return to FirstListen"}</a></p>
          <p style="color:#8f979f;font-size:11px;line-height:1.55">${spanish ? "Este recordatorio es opcional y se limita según la frecuencia que elegiste." : "This optional reminder follows the frequency you selected."}</p>
          <p style="color:#8f979f;font-size:11px;line-height:1.55"><a href="${safeUnsubscribeUrl}" style="color:#b9ff2f">${spanish ? "Cancelar correos" : "Unsubscribe from email"}</a><br>${safePostalAddress}</p>
        </div>
      </div>`,
      subject: spanish
        ? "Hay música nueva esperándote en FirstListen"
        : "New music is waiting on FirstListen",
      tags: [{ name: "category", value: "inactive_community_reminder" }],
      to: [email],
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `communications/${eventKey}`,
    },
    method: "POST",
  });
  if (!response.ok) throw new Error(`Reminder delivery failed (${response.status}).`);
  const payload = (await response.json()) as { id?: string };
  if (!payload.id) throw new Error("Reminder delivery returned no email ID.");
  return payload.id;
}
