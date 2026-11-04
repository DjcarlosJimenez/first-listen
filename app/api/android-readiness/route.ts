import { NextResponse } from "next/server";
import {
  ANDROID_APP_CONFIG,
  getAndroidSigningFingerprints,
} from "@/lib/android-app-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const signingFingerprints = getAndroidSigningFingerprints();

  return NextResponse.json(
    {
      appName: ANDROID_APP_CONFIG.displayName,
      applicationId: ANDROID_APP_CONFIG.applicationId,
      associationConfigured: signingFingerprints.length > 0,
      assetLinksUrl: `${ANDROID_APP_CONFIG.origin}${ANDROID_APP_CONFIG.assetLinksPath}`,
      manifestUrl: `${ANDROID_APP_CONFIG.origin}${ANDROID_APP_CONFIG.manifestPath}`,
      minSdk: ANDROID_APP_CONFIG.minSdk,
      origin: ANDROID_APP_CONFIG.origin,
      startUrl: `${ANDROID_APP_CONFIG.origin}${ANDROID_APP_CONFIG.startPath}`,
      status:
        signingFingerprints.length > 0
          ? "domain_association_ready"
          : "awaiting_signing_certificate",
      targetSdk: ANDROID_APP_CONFIG.targetSdk,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
