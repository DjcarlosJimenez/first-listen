import { ProtectedAppPage } from "@/components/protected-app-page";

export const dynamic = "force-dynamic";

export default function SubmitPage() {
  return <ProtectedAppPage initialView="submit" />;
}
