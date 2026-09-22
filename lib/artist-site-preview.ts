import type { ArtistSiteConfig } from "@/lib/artist-sites";

export const preview: ArtistSiteConfig = {
  tagline: "Cumbia sonidera, musica nueva y videos oficiales.",
  logoUrl: "/artist/dj-carlos-jimenez/logo.png",
  portraitUrl: "/artist/dj-carlos-jimenez/portrait.png",
  accentColor: "#ffd565",
  albums: [
    {
      id: "album-demo-1",
      slug: "sonidero-2027",
      title: "Sonidero 2027",
      description: "Canciones para bailar y compartir.",
      coverUrl: "/artist/dj-carlos-jimenez/icon-512.png",
      rhythm: "Cumbia Sonidera",
      tracks: [
        { id: "track-demo-1", title: "Llegaste Tu", link: "https://www.youtube.com/watch?v=QmpcSnVm1gA", rhythm: "Cumbia Sonidera" },
        { id: "track-demo-2", title: "Si Ya Te Vas", link: "https://www.youtube.com/watch?v=cZ4JIjUWCFo", rhythm: "Romantica" },
      ],
    },
    {
      id: "album-demo-2",
      slug: "sonidero-2026",
      title: "Sonidero 2026",
      description: "Un album para escuchar en orden.",
      coverUrl: "/artist/dj-carlos-jimenez/icon-512.png",
      rhythm: "Regional mexicano",
      tracks: [],
    },
  ],
  topTenIds: ["track-demo-1", "track-demo-2"],
  videos: [
    { id: "video-demo-1", title: "Video oficial", link: "https://www.youtube.com/watch?v=QmpcSnVm1gA", rhythm: "Cumbia Sonidera" },
  ],
  upcoming: { enabled: true, title: "Proximo album", note: "En preparacion", coverUrl: "", songs: ["Nueva cancion", "Otra cancion"] },
};
