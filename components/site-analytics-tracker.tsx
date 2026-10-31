"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const VISITOR_KEY = "first-listen:analytics-visitor";
const SESSION_KEY = "first-listen:analytics-session";
const PRIVATE_PREFIXES = [
  "/admin",
  "/api",
  "/artist-analytics-preview",
  "/dashboard",
  "/login",
  "/owner",
  "/reset-password",
  "/signup",
  "/workspace-v2",
];
const PLATFORM_PREFIXES = new Set([
  "",
  "auth",
  "change-password",
  "discover",
  "explicit-content",
  "forgot-password",
  "guest",
  "guidelines",
  "help",
  "home",
  "legacy",
  "offline",
  "paginas-de-artistas",
  "privacy",
  "profile",
  "review",
  "submit",
  "terms",
  "verify-email",
]);

function randomId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function storedId(storage: Storage, key: string) {
  const current = storage.getItem(key);
  if (current && /^[a-zA-Z0-9_-]{16,100}$/.test(current)) return current;
  const next = randomId();
  storage.setItem(key, next);
  return next;
}

function analyticsTarget(pathname: string) {
  const cleanPath = pathname || "/";
  if (
    PRIVATE_PREFIXES.some((prefix) => cleanPath.startsWith(prefix))
    || cleanPath.includes("/admin")
    || cleanPath.includes("/analytics")
  ) return null;
  const firstSegment = cleanPath.split("/").filter(Boolean)[0] ?? "";
  if (firstSegment.toLowerCase() === "djcarlosjimenez") {
    return { artistSlug: "djcarlosjimenez", scope: "artist" as const };
  }
  if (!PLATFORM_PREFIXES.has(firstSegment.toLowerCase())) {
    return { artistSlug: firstSegment.toLowerCase(), scope: "artist" as const };
  }
  return { artistSlug: "", scope: "platform" as const };
}

function contentKind(pathname: string, scope: "artist" | "platform") {
  if (/\/album\//i.test(pathname)) return "Album";
  if (/video/i.test(pathname)) return "Video";
  return scope === "artist" ? "Artista" : "Pagina";
}

export function SiteAnalyticsTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const target = analyticsTarget(pathname);
    if (!target) return;

    let visitorId = "";
    let sessionId = "";
    try {
      visitorId = storedId(window.localStorage, VISITOR_KEY);
      sessionId = storedId(window.sessionStorage, SESSION_KEY);
    } catch {
      visitorId = randomId();
      sessionId = randomId();
    }

    const basePayload = {
      artistSlug: target.artistSlug,
      contentKind: contentKind(pathname, target.scope),
      contentLabel: document.title.split("|")[0]?.trim() || pathname,
      path: pathname,
      referrer: document.referrer,
      scope: target.scope,
      sessionId,
      visitorId,
    };
    const send = (eventType: "action" | "page_view", label?: string) => {
      const payload = JSON.stringify({
        ...basePayload,
        contentKind: eventType === "action" ? "Accion" : basePayload.contentKind,
        contentLabel: label || basePayload.contentLabel,
        eventType,
      });
      void fetch("/api/analytics/event", {
        body: payload,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        method: "POST",
      }).catch(() => undefined);
    };

    const pageKey = `first-listen:analytics-page:${pathname}`;
    try {
      if (window.sessionStorage.getItem(pageKey) !== "counted") {
        window.sessionStorage.setItem(pageKey, "counted");
        send("page_view");
      }
    } catch {
      send("page_view");
    }

    const onClick = (event: MouseEvent) => {
      const element = event.target instanceof Element
        ? event.target.closest("button,a")
        : null;
      if (!element) return;
      const label = (
        element.getAttribute("aria-label")
        || element.getAttribute("title")
        || element.textContent
        || "Interaccion"
      ).trim().replace(/\s+/g, " ").slice(0, 180);
      send("action", label || "Interaccion");
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [pathname]);

  return null;
}
