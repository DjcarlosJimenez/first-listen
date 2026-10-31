import type { Genre, SongLanguage } from "@/lib/catalog";

export const firstPublishPlatforms = [
  "YouTube",
  "YouTube Music",
  "SoundCloud",
] as const;

export const firstPublishContentKinds = ["song", "music_video"] as const;

export type FirstPublishContentKind =
  (typeof firstPublishContentKinds)[number];

export type FirstPublishRequest = {
  artistName: string;
  contentKind: FirstPublishContentKind;
  country: string;
  coverImageUrl: string;
  durationSeconds: number;
  email: string;
  explicitContent: boolean;
  genre: Genre;
  honeypot?: string;
  musicUrl: string;
  songLanguage: SongLanguage;
  termsAccepted: boolean;
  title: string;
};

export type FirstPublishVerificationType = "magiclink" | "signup";

export const FIRST_PUBLISH_VERIFICATION_MINUTES = 60;
export const FIRST_PUBLISH_VISIBLE_DAYS = 7;
