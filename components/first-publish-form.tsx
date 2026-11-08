"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  CircleHelp,
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

export function FirstPublishForm({
  embedded = false,
  onClose,
}: {
  embedded?: boolean;
  onClose?: () => void;
} = {}) {
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

  const topbar = (
    <header className="first-publish-topbar">
      {embedded ? (
        <button onClick={onClose} type="button">
          <ArrowLeft size={17} /> {spanish ? "Volver a la música" : "Back to music"}
        </button>
      ) : (
        <Link href="/guest"><ArrowLeft size={17} /> {spanish ? "Volver" : "Back"}</Link>
      )}
      <strong>FIRST <span>LISTEN</span></strong>
      {embedded ? (
        <button onClick={onClose} type="button">{spanish ? "Cerrar" : "Close"}</button>
      ) : (
        <Link href="/login?next=/dashboard">{spanish ? "Entrar" : "Log in"}</Link>
      )}
    </header>
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
      <main className={`first-publish-page${embedded ? " is-embedded" : ""}`}>
        {embedded && topbar}
        <section className="first-publish-success-card">
          <span className="first-publish-success-icon"><Mail size={30} /></span>
          <span className="eyebrow">{spanish ? "REVISA TU CORREO" : "CHECK YOUR EMAIL"}</span>
          <h1>{spanish ? "Ya casi compartes tu enlace" : "Your link is almost live"}</h1>
          <p>
            {spanish
              ? `Enviamos una confirmación a ${email}. Ábrela y presiona “Confirmar y compartir”.`
              : `We sent a confirmation to ${email}. Open it and press “Confirm and share.”`}
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
          {embedded ? (
            <button className="first-publish-secondary" onClick={onClose} type="button">
              {spanish ? "Volver a escuchar música" : "Back to listening"}
            </button>
          ) : (
            <Link href="/guest">{spanish ? "Volver a escuchar música" : "Back to listening"}</Link>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className={`first-publish-page${embedded ? " is-embedded" : ""}`}>
      {topbar}

      <section className="first-publish-hero">
        <span className="eyebrow"><Music2 size={14} /> {spanish ? "PRIMERA PUBLICACIÓN" : "FIRST PUBLICATION"}</span>
        <h1>{spanish ? "Comparte el enlace de tu canción." : "Share your song link."}</h1>
        <p>
          {spanish
            ? "FirstListen muestra tu canción desde su plataforma original. Aquí no subes archivos de audio, no entregas tu master y no conectas tu canal."
            : "FirstListen presents your song from its original platform. You do not upload audio files, hand over your master, or connect your channel."}
        </p>
        <div className="first-publish-trust-row">
          <span><BadgeCheck size={15} /> {spanish ? "Primer enlace gratis" : "First link free"}</span>
          <span><Link2 size={15} /> {spanish ? "No subes archivos" : "No file uploads"}</span>
          <span><ShieldCheck size={15} /> {spanish ? "Sin acceso a tu canal" : "No channel access"}</span>
          <span><Clock3 size={15} /> {spanish ? "Visible 7 días" : "Visible for 7 days"}</span>
        </div>
      </section>

      <section
        aria-label={spanish ? "Cómo funciona FirstListen" : "How FirstListen works"}
        className="first-publish-explainer"
      >
        <div>
          <span>1</span>
          <strong>{spanish ? "Pega tu enlace" : "Paste your link"}</strong>
          <small>
            {spanish
              ? "Usa YouTube, YouTube Music o SoundCloud. Tu archivo permanece en la plataforma original."
              : "Use YouTube, YouTube Music, or SoundCloud. Your file stays on the original platform."}
          </small>
        </div>
        <div>
          <span>2</span>
          <strong>{spanish ? "Revisa la información" : "Review the details"}</strong>
          <small>
            {spanish
              ? "Confirmas título, artista, portada y estilo antes de compartir."
              : "Confirm the title, artist, cover, and genre before sharing."}
          </small>
        </div>
        <div>
          <span>3</span>
          <strong>{spanish ? "Comparte en FirstListen" : "Share on FirstListen"}</strong>
          <small>
            {spanish
              ? "Tu enlace aparece en FirstListen durante 7 días y puedes mantenerlo activo con una cuenta gratuita."
              : "Your link appears on FirstListen for 7 days, and a free account can keep it active."}
          </small>
        </div>
      </section>

      <section
        aria-label={spanish ? "Reglas de la primera publicación" : "First publication rules"}
        className="first-publish-rules"
      >
        <div className="first-publish-rules-heading">
          <span className="eyebrow"><ShieldCheck size={14} /> {spanish ? "ANTES DE CONTINUAR" : "BEFORE YOU CONTINUE"}</span>
          <h2>{spanish ? "Esto es exactamente lo que ocurrirá" : "This is exactly what will happen"}</h2>
          <p>
            {spanish
              ? "Sin sorpresas, cargos ni letras pequeñas. Estas reglas se muestran antes de que compartas el enlace."
              : "No surprises, charges, or fine print. These rules are shown before you share the link."}
          </p>
        </div>
        <div className="first-publish-rules-grid">
          <article>
            <strong>{spanish ? "Sin cuenta" : "Without an account"}</strong>
            <b>{spanish ? "1 primer enlace por correo" : "1 first link per email"}</b>
            <small>
              {spanish
                ? "Es una oportunidad inicial gratuita; no vuelve a renovarse cada 7 días."
                : "It is a one-time free opportunity; it does not renew every 7 days."}
            </small>
          </article>
          <article>
            <strong>{spanish ? "Duración inicial" : "Initial duration"}</strong>
            <b>{spanish ? "Visible durante 7 días" : "Visible for 7 days"}</b>
            <small>
              {spanish
                ? "El plazo comienza cuando confirmas el correo y publicas el enlace."
                : "The period starts when you confirm the email and publish the link."}
            </small>
          </article>
          <article>
            <strong>{spanish ? "Con cuenta gratuita" : "With a free account"}</strong>
            <b>{spanish ? "Sin vencimiento fijo de 7 días" : "No fixed 7-day expiration"}</b>
            <small>
              {spanish
                ? "Puedes conservar este enlace y administrarlo. No existe una espera fija entre publicaciones adicionales; tu panel mostrará cuándo tienes otra disponible."
                : "You can keep and manage this link. There is no fixed wait between additional publications; your dashboard shows when another one is available."}
            </small>
          </article>
          <article>
            <strong>{spanish ? "Actividad y visibilidad" : "Activity and visibility"}</strong>
            <b>{spanish ? "Sin archivo automático actualmente" : "No automatic archiving right now"}</b>
            <small>
              {spanish
                ? "La publicación permanece visible mientras esté activa, la cuenta siga en regla y el contenido cumpla las normas. Cualquier cambio futuro se avisará antes de aplicarse."
                : "The publication stays visible while active, the account remains in good standing, and the content follows the rules. Future changes will be announced before they apply."}
            </small>
          </article>
        </div>
      </section>

      <form className="first-publish-form" noValidate onSubmit={submit}>
        <section className="first-publish-step">
          <span className="first-publish-step-number">1</span>
          <div>
            <h2>{spanish ? "Pega el enlace de tu canción o video" : "Paste your song or video link"}</h2>
            <p>
              {spanish
                ? "No cargaremos un MP3: FirstListen reproducirá el enlace desde su plataforma original."
                : "No MP3 is uploaded: FirstListen plays the link from its original platform."}
            </p>
          </div>
          <label className="first-publish-field full">
            <span>{spanish ? "Enlace original" : "Original link"}</span>
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
            <h2>{spanish ? "Confirma tu correo" : "Confirm your email"}</h2>
            <p>
              {spanish
                ? "Te enviaremos una confirmación segura; no crearás contraseña ahora."
                : "We will send a secure confirmation; you will not create a password now."}
            </p>
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
              {spanish
                ? "Confirmo que tengo permiso para compartir este enlace, entiendo que esta oportunidad sin cuenta se usa una sola vez por correo, que estará visible 7 días y acepto los "
                : "I confirm that I have permission to share this link, understand that this no-account opportunity can be used once per email, that it will be visible for 7 days, and accept the "}
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
            : spanish ? "Compartir mi enlace" : "Share my link"}
        </button>
        <p className="first-publish-submit-note">
          {spanish
            ? "Nada se publica hasta que confirmes tu correo. FirstListen no recibe ni almacena tu archivo de audio."
            : "Nothing is published until you confirm your email. FirstListen does not receive or store your audio file."}
        </p>
      </form>

      <section className="first-publish-faq">
        <span className="eyebrow"><CircleHelp size={14} /> {spanish ? "PREGUNTAS CLARAS" : "CLEAR ANSWERS"}</span>
        <h2>{spanish ? "Antes de compartir tu enlace" : "Before you share your link"}</h2>
        <div className="first-publish-faq-list">
          <details>
            <summary>{spanish ? "¿Qué es FirstListen?" : "What is FirstListen?"}</summary>
            <p>
              {spanish
                ? "Es un espacio de descubrimiento donde las personas pueden encontrar y reproducir enlaces de música publicados por artistas."
                : "It is a discovery space where people can find and play music links shared by artists."}
            </p>
          </details>
          <details>
            <summary>{spanish ? "¿Puedo subir un MP3 directamente?" : "Can I upload an MP3 directly?"}</summary>
            <p>
              {spanish
                ? "No. En esta etapa compartes un enlace compatible. El audio sigue alojado en YouTube, YouTube Music o SoundCloud."
                : "No. At this stage, you share a compatible link. The audio remains hosted on YouTube, YouTube Music, or SoundCloud."}
            </p>
          </details>
          <details>
            <summary>{spanish ? "¿FirstListen distribuye mi música?" : "Does FirstListen distribute my music?"}</summary>
            <p>
              {spanish
                ? "No por ahora. FirstListen no envía canciones a Spotify, Apple Music ni otras tiendas; ayuda a descubrir enlaces que ya publicaste."
                : "Not at this time. FirstListen does not deliver songs to Spotify, Apple Music, or other stores; it helps people discover links you already published."}
            </p>
          </details>
          <details>
            <summary>{spanish ? "¿FirstListen paga o monetiza mis reproducciones?" : "Does FirstListen pay or monetize my plays?"}</summary>
            <p>
              {spanish
                ? "FirstListen no paga por reproducciones ni monetiza en tu nombre. Cualquier conteo o monetización depende de la plataforma original y sus reglas."
                : "FirstListen does not pay for plays or monetize on your behalf. Any counting or monetization depends on the original platform and its rules."}
            </p>
          </details>
          <details>
            <summary>{spanish ? "¿Cuánto cuesta?" : "How much does it cost?"}</summary>
            <p>
              {spanish
                ? "Tu primera publicación es gratuita, se usa una sola vez por correo y no requiere tarjeta. Si en el futuro existen planes opcionales, verás el precio antes de aceptar cualquier cargo."
                : "Your first publication is free, can be used once per email, and requires no card. If optional plans are offered later, you will see the price before accepting any charge."}
            </p>
          </details>
          <details>
            <summary>{spanish ? "¿Puedo publicar otro enlace sin registrarme después de 7 días?" : "Can I publish another link without registering after 7 days?"}</summary>
            <p>
              {spanish
                ? "No. La opción sin cuenta es una sola primera publicación por correo; no se reinicia cuando terminan los 7 días. Para conservarla y administrar publicaciones posteriores necesitas una cuenta gratuita."
                : "No. The no-account option is one first publication per email; it does not reset when the 7 days end. To keep it and manage later publications, you need a free account."}
            </p>
          </details>
          <details>
            <summary>{spanish ? "¿Cada cuánto puedo compartir con una cuenta?" : "How often can I share with an account?"}</summary>
            <p>
              {spanish
                ? "No hay una espera fija diaria, semanal o mensual. Tu panel indica si tienes una publicación disponible y siempre muestra cualquier requisito antes de confirmar un nuevo enlace."
                : "There is no fixed daily, weekly, or monthly wait. Your dashboard shows whether a publication is available and displays any requirement before you confirm a new link."}
            </p>
          </details>
          <details>
            <summary>{spanish ? "¿Qué pasa si dejo de entrar a mi cuenta?" : "What happens if I stop signing in?"}</summary>
            <p>
              {spanish
                ? "Actualmente FirstListen no archiva automáticamente publicaciones por inactividad. Un enlace puede dejar de mostrarse si lo retiras, se modera por incumplir las normas, la cuenta se cierra o se suspende. Si esta política cambia, se avisarán los plazos antes de aplicarlos."
                : "FirstListen currently does not automatically archive publications for inactivity. A link may stop appearing if you remove it, it is moderated for a rules violation, or the account is closed or suspended. If this policy changes, the time limits will be announced before they apply."}
            </p>
          </details>
          <details>
            <summary>{spanish ? "¿FirstListen garantiza reproducciones?" : "Does FirstListen guarantee plays?"}</summary>
            <p>
              {spanish
                ? "No. Cada persona decide qué reproducir, pausar o saltar. FirstListen no compra, vende ni intercambia reproducciones."
                : "No. Each person decides what to play, pause, or skip. FirstListen does not buy, sell, or trade plays."}
            </p>
          </details>
          <details>
            <summary>{spanish ? "¿Quién conserva los derechos?" : "Who keeps the rights?"}</summary>
            <p>
              {spanish
                ? "Tú conservas tus derechos. Debes compartir únicamente contenido propio o contenido para el que tengas autorización."
                : "You keep your rights. Only share content you own or have permission to share."}
            </p>
          </details>
          <details>
            <summary>{spanish ? "¿Puedo editar o retirar mi publicación?" : "Can I edit or remove my publication?"}</summary>
            <p>
              {spanish
                ? "Sí. Después de confirmar tu correo puedes conservar la publicación con una cuenta gratuita y administrarla desde tu perfil."
                : "Yes. After confirming your email, you can keep the publication with a free account and manage it from your profile."}
            </p>
          </details>
        </div>
      </section>
    </main>
  );
}
