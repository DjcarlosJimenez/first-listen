import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function WorkspaceV2Page() {
  redirect("/dashboard");
}
