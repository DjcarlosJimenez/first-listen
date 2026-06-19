import { NextResponse } from "next/server";
import { hasOwnerAccess } from "@/lib/admin-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type ResetStage =
  | "authenticate"
  | "authorize"
  | "env_check"
  | "create_admin_client"
  | "get_user_by_id"
  | "reset_password_for_email"
  | "audit_log"
  | "complete";

function logResetDiagnostic(
  requestId: string,
  stage: ResetStage,
  details: Record<string, unknown> = {},
) {
  console.info("[admin-password-reset]", {
    requestId,
    stage,
    ...details,
  });
}

function logResetError(
  requestId: string,
  stage: ResetStage,
  error: unknown,
  details: Record<string, unknown> = {},
) {
  console.error("[admin-password-reset:error]", {
    requestId,
    stage,
    error: error instanceof Error ? error.message : String(error),
    ...details,
  });
}

function resetErrorResponse(
  requestId: string,
  stage: ResetStage,
  message: string,
  status: number,
) {
  return NextResponse.json(
    {
      error: message,
      requestId,
      stage,
    },
    { status },
  );
}

function maskEmail(email?: string | null) {
  if (!email || !email.includes("@")) return null;
  const [local, domain] = email.split("@");
  const visibleLocal = local.slice(0, 2);
  return `${visibleLocal}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  logResetDiagnostic(requestId, "authenticate", { status: "started" });

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) {
    logResetError(requestId, "authenticate", userError);
    return resetErrorResponse(
      requestId,
      "authenticate",
      userError.message,
      401,
    );
  }
  if (!user) {
    logResetDiagnostic(requestId, "authenticate", { status: "unauthorized" });
    return resetErrorResponse(requestId, "authenticate", "Unauthorized", 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, founder_number")
    .eq("id", user.id)
    .single();
  if (profileError) {
    logResetError(requestId, "authorize", profileError, {
      actorId: user.id,
    });
    return resetErrorResponse(
      requestId,
      "authorize",
      profileError.message,
      403,
    );
  }
  if (!hasOwnerAccess(profile, user.email)) {
    logResetDiagnostic(requestId, "authorize", {
      actorId: user.id,
      status: "forbidden",
    });
    return resetErrorResponse(requestId, "authorize", "Forbidden", 403);
  }

  const { id } = await context.params;
  logResetDiagnostic(requestId, "authorize", {
    actorId: user.id,
    role: profile?.role,
    targetId: id,
    status: "authorized",
  });

  const hasSupabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  logResetDiagnostic(requestId, "env_check", {
    hasSupabaseUrl,
    hasServiceRoleKey,
  });
  if (!hasSupabaseUrl || !hasServiceRoleKey) {
    const missing = [
      hasSupabaseUrl ? null : "NEXT_PUBLIC_SUPABASE_URL",
      hasServiceRoleKey ? null : "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean);
    return resetErrorResponse(
      requestId,
      "env_check",
      `Admin password reset is not configured. Missing server environment variable: ${missing.join(", ")}.`,
      500,
    );
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
    logResetDiagnostic(requestId, "create_admin_client", {
      status: "created",
    });
  } catch (error) {
    logResetError(requestId, "create_admin_client", error);
    return resetErrorResponse(
      requestId,
      "create_admin_client",
      error instanceof Error
        ? error.message
        : "Unable to create admin Supabase client.",
      500,
    );
  }

  const { data: targetData, error: targetError } =
    await admin.auth.admin.getUserById(id);
  if (targetError || !targetData.user?.email) {
    logResetError(
      requestId,
      "get_user_by_id",
      targetError ?? "User email is unavailable.",
      { targetId: id },
    );
    return resetErrorResponse(
      requestId,
      "get_user_by_id",
      targetError?.message ?? "User email is unavailable.",
      400,
    );
  }
  logResetDiagnostic(requestId, "get_user_by_id", {
    targetId: id,
    targetEmail: maskEmail(targetData.user.email),
    status: "found",
  });

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    "https://www.firstlisten.net";
  logResetDiagnostic(requestId, "reset_password_for_email", {
    redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
    targetEmail: maskEmail(targetData.user.email),
    status: "requesting",
  });
  const { error: recoveryError } = await admin.auth.resetPasswordForEmail(
    targetData.user.email,
    {
      redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
    },
  );
  if (recoveryError) {
    logResetError(requestId, "reset_password_for_email", recoveryError, {
      targetId: id,
      targetEmail: maskEmail(targetData.user.email),
    });
    return resetErrorResponse(
      requestId,
      "reset_password_for_email",
      recoveryError.message,
      400,
    );
  }
  logResetDiagnostic(requestId, "reset_password_for_email", {
    targetId: id,
    targetEmail: maskEmail(targetData.user.email),
    status: "accepted",
  });

  const { error: auditError } = await admin.from("admin_audit_log").insert({
    actor_id: user.id,
    action: "send_password_recovery",
    target_type: "profile",
    target_id: id,
    details: { delivery: "email" },
  });
  if (auditError) {
    logResetError(requestId, "audit_log", auditError, {
      actorId: user.id,
      targetId: id,
    });
    return resetErrorResponse(
      requestId,
      "audit_log",
      auditError.message,
      500,
    );
  }
  logResetDiagnostic(requestId, "audit_log", {
    actorId: user.id,
    targetId: id,
    status: "inserted",
  });
  logResetDiagnostic(requestId, "complete", {
    targetId: id,
    status: "sent",
  });

  return NextResponse.json({ requestId, sent: true });
}
