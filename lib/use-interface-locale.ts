"use client";

import { useEffect, useState } from "react";
import type { InterfaceLocale } from "@/lib/catalog";

export const INTERFACE_LOCALE_KEY = "first-listen-locale";
export const EXPLICIT_INTERFACE_LOCALE_KEY =
  "first-listen-locale-explicit";

function isInterfaceLocale(value: string | null): value is InterfaceLocale {
  return value === "es" || value === "en";
}

export function detectDeviceLocale(
  defaultLocale: InterfaceLocale = "es",
): InterfaceLocale {
  if (typeof window === "undefined") return defaultLocale;
  const preferredLanguage =
    window.navigator.languages?.[0] || window.navigator.language || "";
  if (!preferredLanguage) return defaultLocale;
  return preferredLanguage.toLocaleLowerCase().startsWith("es") ? "es" : "en";
}

export function preferredInterfaceLocale(
  defaultLocale: InterfaceLocale = "es",
): InterfaceLocale {
  if (typeof window === "undefined") return defaultLocale;
  const explicitLocale = window.localStorage.getItem(
    EXPLICIT_INTERFACE_LOCALE_KEY,
  );
  return isInterfaceLocale(explicitLocale)
    ? explicitLocale
    : detectDeviceLocale(defaultLocale);
}

export function persistInterfaceLocale(
  locale: InterfaceLocale,
  explicit = false,
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(INTERFACE_LOCALE_KEY, locale);
  if (explicit) {
    window.localStorage.setItem(EXPLICIT_INTERFACE_LOCALE_KEY, locale);
  }
  document.documentElement.lang = locale;
  window.dispatchEvent(
    new CustomEvent<InterfaceLocale>("first-listen-locale-change", {
      detail: locale,
    }),
  );
}

export function useInterfaceLocale(defaultLocale: InterfaceLocale = "es") {
  const [locale, setLocale] = useState<InterfaceLocale>(defaultLocale);

  useEffect(() => {
    const preferredLocale = preferredInterfaceLocale(defaultLocale);
    setLocale(preferredLocale);
    persistInterfaceLocale(preferredLocale);

    const handleLocaleChange = (event: Event) => {
      const nextLocale = (event as CustomEvent<InterfaceLocale>).detail;
      if (nextLocale === "es" || nextLocale === "en") setLocale(nextLocale);
    };
    window.addEventListener("first-listen-locale-change", handleLocaleChange);
    return () =>
      window.removeEventListener(
        "first-listen-locale-change",
        handleLocaleChange,
      );
  }, [defaultLocale]);

  return locale;
}
