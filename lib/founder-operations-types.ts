export type FounderDiscoveryAnalyticsSong = {
  artist: string;
  featured?: boolean;
  firstValidListenAt?: string | null;
  hoursToFirstListen?: number | null;
  platform: string;
  songId: string;
  title: string;
  totalValidListens?: number;
  uniqueListeners?: number;
  uploadDate?: string;
  validAfterSmartQueue?: number;
  validBeforeSmartQueue?: number;
  validListens?: number;
  validListens24h?: number;
  validListens7d?: number;
  daysSinceUpload?: number;
};

export type FounderDiscoveryAnalyticsReport = {
  discoverySpread: {
    dailyTrend: Array<{
      date: string;
      songsReached: number;
      validListens: number;
    }>;
    weeklyTrend: Array<{
      songsReached: number;
      validListens: number;
      week: string;
    }>;
  };
  discoveryWinners: FounderDiscoveryAnalyticsSong[];
  generatedAt: string;
  overview: {
    activeSongs: number;
    externalOrNonInternalSongs: number;
    internalPlayableSongs: number;
    lowExposureSongs: number;
    newlyDiscoveredToday: number;
    songsReached: number;
    totalValidListens: number;
    validListens24h: number;
    validListens7d: number;
    validListensToday: number;
    zeroListenSongs: number;
  };
  smartQueueImpact: {
    cutoffAt: string;
    lowExposureGraduated: number;
    lowExposureHits: number;
    postSongsReached: number;
    postValidListens: number;
    repeatRiskSongsStillAtZero: number;
    zeroToOneSongs: number;
  };
  smartQueueStartedAt: string;
  songsAtRisk: FounderDiscoveryAnalyticsSong[];
  songsGainingExposure: FounderDiscoveryAnalyticsSong[];
  timeToFirstListen: {
    averageHoursToDiscovery: number;
    discoveredSongs: number;
    medianHoursToDiscovery: number;
    pendingFirstListenSongs: number;
    songs: FounderDiscoveryAnalyticsSong[];
  };
  topConcentration: {
    beforeSmartQueuePercent: number;
    songs: FounderDiscoveryAnalyticsSong[];
    top10ConcentrationPercent: number;
    top10ValidListens: number;
  };
};

export type FounderOperationsSnapshot = {
  discoveryAnalytics?: FounderDiscoveryAnalyticsReport | null;
  errors?: string[];
  feedback: {
    inProgress: number;
    open: number;
    resolved: number;
  };
  reports: Array<{
    createdAt: string;
    id: string;
    reportType: string;
    status: string;
    targetContent: string;
  }>;
  summary: {
    activeUsers: number;
    openFeedbackItems: number;
    openReports: number;
    songsPendingReview: number;
    totalSongs: number;
    totalUsers: number;
  };
  users: Array<{
    email: string;
    id: string;
    role: string;
    tokenBalance: number;
    username: string;
  }>;
};
