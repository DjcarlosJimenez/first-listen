export type ArtistCustomLink = {
  id: string;
  label: string;
  url: string;
};

export type ArtistPlatformLinks = {
  youtube: string;
  youtubeMusic: string;
  appleMusic: string;
  spotify: string;
  amazonMusic: string;
  tiktok: string;
  instagram: string;
  lemon8: string;
  clapper: string;
  facebook: string;
  facebookCommunityMessage: string;
  facebookVerified: boolean;
  website: string;
  custom: ArtistCustomLink[];
};

export type ArtistPlatformLinkKey =
  | "youtube"
  | "youtubeMusic"
  | "appleMusic"
  | "spotify"
  | "amazonMusic"
  | "tiktok"
  | "instagram"
  | "lemon8"
  | "clapper"
  | "facebook"
  | "website";

const MAX_CUSTOM_LINKS = 8;

export function emptyArtistPlatformLinks(): ArtistPlatformLinks {
  return {
    youtube: "",
    youtubeMusic: "",
    appleMusic: "",
    spotify: "",
    amazonMusic: "",
    tiktok: "",
    instagram: "",
    lemon8: "",
    clapper: "",
    facebook: "",
    facebookCommunityMessage: "",
    facebookVerified: false,
    website: "",
    custom: [],
  };
}

function isExpectedHost(key: ArtistPlatformLinkKey, hostname: string) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (key === "youtube") return host === "youtube.com" || host === "youtu.be";
  if (key === "youtubeMusic") return host === "music.youtube.com";
  if (key === "appleMusic") return host === "music.apple.com";
  if (key === "spotify") return host === "open.spotify.com";
  if (key === "amazonMusic") return host === "music.amazon.com";
  if (key === "tiktok") return host === "tiktok.com" || host.endsWith(".tiktok.com");
  if (key === "instagram") return host === "instagram.com" || host.endsWith(".instagram.com");
  if (key === "lemon8") return host === "lemon8-app.com" || host.endsWith(".lemon8-app.com");
  if (key === "clapper") return host === "clapperapp.com" || host.endsWith(".clapperapp.com");
  if (key === "facebook") {
    return host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch";
  }
  return true;
}

export function validateArtistPlatformUrl(
  key: ArtistPlatformLinkKey | "custom",
  value: string,
) {
  const url = value.trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "El enlace debe comenzar con https://";
    if (key !== "custom" && !isExpectedHost(key, parsed.hostname)) {
      const labels: Record<ArtistPlatformLinkKey, string> = {
        youtube: "youtube.com",
        youtubeMusic: "music.youtube.com",
        appleMusic: "music.apple.com",
        spotify: "open.spotify.com",
        amazonMusic: "music.amazon.com",
        tiktok: "tiktok.com",
        instagram: "instagram.com",
        lemon8: "lemon8-app.com",
        clapper: "clapperapp.com",
        facebook: "facebook.com",
        website: "un sitio HTTPS",
      };
      return `Usa un enlace valido de ${labels[key]}.`;
    }
    return null;
  } catch {
    return "El enlace no es valido.";
  }
}

function cleanPlatformUrl(key: ArtistPlatformLinkKey | "custom", value: unknown) {
  if (typeof value !== "string") return "";
  const url = value.trim().slice(0, 2048);
  return validateArtistPlatformUrl(key, url) ? "" : url;
}

function cleanId(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const id = value.trim().slice(0, 80);
  return /^[a-zA-Z0-9_-]+$/.test(id) ? id : fallback;
}

function cleanText(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength);
}

export function normalizeArtistPlatformLinks(
  value: unknown,
  fallback: ArtistPlatformLinks = emptyArtistPlatformLinks(),
): ArtistPlatformLinks {
  const source = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const usedIds = new Set<string>();
  const customSource = Array.isArray(source.custom) ? source.custom : fallback.custom;
  const custom = customSource.slice(0, MAX_CUSTOM_LINKS).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const link = item as Record<string, unknown>;
    const label = typeof link.label === "string" ? link.label.trim().slice(0, 60) : "";
    const url = cleanPlatformUrl("custom", link.url);
    if (!label || !url) return [];
    const baseId = cleanId(link.id, `custom-${index + 1}`);
    let id = baseId;
    for (let suffix = 2; usedIds.has(id); suffix += 1) id = `${baseId}-${suffix}`;
    usedIds.add(id);
    return [{ id, label, url }];
  });

  return {
    youtube: cleanPlatformUrl("youtube", source.youtube ?? fallback.youtube),
    youtubeMusic: cleanPlatformUrl(
      "youtubeMusic",
      source.youtubeMusic ?? fallback.youtubeMusic,
    ),
    appleMusic: cleanPlatformUrl("appleMusic", source.appleMusic ?? fallback.appleMusic),
    spotify: cleanPlatformUrl("spotify", source.spotify ?? fallback.spotify),
    amazonMusic: cleanPlatformUrl(
      "amazonMusic",
      source.amazonMusic ?? fallback.amazonMusic,
    ),
    tiktok: cleanPlatformUrl("tiktok", source.tiktok ?? fallback.tiktok),
    instagram: cleanPlatformUrl("instagram", source.instagram ?? fallback.instagram),
    lemon8: cleanPlatformUrl("lemon8", source.lemon8 ?? fallback.lemon8),
    clapper: cleanPlatformUrl("clapper", source.clapper ?? fallback.clapper),
    facebook: cleanPlatformUrl("facebook", source.facebook ?? fallback.facebook),
    facebookCommunityMessage: cleanText(
      source.facebookCommunityMessage,
      fallback.facebookCommunityMessage,
      120,
    ),
    facebookVerified: typeof source.facebookVerified === "boolean"
      ? source.facebookVerified
      : fallback.facebookVerified,
    website: cleanPlatformUrl("website", source.website ?? fallback.website),
    custom,
  };
}

export function validateArtistPlatformLinks(links: ArtistPlatformLinks) {
  const fixed: [ArtistPlatformLinkKey, string, string][] = [
    ["youtube", "YouTube", links.youtube],
    ["youtubeMusic", "YouTube Music", links.youtubeMusic],
    ["appleMusic", "Apple Music", links.appleMusic],
    ["spotify", "Spotify", links.spotify],
    ["amazonMusic", "Amazon Music", links.amazonMusic],
    ["tiktok", "TikTok", links.tiktok],
    ["instagram", "Instagram", links.instagram],
    ["lemon8", "Lemon8", links.lemon8],
    ["clapper", "Clapper", links.clapper],
    ["facebook", "Facebook", links.facebook],
    ["website", "sitio web", links.website],
  ];
  for (const [key, label, url] of fixed) {
    const error = validateArtistPlatformUrl(key, url);
    if (error) return `${label}: ${error}`;
  }
  for (const link of links.custom) {
    if (!link.label.trim()) return "Pon un nombre a cada enlace adicional.";
    const error = validateArtistPlatformUrl("custom", link.url);
    if (error) return `${link.label || "Enlace adicional"}: ${error}`;
  }
  return null;
}
