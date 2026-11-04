import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const production = process.argv.includes("--production");

const androidConfig = JSON.parse(
  fs.readFileSync(path.join(root, "android/first-listen-android.json"), "utf8"),
);
const appConfig = fs.readFileSync(
  path.join(root, "lib/android-app-config.ts"),
  "utf8",
);
const assetLinksRoute = fs.readFileSync(
  path.join(root, "app/.well-known/assetlinks.json/route.ts"),
  "utf8",
);
const readinessRoute = fs.readFileSync(
  path.join(root, "app/api/android-readiness/route.ts"),
  "utf8",
);
const manifest = fs.readFileSync(path.join(root, "app/manifest.ts"), "utf8");
const serviceWorker = fs.readFileSync(
  path.join(root, "public/service-worker.js"),
  "utf8",
);

assert.equal(androidConfig.applicationId, "net.firstlisten.app");
assert.equal(androidConfig.origin, "https://www.firstlisten.net");
assert.equal(androidConfig.targetSdk, 36);
assert.equal(androidConfig.minSdk, 23);
assert.match(androidConfig.startUrl, /\/guest\?source=android-app$/);
assert.match(appConfig, /delegate_permission\/common\.handle_all_urls/);
assert.match(appConfig, /ANDROID_SHA256_FINGERPRINTS/);
assert.match(assetLinksRoute, /buildAndroidAssetLinks/);
assert.match(readinessRoute, /awaiting_signing_certificate/);
assert.match(manifest, /display:\s*"standalone"/);
assert.match(manifest, /first-listen-192x192\.png/);
assert.match(manifest, /first-listen-512x512\.png/);
assert.match(serviceWorker, /OFFLINE_URL/);
assert.match(serviceWorker, /self\.addEventListener\("install"/);
assert.match(serviceWorker, /self\.addEventListener\("fetch"/);

const result = {
  applicationId: androidConfig.applicationId,
  assetLinksRoute: "ready",
  manifest: "ready",
  offlineShell: "ready",
  status: "passed",
  targetSdk: androidConfig.targetSdk,
};

if (production) {
  const [manifestResponse, serviceWorkerResponse, offlineResponse, readinessResponse, assetLinksResponse] =
    await Promise.all([
      fetch(`${androidConfig.origin}/manifest.webmanifest`, { cache: "no-store" }),
      fetch(`${androidConfig.origin}/service-worker.js`, { cache: "no-store" }),
      fetch(`${androidConfig.origin}/offline`, { cache: "no-store" }),
      fetch(`${androidConfig.origin}/api/android-readiness`, { cache: "no-store" }),
      fetch(`${androidConfig.origin}/.well-known/assetlinks.json`, { cache: "no-store" }),
    ]);

  assert.equal(manifestResponse.status, 200);
  assert.equal(serviceWorkerResponse.status, 200);
  assert.equal(offlineResponse.status, 200);
  assert.equal(readinessResponse.status, 200);
  assert.equal(assetLinksResponse.status, 200);

  const liveReadiness = await readinessResponse.json();
  assert.equal(liveReadiness.applicationId, androidConfig.applicationId);
  assert.equal(liveReadiness.targetSdk, androidConfig.targetSdk);
  assert.equal(liveReadiness.startUrl, androidConfig.startUrl);

  const liveAssetLinks = await assetLinksResponse.json();
  assert.ok(Array.isArray(liveAssetLinks));

  result.production = {
    assetLinksStatements: liveAssetLinks.length,
    associationConfigured: liveReadiness.associationConfigured,
    status: liveReadiness.status,
  };
}

console.log(JSON.stringify(result, null, 2));
