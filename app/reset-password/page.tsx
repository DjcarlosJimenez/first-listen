import { ResetPasswordForm } from "@/components/reset-password-form";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const params = await searchParams;
  const tokenHash =
    params.type === "recovery" && typeof params.token_hash === "string"
      ? params.token_hash
      : "";
  return <ResetPasswordForm initialTokenHash={tokenHash} />;
}
