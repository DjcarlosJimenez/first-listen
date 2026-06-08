"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PublicLanding } from "@/components/public-landing";
import type { InterfaceLocale } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/client";

export function PublicEntry({ initialFounderRemaining }: { initialFounderRemaining: number }) {
  const router = useRouter();
  const [founderRemaining, setFounderRemaining] = useState(initialFounderRemaining);
  const [locale, setLocale] = useState<InterfaceLocale>("en");

  useEffect(() => {
    const storedLocale = window.localStorage.getItem("first-listen-locale");
    if (storedLocale === "en" || storedLocale === "es") {
      setLocale(storedLocale);
      document.documentElement.lang = storedLocale;
    }

    const supabase = createClient();
    if (!supabase) return;

    const loadFounderCount = async () => {
      const { data } = await supabase
        .from("founder_program")
        .select("capacity, claimed_count")
        .eq("id", true)
        .maybeSingle();
      if (data) setFounderRemaining(Math.max(0, data.capacity - data.claimed_count));
    };

    void loadFounderCount();
    const channel = supabase
      .channel("founder-program-count")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "founder_program" },
        () => void loadFounderCount(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const changeLocale = (nextLocale: InterfaceLocale) => {
    setLocale(nextLocale);
    window.localStorage.setItem("first-listen-locale", nextLocale);
    document.documentElement.lang = nextLocale;
  };

  const joinWaitlist = async (email: string) => {
    const supabase = createClient();
    if (!supabase) return false;
    const { error } = await supabase.from("waitlist").insert({ email });
    return !error || error.code === "23505";
  };

  return (
    <PublicLanding
      founderRemaining={founderRemaining}
      locale={locale}
      onJoinWaitlist={joinWaitlist}
      onLocaleChange={changeLocale}
      onLogin={() => router.push("/login")}
      onSignUp={() => router.push("/signup")}
    />
  );
}
