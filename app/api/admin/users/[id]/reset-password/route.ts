import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
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
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const temporaryPassword = `${randomBytes(12).toString("base64url")}Aa1!`;
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(id, {
    password: temporaryPassword,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { error: profileError } = await admin
    .from("profiles")
    .update({ force_password_change: true, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  return NextResponse.json({ temporaryPassword });
}
