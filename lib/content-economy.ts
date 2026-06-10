import type {
  ContentClassification,
  ContentEconomySetting,
  Platform,
} from "@/lib/types";

export const databasePlatform: Record<Platform, string> = {
  Spotify: "spotify",
  YouTube: "youtube",
  "YouTube Music": "youtube_music",
  SoundCloud: "soundcloud",
  "Apple Music": "apple_music",
  TikTok: "tiktok",
};

export const displayPlatform: Record<string, Platform> = {
  spotify: "Spotify",
  youtube: "YouTube",
  youtube_music: "YouTube Music",
  soundcloud: "SoundCloud",
  apple_music: "Apple Music",
  tiktok: "TikTok",
};

export const allPlatforms = Object.keys(databasePlatform) as Platform[];

export function getContentClassification(
  platform: Platform,
): ContentClassification {
  return platform === "YouTube" ||
    platform === "YouTube Music" ||
    platform === "SoundCloud"
    ? "internal"
    : "external";
}

export function isExternalPlatform(platform: Platform) {
  return getContentClassification(platform) === "external";
}

export function contentClassificationLabel(platform: Platform) {
  return isExternalPlatform(platform)
    ? "External Content"
    : "Internal Content";
}

export function compactClassificationLabel(platform: Platform) {
  return isExternalPlatform(platform) ? "External" : "Internal";
}

export function compatibilityStatus(platform: Platform) {
  if (
    platform === "Spotify" ||
    platform === "Apple Music" ||
    platform === "TikTok"
  ) {
    return "Discovery Only" as const;
  }
  if (platform === "SoundCloud") return "Not Recommended" as const;
  return "Partially Supported" as const;
}

export function economySettingFor(
  settings: ContentEconomySetting[],
  platform: Platform,
) {
  return settings.find((setting) => setting.platform === platform);
}

export function submissionTokenCost(
  settings: ContentEconomySetting[],
  platform: Platform,
  now = Date.now(),
) {
  const setting = economySettingFor(settings, platform);
  if (!setting) return 1;
  if (
    setting.activationAt &&
    new Date(setting.activationAt).getTime() <= now
  ) {
    return setting.scheduledTokenCost;
  }
  return setting.currentTokenCost;
}

export function nextEconomyActivation(
  settings: ContentEconomySetting[],
  now = Date.now(),
) {
  return settings
    .filter(
      (setting) =>
        setting.activationAt &&
        new Date(setting.activationAt).getTime() > now,
    )
    .sort(
      (left, right) =>
        new Date(left.activationAt as string).getTime() -
        new Date(right.activationAt as string).getTime(),
    )[0];
}
