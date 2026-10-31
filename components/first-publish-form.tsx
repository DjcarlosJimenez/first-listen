"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  Link2,
  LoaderCircle,
  Mail,
  Music2,
  ShieldCheck,
} from "lucide-react";
import {
  genreOptions,
  songLanguageOptions,
  type Genre,
  type SongLanguage,
} from "@/lib/catalog";
import {
  firstPublishFunnelLabels,
  trackFirstPublishStage,
  type FirstPublishContentKind,
} from "@/lib/first-publish";
import { optionLabel } from "@/lib/i18n";

type MetadataResult = {
  artistName?: string;
  coverImageUrl?: string;
  durationSeconds?: number | null;
  error?: string;
  platform?: string;
  title?: string;
};

const countries = [
  "United States",
  "Mexico",
  "Canada",
  "Spain",
  "Colombia",
  "Argentina",
  "Dominican Republic",
  "Puerto Rico",
  "Honduras",
  "Guatemala",
  "El Salvador",
  "Other",
];

function durationParts(value: number | null | undefined) {
  const duration = Math.round(Number(value));
  if (!Number.isFinite(duration) || duration < 15 || duration > 480) return null;
  return {
    minutes: String(Math.floor(duration / 60)),
    seconds: String(duration % 60),
  };
}

export function FirstPublishForm() {
  const [locale, setLocale] = useState<"es" | "en">("es");
  const [email, setEmail] = useState("");
  const [musicUrl, setMusicUrl] = useState("");
  const [title, setTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [genre, setGenre] = useState<Genre | "">("");
  const [songLanguage, setSongLanguage] = useState<SongLanguage | "">("");
  const [country, setCountry] = useState("");
  const [contentKind, setContentKind] =
    useState<FirstPublishContentKind>("song");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [platform, setPlatform] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const autoTitle = useRef("");
  const autoArtist = useRef("");
  const autoCover = useRef("");
  const autoMinutes = useRef("");
  const autoSeconds = useRef("");
  const trackedLink = useRef("");
  const spanish = locale === "es";
  const totalDuration = useMemo(
    () => Number(durationMinutes || 0) * 60 + Number(durationSeconds || 0),
    [durationMinutes, durationSeconds],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem("first-listen-locale");
    if (stored === "en" || stored === "es") setLocale(stored);
  }, []);

  useEffect(() => {
    const trimmed = musicUrl.trim();
    if (!trimmed) {
      setPlatform("");
      setMetadataLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setMetadataLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/music-metadata?url=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as MetadataResult;
        if (!response.ok) {
          setPlatform("");
          setError(
            spanish
              ? "Usa un enlace de YouTube, YouTube Music o SoundCloud."
              : "Use a YouTube, YouTube Music, or SoundCloud link.",
          );
          return;
        }
        if (!["YouTube", "YouTube Music", "SoundCloud"].includes(data.platform ?? "")) {
          setPlatform("");
          setError(
            spanish
              ? "La primera publicación debe usar YouTube, YouTube Music o SoundCloud para reproducirse aquí."
              : "Your first publication must use YouTube, YouTube Music, or SoundCloud so it can play here.",
          );
          return;
        }
        setPlatform(data.platform ?? "");
        if (trackedLink.current !== trimmed) {
          trackedLink.current = trimmed;
          trackFirstPublishStage(firstPublishFunnelLabels.linkReady);
        }
        const nextTitle = String(data.title ?? "").trim();
        const nextArtist = String(data.artistName ?? "").trim();
        const nextCover = String(data.coverImageUrl ?? "").trim();
        const nextDuration = durationParts(data.durationSeconds);
        setTitle((current) => {
          if (!nextTitle || (current && current !== autoTitle.current)) return current;
          autoTitle.current = nextTitle;
          return nextTitle;
        });
        setArtistName((current) => {
          if (!nextArtist || (current && current !== autoArtist.current)) return current;
          autoArtist.current = nextArtist;
          return nextArtist;
        });
        setCoverImageUrl((current) => {
          if (!nextCover || (current && current !== autoCover.current)) return current;
          autoCover.current = nextCover;
          return nextCover;
        });
        if (nextDuration) {
          setDurationMinutes((current) => {
            if (current && current !== autoMinutes.current) return current;
            autoMinutes.current = nextDuration.minutes;
            return nextDuration.minutes;
          });
          setDurationSeconds((current) => {
            if (current && current !== autoSeconds.current) return current;
            autoSeconds.current = nextDuration.seconds;
            return nextDuration.seconds;
          });
        }
      } catch (lookupError) {
        if (!(lookupError instanceof DOMException && lookupError.name === "AbortError")) {
          setError(spanish ? "No pudimos leer ese enlace." : "We could not read that link.");
        }
      } finally {
        setMetadataLoading(false);
      }
    }, 550);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [musicUrl, spanish]);

  const ready = Boolean(
    email.trim() &&
      musicUrl.trim() &&
      platform &&
      title.trim() &&
      artistName.trim() &&
      genre &&
      songLanguage &&
      country &&
      Number.isInteger(totalDuration) &&
      totalDuration >= 15 &&
      totalDuration <= 480 &&
      Number(durationSeconds || 0) <= 59 &&
      termsAccepted,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || submitting) {
      setError(
        spanish
          ? "Completa los campos marcados antes de continuar."
          : "Complete the required fields before continuing.",
      );
      return;
    }
    setSubmitting(true);
    setError("");
    trackFirstPublishStage(firstPublishFunnelLabels.formSent);
    try {
      const response = await fetch("/api/first-publish/request", {
        body: JSON.stringify({
          artistName: artistName.trim(),
          contentKind,
          country,
          coverImageUrl,
          durationSeconds: totalDuration,
          email: email.trim(),
          explicitContent: false,
          genre,
          honeypot,
          musicUrl: musicUrl.trim(),
          songLanguage,
          termsAccepted,
          title: title.trim(),
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error || "Submission failed.");
      trackFirstPublishStage(firstPublishFunnelLabels.emailSent);
      setSent(true);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : spanish
            ? "No pudimos enviar el correo."
            : "We could not send the email.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <main className="first-publish-page">
        <section className="first-publish-success-card">
          <span className="first-publish-success-icon"><Mail size={30} /></span>
          <span className="eyebrow">{spanish ? "REVISA TU CORREO" : "CHECK YOUR EMAIL"}</span>
          <h1>{spanish ? "Ya casi está publicada" : "Your song is almost live"}</h1>
          <p>
            {spanish
              ? `Enviamos un enlace a ${email}. Ábrelo y presiona “Confirmar y publicar”.`
              : `We sent a link to ${email}. Open it and press “Confirm and publish.”`}
          </p>
          <div className="first-publish-email-help">
            <ShieldCheck size={18} />
            <span>
              {spanish
                ? "Usa únicamente el correo más reciente. Si no aparece, revisa Spam o Correo no deseado."
                : "Use only the newest email. If it is missing, check Spam or Junk."}
            </span>
          </div>
          <button className="first-publish-secondary" onClick={() => setSent(false)} type="button">
            {spanish ? "Corregir correo o reenviar" : "Change email or resend"}
          </button>
          <Link href="/guest">{spanish ? "Volver a escuchar música" : "Back to listening"}</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="first-publish-page">
      <header className="first-publish-topbar">
        <Link href="/guest"><ArrowLeft size={17} /> {spanish ? "Volver" : "Back"}</Link>
        <strong>FIRST <span>LISTEN</span></strong>
        <Link href="/login?next=/dashboard">{spanish ? "Entrar" : "Log in"}</Link>
      </header>

      <section className="first-publish-hero">
        <span className="eyebrow"><Music2 size={14} /> {spanish ? "PRIMERA PUBLICACIÓN" : "FIRST PUBLICATION"}</span>
        <h1>{spanish ? "Publica una canción. Sin contraseña." : "Publish one song. No password."}</h1>
        <p>
          {spanish
            ? "Pega tu enlace, confirma tu correo y aparecerá en First Listen durante 7 días. Sin tarjeta y sin conectar tu canal."
            : "Paste your link, confirm your email, and it will appear on First Listen for 7 days. No card and no channel access."}
        </p>
        <div className="first-publish-trust-row">
          <span><BadgeCheck size={15} /> {spanish ? "Gratis" : "Free"}</span>
          <span><ShieldCheck size={15} /> {spanish ? "Sin acceso a tu canal" : "No channel access"}</span>
          <span><Clock3 size={15} /> {spanish ? "Visible 7 días" : "Visible for 7 days"}</span>
        </div>
      </section>

      <form className="first-publish-form" noValidate onSubmit={submit}>
        <section className="first-publish-step">
          <span className="first-publish-step-number">1</span>
          <div>
            <h2>{spanish ? "Pega tu canción o video" : "Paste your song or video"}</h2>
            <p>{spanish ? "YouTube, YouTube Music o SoundCloud." : "YouTube, YouTube Music, or SoundCloud."}</p>
          </div>
          <label className="first-publish-field full">
            <span>{spanish ? "Enlace" : "Link"}</span>
            <div className="first-publish-input-icon">
              <Link2 size={18} />
              <input
                onChange={(event) => setMusicUrl(event.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                type="url"
                value={musicUrl}
              />
            </div>
            <small>
              {metadataLoading
                ? spanish ? "Buscando información..." : "Reading song details..."
                : platform
                  ? `${platform} · ${spanish ? "enlace listo" : "link ready"}`
                  : spanish ? "First Listen leerá el título y la portada." : "First Listen will read the title and cover."}
            </small>
          </label>
        </section>

        <section className="first-publish-step">
          <span className="first-publish-step-number">2</span>
          <div>
            <h2>{spanish ? "Confirma los datos" : "Confirm the details"}</h2>
            <p>{spanish ? "Solo corrige lo necesario." : "Only change what is needed."}</p>
          </div>
          <div className="first-publish-grid">
            <label className="first-publish-field">
              <span>{spanish ? "Título" : "Title"}</span>
              <input onChange={(event) => setTitle(event.target.value)} value={title} />
            </label>
            <label className="first-publish-field">
              <span>{spanish ? "Artista" : "Artist"}</span>
              <input onChange={(event) => setArtistName(event.target.value)} value={artistName} />
            </label>
            <label className="first-publish-field">
              <span>{spanish ? "Género" : "Genre"}</span>
              <select onChange={(event) => setGenre(event.target.value as Genre)} value={genre}>
                <option value="">{spanish ? "Selecciona" : "Select"}</option>
                {genreOptions.map((item) => <option key={item} value={item}>{optionLabel(locale, item)}</option>)}
              </select>
            </label>
            <label className="first-publish-field">
              <span>{spanish ? "Idioma" : "Language"}</span>
              <select onChange={(event) => setSongLanguage(event.target.value as SongLanguage)} value={songLanguage}>
                <option value="">{spanish ? "Selecciona" : "Select"}</option>
                {songLanguageOptions.map((item) => <option key={item} value={item}>{optionLabel(locale, item)}</option>)}
              </select>
            </label>
            <label className="first-publish-field">
              <span>{spanish ? "País" : "Country"}</span>
              <select onChange={(event) => setCountry(event.target.value)} value={country}>
                <option value="">{spanish ? "Selecciona" : "Select"}</option>
                {countries.map((item) => <option key={item} value={item}>{optionLabel(locale, item)}</option>)}
              </select>
            </label>
            <label className="first-publish-field">
              <span>{spanish ? "Tipo" : "Type"}</span>
              <select onChange={(event) => setContentKind(event.target.value as FirstPublishContentKind)} value={contentKind}>
                <option value="song">{spanish ? "Canción" : "Song"}</option>
                <option value="music_video">{spanish ? "Video musical" : "Music video"}</option>
              </select>
            </label>
            <label className="first-publish-field">
              <span>{spanish ? "Duración" : "Duration"}</span>
              <div className="first-publish-duration">
                <input aria-label="Minutes" max={8} min={0} onChange={(event) => setDurationMinutes(event.target.value)} placeholder="min" type="number" value={durationMinutes} />
                <b>:</b>
                <input aria-label="Seconds" max={59} min={0} onChange={(event) => setDurationSeconds(event.target.value)} placeholder="seg" type="number" value={durationSeconds} />
              </div>
              <small>{spanish ? "Máximo 8 minutos para publicación inmediata." : "Up to 8 minutes for immediate publication."}</small>
            </label>
            <p className="first-publish-family-note">
              <ShieldCheck size={16} />
              <span>
                {spanish
                  ? "Esta primera publicación debe ser apta para todo público. El contenido explícito se puede administrar después desde una cuenta completa."
                  : "This first publication must be suitable for all audiences. Explicit content can be managed later from a full account."}
              </span>
            </p>
          </div>
        </section>

        <section className="first-publish-step">
          <span className="first-publish-step-number">3</span>
          <div>
            <h2>{spanish ? "Recibe tu enlace" : "Get your confirmation link"}</h2>
            <p>{spanish ? "No crearás contraseña ahora." : "You will not create a password now."}</p>
          </div>
          <label className="first-publish-field full">
            <span>{spanish ? "Correo" : "Email"}</span>
            <div className="first-publish-input-icon">
              <Mail size={18} />
              <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} placeholder="tu@correo.com" type="email" value={email} />
            </div>
          </label>
          <label aria-hidden="true" className="first-publish-honeypot">
            Website
            <input autoComplete="off" onChange={(event) => setHoneypot(event.target.value)} tabIndex={-1} value={honeypot} />
          </label>
          <label className="first-publish-check full">
            <input checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} type="checkbox" />
            <span>
              {spanish ? "Entiendo que estará visible 7 días y acepto los " : "I understand it will be visible for 7 days and accept the "}
              <Link href="/terms" target="_blank">{spanish ? "Términos" : "Terms"}</Link>
              {spanish ? " y la " : " and "}
              <Link href="/privacy" target="_blank">{spanish ? "Privacidad" : "Privacy Policy"}</Link>.
            </span>
          </label>
        </section>

        {error && <div className="first-publish-error" role="alert">{error}</div>}

        <button className="first-publish-submit" disabled={!ready || submitting} type="submit">
          {submitting ? <LoaderCircle className="spin" size={19} /> : <CheckCircle2 size={19} />}
          {submitting
            ? spanish ? "Enviando enlace..." : "Sending link..."
            : spanish ? "Enviar enlace de publicación" : "Send publication link"}
        </button>
        <p className="first-publish-submit-note">
          {spanish
            ? "Nada se publica hasta que confirmes el enlace en tu correo."
            : "Nothing is published until you confirm the link in your email."}
        </p>
      </form>
    </main>
  );
}
