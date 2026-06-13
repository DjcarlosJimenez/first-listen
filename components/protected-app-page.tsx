import { redirect } from "next/navigation";
import { ProtectedAppEntry } from "@/components/protected-app-entry";
import type { View } from "@/components/first-listen-app";
import type { Genre, InterfaceLocale, ListenerLanguage } from "@/lib/catalog";
import { getInitials, platformLabels } from "@/lib/discovery";
import { safeCoverUrl } from "@/lib/media";
import {
  defaultPlatformControlConfig,
  mapPlatformControlState,
} from "@/lib/platform-control";
import { createClient } from "@/lib/supabase/server";
import type {
  CommunityNotification,
  CommunityNotificationSummary,
  CommunityProgram,
  ContentEconomySetting,
  DailyMissionStatus,
  DiscoverySong,
  FollowedArtist,
  ListeningBankStatus,
  Review,
  Song,
  SongPlatformLink,
  SongDashboardSummary,
  TodaySupportSummary,
} from "@/lib/types";

type DashboardRow = {
  song_id: string;
  artist_id: string;
  title: string;
  artist_name: string;
  cover_image_url: string;
  music_url: string;
  platform: string;
  genre: string;
  song_language: string;
  submitted_at: string;
  reviews_received: number;
  average_rating: number;
  hook_score: number;
  report_count: number;
  total_listening_seconds: number;
  average_listening_seconds: number;
  completion_rate: number;
  playlist_intent: number;
  share_intent: number;
  listener_retention: number;
  boost_status: string | null;
  platform_links?: PlatformLinkRow[] | null;
  recommended_platform?: string | null;
};

type ListeningBankRow = {
  bank_seconds: number;
  pending_seconds: number;
  approved_seconds?: number;
  rejected_seconds?: number;
  lifetime_seconds: number;
  today_seconds: number;
  weekly_seconds: number;
  monthly_seconds: number;
  available_reward_credits: number;
  seconds_to_next_credit: number;
  minutes_per_credit: number;
  daily_cap_minutes: number;
  level_number: number;
  level_name: string;
  rewards_enabled: boolean;
  community_points: number;
  community_rank: string;
  valid_listens: number;
  complete_listens: number;
  today_valid_listens: number;
  today_complete_listens: number;
  today_average_completion_rate: number;
  last_rejection_reason_code?: string | null;
  last_rejection_reason_description?: string | null;
  last_rejection_at?: string | null;
};

type DiscoveryRow = {
  slot_number?: number;
  rank?: number;
  ranking_score?: number;
  badge?: string;
  song_id: string;
  artist_id: string;
  title: string;
  artist_name: string;
  cover_image_url: string;
  music_url: string;
  platform: string;
  genre: string;
  song_language: string;
  reviews_received: number;
  average_rating: number;
  hook_score: number;
  total_listening_seconds: number;
  completion_rate: number;
  platform_links?: PlatformLinkRow[] | null;
  recommended_platform?: string | null;
};

type ExternalDiscoveryRow = DiscoveryRow & {
  feed_kind: string;
  feed_position: number;
  badge: string;
  feedback_focus: string[];
  country: string;
  submitted_at: string;
  comments_count: number;
  likes_count: number;
  followers_count: number;
};

type PlatformLinkRow = {
  platform: string;
  music_url: string;
  is_primary?: boolean;
  resolution_source?: string;
  confidence_score?: number;
};

type MissionRow = {
  mission_id: string;
  mission_key: string;
  title_en: string;
  title_es: string;
  description_en: string;
  description_es: string;
  target_count: number;
  progress_count: number;
  reward_kind: "listening_minutes" | "credit";
  reward_amount: number;
  completed: boolean;
  claimed: boolean;
};

type CommunityRow = {
  program_kind: "contest" | "event";
  program_id: string;
  title: string;
  description: string;
  genre: string | null;
  starts_at: string;
  ends_at: string;
  reward_description: string;
  entry_count: number;
};

type FollowedArtistRow = {
  artist_id: string;
  artist_name: string;
  followers: number;
  songs_submitted: number;
  average_rating: number;
  community_rank: string;
};

type TodaySupportRow = {
  songs_reviewed_today: number;
  songs_supported_today: number;
  creators_supported: number;
  listening_seconds_today: number;
  community_rank: string;
  valid_listens_today: number;
  complete_listens_today: number;
  average_completion_rate: number;
};

type CommunityNotificationRow = {
  notification_id: string;
  event_type: CommunityNotification["type"];
  actor_id: string | null;
  actor_name: string;
  song_id: string | null;
  song_title: string | null;
  is_read: boolean;
  created_at: string;
};

type CommunityNotificationSummaryRow = {
  unread_count: number;
  supporters_count: number;
  followers_count: number;
  reviews_count: number;
  valid_listens_count: number;
  most_supported_song_id: string | null;
  most_supported_song_title: string | null;
  most_supported_song_valid_listens: number;
  top_supporter_id: string | null;
  top_supporter_name: string | null;
};

type ContentEconomyRow = {
  platform: string;
  classification: "internal" | "external";
  compatibility_status:
    | "Partially Supported"
    | "Discovery Only"
    | "Not Recommended";
  current_token_cost: number;
  scheduled_token_cost: number;
  activation_at: string | null;
  effective_token_cost: number;
  activation_pending: boolean;
};

function mapDiscoveryRow(row: DiscoveryRow): DiscoverySong {
  const platform = platformLabels[row.platform] ?? "YouTube";
  const extended = row as DiscoveryRow & Partial<ExternalDiscoveryRow>;
  return {
    id: row.song_id,
    artistId: row.artist_id,
    title: row.title,
    artist: row.artist_name,
    coverUrl: safeCoverUrl(row.cover_image_url),
    link: row.music_url,
    platform,
    platformLinks: mapPlatformLinks(row.platform_links, platform, row.music_url),
    recommendedPlatform:
      row.recommended_platform && platformLabels[row.recommended_platform]
        ? platformLabels[row.recommended_platform]
        : platform,
    genre: row.genre,
    language: row.song_language,
    reviewsReceived: Number(row.reviews_received ?? 0),
    averageRating: Number(row.average_rating ?? 0),
    hookScore: Number(row.hook_score ?? 0),
    totalListeningSeconds: Number(row.total_listening_seconds ?? 0),
    completionRate: Number(row.completion_rate ?? 0),
    submittedAt: extended.submitted_at ?? undefined,
    commentsCount: Number(extended.comments_count ?? 0),
    likesCount: Number(extended.likes_count ?? 0),
    followersCount: Number(extended.followers_count ?? 0),
    badge: row.badge,
    position:
      row.slot_number === undefined
        ? row.rank === undefined
          ? undefined
          : Number(row.rank)
        : Number(row.slot_number),
    rankingScore:
      row.ranking_score === undefined
        ? undefined
        : Number(row.ranking_score),
  };
}

function mapPlatformLinks(
  rows: PlatformLinkRow[] | null | undefined,
  fallbackPlatform: DiscoverySong["platform"],
  fallbackUrl: string,
): SongPlatformLink[] {
  if (!rows?.length) {
    return [
      {
        platform: fallbackPlatform,
        url: fallbackUrl,
        primary: true,
        resolutionSource: "submitted",
        confidenceScore: 100,
      },
    ];
  }
  return rows.map((link) => ({
    platform: platformLabels[link.platform] ?? fallbackPlatform,
    url: link.music_url,
    primary: Boolean(link.is_primary),
    resolutionSource:
      link.resolution_source === "manual" ||
      link.resolution_source === "inferred" ||
      link.resolution_source === "verified"
        ? link.resolution_source
        : "submitted",
    confidenceScore: Number(link.confidence_score ?? 100),
  }));
}

export async function ProtectedAppPage({ initialView }: { initialView: View }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/${initialView}`);

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, founder_number, founder_free_submissions_remaining, credits, total_review_credits_earned, review_quality_score, languages_understood, genre_preferences, interface_language, onboarding_completed, role, community_visibility, autoplay_next_song, external_redirect_notice_disabled",
    )
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login?error=profile");

  const [
    { data: latestSong },
    { data: dashboardRows },
    { data: listeningRows },
    { data: spotlightRows },
    { data: topTenRows },
    { data: externalDiscoveryRows },
    { data: missionRows },
    { data: communityRows },
    { data: followedArtistRows },
    { data: previouslySupportedRows },
    { data: todaySupportRows },
    { data: notificationRows },
    { data: notificationSummaryRows },
    { data: contentEconomyRows },
    { data: platformRuntimeRows },
  ] = await Promise.all([
    supabase
      .from("songs")
      .select(
        "id, user_id, title, artist_name, genre, song_language, feedback_focus, country, platform, music_url, cover_image_url, explicit_content, created_at",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.rpc("get_my_song_dashboard_v2"),
    supabase.rpc("get_listening_bank_status_v2"),
    supabase.rpc("get_spotlight_songs"),
    supabase.rpc("get_top_ten_songs"),
    supabase.rpc("get_external_discovery_feed", { feed_limit: 48 }),
    supabase.rpc("get_daily_mission_status"),
    supabase.rpc("get_active_community_programs"),
    supabase.rpc("get_followed_artists", { queue_limit: 8 }),
    supabase.rpc("get_previously_supported_songs", { queue_limit: 8 }),
    supabase.rpc("get_today_support_summary"),
    supabase.rpc("get_my_community_notifications", {
      notification_limit: 20,
    }),
    supabase.rpc("get_my_community_notification_summary"),
    supabase.rpc("get_content_economy_settings"),
    supabase.rpc("get_platform_runtime"),
  ]);

  const { data: reviewRows } = latestSong
    ? await supabase
        .from("reviews")
        .select(
          "id, song_id, listen_full, add_to_playlist, grabbed_attention, share_with_friend, rating, comment, quality_score, quality_passed, listening_seconds, listening_duration_seconds, listening_completion_percent, created_at",
        )
        .eq("song_id", latestSong.id)
        .order("created_at", { ascending: false })
    : { data: [] };

  const song: Song | null = latestSong
    ? {
        id: latestSong.id,
        artistId: latestSong.user_id,
        title: latestSong.title,
        artist: latestSong.artist_name,
        genre: latestSong.genre,
        language: latestSong.song_language,
        feedbackFocus: latestSong.feedback_focus,
        country: latestSong.country,
        platform: platformLabels[latestSong.platform],
        link: latestSong.music_url,
        platformLinks: [
          {
            platform: platformLabels[latestSong.platform],
            url: latestSong.music_url,
            primary: true,
            resolutionSource: "submitted",
            confidenceScore: 100,
          },
        ],
        recommendedPlatform: platformLabels[latestSong.platform],
        coverUrl: safeCoverUrl(latestSong.cover_image_url),
        explicitContent: latestSong.explicit_content,
        accent: "#c8ff4f",
        submittedAt: latestSong.created_at,
      }
    : null;

  const songSummaries: SongDashboardSummary[] = (
    (dashboardRows ?? []) as DashboardRow[]
  ).map((row) => ({
    id: row.song_id,
    artistId: row.artist_id,
    title: row.title,
    artist: row.artist_name,
    coverUrl: safeCoverUrl(row.cover_image_url),
    link: row.music_url,
    platform: platformLabels[row.platform],
    platformLinks: mapPlatformLinks(
      row.platform_links,
      platformLabels[row.platform],
      row.music_url,
    ),
    recommendedPlatform:
      row.recommended_platform && platformLabels[row.recommended_platform]
        ? platformLabels[row.recommended_platform]
        : platformLabels[row.platform],
    genre: row.genre,
    language: row.song_language,
    submittedAt: row.submitted_at,
    reviewsReceived: Number(row.reviews_received ?? 0),
    averageRating: Number(row.average_rating ?? 0),
    hookScore: Number(row.hook_score ?? 0),
    reportCount: Number(row.report_count ?? 0),
    totalListeningSeconds: Number(row.total_listening_seconds ?? 0),
    averageListeningSeconds: Number(row.average_listening_seconds ?? 0),
    completionRate: Number(row.completion_rate ?? 0),
    playlistIntent: Number(row.playlist_intent ?? 0),
    shareIntent: Number(row.share_intent ?? 0),
    listenerRetention: Number(row.listener_retention ?? 0),
    boostStatus: row.boost_status ?? undefined,
  }));

  const reviews: Review[] = (reviewRows ?? []).map((review) => ({
    id: review.id,
    songId: review.song_id,
    reviewer: "Anonymous listener",
    listenFull: review.listen_full,
    addPlaylist: review.add_to_playlist,
    grabbedAttention: review.grabbed_attention,
    shareWithFriend: review.share_with_friend,
    rating: review.rating,
    comment: review.comment,
    qualityScore: review.quality_score,
    qualityPassed: review.quality_passed,
    listeningSeconds: Number(review.listening_seconds ?? 0),
    listeningDurationSeconds:
      review.listening_duration_seconds === null
        ? undefined
        : Number(review.listening_duration_seconds),
    listeningCompletionPercent:
      review.listening_completion_percent === null
        ? undefined
        : Number(review.listening_completion_percent),
    createdAt: review.created_at.slice(0, 10),
  }));

  const listeningRow = (
    Array.isArray(listeningRows) ? listeningRows[0] : listeningRows
  ) as ListeningBankRow | null;
  const listeningBank: ListeningBankStatus = {
    bankSeconds: Number(listeningRow?.bank_seconds ?? 0),
    pendingSeconds: Number(listeningRow?.pending_seconds ?? 0),
    approvedSeconds: Number(
      listeningRow?.approved_seconds ?? listeningRow?.today_seconds ?? 0,
    ),
    rejectedSeconds: Number(listeningRow?.rejected_seconds ?? 0),
    lifetimeSeconds: Number(listeningRow?.lifetime_seconds ?? 0),
    todaySeconds: Number(listeningRow?.today_seconds ?? 0),
    weeklySeconds: Number(listeningRow?.weekly_seconds ?? 0),
    monthlySeconds: Number(listeningRow?.monthly_seconds ?? 0),
    availableRewardCredits: Number(
      listeningRow?.available_reward_credits ?? 0,
    ),
    secondsToNextCredit: Number(listeningRow?.seconds_to_next_credit ?? 7200),
    minutesPerCredit: Number(listeningRow?.minutes_per_credit ?? 120),
    dailyCapMinutes: Number(listeningRow?.daily_cap_minutes ?? 180),
    levelNumber: Number(listeningRow?.level_number ?? 1),
    levelName: listeningRow?.level_name ?? "Explorer",
    rewardsEnabled: Boolean(listeningRow?.rewards_enabled ?? true),
    communityPoints: Number(listeningRow?.community_points ?? 0),
    communityRank: listeningRow?.community_rank ?? "New Member",
    validListens: Number(listeningRow?.valid_listens ?? 0),
    completeListens: Number(listeningRow?.complete_listens ?? 0),
    todayValidListens: Number(listeningRow?.today_valid_listens ?? 0),
    todayCompleteListens: Number(
      listeningRow?.today_complete_listens ?? 0,
    ),
    todayAverageCompletionRate: Number(
      listeningRow?.today_average_completion_rate ?? 0,
    ),
    lastRejectionReasonCode:
      listeningRow?.last_rejection_reason_code ?? undefined,
    lastRejectionReasonDescription:
      listeningRow?.last_rejection_reason_description ?? undefined,
    lastRejectionAt: listeningRow?.last_rejection_at ?? undefined,
  };

  const followedArtists: FollowedArtist[] = (
    (followedArtistRows ?? []) as FollowedArtistRow[]
  ).map((artist) => ({
    id: artist.artist_id,
    name: artist.artist_name,
    followers: Number(artist.followers ?? 0),
    songsSubmitted: Number(artist.songs_submitted ?? 0),
    averageRating: Number(artist.average_rating ?? 0),
    communityRank: artist.community_rank ?? "New Member",
  }));

  const todaySupportRow = (
    Array.isArray(todaySupportRows) ? todaySupportRows[0] : todaySupportRows
  ) as TodaySupportRow | null;
  const todaySupport: TodaySupportSummary = {
    songsReviewed: Number(todaySupportRow?.songs_reviewed_today ?? 0),
    songsSupported: Number(todaySupportRow?.songs_supported_today ?? 0),
    creatorsSupported: Number(todaySupportRow?.creators_supported ?? 0),
    listeningSeconds: Number(todaySupportRow?.listening_seconds_today ?? 0),
    communityRank: todaySupportRow?.community_rank ?? "New Member",
    validListens: Number(todaySupportRow?.valid_listens_today ?? 0),
    completeListens: Number(todaySupportRow?.complete_listens_today ?? 0),
    averageCompletionRate: Number(
      todaySupportRow?.average_completion_rate ?? 0,
    ),
  };

  const notifications: CommunityNotification[] = (
    (notificationRows ?? []) as CommunityNotificationRow[]
  ).map((notification) => ({
    id: notification.notification_id,
    type: notification.event_type,
    actorId: notification.actor_id ?? undefined,
    actorName: notification.actor_name,
    songId: notification.song_id ?? undefined,
    songTitle: notification.song_title ?? undefined,
    read: Boolean(notification.is_read),
    createdAt: notification.created_at,
  }));

  const notificationSummaryRow = (
    Array.isArray(notificationSummaryRows)
      ? notificationSummaryRows[0]
      : notificationSummaryRows
  ) as CommunityNotificationSummaryRow | null;
  const notificationSummary: CommunityNotificationSummary = {
    unreadCount: Number(notificationSummaryRow?.unread_count ?? 0),
    supportersCount: Number(notificationSummaryRow?.supporters_count ?? 0),
    followersCount: Number(notificationSummaryRow?.followers_count ?? 0),
    reviewsCount: Number(notificationSummaryRow?.reviews_count ?? 0),
    validListensCount: Number(
      notificationSummaryRow?.valid_listens_count ?? 0,
    ),
    mostSupportedSongId:
      notificationSummaryRow?.most_supported_song_id ?? undefined,
    mostSupportedSongTitle:
      notificationSummaryRow?.most_supported_song_title ?? undefined,
    mostSupportedSongValidListens: Number(
      notificationSummaryRow?.most_supported_song_valid_listens ?? 0,
    ),
    topSupporterId: notificationSummaryRow?.top_supporter_id ?? undefined,
    topSupporterName:
      notificationSummaryRow?.top_supporter_name ?? undefined,
  };

  const missionRow = (
    Array.isArray(missionRows) ? missionRows[0] : missionRows
  ) as MissionRow | null;
  const dailyMission: DailyMissionStatus | null = missionRow
    ? {
        id: missionRow.mission_id,
        key: missionRow.mission_key,
        titleEn: missionRow.title_en,
        titleEs: missionRow.title_es,
        descriptionEn: missionRow.description_en,
        descriptionEs: missionRow.description_es,
        targetCount: Number(missionRow.target_count),
        progressCount: Number(missionRow.progress_count),
        rewardKind: missionRow.reward_kind,
        rewardAmount: Number(missionRow.reward_amount),
        completed: Boolean(missionRow.completed),
        claimed: Boolean(missionRow.claimed),
      }
    : null;

  const communityPrograms: CommunityProgram[] = (
    (communityRows ?? []) as CommunityRow[]
  ).map((row) => ({
    kind: row.program_kind,
    id: row.program_id,
    title: row.title,
    description: row.description,
    genre: row.genre ?? undefined,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    rewardDescription: row.reward_description || undefined,
    entryCount: Number(row.entry_count ?? 0),
  }));
  const platformConfig = platformRuntimeRows
    ? mapPlatformControlState(platformRuntimeRows).config
    : defaultPlatformControlConfig;

  return (
    <ProtectedAppEntry
      initialView={initialView}
      profile={{
        account: {
          id: user.id,
          displayName: profile.display_name,
          email: user.email ?? "",
          initials: getInitials(profile.display_name),
        },
        founder: profile.founder_number !== null,
        founderSubmissionsRemaining: Number(
          profile.founder_free_submissions_remaining ?? 0,
        ),
        reviewCredits: Number(profile.credits ?? 0),
        totalCreditsEarned: Number(profile.total_review_credits_earned ?? 0),
        reviewQualityScore: Math.round(Number(profile.review_quality_score ?? 100)),
        languages: (profile.languages_understood ?? []) as ListenerLanguage[],
        genres: (profile.genre_preferences ?? []) as Genre[],
        locale: (profile.interface_language === "es" ? "es" : "en") as InterfaceLocale,
        onboardingCompleted: Boolean(profile.onboarding_completed),
        role: profile.role,
        communityVisibility:
          profile.community_visibility === "anonymous" ? "anonymous" : "public",
        autoplayNextSong: Boolean(profile.autoplay_next_song),
        externalRedirectNoticeDisabled: Boolean(
          profile.external_redirect_notice_disabled,
        ),
        contentEconomy: (
          (contentEconomyRows ?? []) as ContentEconomyRow[]
        ).map(
          (setting): ContentEconomySetting => ({
            platform: platformLabels[setting.platform],
            classification: setting.classification,
            compatibilityStatus: setting.compatibility_status,
            currentTokenCost: Number(setting.current_token_cost),
            scheduledTokenCost: Number(setting.scheduled_token_cost),
            activationAt: setting.activation_at ?? undefined,
            effectiveTokenCost: Number(setting.effective_token_cost),
            activationPending: Boolean(setting.activation_pending),
          }),
        ),
        song,
        songSummaries,
        reviews,
        listeningBank,
        spotlightSongs: ((spotlightRows ?? []) as DiscoveryRow[]).map(
          mapDiscoveryRow,
        ),
        topTenSongs: ((topTenRows ?? []) as DiscoveryRow[]).map(
          mapDiscoveryRow,
        ),
        externalDiscoverySongs: (
          (externalDiscoveryRows ?? []) as ExternalDiscoveryRow[]
        ).map((row) => ({
          ...mapDiscoveryRow(row),
          badge: row.badge,
          feedKind: row.feed_kind,
          position: Number(row.feed_position ?? 0),
        })),
        followedArtists,
        previouslySupportedSongs: (
          (previouslySupportedRows ?? []) as DiscoveryRow[]
        ).map(mapDiscoveryRow),
        todaySupport,
        notifications,
        notificationSummary,
        dailyMission,
        communityPrograms,
        platformConfig,
      }}
    />
  );
}
