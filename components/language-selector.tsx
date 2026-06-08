"use client";

import type { InterfaceLocale } from "@/lib/catalog";

export function LanguageSelector({
  locale,
  onChange,
  compact = false,
}: {
  locale: InterfaceLocale;
  onChange: (locale: InterfaceLocale) => void;
  compact?: boolean;
}) {
  return (
    <label className={compact ? "language-selector compact" : "language-selector"}>
      <span>{locale === "es" ? "Idioma" : "Language"}</span>
      <select
        aria-label={locale === "es" ? "Seleccionar idioma" : "Select language"}
        onChange={(event) => onChange(event.target.value as InterfaceLocale)}
        value={locale}
      >
        <option value="en">EN</option>
        <option value="es">ES</option>
      </select>
    </label>
  );
}
