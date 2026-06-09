import { redirect } from "next/navigation";
import { ProtectedAppEntry } from "@/components/protected-app-entry";
import type { View } from "@/components/first-listen-app";
import type { Genre, InterfaceLocale, ListenerLanguage } from "@/lib/catalog";
import { getInitials, platformLabels } from "@/lib/discovery";
import { safeCoverUrl } from "@/lib/media";
import { createClient } from "@/lib/supabase/server";
import type {
  CommunityProgram,
  DailyMissionStatus,
  DiscoverySong,
  ListeningBankStatus,
  Review,
  Song,
  SongDashboardSummary,
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
};

type ListeningBankRow = {
  bank_seconds: number;
  pending_seconds: number;
  lifetime_seconds: number;
  today_seconds: number;
  available_reward_credits: number;
  seconds_to_next_credit: number;
  minutes_per_credit: number;
  daily_cap_minutes: number;
  level_number: number;
  level_name: string;
  rewards_enabled: boolean;
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

function mapDiscoveryRow(row: DiscoveryRow): DiscoverySong {
  return {
    id: row.song_id,
    artistId: row.artist_id,
    title: row.title,
    artist: row.artist_name,
    coverUrl: safeCoverUrl(row.cover_image_url),
    link: row.music_url,
    platform: platformLabels[row.platform],
    genre: row.genre,
    language: row.song_language,
    reviewsReceived: Number(row.reviews_received ?? 0),
    averageRating: Number(row.average_rating ?? 0),
    hookScore: Number(row.hook_score ?? 0),
    totalListeningSeconds: Number(row.total_listening_seconds ?? 0),
    completionRate: Number(row.completion_rate ?? 0),
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

export async function ProtectedAppPage({ initialView }: { initialView: View }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/${initialView}`);

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, founder_number, credits, total_review_credits_earned, review_quality_score, languages_understood, genre_preferences, interface_language, onboarding_completed, role",
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
    { data: missionRows },
    { data: communityRows },
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
    supabase.rpc("get_daily_mission_status"),
    supabase.rpc("get_active_community_programs"),
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
    lifetimeSeconds: Number(listeningRow?.lifetime_seconds ?? 0),
    todaySeconds: Number(listeningRow?.today_seconds ?? 0),
    availableRewardCredits: Number(
      listeningRow?.available_reward_credits ?? 0,
    ),
    secondsToNextCredit: Number(listeningRow?.seconds_to_next_credit ?? 7200),
    minutesPerCredit: Number(listeningRow?.minutes_per_credit ?? 120),
    dailyCapMinutes: Number(listeningRow?.daily_cap_minutes ?? 180),
    levelNumber: Number(listeningRow?.level_number ?? 1),
    levelName: listeningRow?.level_name ?? "Explorer",
    rewardsEnabled: Boolean(listeningRow?.rewards_enabled ?? true),
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
        reviewCredits: Number(profile.credits ?? 0),
        totalCreditsEarned: Number(profile.total_review_credits_earned ?? 0),
        reviewQualityScore: Math.round(Number(profile.review_quality_score ?? 100)),
        languages: (profile.languages_understood ?? []) as ListenerLanguage[],
        genres: (profile.genre_preferences ?? []) as Genre[],
        locale: (profile.interface_language === "es" ? "es" : "en") as InterfaceLocale,
        onboardingCompleted: Boolean(profile.onboarding_completed),
        role: profile.role,
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
        dailyMission,
        communityPrograms,
      }}
    />
  );
}
