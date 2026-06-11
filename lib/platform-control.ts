import {
  defaultPlatformTheme,
  type PlatformTheme,
} from "@/lib/platform-theme";

export const homepageModuleLabels = {
  away_summary: "While You Were Away",
  spotlight: "Spotlight",
  top_results: "Top 10",
  organic_rankings: "Organic Rankings",
  community_activity: "Community Activity",
  review_queue: "Review Queue",
  artist_spotlight: "Artist Spotlight",
  external_discovery: "External Discovery",
  trending: "Trending",
  most_shared: "Most Shared",
  most_supported: "Community Picks",
  newest_songs: "New Releases",
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
    firstVisibleSection:
      | "review_queue"
      | "spotlight"
      | "discovery"
      | "rankings"
      | "community_activity";
    reviewLayoutDensity: "compact" | "standard" | "expanded";
    actionButtonLayout: {
      desktop: "vertical_stack" | "grid_2x3" | "single_row";
      mobile: "icons_only" | "icons_labels" | "two_row_grid";
    };
    reviewFormLayout: "compact" | "standard" | "detailed";
    autoplay: {
      autoPlayOnLoginDefault: boolean;
      defaultLandingPlayback:
        | "review_queue"
        | "spotlight"
        | "discovery"
        | "top_results";
    };
    community: {
      features: {
        likes: boolean;
        comments: boolean;
        followers: boolean;
        shares: boolean;
        savedSongs: boolean;
        reviews: boolean;
      };
      visibility: {
        communityActivity: boolean;
        whileYouWereAway: boolean;
        topSupporters: boolean;
        recentSupporters: boolean;
      };
    };
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
    externalContent: {
      visibility: "mixed_with_queue" | "separate_section" | "both" | "hidden";
      ratio: 0 | 10 | 20 | 30 | 50;
      behavior:
        | "mix_normally"
        | "ask_user"
        | "skip_automatically"
        | "internal_content_only";
      userSkipExternalDefault: boolean;
    };
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
    pinned: boolean;
    startsAt: string | null;
    endsAt: string | null;
  }>;
  artistProfile: {
    layout: "compact" | "standard" | "premium_showcase";
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
    premium: {
      enabled: boolean;
      customBanner: boolean;
      customProfileImage: boolean;
      biography: boolean;
      customTheme: boolean;
      pinnedSong: boolean;
      socialLinks: boolean;
      featuredVideo: boolean;
      customSections: boolean;
      premiumBadge: boolean;
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
    layoutA: string;
    layoutB: string;
    activeVariant: "none" | "layout_a" | "layout_b";
    metrics: {
      listeningTime: boolean;
      reviewsCompleted: boolean;
      followersGained: boolean;
      shares: boolean;
      comments: boolean;
      artistVisits: boolean;
    };
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
    firstVisibleSection: "review_queue",
    reviewLayoutDensity: "standard",
    actionButtonLayout: {
      desktop: "grid_2x3",
      mobile: "icons_only",
    },
    reviewFormLayout: "standard",
    autoplay: {
      autoPlayOnLoginDefault: true,
      defaultLandingPlayback: "review_queue",
    },
    community: {
      features: {
        likes: true,
        comments: true,
        followers: true,
        shares: true,
        savedSongs: true,
        reviews: true,
      },
      visibility: {
        communityActivity: true,
        whileYouWereAway: true,
        topSupporters: true,
        recentSupporters: true,
      },
    },
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
    externalContent: {
      visibility: "separate_section",
      ratio: 10,
      behavior: "ask_user",
      userSkipExternalDefault: false,
    },
  },
  spotlight: [1, 2, 3].map((slot) => ({
    slot: slot as 1 | 2 | 3,
    songId: null,
    placement: "editor_pick" as const,
    label: "",
    pinned: false,
    startsAt: null,
    endsAt: null,
  })),
  artistProfile: {
    layout: "standard",
    order: [
      "profileHeader",
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
    premium: {
      enabled: false,
      customBanner: false,
      customProfileImage: false,
      biography: false,
      customTheme: false,
      pinnedSong: false,
      socialLinks: false,
      featuredVideo: false,
      customSections: false,
      premiumBadge: false,
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
    layoutA: "Control layout",
    layoutB: "Variant layout",
    activeVariant: "none",
    metrics: {
      listeningTime: true,
      reviewsCompleted: true,
      followersGained: true,
      shares: true,
      comments: true,
      artistVisits: true,
    },
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
  const merged = mergeConfig(
    defaultPlatformControlConfig as unknown as Record<string, unknown>,
    value as Record<string, unknown>,
  ) as unknown as PlatformControlConfig;
  const allowedModules = new Set(moduleOrder);
  const order = merged.homepage.order.filter((module) =>
    allowedModules.has(module),
  );
  for (const moduleKey of moduleOrder) {
    if (!order.includes(moduleKey)) order.push(moduleKey);
  }
  const spotlightSource = Array.isArray(merged.spotlight)
    ? merged.spotlight
    : defaultPlatformControlConfig.spotlight;
  const spotlight = defaultPlatformControlConfig.spotlight.map(
    (defaultSlot, index) => {
      const candidate =
        spotlightSource.find((item) => item.slot === defaultSlot.slot) ??
        spotlightSource[index] ??
        defaultSlot;
      return {
        ...defaultSlot,
        ...candidate,
        slot: defaultSlot.slot,
        songId:
          typeof candidate.songId === "string" && candidate.songId
            ? candidate.songId
            : null,
        label: typeof candidate.label === "string" ? candidate.label : "",
        pinned: Boolean(candidate.pinned),
        startsAt:
          typeof candidate.startsAt === "string" && candidate.startsAt
            ? candidate.startsAt
            : null,
        endsAt:
          typeof candidate.endsAt === "string" && candidate.endsAt
            ? candidate.endsAt
            : null,
      };
    },
  );
  return {
    ...merged,
    homepage: {
      ...merged.homepage,
      order,
      visibility: {
        ...defaultPlatformControlConfig.homepage.visibility,
        ...merged.homepage.visibility,
      },
    },
    spotlight,
  };
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
