import type { Genre, SongLanguage } from "@/lib/catalog";
import type { Platform } from "@/lib/types";

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

export const firstPublishReactionKeys = [
  "liked",
  "good_voice",
  "good_rhythm",
  "listen_again",
] as const;

export type FirstPublishReactionKey =
  (typeof firstPublishReactionKeys)[number];

export type FirstPublishReactionCounts = Record<FirstPublishReactionKey, number>;

export type FirstPublishLiveSong = {
  artistName: string;
  contentKind: FirstPublishContentKind;
  coverImageUrl: string;
  expiresAt: string | null;
  genre: string;
  id: string;
  isOwner: boolean;
  musicUrl: string;
  platform: Platform;
  reactions: FirstPublishReactionCounts;
  retained: boolean;
  title: string;
};

export const firstPublishFunnelLabels = {
  linkReady: "Primer flujo · enlace listo",
  formSent: "Primer flujo · formulario enviado",
  emailSent: "Primer flujo · correo enviado",
  published: "Primer flujo · publicación confirmada",
  retained: "Primer flujo · conservada",
  shared: "Primer flujo · compartida",
} as const;

export function trackFirstPublishStage(label: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("first-listen:analytics-action", { detail: { label } }),
  );
}

export const FIRST_PUBLISH_VERIFICATION_MINUTES = 60;
export const FIRST_PUBLISH_VISIBLE_DAYS = 7;
