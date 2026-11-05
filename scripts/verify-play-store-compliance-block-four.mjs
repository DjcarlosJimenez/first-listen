import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const artifactRequired = process.argv.includes("--artifact");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const twaManifest = JSON.parse(read("android/twa/twa-manifest.json"));
const declarations = JSON.parse(read("android/play-console-declarations.json"));
const appGradle = read("android/twa/app/build.gradle");
const androidManifest = read("android/twa/app/src/main/AndroidManifest.xml");
const buildScript = read("scripts/build-first-listen-android.ps1");

assert.equal(twaManifest.packageId, "net.firstlisten.app");
assert.equal(twaManifest.startUrl, "/guest?source=android-app");
assert.equal(twaManifest.appVersionCode, 1);
assert.equal(twaManifest.appVersionName, "1");
assert.equal(twaManifest.minSdkVersion, 24);
assert.equal(twaManifest.enableNotifications, false);
assert.equal(twaManifest.features.playBilling, undefined);
assert.equal(twaManifest.features.locationDelegation, undefined);
assert.equal(path.isAbsolute(twaManifest.signingKey.path), false);

assert.match(appGradle, /compileSdkVersion 36/);
assert.match(appGradle, /targetSdkVersion 36/);
assert.match(appGradle, /minSdkVersion 24/);
assert.match(appGradle, /enableNotifications: false/);
assert.doesNotMatch(androidManifest, /POST_NOTIFICATIONS/);
assert.doesNotMatch(androidManifest, /ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION/);
assert.doesNotMatch(androidManifest, /CAMERA|RECORD_AUDIO/);

assert.equal(declarations.targetAudience.ownerConfirmationRequired, false);
assert.deepEqual(declarations.targetAudience.confirmedAgeGroups, ["18 and over"]);
assert.match(buildScript, /BUBBLEWRAP_KEYSTORE_PASSWORD/);
assert.match(buildScript, /ProtectedData\]::Unprotect/);
assert.match(buildScript, /storepass:env BUBBLEWRAP_KEYSTORE_PASSWORD/);
assert.match(buildScript, /ks-pass env:BUBBLEWRAP_KEYSTORE_PASSWORD/);
assert.doesNotMatch(buildScript, /first-listen-upload-password\s*=/i);

const forbiddenPrivateFiles = [];
function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", ".next", "node_modules", "build"].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) scan(fullPath);
    else if (/\.(jks|keystore|dpapi)$/i.test(entry.name)) forbiddenPrivateFiles.push(fullPath);
  }
}
scan(root);
assert.deepEqual(forbiddenPrivateFiles, []);

const bundlePath = path.join(root, "artifacts/android/First-Listen-v1.aab");
const bundleReady = fs.existsSync(bundlePath) && fs.statSync(bundlePath).size > 100_000;
if (artifactRequired) assert.equal(bundleReady, true, "Signed AAB is missing");

console.log(JSON.stringify({
  applicationId: twaManifest.packageId,
  bundleReady,
  notifications: "disabled",
  privateSigningFilesInRepository: forbiddenPrivateFiles.length,
  status: "passed",
  targetAudience: declarations.targetAudience.confirmedAgeGroups,
  targetSdk: 36,
}, null, 2));
