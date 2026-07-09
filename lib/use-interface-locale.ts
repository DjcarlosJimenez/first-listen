"use client";

import { useEffect, useState } from "react";
import type { InterfaceLocale } from "@/lib/catalog";

export function useInterfaceLocale(defaultLocale: InterfaceLocale = "es") {
  const [locale, setLocale] = useState<InterfaceLocale>(defaultLocale);

  useEffect(() => {
    const stored = window.localStorage.getItem("first-listen-locale");
    if (stored === "es" || stored === "en") {
      setLocale(stored);
      document.documentElement.lang = stored;
    }
  }, []);

  return locale;
}
