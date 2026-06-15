import { WorkspaceV2AuthEntry } from "@/components/workspace-v2/workspace-v2-auth-entry";

export const dynamic = "force-dynamic";

export default function WorkspaceV2Page() {
  return <WorkspaceV2AuthEntry loginRedirectPath="/workspace-v2" />;
}
