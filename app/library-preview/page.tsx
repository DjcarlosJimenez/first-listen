import { notFound } from "next/navigation";
import { WorkspaceV2GuestEntry } from "@/components/workspace-v2/workspace-v2-guest-entry";

export const dynamic = "force-dynamic";

export default function LibraryPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <WorkspaceV2GuestEntry experience="library-preview" />;
}
