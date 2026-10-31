import type { Metadata } from "next";
import { FirstPublishVerify } from "@/components/first-publish-verify";
import type { FirstPublishVerificationType } from "@/lib/first-publish";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Confirma tu publicación | First Listen",
};

export default async function FirstPublishVerificationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const tokenHash =
    typeof params.token_hash === "string" ? params.token_hash : "";
  const rawType = typeof params.type === "string" ? params.type : "";
  const type: FirstPublishVerificationType | "" =
    rawType === "signup" || rawType === "magiclink" ? rawType : "";
  return <FirstPublishVerify token={token} tokenHash={tokenHash} type={type} />;
}
