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

export const uiComponentLabels = {
  artistProfileButton: "Artist Profile Button",
  likeButton: "Like Button",
  commentsButton: "Comments Button",
  followButton: "Follow Button",
  saveButton: "Save Button",
  shareButton: "Share Button",
  statisticsButton: "Statistics Button",
  reviewButton: "Review Button",
  playNowButton: "Play Now Button",
  nextSongButton: "Next Song Button",
  pauseAutoplayButton: "Pause Autoplay Button",
  openPlatformButton: "Open Platform Button",
  supportArtistButton: "Support Artist Button",
  giftTokensButton: "Gift Tokens Button",
} as const;

export type UiComponentKey = keyof typeof uiComponentLabels;
export type UiComponentDisplay = "hidden" | "icon_only" | "text_only" | "icon_text";
export type UiSizePreset = "xs" | "small" | "medium" | "large" | "custom";
export type UiDensity = "compact" | "standard" | "expanded" | "custom";
export type UiActionLayout =
  | "grid"
  | "single_row"
  | "compact_row"
  | "icons_only"
  | "custom";

export const cardDensityLabels = {
  reviewQueue: "Review Queue Cards",
  spotlight: "Spotlight Cards",
  discovery: "Discovery Cards",
  ranking: "Ranking Cards",
  artist: "Artist Cards",
  profile: "Profile Cards",
} as const;

export type CardDensityKey = keyof typeof cardDensityLabels;
export type PlatformResolutionEngineMode = "off" | "basic" | "advanced";
export type PlatformRecommendationEngineMode =
  | "off"
  | "recommend"
  | "automatic";
export type PlatformResolutionProvider =
  | "youtube_music"
  | "youtube"
  | "spotify"
  | "apple_music"
  | "tiktok"
  | "soundcloud"
  | "amazon_music"
  | "deezer"
  | "facebook_video"
  | "instagram"
  | "other";

export type PlatformPresenceIconSize = "compact" | "standard" | "large";

export type UiResponsiveSize = {
  iconSize: UiSizePreset;
  iconCustomPx: number;
  textSize: UiSizePreset;
  textCustomPx: number;
  buttonSize: UiSizePreset;
  buttonCustomPx: number;
};

export type UiComponentControl = {
  display: UiComponentDisplay;
  desktop: UiResponsiveSize;
  mobile: UiResponsiveSize;
};

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
    | "homepage_banner"
    | "artist_banner"
    | "contest_banner"
    | "emergency_banner"
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
  pinned: boolean;
  bannerPlacement:
    | "standard"
    | "homepage"
    | "artist"
    | "contest"
    | "emergency";
  active: boolean;
};

export const membershipTierLabels = {
  guestListener: "Guest Listener",
  registeredMember: "Registered Member",
  creator: "Creator",
  communitySupporter: "Community Supporter",
  founderCircle: "Founder Circle",
} as const;

export type MembershipTierKey = keyof typeof membershipTierLabels;

export const membershipPermissionLabels = {
  canListen: "Can Listen",
  canComment: "Can Comment",
  canLike: "Can Like",
  canFollowArtists: "Can Follow Artists",
  canSaveSongs: "Can Save Songs",
  canShareSongs: "Can Share Songs",
  canEarnTokens: "Can Earn Tokens",
  canGiftTokens: "Can Gift Tokens",
  canUploadSongs: "Can Upload Songs",
  canCreateArtistProfiles: "Can Create Artist Profiles",
  canReceiveFollowers: "Can Receive Followers",
  canAccessStatistics: "Can Access Statistics",
  canCustomizeProfile: "Can Customize Profile",
  canCreatePlaylists: "Can Create Playlists",
  canAppearInRankings: "Can Appear In Rankings",
  canParticipateInContests: "Can Participate In Contests",
  canAccessPremiumFeatures: "Can Access Premium Features",
  canSupportArtists: "Can Support Artists",
  canReceiveSupport: "Can Receive Support",
  canDisplayBadges: "Can Display Badges",
} as const;

export type MembershipPermissionKey = keyof typeof membershipPermissionLabels;

export type MembershipTierConfig = {
  enabled: boolean;
  name: string;
  description: string;
  visibility: "public" | "private" | "hidden";
  badge: {
    name: string;
    color: string;
    icon: string;
    visible: boolean;
    placement: "profile_header" | "profile_card" | "support_wall" | "hidden";
  };
  profileAppearance: {
    customFrame: boolean;
    customTheme: boolean;
    customBanner: boolean;
    profileAccent: string;
    recognitionStyling: boolean;
  };
  permissions: Record<MembershipPermissionKey, boolean>;
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
      | "community_activity"
      | "artist_spotlight"
      | "custom";
    reviewLayoutDensity: UiDensity;
    actionButtonLayout: {
      desktop:
        | "vertical_stack"
        | "grid_2x3"
        | "single_row"
        | "compact_row"
        | "icons_only"
        | "custom";
      mobile:
        | "icons_only"
        | "icons_labels"
        | "two_row_grid"
        | "grid"
        | "single_row"
        | "compact_row"
        | "custom";
    };
    reviewFormLayout: "compact" | "standard" | "detailed" | "custom";
    autoplay: {
      autoPlayOnLoginDefault: boolean;
      autoPlayNextSongDefault: boolean;
      defaultLandingPlayback:
        | "review_queue"
        | "spotlight"
        | "discovery"
        | "top_results"
        | "custom";
    };
    community: {
      features: {
        likes: boolean;
        comments: boolean;
        followers: boolean;
        shares: boolean;
        savedSongs: boolean;
        supporters: boolean;
        statistics: boolean;
        reviews: boolean;
      };
      visibility: {
        communityActivity: boolean;
        whileYouWereAway: boolean;
        topSupporters: boolean;
        recentSupporters: boolean;
      };
      sectionVisibility: Record<
        "homepage" | "artistProfile" | "reviewQueue" | "discovery" | "rankings",
        {
          likes: boolean;
          comments: boolean;
          followers: boolean;
          shares: boolean;
          savedSongs: boolean;
          supporters: boolean;
          communityActivity: boolean;
          reviews: boolean;
          statistics: boolean;
        }
      >;
    };
  };
  ui: {
    components: Record<UiComponentKey, UiComponentControl>;
    cardDensity: Record<CardDensityKey, UiDensity>;
    desktop: {
      actionLayout: UiActionLayout;
      cardLayout: UiDensity;
    };
    mobile: {
      actionLayout: UiActionLayout;
      cardLayout: UiDensity;
    };
    preview: {
      target: "section" | "homepage" | "mobile" | "desktop";
      section: HomepageModuleKey | "artist_profile" | "review_queue";
    };
    presets: {
      active: string;
      custom: Array<{
        id: string;
        name: string;
        description: string;
        snapshot: Record<string, unknown>;
        createdAt: string;
      }>;
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
      placement: "top" | "middle" | "bottom" | "hidden";
      userSkipExternalDefault: boolean;
    };
    platformResolution: {
      engineMode: PlatformResolutionEngineMode;
      recommendationMode: PlatformRecommendationEngineMode;
      preferredPlatformOrder: PlatformResolutionProvider[];
      showPlatformRecommendations: boolean;
      showSecondaryPlatforms: boolean;
      allowCreatorVerifiedLinks: boolean;
    };
    platformPresence: {
      enabled: boolean;
      iconSize: PlatformPresenceIconSize;
      platformOrder: PlatformResolutionProvider[];
    };
    externalDiscovery: {
      showExternalSongs: boolean;
      showExternalArtists: boolean;
      showRecentReleases: boolean;
      showTrendingExternalContent: boolean;
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
    headerLayout: "compact" | "standard" | "expanded";
    songSortOrder:
      | "newest"
      | "most_played"
      | "most_supported"
      | "most_shared"
      | "highest_rated";
    order: string[];
    visibility: {
      followers: boolean;
      likes: boolean;
      comments: boolean;
      shares: boolean;
      savedCount: boolean;
      communityActivity: boolean;
      recentActivity: boolean;
      statistics: boolean;
      supporters: boolean;
      giftTokens: boolean;
    };
    discovery: {
      showArtistNameLinks: boolean;
      showArtistProfileButtons: boolean;
      showFollowArtistButton: boolean;
      showShareArtistButton: boolean;
      showSupportArtistButton: boolean;
      showArtistStatistics: boolean;
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
    contentTypeCosts: {
      internalSong: number;
      externalSong: number;
      video: number;
      audio: number;
    };
    rewardMultipliers: {
      mission: number;
      contest: number;
      communityEvent: number;
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
  membership: {
    previewTier: MembershipTierKey;
    tiers: Record<MembershipTierKey, MembershipTierConfig>;
    supportWall: {
      enabled: boolean;
      showCommunitySupporters: boolean;
      showFounderCircleMembers: boolean;
      showTopArtistSupporters: boolean;
    };
    donations: {
      enabled: boolean;
      monthlySupportEnabled: boolean;
    };
  };
  listeningBank: {
    diagnostics: {
      enabled: boolean;
      showOwnerDiagnostics: boolean;
      showActivityLog: boolean;
      showCalculationTimestamp: boolean;
      activityLogLimit: number;
      activityLogLimitMode: "10" | "20" | "30" | "50" | "custom";
      customActivityLogLimit: number;
      autoCleanupOldRecords: boolean;
      autoCleanupKeepVisible: number;
    };
    testing: {
      enabled: boolean;
      rollbackSafeOnly: boolean;
      allowProductionSimulations: boolean;
    };
    rewards: {
      minutesPerToken: number;
      dailyCapMinutes: number;
      showUserTransparency: boolean;
      showApprovalRules: boolean;
    };
    validation: {
      desktopValidationMode: "strict" | "balanced" | "playback_based";
    };
    module: {
      show: boolean;
      desktop: {
        visibility: "visible" | "hidden" | "desktop_only" | "mobile_only";
        position: number;
        column: "left" | "right" | "full_width";
        size: "compact" | "standard" | "expanded" | "custom";
      };
      mobile: {
        visibility: "visible" | "hidden" | "desktop_only" | "mobile_only";
        position: number;
        column: "left" | "right" | "full_width";
        size: "compact" | "standard" | "expanded" | "custom";
      };
      visibility: {
        showApprovedMinutes: boolean;
        showPendingMinutes: boolean;
        showRejectedMinutes: boolean;
        showTokenConversion: boolean;
        showNextRewardThreshold: boolean;
      };
    };
    events: Array<{
      id: string;
      name: string;
      startsAt: string | null;
      endsAt: string | null;
      enabled: boolean;
      visible: boolean;
      rewardTypes: {
        extraListeningMinutes: boolean;
        listeningMultiplier: boolean;
        tokenMultiplier: boolean;
        missionMultiplier: boolean;
      };
      bonusMinutes: number;
      bonusThresholdMinutes: number;
      listeningMultiplier: number;
      tokenMultiplier: number;
      missionMultiplier: number;
      description: string;
      preview: boolean;
    }>;
  };
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

const uiComponentKeys = Object.keys(uiComponentLabels) as UiComponentKey[];
const cardDensityKeys = Object.keys(cardDensityLabels) as CardDensityKey[];

const defaultUiSize: UiResponsiveSize = {
  iconSize: "medium",
  iconCustomPx: 15,
  textSize: "medium",
  textCustomPx: 12,
  buttonSize: "medium",
  buttonCustomPx: 10,
};

const defaultUiComponentControl: UiComponentControl = {
  display: "icon_text",
  desktop: defaultUiSize,
  mobile: {
    iconSize: "medium",
    iconCustomPx: 15,
    textSize: "small",
    textCustomPx: 11,
    buttonSize: "small",
    buttonCustomPx: 8,
  },
};

const communitySectionDefaults = {
  likes: true,
  comments: true,
  followers: true,
  shares: true,
  savedSongs: true,
  supporters: true,
  communityActivity: true,
  reviews: true,
  statistics: true,
};

const disabledMembershipPermissions = Object.fromEntries(
  Object.keys(membershipPermissionLabels).map((permission) => [
    permission,
    false,
  ]),
) as Record<MembershipPermissionKey, boolean>;

const guestMembershipPermissions: Record<MembershipPermissionKey, boolean> = {
  ...disabledMembershipPermissions,
  canListen: true,
  canComment: true,
  canLike: true,
  canFollowArtists: true,
  canSaveSongs: true,
  canShareSongs: true,
};

const registeredMembershipPermissions: Record<MembershipPermissionKey, boolean> = {
  ...guestMembershipPermissions,
  canEarnTokens: true,
  canGiftTokens: true,
  canUploadSongs: true,
  canCreateArtistProfiles: true,
  canReceiveFollowers: true,
  canAccessStatistics: true,
  canSupportArtists: true,
  canReceiveSupport: true,
  canDisplayBadges: true,
};

const creatorMembershipPermissions: Record<MembershipPermissionKey, boolean> = {
  ...registeredMembershipPermissions,
  canCustomizeProfile: true,
};

const communitySupporterPermissions: Record<MembershipPermissionKey, boolean> = {
  ...guestMembershipPermissions,
  canSupportArtists: true,
  canDisplayBadges: true,
};

const founderCirclePermissions: Record<MembershipPermissionKey, boolean> = {
  ...communitySupporterPermissions,
  canCustomizeProfile: true,
};

function membershipTier(
  tier: MembershipTierKey,
  enabled: boolean,
  description: string,
  badgeColor: string,
  permissions: Record<MembershipPermissionKey, boolean>,
): MembershipTierConfig {
  return {
    enabled,
    name: membershipTierLabels[tier],
    description,
    visibility: enabled ? "public" : "hidden",
    badge: {
      name: membershipTierLabels[tier],
      color: badgeColor,
      icon: membershipTierLabels[tier],
      visible: enabled,
      placement: enabled ? "profile_header" : "hidden",
    },
    profileAppearance: {
      customFrame: false,
      customTheme: false,
      customBanner: false,
      profileAccent: badgeColor,
      recognitionStyling: tier === "founderCircle",
    },
    permissions,
  };
}

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
      autoPlayNextSongDefault: true,
      defaultLandingPlayback: "review_queue",
    },
    community: {
      features: {
        likes: true,
        comments: true,
        followers: true,
        shares: true,
        savedSongs: true,
        supporters: true,
        statistics: true,
        reviews: true,
      },
      visibility: {
        communityActivity: true,
        whileYouWereAway: true,
        topSupporters: true,
        recentSupporters: true,
      },
      sectionVisibility: {
        homepage: { ...communitySectionDefaults },
        artistProfile: { ...communitySectionDefaults },
        reviewQueue: { ...communitySectionDefaults },
        discovery: { ...communitySectionDefaults },
        rankings: { ...communitySectionDefaults },
      },
    },
  },
  ui: {
    components: Object.fromEntries(
      uiComponentKeys.map((component) => [
        component,
        {
          ...defaultUiComponentControl,
          desktop: { ...defaultUiComponentControl.desktop },
          mobile: { ...defaultUiComponentControl.mobile },
        },
      ]),
    ) as Record<UiComponentKey, UiComponentControl>,
    cardDensity: Object.fromEntries(
      cardDensityKeys.map((card) => [card, "standard"]),
    ) as Record<CardDensityKey, UiDensity>,
    desktop: {
      actionLayout: "grid",
      cardLayout: "standard",
    },
    mobile: {
      actionLayout: "icons_only",
      cardLayout: "standard",
    },
    preview: {
      target: "homepage",
      section: "review_queue",
    },
    presets: {
      active: "standard",
      custom: [],
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
      placement: "middle",
      userSkipExternalDefault: false,
    },
    platformResolution: {
      engineMode: "off",
      recommendationMode: "off",
      preferredPlatformOrder: [
        "youtube_music",
        "youtube",
        "spotify",
        "apple_music",
        "tiktok",
        "soundcloud",
        "amazon_music",
        "deezer",
        "facebook_video",
        "instagram",
        "other",
      ],
      showPlatformRecommendations: false,
      showSecondaryPlatforms: true,
      allowCreatorVerifiedLinks: true,
    },
    platformPresence: {
      enabled: true,
      iconSize: "compact",
      platformOrder: [
        "youtube_music",
        "youtube",
        "spotify",
        "apple_music",
        "tiktok",
        "soundcloud",
        "amazon_music",
        "deezer",
        "facebook_video",
        "instagram",
        "other",
      ],
    },
    externalDiscovery: {
      showExternalSongs: true,
      showExternalArtists: true,
      showRecentReleases: true,
      showTrendingExternalContent: true,
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
    headerLayout: "standard",
    songSortOrder: "newest",
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
      savedCount: true,
      communityActivity: true,
      recentActivity: true,
      statistics: true,
      supporters: true,
      giftTokens: false,
    },
    discovery: {
      showArtistNameLinks: true,
      showArtistProfileButtons: true,
      showFollowArtistButton: true,
      showShareArtistButton: true,
      showSupportArtistButton: true,
      showArtistStatistics: true,
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
      enabled: true,
      minimum: 1,
      maximum: 10,
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
    contentTypeCosts: {
      internalSong: 1,
      externalSong: 1,
      video: 1,
      audio: 1,
    },
    rewardMultipliers: {
      mission: 1,
      contest: 1,
      communityEvent: 1,
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
  membership: {
    previewTier: "guestListener",
    tiers: {
      guestListener: membershipTier(
        "guestListener",
        true,
        "Free listening access for guests. Guests can listen, react, follow, save, and share.",
        "#C8FF4F",
        guestMembershipPermissions,
      ),
      registeredMember: membershipTier(
        "registeredMember",
        true,
        "Free member account with history, earned tokens, artist support, and song submission access.",
        "#4F7110",
        registeredMembershipPermissions,
      ),
      creator: membershipTier(
        "creator",
        false,
        "Prepared future creator tier for artist profiles, song catalog tools, statistics, and customizations.",
        "#7AA511",
        creatorMembershipPermissions,
      ),
      communitySupporter: membershipTier(
        "communitySupporter",
        false,
        "Prepared future recognition tier for voluntary community support with no competitive advantages.",
        "#2F8F5B",
        communitySupporterPermissions,
      ),
      founderCircle: membershipTier(
        "founderCircle",
        false,
        "Prepared future monthly support tier for permanent recognition with no queue, ranking, token, or visibility advantages.",
        "#C9A227",
        founderCirclePermissions,
      ),
    },
    supportWall: {
      enabled: false,
      showCommunitySupporters: true,
      showFounderCircleMembers: true,
      showTopArtistSupporters: true,
    },
    donations: {
      enabled: false,
      monthlySupportEnabled: false,
    },
  },
  listeningBank: {
    diagnostics: {
      enabled: true,
      showOwnerDiagnostics: true,
      showActivityLog: true,
      showCalculationTimestamp: true,
      activityLogLimit: 20,
      activityLogLimitMode: "20",
      customActivityLogLimit: 20,
      autoCleanupOldRecords: true,
      autoCleanupKeepVisible: 30,
    },
    testing: {
      enabled: true,
      rollbackSafeOnly: true,
      allowProductionSimulations: true,
    },
    rewards: {
      minutesPerToken: 120,
      dailyCapMinutes: 180,
      showUserTransparency: true,
      showApprovalRules: true,
    },
    validation: {
      desktopValidationMode: "playback_based",
    },
    module: {
      show: true,
      desktop: {
        visibility: "visible",
        position: 2,
        column: "full_width",
        size: "standard",
      },
      mobile: {
        visibility: "visible",
        position: 2,
        column: "full_width",
        size: "standard",
      },
      visibility: {
        showApprovedMinutes: true,
        showPendingMinutes: true,
        showRejectedMinutes: true,
        showTokenConversion: true,
        showNextRewardThreshold: true,
      },
    },
    events: [],
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
