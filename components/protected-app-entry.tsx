"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FirstListenApp, type View } from "@/components/first-listen-app";
import { Onboarding, type OnboardingPreferences } from "@/components/onboarding";
import type { Genre, InterfaceLocale, ListenerLanguage } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/client";
import type {
  AccountSummary,
  ListeningBankStatus,
  Review,
  Song,
  SongDashboardSummary,
} from "@/lib/types";

type ProfileSeed = {
  account: AccountSummary;
  founder: boolean;
  reviewCredits: number;
  totalCreditsEarned: number;
  reviewQualityScore: number;
  languages: ListenerLanguage[];
  genres: Genre[];
  locale: InterfaceLocale;
  onboardingCompleted: boolean;
  role: "super_admin" | "admin" | "moderator" | "user";
  song: Song | null;
  songSummaries: SongDashboardSummary[];
  reviews: Review[];
  listeningBank: ListeningBankStatus;
};

export function ProtectedAppEntry({
  initialView,
  profile,
}: {
  initialView: View;
  profile: ProfileSeed;
}) {
  const router = useRouter();
  const [locale, setLocale] = useState(profile.locale);
  const [onboarded, setOnboarded] = useState(profile.onboardingCompleted);
  const [languages, setLanguages] = useState(profile.languages);
  const [genres, setGenres] = useState(profile.genres);

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
      genrePreferences={genres}
      account={profile.account}
      initialFounder={profile.founder}
      initialFounderFree={false}
      initialReviewCredits={profile.reviewCredits}
      initialReviewQualityScore={profile.reviewQualityScore}
      initialSongReviews={profile.reviews}
      initialSongSummaries={profile.songSummaries}
      initialTotalCreditsEarned={profile.totalCreditsEarned}
      initialUserSong={profile.song}
      initialListeningBank={profile.listeningBank}
      initialView={initialView}
      listenerLanguages={languages}
      locale={locale}
      onLocaleChange={changeLocale}
      onLogout={logout}
      role={profile.role}
    />
  );
}
