import {
  defaultPlatformTheme,
  type PlatformTheme,
} from "@/lib/platform-theme";

export const homepageModuleLabels = {
  away_summary: "While You Were Away",
  spotlight: "Spotlight",
  top_results: "Top Results",
  organic_rankings: "Organic Rankings",
  community_activity: "Community Activity",
  review_queue: "Review Queue",
  artist_spotlight: "Artist Spotlight",
  trending: "Trending",
  most_shared: "Most Shared",
  most_supported: "Most Supported",
  newest_songs: "Newest Songs",
} as const;

export type HomepageModuleKey = keyof typeof homepageModuleLabels;

export type ControlTheme = PlatformTheme & {
  primaryColor: string;
  secondaryColor: string;
  hoverColor: string;
  customThemes: Array<{
    id: string;
    name: string;
    colors: Omit<ControlTheme, "customThemes">;
  }>;
};

export type ControlAnnouncement = {
  id: string;
  type:
    | "platform_update"
    | "contest"
    | "maintenance"
    | "community_news"
    | "special_event"
    | "founder_message";
  title: string;
  message: string;
  priority: number;
  audience:
    | "guests"
    | "members"
    | "artists"
    | "moderators"
    | "everyone";
  startsAt: string;
  endsAt: string | null;
  active: boolean;
};

export type PlatformControlConfig = {
  schemaVersion: number;
  theme: ControlTheme;
  homepage: {
    order: HomepageModuleKey[];
    visibility: Record<HomepageModuleKey, boolean>;
  };
  discovery: {
    songsPerPage: 10 | 20 | 50 | 100;
    modules: Record<
      | "spotlight"
      | "rankings"
      | "topResults"
      | "organicRankings"
      | "trending"
      | "mostShared"
      | "mostSupported"
      | "newestSongs",
      boolean
    >;
  };
  spotlight: Array<{
    slot: 1 | 2 | 3;
    songId: string | null;
    placement:
      | "sponsored"
      | "new_release"
      | "founder_artist"
      | "contest_winner"
      | "special_event"
      | "editor_pick";
    label: string;
  }>;
  artistProfile: {
    order: string[];
    visibility: {
      followers: boolean;
      likes: boolean;
      comments: boolean;
      shares: boolean;
      recentActivity: boolean;
      statistics: boolean;
      supporters: boolean;
      giftTokens: boolean;
    };
  };
  tokens: {
    minutesPerToken: number;
    dailyListeningLimit: number;
    maxTokensPerDay: number;
    submissionCost: number;
    gifting: {
      enabled: boolean;
      minimum: number;
      maximum: number;
      dailyLimit: number;
      cooldownMinutes: number;
    };
    bonuses: {
      review: number;
      mission: number;
      spotlight: number;
      contest: number;
      referral: number;
    };
    engagement: {
      enabled: boolean;
      likeRewards: boolean;
      commentRewards: boolean;
      shareRewards: boolean;
      followRewards: boolean;
    };
    emergency: {
      pauseTokenGeneration: boolean;
      pauseGifting: boolean;
      pauseMissions: boolean;
      pauseRewards: boolean;
      pauseSubmissions: boolean;
    };
    futureSupport: {
      voluntaryDonations: boolean;
      buyMeACoffee: boolean;
      founderSupportBadge: boolean;
      communitySupportBanner: boolean;
    };
  };
  permissions: Record<string, Record<string, boolean>>;
  experiments: {
    experimentalFeatures: boolean;
    abTesting: boolean;
    layoutTesting: boolean;
    themeTesting: boolean;
    newDiscoveryModules: boolean;
    betaFeatures: boolean;
  };
  announcements: ControlAnnouncement[];
};

export type PlatformControlState = {
  config: PlatformControlConfig;
  previewActive: boolean;
  publishedVersion: number;
  draftRevision: number;
};

const moduleOrder = Object.keys(
  homepageModuleLabels,
) as HomepageModuleKey[];

export const defaultPlatformControlConfig: PlatformControlConfig = {
  schemaVersion: 1,
  theme: {
    ...defaultPlatformTheme,
    primaryColor: "#171A18",
    secondaryColor: "#4F7110",
    hoverColor: "#96CF18",
    customThemes: [],
  },
  homepage: {
    order: moduleOrder,
    visibility: Object.fromEntries(
      moduleOrder.map((module) => [module, true]),
    ) as Record<HomepageModuleKey, boolean>,
  },
  discovery: {
    songsPerPage: 20,
    modules: {
      spotlight: true,
      rankings: true,
      topResults: true,
      organicRankings: true,
      trending: true,
      mostShared: true,
      mostSupported: true,
      newestSongs: true,
    },
  },
  spotlight: [1, 2, 3].map((slot) => ({
    slot: slot as 1 | 2 | 3,
    songId: null,
    placement: "editor_pick" as const,
    label: "",
  })),
  artistProfile: {
    order: [
      "statistics",
      "supporters",
      "recentActivity",
      "songs",
    ],
    visibility: {
      followers: true,
      likes: true,
      comments: true,
      shares: true,
      recentActivity: true,
      statistics: true,
      supporters: true,
      giftTokens: false,
    },
  },
  tokens: {
    minutesPerToken: 120,
    dailyListeningLimit: 180,
    maxTokensPerDay: 3,
    submissionCost: 1,
    gifting: {
      enabled: false,
      minimum: 1,
      maximum: 5,
      dailyLimit: 10,
      cooldownMinutes: 60,
    },
    bonuses: {
      review: 0,
      mission: 0,
      spotlight: 0,
      contest: 0,
      referral: 0,
    },
    engagement: {
      enabled: false,
      likeRewards: false,
      commentRewards: false,
      shareRewards: false,
      followRewards: false,
    },
    emergency: {
      pauseTokenGeneration: false,
      pauseGifting: false,
      pauseMissions: false,
      pauseRewards: false,
      pauseSubmissions: false,
    },
    futureSupport: {
      voluntaryDonations: false,
      buyMeACoffee: false,
      founderSupportBadge: false,
      communitySupportBanner: false,
    },
  },
  permissions: {
    founder: {
      manageConfiguration: true,
      publishConfiguration: true,
      emergencyRestore: true,
      managePermissions: true,
      manageExperiments: true,
    },
    super_admin: {
      manageConfiguration: true,
      publishConfiguration: true,
      emergencyRestore: false,
      managePermissions: false,
      manageExperiments: false,
    },
    moderator: {
      manageReports: true,
      removeInvalidSongs: true,
    },
    artist: {
      submitSongs: true,
      manageOwnSongs: true,
    },
    member: {
      listen: true,
      review: true,
      participateInRankings: true,
    },
    guest: {
      listen: true,
      comment: true,
      follow: true,
      save: true,
    },
  },
  experiments: {
    experimentalFeatures: false,
    abTesting: false,
    layoutTesting: false,
    themeTesting: false,
    newDiscoveryModules: false,
    betaFeatures: false,
  },
  announcements: [],
};

function mergeConfig(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      result[key] = mergeConfig(
        base[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function normalizePlatformControlConfig(
  value: unknown,
): PlatformControlConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultPlatformControlConfig;
  }
  return mergeConfig(
    defaultPlatformControlConfig as unknown as Record<string, unknown>,
    value as Record<string, unknown>,
  ) as unknown as PlatformControlConfig;
}

export function mapPlatformControlState(
  value: unknown,
): PlatformControlState {
  const row =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    config: normalizePlatformControlConfig(row.config),
    previewActive: Boolean(row.preview_active),
    publishedVersion: Number(row.published_version ?? 1),
    draftRevision: Number(row.draft_revision ?? 1),
  };
}
