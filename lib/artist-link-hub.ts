export type ArtistCustomLink = {
  id: string;
  label: string;
  url: string;
};

export type ArtistPlatformLinks = {
  youtubeMusic: string;
  appleMusic: string;
  spotify: string;
  facebook: string;
  website: string;
  custom: ArtistCustomLink[];
};

export type ArtistPlatformLinkKey = Exclude<keyof ArtistPlatformLinks, "custom">;

const MAX_CUSTOM_LINKS = 8;

export function emptyArtistPlatformLinks(): ArtistPlatformLinks {
  return {
    youtubeMusic: "",
    appleMusic: "",
    spotify: "",
    facebook: "",
    website: "",
    custom: [],
  };
}

function isExpectedHost(key: ArtistPlatformLinkKey, hostname: string) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (key === "youtubeMusic") return host === "music.youtube.com";
  if (key === "appleMusic") return host === "music.apple.com";
  if (key === "spotify") return host === "open.spotify.com";
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
        youtubeMusic: "music.youtube.com",
        appleMusic: "music.apple.com",
        spotify: "open.spotify.com",
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
    youtubeMusic: cleanPlatformUrl(
      "youtubeMusic",
      source.youtubeMusic ?? fallback.youtubeMusic,
    ),
    appleMusic: cleanPlatformUrl("appleMusic", source.appleMusic ?? fallback.appleMusic),
    spotify: cleanPlatformUrl("spotify", source.spotify ?? fallback.spotify),
    facebook: cleanPlatformUrl("facebook", source.facebook ?? fallback.facebook),
    website: cleanPlatformUrl("website", source.website ?? fallback.website),
    custom,
  };
}

export function validateArtistPlatformLinks(links: ArtistPlatformLinks) {
  const fixed: [ArtistPlatformLinkKey, string, string][] = [
    ["youtubeMusic", "YouTube Music", links.youtubeMusic],
    ["appleMusic", "Apple Music", links.appleMusic],
    ["spotify", "Spotify", links.spotify],
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
