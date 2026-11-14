export const FIRST_LISTEN_BRAND_VERSION = "official-mark-20261113";

export function firstListenBrandAsset(path: string) {
  return `${path}?v=${FIRST_LISTEN_BRAND_VERSION}`;
}
