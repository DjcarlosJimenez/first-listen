import { createHash, timingSafeEqual } from "crypto";

export const DJ_CARLOS_ADMIN_COOKIE_NAME = "dj_carlos_admin_session";
export const DJ_CARLOS_ADMIN_COOKIE_PATH = "/DJCarlosJimenez";
export const DJ_CARLOS_ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 45;

const DEVELOPMENT_PASSWORD = "DJCarlos2027!";

function expectedPassword() {
  const configured = process.env.DJ_CARLOS_ADMIN_PASSWORD?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? "" : DEVELOPMENT_PASSWORD;
}

function sessionSecret() {
  return (
    process.env.DJ_CARLOS_ADMIN_SESSION_SECRET?.trim() ||
    expectedPassword()
  );
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(a: string, b: string) {
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}

export function verifyDjCarlosAdminPassword(password: string) {
  const expected = expectedPassword();
  return Boolean(expected) && safeEqual(digest(password), digest(expected));
}

export function createDjCarlosAdminSession() {
  const issuedAt = Math.floor(Date.now() / 1000);
  const secret = sessionSecret();
  const signature = digest(`${issuedAt}:${secret}`);
  return `${issuedAt}.${signature}`;
}

export function isDjCarlosAdminSession(value: string | undefined) {
  const secret = sessionSecret();
  if (!value || !secret) return false;
  const [rawIssuedAt, signature] = value.split(".");
  const issuedAt = Number(rawIssuedAt);
  if (!Number.isFinite(issuedAt) || !signature) return false;

  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now + 60) return false;
  if (now - issuedAt > DJ_CARLOS_ADMIN_SESSION_MAX_AGE_SECONDS) return false;

  return safeEqual(signature, digest(`${issuedAt}:${secret}`));
}

export function hasDjCarlosAdminSession(
  cookies: Array<{ value?: string }>,
) {
  return cookies.some((cookie) => isDjCarlosAdminSession(cookie.value));
}

export function isDjCarlosAdminPasswordReady() {
  return Boolean(expectedPassword());
}
