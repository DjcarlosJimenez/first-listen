import { permanentRedirect } from "next/navigation";

type RouteSearchParams = Record<string, string | string[] | undefined>;

function serializeSearchParams(searchParams: RouteSearchParams) {
  const params = new URLSearchParams();
  Object.entries(searchParams).forEach(([key, value]) => {
    if (typeof value === "string") params.append(key, value);
    else value?.forEach((item) => params.append(key, item));
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export default async function LegacyDjCarlosListenPage({
  searchParams,
}: {
  searchParams: Promise<RouteSearchParams>;
}) {
  permanentRedirect(
    `/DJCarlosJimenez/enlaces${serializeSearchParams(await searchParams)}`,
  );
}
