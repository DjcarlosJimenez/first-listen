export function GET() {
  const manifest = {
    background_color: "#050505",
    description:
      "Pagina oficial de DJ Carlos Jimenez: album, Top Ten y videos oficiales.",
    categories: ["music", "entertainment"],
    dir: "ltr",
    display: "standalone",
    display_override: ["standalone", "minimal-ui", "browser"],
    icons: [
      {
        purpose: "any maskable",
        sizes: "192x192",
        src: "/artist/dj-carlos-jimenez/icon-192.png",
        type: "image/png",
      },
      {
        purpose: "any maskable",
        sizes: "512x512",
        src: "/artist/dj-carlos-jimenez/icon-512.png",
        type: "image/png",
      },
    ],
    id: "/DJCarlosJimenez",
    lang: "es-US",
    name: "DJ Carlos Jimenez",
    orientation: "any",
    screenshots: [
      {
        form_factor: "narrow",
        label: "DJ Carlos Jimenez",
        sizes: "512x512",
        src: "/artist/dj-carlos-jimenez/icon-512.png",
        type: "image/png",
      },
    ],
    shortcuts: [
      {
        description: "Abrir la pagina oficial de DJ Carlos",
        icons: [
          {
            sizes: "192x192",
            src: "/artist/dj-carlos-jimenez/icon-192.png",
            type: "image/png",
          },
        ],
        name: "Pagina oficial",
        short_name: "DJ Carlos",
        url: "/DJCarlosJimenez",
      },
    ],
    scope: "/DJCarlosJimenez",
    short_name: "DJ Carlos",
    start_url: "/DJCarlosJimenez",
    theme_color: "#f6c84f",
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Content-Type": "application/manifest+json; charset=utf-8",
    },
  });
}
