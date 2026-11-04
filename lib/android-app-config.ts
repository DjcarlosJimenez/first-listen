export const ANDROID_APP_CONFIG = Object.freeze({
  applicationId: "net.firstlisten.app",
  assetLinksPath: "/.well-known/assetlinks.json",
  displayName: "First Listen",
  manifestPath: "/manifest.webmanifest",
  minSdk: 23,
  origin: "https://www.firstlisten.net",
  scopePath: "/",
  startPath: "/guest?source=android-app",
  targetSdk: 36,
});

const SHA256_FINGERPRINT = /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/;

export function getAndroidSigningFingerprints() {
  return (process.env.ANDROID_SHA256_FINGERPRINTS ?? "")
    .split(/[;,\n]/)
    .map((value) => value.trim().toUpperCase())
    .filter((value, index, values) =>
      SHA256_FINGERPRINT.test(value) && values.indexOf(value) === index,
    );
}

export function buildAndroidAssetLinks() {
  const fingerprints = getAndroidSigningFingerprints();
  if (!fingerprints.length) return [];

  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_APP_CONFIG.applicationId,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}
