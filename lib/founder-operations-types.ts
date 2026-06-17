export type FounderOperationsSnapshot = {
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
