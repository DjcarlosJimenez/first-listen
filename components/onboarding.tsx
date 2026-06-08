"use client";

import { ArrowRight, Check, Globe2, Music2, Sparkles } from "lucide-react";
import { useState } from "react";
import {
  defaultGenrePreferences,
  defaultListenerLanguages,
  genreOptions,
  languageOptions,
  type Genre,
  type InterfaceLocale,
  type ListenerLanguage,
} from "@/lib/catalog";
import { getCopy, optionLabel } from "@/lib/i18n";
import { LanguageSelector } from "@/components/language-selector";
import { Logo } from "@/components/logo";

export type OnboardingPreferences = {
  languages: ListenerLanguage[];
  genres: Genre[];
};

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

export function Onboarding({
  locale,
  onLocaleChange,
  onComplete,
}: {
  locale: InterfaceLocale;
  onLocaleChange: (locale: InterfaceLocale) => void;
  onComplete: (preferences: OnboardingPreferences) => Promise<void>;
}) {
  const copy = getCopy(locale);
  const [languages, setLanguages] = useState<ListenerLanguage[]>(defaultListenerLanguages);
  const [genres, setGenres] = useState<Genre[]>(defaultGenrePreferences);
  const [saving, setSaving] = useState(false);

  const complete = async () => {
    if (!languages.length || !genres.length) return;
    setSaving(true);
    await onComplete({ languages, genres });
    setSaving(false);
  };

  return (
    <div className="onboarding-page">
      <header className="onboarding-nav">
        <Logo />
        <LanguageSelector locale={locale} onChange={onLocaleChange} />
      </header>
      <main className="onboarding-card">
        <div className="onboarding-heading">
          <span className="onboarding-icon"><Sparkles size={25} /></span>
          <div>
            <span className="eyebrow">{copy.onboarding.eyebrow}</span>
            <h1>{copy.onboarding.title}</h1>
            <p>{copy.onboarding.body}</p>
          </div>
        </div>

        <section className="preference-section">
          <div>
            <Globe2 size={20} />
            <span>
              <strong>{copy.onboarding.languages}</strong>
              <small>{copy.onboarding.hint}</small>
            </span>
          </div>
          <div className="preference-grid">
            {languageOptions.map((language) => (
              <button
                className={languages.includes(language) ? "selected" : ""}
                key={language}
                onClick={() => setLanguages(toggleValue(languages, language))}
                type="button"
              >
                {languages.includes(language) && <Check size={14} />}
                {optionLabel(locale, language)}
              </button>
            ))}
          </div>
        </section>

        <section className="preference-section">
          <div>
            <Music2 size={20} />
            <span>
              <strong>{copy.onboarding.genres}</strong>
              <small>{copy.onboarding.hint}</small>
            </span>
          </div>
          <div className="preference-grid genres">
            {genreOptions.map((genre) => (
              <button
                className={genres.includes(genre) ? "selected" : ""}
                key={genre}
                onClick={() => setGenres(toggleValue(genres, genre))}
                type="button"
              >
                {genres.includes(genre) && <Check size={14} />}
                {optionLabel(locale, genre)}
              </button>
            ))}
          </div>
        </section>

        <button
          className="onboarding-continue"
          disabled={!languages.length || !genres.length || saving}
          onClick={complete}
        >
          {saving ? "..." : copy.onboarding.continue}
          <ArrowRight size={17} />
        </button>
      </main>
    </div>
  );
}
