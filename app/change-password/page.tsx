import { ChangePasswordForm } from "@/components/change-password-form";

export const dynamic = "force-dynamic";

function safeNextPath(value: string | string[] | undefined) {
  const path = Array.isArray(value) ? value[0] : value;
  return path?.startsWith("/") && !path.startsWith("//")
    ? path
    : "/dashboard";
}

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  return <ChangePasswordForm nextPath={safeNextPath(query.next)} />;
}
