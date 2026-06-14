import { ProtectedAppPage } from "@/components/protected-app-page";

export const dynamic = "force-dynamic";

export default async function DiscoverGenrePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <ProtectedAppPage
      discoveryDestination={{ slug, type: "genre" }}
      initialView="dashboard"
      loginRedirectPath={`/discover/genre/${slug}`}
    />
  );
}
