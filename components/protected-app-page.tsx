import { redirect } from "next/navigation";
import { ProtectedAppEntry } from "@/components/protected-app-entry";
import type { View } from "@/components/first-listen-app";
import type { Genre, InterfaceLocale, ListenerLanguage } from "@/lib/catalog";
import { getInitials, platformLabels } from "@/lib/discovery";
import { createClient } from "@/lib/supabase/server";
import type { Review, Song, SongDashboardSummary } from "@/lib/types";

type DashboardRow = {
  song_id: string;
  title: string;
  artist_name: string;
  platform: string;
  submitted_at: string;
  reviews_received: number;
  average_rating: number;
  hook_score: number;
  report_count: number;
};

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

  const [{ data: latestSong }, { data: dashboardRows }] = await Promise.all([
    supabase
      .from("songs")
      .select(
        "id, user_id, title, artist_name, genre, song_language, feedback_focus, country, platform, music_url, cover_image_url, explicit_content, created_at",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.rpc("get_my_song_dashboard"),
  ]);

  const { data: reviewRows } = latestSong
    ? await supabase
        .from("reviews")
        .select(
          "id, song_id, listen_full, add_to_playlist, grabbed_attention, share_with_friend, rating, comment, quality_score, quality_passed, created_at",
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
        coverUrl: latestSong.cover_image_url,
        explicitContent: latestSong.explicit_content,
        accent: "#c8ff4f",
        submittedAt: latestSong.created_at,
      }
    : null;

  const songSummaries: SongDashboardSummary[] = (
    (dashboardRows ?? []) as DashboardRow[]
  ).map((row) => ({
    id: row.song_id,
    title: row.title,
    artist: row.artist_name,
    platform: platformLabels[row.platform],
    submittedAt: row.submitted_at,
    reviewsReceived: Number(row.reviews_received ?? 0),
    averageRating: Number(row.average_rating ?? 0),
    hookScore: Number(row.hook_score ?? 0),
    reportCount: Number(row.report_count ?? 0),
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
    createdAt: review.created_at.slice(0, 10),
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
      }}
    />
  );
}
