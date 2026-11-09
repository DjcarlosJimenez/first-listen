import { NextRequest, NextResponse } from "next/server";
import { verifyCommunicationToken } from "@/lib/communications";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  let bodyToken = "";
  let shouldRedirect = false;
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    bodyToken = String(form.get("token") ?? "");
    shouldRedirect = form.get("redirect") === "1";
  } else if (contentType.includes("application/json")) {
    const payload = (await request.json().catch(() => null)) as { token?: string } | null;
    bodyToken = String(payload?.token ?? "");
  }
  const token = bodyToken || request.nextUrl.searchParams.get("token") || "";
  const userId = verifyCommunicationToken(token);
  if (!userId) {
    if (shouldRedirect) {
      return NextResponse.redirect(new URL("/communications/unsubscribed?status=invalid", request.url), 303);
    }
    return NextResponse.json({ error: "Invalid unsubscribe token" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("user_notification_preferences")
    .upsert(
      {
        email_consent_at: null,
        email_music_digest_enabled: false,
        email_unsubscribed_at: now,
        inactive_community_reminders: false,
        reminder_consent_at: null,
        updated_at: now,
        user_id: userId,
      },
      { onConflict: "user_id" },
    );
  if (error) {
    return NextResponse.json({ error: "Unable to update preferences" }, { status: 500 });
  }
  if (shouldRedirect) {
    return NextResponse.redirect(new URL("/communications/unsubscribed", request.url), 303);
  }
  return NextResponse.json({ status: "unsubscribed" });
}
