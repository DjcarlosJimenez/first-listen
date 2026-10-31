import { NextResponse } from "next/server";
import { getAppVersion } from "@/lib/app-version";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    { version: getAppVersion() },
    {
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
      },
    },
  );
}
