import type { MetadataRoute } from "next";

import { DJ_CARLOS_LOGO_URL } from "@/lib/dj-carlos-page";

const DJ_CARLOS_ICON_192_URL = "/artist/dj-carlos-jimenez/icon-192.png";
const DJ_CARLOS_ICON_512_URL = "/artist/dj-carlos-jimenez/icon-512.png";

export function createDjCarlosManifest({
  rootScope = false,
}: {
  rootScope?: boolean;
} = {}): MetadataRoute.Manifest {
  const startUrl = rootScope ? "/" : "/DJCarlosJimenez";
  const scope = rootScope ? "/" : "/DJCarlosJimenez";
  const id = rootScope ? "/" : "/DJCarlosJimenez";

  return {
    background_color: "#050505",
    description:
      "Pagina oficial de DJ Carlos Jimenez: album, Top Ten y videos oficiales.",
    categories: ["music", "entertainment"],
    dir: "ltr",
    display: "standalone",
    display_override: ["standalone", "minimal-ui", "browser"],
    icons: [
      {
        purpose: "maskable",
        sizes: "192x192",
        src: DJ_CARLOS_ICON_192_URL,
        type: "image/png",
      },
      {
        purpose: "maskable",
        sizes: "512x512",
        src: DJ_CARLOS_ICON_512_URL,
        type: "image/png",
      },
    ],
    id,
    lang: "es-US",
    name: "DJ Carlos Jimenez",
    orientation: "any",
    screenshots: [
      {
        form_factor: "narrow",
        label: "DJ Carlos Jimenez",
        sizes: "512x512",
        src: DJ_CARLOS_ICON_512_URL,
        type: "image/png",
      },
    ],
    shortcuts: [
      {
        description: "Abrir la pagina oficial de DJ Carlos",
        icons: [
          {
            sizes: "192x192",
            src: DJ_CARLOS_ICON_192_URL,
            type: "image/png",
          },
        ],
        name: "Pagina oficial",
        short_name: "DJ Carlos",
        url: startUrl,
      },
    ],
    scope,
    short_name: "DJ Carlos",
    start_url: startUrl,
    theme_color: "#f6c84f",
  };
}

export const DJ_CARLOS_MANIFEST_ICON_URL = DJ_CARLOS_ICON_192_URL;
export const DJ_CARLOS_MANIFEST_LOGO_URL = DJ_CARLOS_LOGO_URL;
