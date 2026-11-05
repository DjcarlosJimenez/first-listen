export const ANDROID_APP_CONFIG = Object.freeze({
  applicationId: "net.firstlisten.app",
  assetLinksPath: "/.well-known/assetlinks.json",
  displayName: "First Listen",
  manifestPath: "/manifest.webmanifest",
  minSdk: 24,
  origin: "https://www.firstlisten.net",
  scopePath: "/",
  startPath: "/guest?source=android-app",
  targetSdk: 36,
  uploadCertificateSha256:
    "DD:5E:50:1A:39:10:44:2B:23:78:7E:C3:5D:2C:71:AD:6D:B7:69:D5:46:68:D2:B3:D2:37:0A:2D:DE:05:1F:AB",
});

const SHA256_FINGERPRINT = /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/;

export function getAndroidSigningFingerprints() {
  return [
    ANDROID_APP_CONFIG.uploadCertificateSha256,
    ...(process.env.ANDROID_SHA256_FINGERPRINTS ?? "").split(/[;,\n]/),
  ]
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
