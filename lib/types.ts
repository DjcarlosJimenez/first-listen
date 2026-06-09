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
  artistId: string;
  title: string;
  artist: string;
  coverUrl: string;
  link: string;
  platform: Platform;
  genre: string;
  language: string;
  submittedAt: string;
  reviewsReceived: number;
  averageRating: number;
  hookScore: number;
  reportCount: number;
  totalListeningSeconds: number;
  averageListeningSeconds: number;
  completionRate: number;
  playlistIntent: number;
  shareIntent: number;
  listenerRetention: number;
  boostStatus?: string;
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
  listeningSeconds?: number;
  listeningDurationSeconds?: number;
  listeningCompletionPercent?: number;
  createdAt: string;
};

export type ListeningBankStatus = {
  bankSeconds: number;
  pendingSeconds: number;
  lifetimeSeconds: number;
  todaySeconds: number;
  availableRewardCredits: number;
  secondsToNextCredit: number;
  minutesPerCredit: number;
  dailyCapMinutes: number;
  levelNumber: number;
  levelName: string;
  rewardsEnabled: boolean;
};

export type DiscoverySong = {
  id: string;
  artistId: string;
  title: string;
  artist: string;
  coverUrl: string;
  link: string;
  platform: Platform;
  genre: string;
  language: string;
  reviewsReceived: number;
  averageRating: number;
  hookScore: number;
  totalListeningSeconds: number;
  completionRate: number;
  badge?: string;
  position?: number;
  rankingScore?: number;
};

export type DailyMissionStatus = {
  id: string;
  key: string;
  titleEn: string;
  titleEs: string;
  descriptionEn: string;
  descriptionEs: string;
  targetCount: number;
  progressCount: number;
  rewardKind: "listening_minutes" | "credit";
  rewardAmount: number;
  completed: boolean;
  claimed: boolean;
};

export type CommunityProgram = {
  kind: "contest" | "event";
  id: string;
  title: string;
  description: string;
  genre?: string;
  startsAt: string;
  endsAt: string;
  rewardDescription?: string;
  entryCount: number;
};
