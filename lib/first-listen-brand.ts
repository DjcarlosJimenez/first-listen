export const FIRST_LISTEN_BRAND_VERSION = "blue-chrome-20261112";

export function firstListenBrandAsset(path: string) {
  return `${path}?v=${FIRST_LISTEN_BRAND_VERSION}`;
}
