import type { FeedbackFocus, Genre, SongLanguage } from "@/lib/catalog";

export type Platform = "Spotify" | "YouTube" | "YouTube Music" | "SoundCloud";

export type Song = {
  id: string;
  title: string;
  artist: string;
  genre: Genre;
  language: SongLanguage;
  feedbackFocus: FeedbackFocus[];
  country: string;
  platform: Platform;
  link: string;
  coverUrl: string;
  accent: string;
  submittedAt: string;
};

export type Review = {
  id: string;
  songId: string;
  reviewer: string;
  listenFull: boolean;
  addPlaylist: boolean;
  grabbedAttention: boolean;
  shareWithFriend: boolean;
  rating: number;
  comment?: string;
  qualityScore: number;
  qualityPassed: boolean;
  createdAt: string;
};
