export function GET() {
  return Response.json({
    background_color: "#050505",
    description:
      "Pagina oficial de DJ Carlos Jimenez: album, Top Ten y videos oficiales.",
    display: "standalone",
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
    name: "DJ Carlos Jimenez",
    scope: "/DJCarlosJimenez",
    short_name: "DJ Carlos",
    start_url: "/DJCarlosJimenez",
    theme_color: "#f6c84f",
  });
}
