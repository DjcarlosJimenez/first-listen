import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "First Listen",
    short_name: "First Listen",
    description:
      "Honest music feedback and verified listener support for independent artists.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui", "browser"],
    background_color: "#f3f4ee",
    theme_color: "#171a18",
    orientation: "any",
    categories: ["music", "entertainment", "social"],
    icons: [
      {
        src: "/icons/first-listen-180x180.png",
        sizes: "180x180",
        type: "image/png",
      },
      {
        src: "/icons/first-listen-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/first-listen-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    screenshots: [
      {
        src: "/icons/first-listen-512x512.png",
        sizes: "512x512",
        type: "image/png",
        form_factor: "narrow",
        label: "First Listen app icon",
      },
    ],
  };
}
