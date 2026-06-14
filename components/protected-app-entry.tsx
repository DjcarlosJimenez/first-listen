"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  FirstListenApp,
  type DiscoveryDestination,
  type View,
} from "@/components/first-listen-app";
import { Onboarding, type OnboardingPreferences } from "@/components/onboarding";
import type { Genre, InterfaceLocale, ListenerLanguage } from "@/lib/catalog";
import type { PlatformControlConfig } from "@/lib/platform-control";
import { createClient } from "@/lib/supabase/client";
import type {
  AccountSummary,
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
  SongDashboardSummary,
  TodaySupportSummary,
} from "@/lib/types";

type ProfileSeed = {
  account: AccountSummary;
  founder: boolean;
  founderSubmissionsRemaining: number;
  reviewCredits: number;
  totalCreditsEarned: number;
  reviewQualityScore: number;
  languages: ListenerLanguage[];
  genres: Genre[];
  locale: InterfaceLocale;
  onboardingCompleted: boolean;
  role: "super_admin" | "admin" | "moderator" | "user";
  communityVisibility: "public" | "anonymous";
  autoplayNextSong: boolean;
  externalRedirectNoticeDisabled: boolean;
  contentEconomy: ContentEconomySetting[];
  song: Song | null;
  songSummaries: SongDashboardSummary[];
  reviews: Review[];
  listeningBank: ListeningBankStatus;
  spotlightSongs: DiscoverySong[];
  topTenSongs: DiscoverySong[];
  externalDiscoverySongs: DiscoverySong[];
  followedArtists: FollowedArtist[];
  previouslySupportedSongs: DiscoverySong[];
  todaySupport: TodaySupportSummary;
  notifications: CommunityNotification[];
  notificationSummary: CommunityNotificationSummary;
  dailyMission: DailyMissionStatus | null;
  communityPrograms: CommunityProgram[];
  platformConfig: PlatformControlConfig;
};

export function ProtectedAppEntry({
  discoveryDestination,
  initialView,
  profile,
}: {
  discoveryDestination?: DiscoveryDestination;
  initialView: View;
  profile: ProfileSeed;
}) {
  const router = useRouter();
  const [locale, setLocale] = useState(profile.locale);
  const [onboarded, setOnboarded] = useState(profile.onboardingCompleted);
  const [languages, setLanguages] = useState(profile.languages);
  const [genres, setGenres] = useState(profile.genres);

  useEffect(() => {
    const guestToken = window.localStorage.getItem(
      "first-listen-guest-token",
    );
    if (!guestToken) return;
    const supabase = createClient();
    if (!supabase) return;
    void supabase
      .rpc("convert_guest_to_account", {
        guest_access_token: guestToken,
      })
      .then(({ error }) => {
        if (error) return;
        window.localStorage.removeItem("first-listen-guest-token");
        window.localStorage.removeItem("first-listen-guest-recovery-code");
        document.cookie =
          "first-listen-guest-token=; Max-Age=0; Path=/; SameSite=Lax; Secure";
        router.refresh();
      });
  }, [router]);

  const changeLocale = (nextLocale: InterfaceLocale) => {
    setLocale(nextLocale);
    window.localStorage.setItem("first-listen-locale", nextLocale);
    document.documentElement.lang = nextLocale;
    const supabase = createClient();
    if (supabase) {
      void supabase.rpc("set_interface_language", {
        profile_interface_language: nextLocale,
      });
    }
  };

  const completeOnboarding = async (preferences: OnboardingPreferences) => {
    const supabase = createClient();
    if (!supabase) return;
    const { error } = await supabase.rpc("save_onboarding_preferences", {
      profile_languages: preferences.languages,
      profile_genres: preferences.genres,
      profile_interface_language: locale,
    });
    if (error) return;
    setLanguages(preferences.languages);
    setGenres(preferences.genres);
    setOnboarded(true);
  };

  const logout = async () => {
    const supabase = createClient();
    if (supabase) await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  if (!onboarded) {
    return (
      <Onboarding
        locale={locale}
        onComplete={completeOnboarding}
        onLocaleChange={changeLocale}
      />
    );
  }

  return (
    <FirstListenApp
      discoveryDestination={discoveryDestination}
      genrePreferences={genres}
      account={profile.account}
      initialFounder={profile.founder}
      initialFounderSubmissionsRemaining={profile.founderSubmissionsRemaining}
      initialReviewCredits={profile.reviewCredits}
      initialReviewQualityScore={profile.reviewQualityScore}
      initialSongReviews={profile.reviews}
      initialSongSummaries={profile.songSummaries}
      initialTotalCreditsEarned={profile.totalCreditsEarned}
      initialUserSong={profile.song}
      initialListeningBank={profile.listeningBank}
      initialSpotlightSongs={profile.spotlightSongs}
      initialTopTenSongs={profile.topTenSongs}
      initialExternalDiscoverySongs={profile.externalDiscoverySongs}
      initialFollowedArtists={profile.followedArtists}
      initialPreviouslySupportedSongs={profile.previouslySupportedSongs}
      initialTodaySupport={profile.todaySupport}
      initialNotifications={profile.notifications}
      initialNotificationSummary={profile.notificationSummary}
      initialCommunityVisibility={profile.communityVisibility}
      initialAutoplayNextSong={profile.autoplayNextSong}
      initialExternalRedirectNoticeDisabled={
        profile.externalRedirectNoticeDisabled
      }
      contentEconomy={profile.contentEconomy}
      initialDailyMission={profile.dailyMission}
      initialCommunityPrograms={profile.communityPrograms}
      platformConfig={profile.platformConfig}
      initialView={initialView}
      listenerLanguages={languages}
      locale={locale}
      onLocaleChange={changeLocale}
      onLogout={logout}
      role={profile.role}
    />
  );
}
