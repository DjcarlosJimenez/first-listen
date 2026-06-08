import type { FeedbackFocus, Genre, SongLanguage } from "@/lib/catalog";

export type Platform =
  | "Spotify"
  | "YouTube"
  | "YouTube Music"
  | "SoundCloud"
  | "Apple Music";

export type Song = {
  id: string;
  artistId?: string;
  title: string;
  artist: string;
  genre: Genre;
  language: SongLanguage;
  feedbackFocus: FeedbackFocus[];
  explicitContent?: boolean;
  country: string;
  platform: Platform;
  link: string;
  coverUrl: string;
  accent: string;
  submittedAt: string;
};

export type AccountSummary = {
  id: string;
  displayName: string;
  email: string;
  initials: string;
};

export type SongDashboardSummary = {
  id: string;
  title: string;
  artist: string;
  platform: Platform;
  submittedAt: string;
  reviewsReceived: number;
  averageRating: number;
  hookScore: number;
  reportCount: number;
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
