import { NextResponse } from "next/server";
import { buildAndroidAssetLinks } from "@/lib/android-app-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(buildAndroidAssetLinks(), {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}
