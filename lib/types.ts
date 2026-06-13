import type { FeedbackFocus, Genre, SongLanguage } from "@/lib/catalog";

export type Platform =
  | "Spotify"
  | "YouTube"
  | "YouTube Music"
  | "SoundCloud"
  | "Apple Music"
  | "TikTok";

export type ContentClassification = "internal" | "external";

export type ContentEconomySetting = {
  platform: Platform;
  classification: ContentClassification;
  compatibilityStatus:
    | "Partially Supported"
    | "Discovery Only"
    | "Not Recommended";
  currentTokenCost: number;
  scheduledTokenCost: number;
  activationAt?: string;
  effectiveTokenCost: number;
  activationPending: boolean;
};

export type SongPlatformLink = {
  platform: Platform;
  url: string;
  primary: boolean;
  resolutionSource: "submitted" | "inferred" | "manual" | "verified";
  confidenceScore: number;
};

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
  platformLinks?: SongPlatformLink[];
  recommendedPlatform?: Platform;
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

export type ConnectedPlatform =
  | "spotify"
  | "apple_music"
  | "youtube"
  | "soundcloud"
  | "tiktok";

export type ConnectedPlatformAccount = {
  platform: ConnectedPlatform;
  connectionStatus:
    | "not_connected"
    | "pending"
    | "connected"
    | "needs_reauth"
    | "revoked";
  username?: string;
  displayName?: string;
  profileUrl?: string;
  avatarUrl?: string;
  creatorAccount: boolean;
  providerVerified: boolean;
  followerCount?: number;
  followingCount?: number;
  contentCount?: number;
  likesCount?: number;
  connectedAt?: string;
  lastSyncedAt?: string;
};

export type SongDashboardSummary = {
  id: string;
  artistId: string;
  title: string;
  artist: string;
  coverUrl: string;
  link: string;
  platform: Platform;
  platformLinks?: SongPlatformLink[];
  recommendedPlatform?: Platform;
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
  approvedSeconds: number;
  rejectedSeconds: number;
  lifetimeSeconds: number;
  todaySeconds: number;
  weeklySeconds: number;
  monthlySeconds: number;
  availableRewardCredits: number;
  secondsToNextCredit: number;
  minutesPerCredit: number;
  dailyCapMinutes: number;
  levelNumber: number;
  levelName: string;
  rewardsEnabled: boolean;
  communityPoints: number;
  communityRank: string;
  validListens: number;
  completeListens: number;
  todayValidListens: number;
  todayCompleteListens: number;
  todayAverageCompletionRate: number;
  lastRejectionReasonCode?: string;
  lastRejectionReasonDescription?: string;
  lastRejectionAt?: string;
};

export type ListenerImpact = {
  supportingSeconds: number;
  songsReviewed: number;
  creatorsSupported: number;
  validListens: number;
  averageListeningSeconds: number;
  daysActive: number;
  communityPoints: number;
  communityRank: string;
};

export type DiscoverySong = {
  id: string;
  artistId: string;
  title: string;
  artist: string;
  coverUrl: string;
  link: string;
  platform: Platform;
  platformLinks?: SongPlatformLink[];
  recommendedPlatform?: Platform;
  genre: string;
  language: string;
  reviewsReceived: number;
  averageRating: number;
  hookScore: number;
  totalListeningSeconds: number;
  completionRate: number;
  badge?: string;
  feedKind?: string;
  position?: number;
  rankingScore?: number;
};

export type FollowedArtist = {
  id: string;
  name: string;
  followers: number;
  songsSubmitted: number;
  averageRating: number;
  communityRank: string;
};

export type TodaySupportSummary = {
  songsReviewed: number;
  songsSupported: number;
  creatorsSupported: number;
  listeningSeconds: number;
  communityRank: string;
  validListens: number;
  completeListens: number;
  averageCompletionRate: number;
};

export type CommunityNetwork = {
  followers: number;
  following: number;
  artistsSupported: number;
  visibleSupports: number;
  anonymousSupports: number;
  visibility: "public" | "anonymous";
  autoplayNextSong: boolean;
};

export type CommunityActivity = {
  id: string;
  type: "valid_listen" | "complete_listen" | "review" | "follow";
  artistId: string;
  artistName: string;
  songId?: string;
  songTitle?: string;
  visibility: "public" | "anonymous";
  createdAt: string;
};

export type CommunityNotification = {
  id: string;
  type: "valid_listen" | "complete_listen" | "review" | "follow";
  actorId?: string;
  actorName: string;
  songId?: string;
  songTitle?: string;
  read: boolean;
  createdAt: string;
};

export type CommunityNotificationSummary = {
  unreadCount: number;
  supportersCount: number;
  followersCount: number;
  reviewsCount: number;
  validListensCount: number;
  mostSupportedSongId?: string;
  mostSupportedSongTitle?: string;
  mostSupportedSongValidListens: number;
  topSupporterId?: string;
  topSupporterName?: string;
};

export type ArtistTopSupporter = {
  id: string;
  name: string;
  supportsGiven: number;
  songsSupported: number;
  mutualFollowing: boolean;
};

export type ArtistCommunityActivity = {
  id: string;
  type:
    | "valid_listen"
    | "complete_listen"
    | "review"
    | "follow"
    | "like"
    | "comment"
    | "share";
  actorId?: string;
  actorName: string;
  songId?: string;
  songTitle?: string;
  createdAt: string;
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
