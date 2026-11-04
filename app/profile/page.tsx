import { WorkspaceV2AuthEntry } from "@/components/workspace-v2/workspace-v2-auth-entry";

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  return <WorkspaceV2AuthEntry loginRedirectPath="/profile" profileOnly />;
}
