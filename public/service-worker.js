const CACHE_VERSION = "first-listen-pwa-v14-dj-carlos-links";
const BRAND_VERSION = "blue-chrome-20261112";
const OFFLINE_URL = "/offline";
const APP_SHELL = [
  OFFLINE_URL,
  `/manifest.webmanifest?v=${BRAND_VERSION}`,
  "/DJCarlosJimenez/manifest.webmanifest",
  `/icons/first-listen-180x180.png?v=${BRAND_VERSION}`,
  `/icons/first-listen-192x192.png?v=${BRAND_VERSION}`,
  `/icons/first-listen-512x512.png?v=${BRAND_VERSION}`,
  `/icons/first-listen-maskable-192x192.png?v=${BRAND_VERSION}`,
  `/icons/first-listen-maskable-512x512.png?v=${BRAND_VERSION}`,
  `/brand/first-listen-wordmark.png?v=${BRAND_VERSION}`,
  `/brand/first-listen-emblem.png?v=${BRAND_VERSION}`,
  "/artist/dj-carlos-jimenez/icon-192.png?v=blue-20261112",
  "/artist/dj-carlos-jimenez/icon-512.png?v=blue-20261112",
  "/artist/dj-carlos-jimenez/logo.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("first-listen-pwa-") && key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_VERSION);
        return cache.match(OFFLINE_URL);
      }),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/artist/dj-carlos-jimenez/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.endsWith("/manifest.webmanifest") ||
    /\/pwa-icon\/(192|512)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});
