import { ProtectedAppPage } from "@/components/protected-app-page";

export const dynamic = "force-dynamic";

export default function DiscoverGenresPage() {
  return (
    <ProtectedAppPage
      discoveryDestination={{ type: "genres" }}
      initialView="dashboard"
      loginRedirectPath="/discover/genres"
    />
  );
}
