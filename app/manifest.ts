import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "First Listen",
    short_name: "First Listen",
    description:
      "Honest music feedback and verified listener support for independent artists.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f4ee",
    theme_color: "#171a18",
    icons: [
      {
        src: "/icons/first-listen-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/first-listen-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
