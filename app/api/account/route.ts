import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: { email?: unknown; confirmation?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; confirmation?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const confirmation = String(body.confirmation ?? "").trim().toUpperCase();
  if (email !== user.email.trim().toLowerCase()) {
    return NextResponse.json(
      { error: "The email does not match the signed-in account." },
      { status: 400 },
    );
  }
  if (confirmation !== "ELIMINAR" && confirmation !== "DELETE") {
    return NextResponse.json(
      { error: "Type ELIMINAR to confirm permanent deletion." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  await admin.from("admin_audit_log").insert({
    actor_id: user.id,
    action: "self_delete_account",
    target_type: "auth_user",
    target_id: user.id,
    details: { source: "in_app_account_deletion" },
  });

  const { error } = await admin.auth.admin.deleteUser(user.id, false);
  if (error) {
    return NextResponse.json(
      { error: "We could not delete the account. Contact support@firstlisten.net." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { deleted: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
