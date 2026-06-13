import type {
  ContentClassification,
  ContentEconomySetting,
  Platform,
  PrimaryPlatform,
} from "@/lib/types";

export const databasePlatform: Record<Platform, string> = {
  Spotify: "spotify",
  YouTube: "youtube",
  "YouTube Music": "youtube_music",
  SoundCloud: "soundcloud",
  "Apple Music": "apple_music",
  TikTok: "tiktok",
  "Amazon Music": "amazon_music",
  Deezer: "deezer",
  "Facebook Video": "facebook_video",
  Instagram: "instagram",
  Other: "other",
};

export const displayPlatform: Record<string, Platform> = {
  spotify: "Spotify",
  youtube: "YouTube",
  youtube_music: "YouTube Music",
  soundcloud: "SoundCloud",
  apple_music: "Apple Music",
  tiktok: "TikTok",
  amazon_music: "Amazon Music",
  deezer: "Deezer",
  facebook_video: "Facebook Video",
  instagram: "Instagram",
  other: "Other",
};

export const primaryPlatforms: PrimaryPlatform[] = [
  "YouTube Music",
  "YouTube",
  "Spotify",
  "Apple Music",
  "TikTok",
  "SoundCloud",
];

export const additionalPlatforms: Platform[] = [
  "Amazon Music",
  "Deezer",
  "Facebook Video",
  "Instagram",
  "Other",
];

export const allPlatforms: Platform[] = [
  ...primaryPlatforms,
  ...additionalPlatforms,
];

export function isPrimaryPlatform(platform: Platform | null): platform is PrimaryPlatform {
  return Boolean(platform && primaryPlatforms.includes(platform as PrimaryPlatform));
}

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
    platform === "TikTok" ||
    additionalPlatforms.includes(platform)
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
