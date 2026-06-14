import { ProtectedAppPage } from "@/components/protected-app-page";

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  return <ProtectedAppPage initialView="profile" loginRedirectPath="/profile" />;
}
