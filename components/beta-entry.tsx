"use client";

import { useEffect, useState } from "react";
import { FirstListenApp } from "@/components/first-listen-app";
import { Onboarding, type OnboardingPreferences } from "@/components/onboarding";
import { PublicLanding } from "@/components/public-landing";
import type { Genre, InterfaceLocale, ListenerLanguage } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/client";

type EntryState = "loading" | "public" | "onboarding" | "app";
type ProfileSeed = {
  founder: boolean;
  founderFree: boolean;
  reviewCredits: number;
  totalCreditsEarned: number;
  reviewQualityScore: number;
  languages: ListenerLanguage[];
  genres: Genre[];
};

export function BetaEntry() {
  const [entryState, setEntryState] = useState<EntryState>("loading");
  const [founderRemaining, setFounderRemaining] = useState(50);
  const [profileSeed, setProfileSeed] = useState<ProfileSeed | null>(null);
  const [locale, setLocale] = useState<InterfaceLocale>("en");

  useEffect(() => {
    const supabase = createClient();
    const demoSignedIn = window.localStorage.getItem("first-listen-demo-auth") === "true";
    const storedRemaining = window.localStorage.getItem("first-listen-founder-remaining");
    const storedLocale = window.localStorage.getItem("first-listen-locale") as InterfaceLocale | null;

    if (storedRemaining) setFounderRemaining(Number(storedRemaining));
    if (storedLocale === "en" || storedLocale === "es") {
      setLocale(storedLocale);
      document.documentElement.lang = storedLocale;
    }

    if (!supabase) {
      const onboarded = window.localStorage.getItem("first-listen-onboarded") === "true";
      setEntryState(demoSignedIn ? (onboarded ? "app" : "onboarding") : "public");
      return;
    }

    const loadProfile = async (userId: string) => {
      const { data } = await supabase
        .from("profiles")
        .select(
          "founder_number, founder_free_submission_available, review_credits, total_review_credits_earned, review_quality_score, languages_understood, genre_preferences, interface_language, onboarding_completed",
        )
        .eq("id", userId)
        .maybeSingle();

      if (data) {
        setProfileSeed({
          founder: data.founder_number !== null,
          founderFree: data.founder_free_submission_available,
          reviewCredits: data.review_credits,
          totalCreditsEarned: data.total_review_credits_earned,
          reviewQualityScore: Math.round(Number(data.review_quality_score)),
          languages: data.languages_understood ?? [],
          genres: data.genre_preferences ?? [],
        });
        if (data.interface_language === "en" || data.interface_language === "es") {
          setLocale(data.interface_language);
        }
        return Boolean(data.onboarding_completed);
      }
      return false;
    };

    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        const onboarded = await loadProfile(data.session.user.id);
        setEntryState(onboarded ? "app" : "onboarding");
      } else {
        setEntryState("public");
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        const onboarded = await loadProfile(session.user.id);
        setEntryState(onboarded ? "app" : "onboarding");
      } else {
        setProfileSeed(null);
        setEntryState("public");
      }
    });

    supabase
      .from("founder_program")
      .select("capacity, claimed_count")
      .eq("id", true)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setFounderRemaining(Math.max(0, data.capacity - data.claimed_count));
      });

    return () => listener.subscription.unsubscribe();
  }, []);

  const authenticate = async (claimFounder: boolean) => {
    const supabase = createClient();

    if (!supabase) {
      window.localStorage.setItem("first-listen-demo-auth", "true");
      if (claimFounder && founderRemaining > 0) {
        const alreadyClaimed = window.localStorage.getItem("first-listen-founder") === "true";
        if (!alreadyClaimed) {
          const nextRemaining = Math.max(0, founderRemaining - 1);
          setFounderRemaining(nextRemaining);
          window.localStorage.setItem("first-listen-founder-remaining", String(nextRemaining));
          window.localStorage.setItem("first-listen-founder", "true");
          window.localStorage.setItem("first-listen-founder-free", "true");
        }
      }
      const onboarded = window.localStorage.getItem("first-listen-onboarded") === "true";
      setEntryState(onboarded ? "app" : "onboarding");
      return;
    }

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  const changeLocale = (nextLocale: InterfaceLocale) => {
    setLocale(nextLocale);
    window.localStorage.setItem("first-listen-locale", nextLocale);
    document.documentElement.lang = nextLocale;

    const supabase = createClient();
    if (supabase) {
      supabase.auth.getUser().then(({ data }) => {
        if (data.user) {
          void supabase.rpc("set_interface_language", {
            profile_interface_language: nextLocale,
          });
        }
      });
    }
  };

  const completeOnboarding = async (preferences: OnboardingPreferences) => {
    const supabase = createClient();
    if (supabase) {
      const { error } = await supabase.rpc("save_onboarding_preferences", {
        profile_languages: preferences.languages,
        profile_genres: preferences.genres,
        profile_interface_language: locale,
      });
      if (error) return;
    } else {
      window.localStorage.setItem(
        "first-listen-listener-languages",
        JSON.stringify(preferences.languages),
      );
      window.localStorage.setItem(
        "first-listen-genre-preferences",
        JSON.stringify(preferences.genres),
      );
      window.localStorage.setItem("first-listen-onboarded", "true");
    }

    setProfileSeed((current) => ({
      founder:
        current?.founder ??
        window.localStorage.getItem("first-listen-founder") === "true",
      founderFree:
        current?.founderFree ??
        window.localStorage.getItem("first-listen-founder-free") === "true",
      reviewCredits:
        current?.reviewCredits ??
        Number(window.localStorage.getItem("first-listen-review-count") ?? 3),
      totalCreditsEarned:
        current?.totalCreditsEarned ??
        Number(window.localStorage.getItem("first-listen-total-credits") ?? 3),
      reviewQualityScore: current?.reviewQualityScore ?? 92,
      languages: preferences.languages,
      genres: preferences.genres,
    }));
    setEntryState("app");
  };

  const signOut = async () => {
    const supabase = createClient();
    if (supabase) await supabase.auth.signOut();
    window.localStorage.removeItem("first-listen-demo-auth");
    setEntryState("public");
  };

  const joinWaitlist = async (email: string) => {
    const supabase = createClient();
    if (supabase) {
      const { error } = await supabase.from("waitlist").insert({ email });
      return !error || error.code === "23505";
    }

    window.localStorage.setItem("first-listen-waitlist-email", email);
    return true;
  };

  if (entryState === "loading") {
    return (
      <div className="entry-loading">
        <span />
        <p>
          {locale === "es"
            ? "Preparando tu primera escucha..."
            : "Preparing your first listen..."}
        </p>
      </div>
    );
  }

  if (entryState === "public") {
    return (
      <PublicLanding
        founderRemaining={founderRemaining}
        locale={locale}
        onLocaleChange={changeLocale}
        onJoinWaitlist={joinWaitlist}
        onLogin={() => authenticate(false)}
        onSignUp={() => authenticate(true)}
      />
    );
  }

  if (entryState === "onboarding") {
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
      genrePreferences={profileSeed?.genres}
      initialFounder={profileSeed?.founder}
      initialFounderFree={profileSeed?.founderFree}
      initialReviewCredits={profileSeed?.reviewCredits}
      initialReviewQualityScore={profileSeed?.reviewQualityScore}
      initialTotalCreditsEarned={profileSeed?.totalCreditsEarned}
      listenerLanguages={profileSeed?.languages}
      locale={locale}
      onLocaleChange={changeLocale}
      onLogout={signOut}
    />
  );
}
