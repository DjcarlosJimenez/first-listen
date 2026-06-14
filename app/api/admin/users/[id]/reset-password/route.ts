import { NextResponse } from "next/server";
import { hasOwnerAccess } from "@/lib/admin-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, founder_number")
    .eq("id", user.id)
    .single();
  if (!hasOwnerAccess(profile, user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const admin = createAdminClient();
  const { data: targetData, error: targetError } =
    await admin.auth.admin.getUserById(id);
  if (targetError || !targetData.user?.email) {
    return NextResponse.json(
      { error: targetError?.message ?? "User email is unavailable." },
      { status: 400 },
    );
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    "https://www.firstlisten.net";
  const { error: recoveryError } = await admin.auth.resetPasswordForEmail(
    targetData.user.email,
    {
      redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
    },
  );
  if (recoveryError) {
    return NextResponse.json({ error: recoveryError.message }, { status: 400 });
  }

  const { error: auditError } = await admin.from("admin_audit_log").insert({
    actor_id: user.id,
    action: "send_password_recovery",
    target_type: "profile",
    target_id: id,
    details: { delivery: "email" },
  });
  if (auditError) {
    return NextResponse.json({ error: auditError.message }, { status: 500 });
  }

  return NextResponse.json({ sent: true });
}
