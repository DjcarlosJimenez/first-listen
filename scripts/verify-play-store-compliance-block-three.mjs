import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const production = process.argv.includes("--production");

const declarations = JSON.parse(
  fs.readFileSync(
    path.join(root, "android/play-console-declarations.json"),
    "utf8",
  ),
);
const privacy = fs.readFileSync(
  path.join(root, "app/privacy/page.tsx"),
  "utf8",
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const nextConfig = fs.readFileSync(
  path.join(root, "next.config.ts"),
  "utf8",
);
const guide = fs.readFileSync(
  path.join(root, "docs/play-store-data-safety.md"),
  "utf8",
);

assert.equal(declarations.applicationId, "net.firstlisten.app");
assert.equal(declarations.ads.containsAds, false);
assert.equal(declarations.ads.advertisingSdkPresent, false);
assert.equal(declarations.dataSafety.collectsData, true);
assert.equal(declarations.dataSafety.encryptedInTransit, true);
assert.equal(declarations.dataSafety.accountDeletionAvailable, true);
assert.equal(declarations.appAccess.reviewerAccountRequired, true);
assert.equal(declarations.targetAudience.ownerConfirmationRequired, false);
assert.deepEqual(declarations.targetAudience.confirmedAgeGroups, ["18 and over"]);
assert.equal(declarations.permissions.camera, false);
assert.equal(declarations.permissions.microphone, false);
assert.equal(declarations.permissions.location, false);

const declaredTypes = new Set(
  declarations.dataSafety.dataTypes.map(
    (entry) => `${entry.category} > ${entry.type}`,
  ),
);
for (const requiredType of [
  "Personal info > Name",
  "Personal info > Email address",
  "Personal info > User IDs",
  "Photos and videos > Photos",
  "Audio files > Music and audio files",
  "App activity > App interactions",
  "App activity > Other user-generated content",
  "App activity > Other actions",
  "Device or other IDs > Device or other IDs",
]) {
  assert.ok(declaredTypes.has(requiredType), `Missing ${requiredType}`);
}

assert.match(privacy, /aplicación Android oficial de First Listen/);
assert.match(privacy, /adelantos de audio cortos/);
assert.match(privacy, /identificadores aleatorios de visitante y sesión/);
assert.match(privacy, /resúmenes irreversibles \(hashes\)/);
assert.match(privacy, /No vendemos datos personales/);
assert.match(privacy, /https:\/\/www\.firstlisten\.net\/delete-account|href="\/delete-account"/);
assert.match(nextConfig, /camera=\(\), microphone=\(\), geolocation=\(\)/);
assert.match(guide, /18 and over/);
assert.match(guide, /No se deben guardar esas credenciales en GitHub/);

const dependencyNames = Object.keys({
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
}).join("\n");
assert.doesNotMatch(
  dependencyNames,
  /admob|google-ads|doubleclick|facebook-sdk|appsflyer|adjust-sdk/i,
);

const result = {
  ads: "not-present",
  applicationId: declarations.applicationId,
  dataTypes: declaredTypes.size,
  ownerDecisionRequired: false,
  targetAudience: "18 and over",
  privacy: "aligned",
  status: "passed",
};

if (production) {
  const origin = "https://www.firstlisten.net";
  const [privacyResponse, deletionResponse, readinessResponse] =
    await Promise.all([
      fetch(`${origin}/privacy`, { cache: "no-store", redirect: "follow" }),
      fetch(`${origin}/delete-account`, { cache: "no-store", redirect: "follow" }),
      fetch(`${origin}/api/android-readiness`, { cache: "no-store" }),
    ]);

  assert.equal(privacyResponse.status, 200);
  assert.equal(deletionResponse.status, 200);
  assert.equal(readinessResponse.status, 200);

  const livePrivacy = await privacyResponse.text();
  assert.match(livePrivacy, /adelantos de audio cortos/);
  assert.match(livePrivacy, /No vendemos datos personales/);

  result.production = {
    accountDeletionUrl: `${origin}/delete-account`,
    privacyPolicyUrl: `${origin}/privacy`,
    status: "reachable-and-aligned",
  };
}

console.log(JSON.stringify(result, null, 2));
