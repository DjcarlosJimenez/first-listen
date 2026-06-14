import { ProtectedAppPage } from "@/components/protected-app-page";

export const dynamic = "force-dynamic";

export default function ReviewPage() {
  return <ProtectedAppPage initialView="queue" loginRedirectPath="/review" />;
}
