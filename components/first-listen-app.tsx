"use client";

import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Cloud,
  Disc3,
  ExternalLink,
  Gauge,
  Globe2,
  Headphones,
  Link2,
  ListMusic,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  Music2,
  Play,
  Plus,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  X,
  Youtube,
} from "lucide-react";
import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { LanguageSelector } from "@/components/language-selector";
import { Logo } from "@/components/logo";
import {
  defaultGenrePreferences,
  defaultListenerLanguages,
  feedbackFocusOptions,
  genreOptions,
  songLanguageOptions,
  type FeedbackFocus,
  type Genre,
  type InterfaceLocale,
  type ListenerLanguage,
  type SongLanguage,
} from "@/lib/catalog";
import { demoReviews, reviewQueue, userSong } from "@/lib/demo-data";
import { getCopy, optionLabel } from "@/lib/i18n";
import { describeMatch, prioritizeReviewQueue } from "@/lib/matching";
import { detectMusicPlatform } from "@/lib/platform";
import { evaluateReviewQuality } from "@/lib/review-quality";
import { createClient } from "@/lib/supabase/client";
import type { Platform, Song } from "@/lib/types";

type View = "review" | "dashboard" | "submit";
type BinaryAnswer = boolean | null;
type Copy = ReturnType<typeof getCopy>;

type ReviewForm = {
  listenFull: BinaryAnswer;
  addPlaylist: BinaryAnswer;
  grabbedAttention: BinaryAnswer;
  shareWithFriend: BinaryAnswer;
  rating: number;
  comment: string;
};

type ReviewSubmissionResult = {
  accepted: boolean;
  qualityScore: number;
  warning?: string;
};

type SongSubmission = {
  title: string;
  artistName: string;
  coverImageUrl: string;
  musicUrl: string;
  platform: Platform;
  genre: Genre;
  language: SongLanguage;
  feedbackFocus: FeedbackFocus[];
  country: string;
};

const databasePlatform: Record<Platform, string> = {
  Spotify: "spotify",
  YouTube: "youtube",
  "YouTube Music": "youtube_music",
  SoundCloud: "soundcloud",
};

const displayPlatform: Record<string, Platform> = {
  spotify: "Spotify",
  youtube: "YouTube",
  youtube_music: "YouTube Music",
  soundcloud: "SoundCloud",
};

const emptyReview: ReviewForm = {
  listenFull: null,
  addPlaylist: null,
  grabbedAttention: null,
  shareWithFriend: null,
  rating: 0,
  comment: "",
};

const waveform = [
  18, 34, 24, 51, 36, 72, 44, 60, 29, 82, 54, 39, 66, 92, 48, 74, 31, 58,
  86, 43, 64, 78, 36, 55, 89, 47, 68, 32, 61, 76, 42, 57, 83, 35, 71, 51,
  65, 28, 80, 46, 59, 73, 38, 63, 87, 49, 70, 30, 56, 81, 41, 67, 52, 75,
  33, 62, 84, 45, 69, 37, 58, 79, 43, 64, 50, 72, 31, 60, 85, 46, 66, 39,
];

function navItems(copy: Copy): Array<{ id: View; label: string; icon: typeof Headphones }> {
  return [
    { id: "review", label: copy.app.nav.review, icon: Headphones },
    { id: "dashboard", label: copy.app.nav.dashboard, icon: BarChart3 },
    { id: "submit", label: copy.app.nav.submit, icon: Plus },
  ];
}

function shortMobileLabel(locale: InterfaceLocale, view: View, copy: Copy) {
  if (view === "review") return locale === "es" ? "Review" : "Review";
  if (view === "submit") return locale === "es" ? "Enviar" : "Submit";
  return copy.app.nav.results;
}

function translatedPlatformMessage(
  locale: InterfaceLocale,
  rawLink: string,
  platform: Platform | null,
  valid: boolean,
  fallback: string,
) {
  if (locale === "en") return fallback;
  if (!rawLink.trim()) return "Pega un enlace publico de una cancion.";
  if (valid && platform) return `${platform} detectado.`;
  if (platform === "Spotify") return "Usa un enlace directo de Spotify track.";
  if (platform === "YouTube") return "Usa un enlace directo de YouTube.";
  if (platform === "YouTube Music") return "Usa un enlace watch de YouTube Music.";
  if (platform === "SoundCloud") return "Usa un enlace publico de SoundCloud.";
  return "Este enlace no pertenece a una plataforma compatible.";
}

function PlatformIcon({
  platform,
  size = 15,
}: {
  platform: Platform | null;
  size?: number;
}) {
  if (platform === "YouTube" || platform === "YouTube Music") {
    return <Youtube size={size} />;
  }
  if (platform === "SoundCloud") {
    return <Cloud size={size} />;
  }
  if (platform === "Spotify") {
    return <Disc3 size={size} />;
  }
  return <Music2 size={size} />;
}

function BinaryChoice({
  value,
  onChange,
  copy,
}: {
  value: BinaryAnswer;
  onChange: (answer: boolean) => void;
  copy: Copy;
}) {
  return (
    <div className="binary-choice">
      <button
        className={value === true ? "selected yes" : ""}
        onClick={() => onChange(true)}
        type="button"
      >
        <ThumbsUp size={16} />
        {copy.common.yes}
      </button>
      <button
        className={value === false ? "selected no" : ""}
        onClick={() => onChange(false)}
        type="button"
      >
        <ThumbsDown size={16} />
        {copy.common.no}
      </button>
    </div>
  );
}

function MiniWaveform() {
  return (
    <div className="waveform" aria-label="Decorative audio waveform">
      {waveform.map((height, index) => (
        <i
          key={`${height}-${index}`}
          style={{ height: `${height}%`, opacity: index < 26 ? 1 : 0.28 }}
        />
      ))}
    </div>
  );
}

function ReviewProgress({
  count,
  founderFree = false,
  copy,
}: {
  count: number;
  founderFree?: boolean;
  copy: Copy;
}) {
  const safeCount = Math.min(count, 5);
  const remaining = Math.max(0, 5 - safeCount);

  return (
    <div className="review-progress">
      <div>
        <span className="eyebrow">
          <Sparkles size={13} />
          {copy.app.review.submissionCredit}
        </span>
        <strong>
          {safeCount}<span>/5</span>
        </strong>
      </div>
      <div className="progress-track" aria-label={`${safeCount} of 5 reviews completed`}>
        <i style={{ width: `${safeCount * 20}%` }} />
      </div>
      <p>
        {founderFree
          ? copy.app.review.founderReady
          : safeCount >= 5
            ? copy.app.review.unlocked
            : `${remaining} ${copy.app.review.toUnlock}`}
      </p>
    </div>
  );
}

function Sidebar({
  view,
  setView,
  reviewCount,
  founder,
  founderFree,
  onLogout,
  copy,
}: {
  view: View;
  setView: (view: View) => void;
  reviewCount: number;
  founder: boolean;
  founderFree: boolean;
  onLogout: () => void;
  copy: Copy;
}) {
  return (
    <aside className="sidebar">
      <Logo />
      <nav>
        <span className="nav-label">{copy.app.nav.workspace}</span>
        {navItems(copy).map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={view === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setView(item.id)}
            >
              <Icon size={19} />
              <span>{item.label}</span>
              {item.id === "review" && <em>{Math.min(reviewCount, 5)}/5</em>}
              {item.id === "submit" && reviewCount < 5 && !founderFree && (
                <LockKeyhole className="nav-lock" size={14} />
              )}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-bottom">
        {founder && (
          <div className="founder-mini-badge">
            <BadgeCheck size={16} />
            <span>
              <strong>{copy.app.sidebar.foundingArtist}</strong>
              <small>{founderFree ? copy.app.sidebar.freeReady : copy.app.sidebar.founderMember}</small>
            </span>
          </div>
        )}
        <div className="sidebar-card">
          <div className="sidebar-card-icon"><Gauge size={18} /></div>
          <strong>{copy.app.sidebar.keepHonest}</strong>
          <p>{copy.app.sidebar.keepHonestBody}</p>
          <button onClick={() => setView("review")}>
            {copy.app.sidebar.reviewSong} <ArrowRight size={14} />
          </button>
        </div>
        <button className="profile-row" onClick={onLogout}>
          <span className="avatar">CJ</span>
          <span>
            <strong>Carlos J.</strong>
            <small>{copy.common.signOut}</small>
          </span>
          <ChevronDown size={15} />
        </button>
      </div>
    </aside>
  );
}

function Topbar({
  view,
  onMenu,
  onLogout,
  darkMode,
  onToggleTheme,
  copy,
  locale,
  onLocaleChange,
}: {
  view: View;
  onMenu: () => void;
  onLogout: () => void;
  darkMode: boolean;
  onToggleTheme: () => void;
  copy: Copy;
  locale: InterfaceLocale;
  onLocaleChange: (locale: InterfaceLocale) => void;
}) {
  const titles: Record<View, { title: string; subtitle: string }> = {
    review: {
      title: copy.app.topbar.reviewTitle,
      subtitle: copy.app.topbar.reviewSubtitle,
    },
    dashboard: {
      title: copy.app.topbar.dashboardTitle,
      subtitle: copy.app.topbar.dashboardSubtitle,
    },
    submit: {
      title: copy.app.topbar.submitTitle,
      subtitle: copy.app.topbar.submitSubtitle,
    },
  };

  return (
    <header className="topbar">
      <button className="menu-button" onClick={onMenu} aria-label="Open menu">
        <Menu size={21} />
      </button>
      <div className="mobile-logo"><Logo /></div>
      <div className="page-title">
        <h1>{titles[view].title}</h1>
        <p>{titles[view].subtitle}</p>
      </div>
      <div className="topbar-actions">
        <LanguageSelector compact locale={locale} onChange={onLocaleChange} />
        <span className="app-status-pill">{copy.common.publicBeta}</span>
        <span className="app-founder-pill"><i /> {copy.common.founderActive}</span>
        <button
          className="help-button"
          onClick={onToggleTheme}
          aria-label={darkMode ? "Use light theme" : "Use dark theme"}
        >
          {darkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className="help-button" aria-label="Help"><CircleHelp size={19} /></button>
        <button className="google-button" onClick={onLogout} title={copy.common.signOut}>
          <span>G</span>
          <b>Connected</b>
        </button>
      </div>
    </header>
  );
}

function ReviewView({
  reviewCount,
  onReviewed,
  setView,
  notify,
  priorComments,
  founderFree,
  copy,
  locale,
  listenerLanguages,
  genrePreferences,
  activityScore,
  queueSongs,
}: {
  reviewCount: number;
  onReviewed: (
    songId: string,
    form: ReviewForm,
    pastedWithoutEditing: boolean,
    clientQualityScore: number,
  ) => Promise<ReviewSubmissionResult>;
  setView: (view: View) => void;
  notify: (message: string) => void;
  priorComments: string[];
  founderFree: boolean;
  copy: Copy;
  locale: InterfaceLocale;
  listenerLanguages: ListenerLanguage[];
  genrePreferences: Genre[];
  activityScore: number;
  queueSongs: Song[];
}) {
  const reviewerProfile = useMemo(
    () => ({ languages: listenerLanguages, genrePreferences, activityScore }),
    [activityScore, genrePreferences, listenerLanguages],
  );
  const matchedQueue = useMemo(
    () => prioritizeReviewQueue(queueSongs, reviewerProfile),
    [queueSongs, reviewerProfile],
  );
  const queueIndex = 0;
  const song = matchedQueue[queueIndex];
  const matchReason = song ? describeMatch(song, reviewerProfile) : "";
  const [form, setForm] = useState<ReviewForm>(emptyReview);
  const [isPlaying, setIsPlaying] = useState(false);
  const [pastedWithoutEditing, setPastedWithoutEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setForm(emptyReview);
    setIsPlaying(false);
    setPastedWithoutEditing(false);
  }, [song?.id]);

  const requiredAnswersComplete =
    form.listenFull !== null &&
    form.addPlaylist !== null &&
    form.grabbedAttention !== null &&
    form.shareWithFriend !== null &&
    form.rating > 0;
  const reviewQuality = evaluateReviewQuality(
    form.comment,
    priorComments,
    pastedWithoutEditing,
  );
  const complete = requiredAnswersComplete && reviewQuality.passed;

  const submitReview = async () => {
    if (!requiredAnswersComplete) {
      notify(locale === "es" ? "Responde las cinco preguntas requeridas." : "Answer all five required questions first.");
      return;
    }
    if (!reviewQuality.passed) {
      notify(copy.app.review.warning);
      return;
    }
    if (!song) return;
    setSubmitting(true);
    const result = await onReviewed(song.id, form, pastedWithoutEditing, reviewQuality.score);
    setSubmitting(false);
    if (!result.accepted) {
      notify(result.warning || copy.app.review.warning);
      return;
    }
    notify(locale === "es" ? "Review de calidad enviada. Ganaste un credito." : "Quality review submitted. One review credit earned.");
  };

  if (reviewCount >= 5) {
    return (
      <main className="content review-complete-wrap">
        <section className="review-complete-card">
          <div className="success-orbit"><Check size={36} strokeWidth={2.4} /></div>
          <span className="eyebrow">{copy.app.review.fiveForOne}</span>
          <h2>{copy.app.review.unlockedTitle}</h2>
          <p>{copy.app.review.unlockedBody}</p>
          <button className="primary-button" onClick={() => setView("submit")}>
            {copy.app.review.submitSong} <ArrowRight size={17} />
          </button>
          <button
            className="text-button"
            onClick={() =>
              notify(locale === "es" ? "Las reviews extra cuentan para tu proximo envio." : "Extra reviews will count toward your next submission.")
            }
          >
            {locale === "es" ? "Seguir revisando" : "Keep reviewing"}
          </button>
        </section>
        <aside className="review-side">
          <ReviewProgress count={reviewCount} copy={copy} founderFree={founderFree} />
          <div className="side-note">
            <MessageSquareText size={20} />
            <div>
              <strong>{locale === "es" ? "Buen feedback es especifico" : "Good feedback is specific"}</strong>
              <p>{locale === "es" ? "Comenta el momento que gano o perdio tu atencion." : "Comment on the moment that won or lost your attention."}</p>
            </div>
          </div>
        </aside>
      </main>
    );
  }

  if (!song) {
    return (
      <main className="content review-complete-wrap">
        <section className="review-complete-card">
          <div className="success-orbit"><Headphones size={34} /></div>
          <span className="eyebrow">{locale === "es" ? "Cola limpia" : "Queue clear"}</span>
          <h2>{locale === "es" ? "No hay canciones compatibles por ahora." : "No matched songs are waiting right now."}</h2>
          <p>
            {locale === "es"
              ? "Puedes enviar tu cancion Founder o volver pronto para revisar nuevas canciones."
              : "You can submit your Founder song or come back soon to review new tracks."}
          </p>
          <button className="primary-button" onClick={() => setView("submit")}>
            {copy.app.review.submitSong} <ArrowRight size={17} />
          </button>
        </section>
        <aside className="review-side">
          <ReviewProgress count={reviewCount} copy={copy} founderFree={founderFree} />
        </aside>
      </main>
    );
  }

  return (
    <main className="content review-layout">
      <section className="review-card">
        <div className="song-hero">
          <div className="cover-wrap">
            <Image
              alt={`${song.title} cover`}
              src={song.coverUrl}
              unoptimized
              width={520}
              height={520}
              priority
            />
            <button
              className={isPlaying ? "play-button playing" : "play-button"}
              onClick={() => setIsPlaying((current) => !current)}
              aria-label={isPlaying ? "Pause preview timer" : "Start preview timer"}
            >
              {isPlaying ? <span className="pause-icon" /> : <Play fill="currentColor" size={26} />}
            </button>
            <span className="listen-badge"><Clock3 size={13} /> First 30 sec</span>
          </div>
          <div className="song-copy">
            <div className="song-meta-row">
              <span className="platform-pill">
                <PlatformIcon platform={song.platform} size={13} />
                {song.platform}
              </span>
              <span>{song.country}</span>
              <span>{optionLabel(locale, song.language)}</span>
            </div>
            <h2>{song.title}</h2>
            <p className="artist-name">{song.artist}</p>
            <div className="song-context">
              <span className="genre">{optionLabel(locale, song.genre)}</span>
              <span className="match-badge">
                <Globe2 size={12} />
                {copy.app.review.matchedFor}: {matchReason}
              </span>
            </div>
            <div className="focus-chips" aria-label={copy.app.review.feedbackFocus}>
              {song.feedbackFocus.map((focus) => (
                <span key={focus}>{optionLabel(locale, focus)}</span>
              ))}
            </div>
            <MiniWaveform />
            <div className="player-row">
              <span>{isPlaying ? "0:18" : "0:00"}</span>
              <div className="player-track"><i className={isPlaying ? "animating" : ""} /></div>
              <span>0:30</span>
            </div>
            <a href={song.link} target="_blank" rel="noreferrer">
              Open on {song.platform} <ExternalLink size={14} />
            </a>
          </div>
        </div>

        <div className="review-form">
          <div className="form-heading">
            <div>
              <span className="eyebrow">{copy.app.review.firstImpression}</span>
              <h3>{copy.app.review.direct}</h3>
            </div>
            <span className="anonymous-badge">{copy.app.review.anonymous}</span>
          </div>

          <div className="questions">
            {[
              ["01", copy.app.review.q1, "listenFull"],
              ["02", copy.app.review.q2, "addPlaylist"],
              ["03", copy.app.review.q3, "grabbedAttention"],
              ["04", copy.app.review.q4, "shareWithFriend"],
            ].map(([number, question, key]) => (
              <div className="question-row" key={key}>
                <div><span>{number}</span><p>{question}</p></div>
                <BinaryChoice
                  copy={copy}
                  value={form[key as keyof Pick<ReviewForm, "listenFull" | "addPlaylist" | "grabbedAttention" | "shareWithFriend">]}
                  onChange={(answer) => setForm({ ...form, [key]: answer })}
                />
              </div>
            ))}
          </div>

          <div className="rating-block">
            <div className="rating-label">
              <div><span>05</span><p>{copy.app.review.rating}</p></div>
              <strong>{form.rating || "-"}<small>/10</small></strong>
            </div>
            <div className="rating-options">
              {Array.from({ length: 10 }, (_, index) => index + 1).map((rating) => (
                <button
                  className={form.rating === rating ? "active" : ""}
                  key={rating}
                  onClick={() => setForm({ ...form, rating })}
                  type="button"
                >
                  {rating}
                </button>
              ))}
            </div>
          </div>

          <label className="comment-field">
            <span>
              <b>06</b>
              {copy.app.review.comment} <em>{copy.app.review.commentHint}</em>
            </span>
            <textarea
              maxLength={500}
              minLength={30}
              onChange={(event) => setForm({ ...form, comment: event.target.value })}
              onKeyDown={() => {
                if (pastedWithoutEditing) setPastedWithoutEditing(false);
              }}
              onPaste={() => setPastedWithoutEditing(true)}
              placeholder={locale === "es" ? "El inicio me atrapo porque..." : "The opening pulled me in because..."}
              required
              value={form.comment}
            />
            <small>{form.comment.length}/500</small>
          </label>
          {!reviewQuality.passed && form.comment.length > 0 && (
            <div className="quality-warning" role="alert">
              <ShieldCheck size={16} />
              <span>
                <strong>{copy.app.review.warning}</strong>
                {locale === "es"
                  ? " Evita comentarios repetidos, pegados o demasiado cortos."
                  : reviewQuality.warning.replace("Please provide useful feedback. ", "")}
              </span>
            </div>
          )}
          {reviewQuality.passed && (
            <div className="quality-pass">
              <CheckCircle2 size={15} />
              {copy.app.review.qualityPassed} {reviewQuality.score}
            </div>
          )}

          <button
            className="submit-review-button"
            disabled={!complete || submitting}
            onClick={submitReview}
          >
            {submitting ? "..." : copy.app.review.submitReview} <Send size={17} />
          </button>
        </div>
      </section>

      <aside className="review-side">
        <ReviewProgress count={reviewCount} copy={copy} founderFree={founderFree} />
        <div className="side-note">
          <MessageSquareText size={20} />
          <div>
            <strong>{locale === "es" ? "Que hace una buena review?" : "What makes a good review?"}</strong>
            <p>{locale === "es" ? "Escucha primero. Responde con instinto. Se constructivo." : "Listen first. Answer instinctively. Keep comments constructive."}</p>
          </div>
        </div>
        <div className="queue-card">
          <div className="queue-top">
            <ListMusic size={17} />
            <span>{locale === "es" ? "Siguiente" : "Up next"}</span>
            <b>{matchedQueue.length - queueIndex - 1}</b>
          </div>
          {matchedQueue.slice(queueIndex + 1).map((queuedSong) => (
            <div className="queue-song" key={queuedSong.id}>
              <Image alt="" src={queuedSong.coverUrl} unoptimized width={42} height={42} />
              <span>
                <strong>{queuedSong.title}</strong>
                <small>{optionLabel(locale, queuedSong.genre)} / {optionLabel(locale, queuedSong.language)}</small>
              </span>
            </div>
          ))}
        </div>
      </aside>
    </main>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Star;
  accent?: boolean;
}) {
  return (
    <div className={accent ? "stat-card accent" : "stat-card"}>
      <div className="stat-icon"><Icon size={18} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function DashboardView({
  setView,
  founder,
  totalCreditsEarned,
  reviewCredits,
  reviewQualityScore,
  copy,
  locale,
}: {
  setView: (view: View) => void;
  founder: boolean;
  totalCreditsEarned: number;
  reviewCredits: number;
  reviewQualityScore: number;
  copy: Copy;
  locale: InterfaceLocale;
}) {
  const reviews = demoReviews;
  const average = reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
  const percentage = (
    key: "listenFull" | "addPlaylist" | "grabbedAttention" | "shareWithFriend",
  ) => Math.round((reviews.filter((review) => review[key]).length / reviews.length) * 100);

  const ratingCounts = Array.from({ length: 10 }, (_, index) => {
    const rating = index + 1;
    return reviews.filter((review) => review.rating === rating).length;
  });
  const maxCount = Math.max(...ratingCounts);
  const hookScore = Math.round(
    (
      percentage("listenFull") +
      percentage("addPlaylist") +
      percentage("grabbedAttention") +
      percentage("shareWithFriend")
    ) / 4,
  );

  return (
    <main className="content dashboard-layout">
      <section className="dashboard-main">
        <div className="dashboard-intro">
          <div>
            <span className="eyebrow">{copy.app.dashboard.latest}</span>
            <h2>{copy.app.dashboard.heard}</h2>
          </div>
          <button className="secondary-button" onClick={() => setView("submit")}>
            <Plus size={16} /> {copy.app.dashboard.newSubmission}
          </button>
        </div>

        <div className="active-song">
          <Image src={userSong.coverUrl} alt={`${userSong.title} cover`} width={90} height={90} />
          <div className="active-song-copy">
            <div>
              <span className="live-dot">{copy.app.dashboard.collecting}</span>
              <span className="platform-label">{userSong.platform}</span>
              {founder && <span className="song-founder-badge"><BadgeCheck size={12} /> {copy.app.dashboard.founder}</span>}
            </div>
            <h3>{userSong.title}</h3>
            <p>
              {userSong.artist} / {optionLabel(locale, userSong.genre)} / {optionLabel(locale, userSong.language)}
            </p>
            <div className="active-song-tags">
              {userSong.feedbackFocus.map((focus) => <span key={focus}>{optionLabel(locale, focus)}</span>)}
            </div>
          </div>
          <div className="hook-score-card" title={copy.app.dashboard.hookTooltip}>
            <span><Gauge size={14} /> {copy.app.dashboard.hookScore}</span>
            <strong>{hookScore}</strong>
            <small>{copy.app.dashboard.outOf100}</small>
          </div>
          <div className="review-total">
            <strong>{reviews.length}</strong>
            <span>{copy.app.dashboard.totalReviews}</span>
          </div>
        </div>

        <div className="stats-grid">
          <StatCard
            accent
            label={copy.app.dashboard.hookScore}
            value={`${hookScore}`}
            detail={copy.app.dashboard.hookTooltip}
            icon={Gauge}
          />
          <StatCard
            label={copy.app.dashboard.average}
            value={average.toFixed(1)}
            detail={`${reviews.length} ${copy.app.dashboard.totalReviews.toLowerCase()}`}
            icon={Star}
          />
          <StatCard
            label={copy.app.dashboard.listenFull}
            value={`${percentage("listenFull")}%`}
            detail={`${reviews.filter((review) => review.listenFull).length} yes`}
            icon={Headphones}
          />
          <StatCard
            label={copy.app.dashboard.playlist}
            value={`${percentage("addPlaylist")}%`}
            detail={`${reviews.filter((review) => review.addPlaylist).length} yes`}
            icon={ListMusic}
          />
          <StatCard
            label={copy.app.dashboard.attention}
            value={`${percentage("grabbedAttention")}%`}
            detail="first 30 seconds"
            icon={Sparkles}
          />
          <StatCard
            label={copy.app.dashboard.share}
            value={`${percentage("shareWithFriend")}%`}
            detail={`${reviews.filter((review) => review.shareWithFriend).length} yes`}
            icon={Share2}
          />
          <StatCard
            label={copy.app.dashboard.credits}
            value={String(totalCreditsEarned)}
            detail={`${reviewCredits} ${locale === "es" ? "disponibles" : "currently available"}`}
            icon={CheckCircle2}
          />
          <StatCard
            label={copy.app.dashboard.quality}
            value={`${reviewQualityScore}`}
            detail={copy.app.dashboard.outOf100}
            icon={ShieldCheck}
          />
        </div>

        <div className="insights-grid">
          <div className="panel ratings-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">{copy.app.dashboard.ratingSpread}</span>
                <h3>{copy.app.dashboard.howScores}</h3>
              </div>
              <div className="rating-summary">
                <Star fill="currentColor" size={16} />
                {average.toFixed(1)}
              </div>
            </div>
            <div className="bar-chart">
              {ratingCounts.map((count, index) => (
                <div className="bar-item" key={index}>
                  <span>{count || ""}</span>
                  <i style={{ height: `${Math.max(8, (count / maxCount) * 100)}%` }} />
                  <small>{index + 1}</small>
                </div>
              ))}
            </div>
          </div>

          <div className="panel signal-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">{copy.app.dashboard.signal}</span>
                <h3>{copy.app.dashboard.firstImpression}</h3>
              </div>
            </div>
            {[
              [copy.app.dashboard.listenFull, percentage("listenFull")],
              [copy.app.dashboard.playlist, percentage("addPlaylist")],
              [copy.app.dashboard.attention, percentage("grabbedAttention")],
              [copy.app.dashboard.share, percentage("shareWithFriend")],
            ].map(([label, value]) => (
              <div className="signal-row" key={label}>
                <div><span>{label}</span><strong>{value}%</strong></div>
                <div className="signal-track"><i style={{ width: `${value}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <aside className="comments-panel">
        <div className="comments-heading">
          <div>
            <span className="eyebrow">{copy.app.dashboard.listenerNotes}</span>
            <h3>{copy.app.dashboard.comments}</h3>
          </div>
          <span>{reviews.filter((review) => review.comment).length}</span>
        </div>
        <div className="comment-list">
          {reviews
            .filter((review) => review.comment)
            .slice(0, 5)
            .map((review) => (
              <article key={review.id}>
                <div>
                  <span className="comment-avatar"><UserRound size={14} /></span>
                  <span>
                    <strong>{review.reviewer}</strong>
                    <small>{review.createdAt}</small>
                  </span>
                  <b>{review.rating}<Star size={11} fill="currentColor" /></b>
                </div>
                <p>&quot;{review.comment}&quot;</p>
              </article>
            ))}
        </div>
        <button className="all-comments-button">
          {locale === "es" ? "Ver todos los comentarios" : "View all comments"} <ArrowRight size={15} />
        </button>
      </aside>
    </main>
  );
}

function toggleFocus(values: FeedbackFocus[], value: FeedbackFocus) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function SubmitView({
  reviewCount,
  notify,
  onSubmitted,
  founderFree,
  copy,
  locale,
}: {
  reviewCount: number;
  notify: (message: string) => void;
  onSubmitted: (
    usedFounderFree: boolean,
    submission: SongSubmission,
  ) => Promise<boolean>;
  founderFree: boolean;
  copy: Copy;
  locale: InterfaceLocale;
}) {
  const unlocked = reviewCount >= 5 || founderFree;
  const [submitted, setSubmitted] = useState(false);
  const [musicLink, setMusicLink] = useState("");
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [songLanguage, setSongLanguage] = useState<SongLanguage | "">("");
  const [feedbackFocus, setFeedbackFocus] = useState<FeedbackFocus[]>(["Hook Strength"]);
  const [saving, setSaving] = useState(false);
  const platformDetection = detectMusicPlatform(musicLink);
  const platformMessage = translatedPlatformMessage(
    locale,
    musicLink,
    platformDetection.platform,
    platformDetection.valid,
    platformDetection.message,
  );

  const submitSong = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!unlocked) return;
    if (!platformDetection.valid || !platformDetection.platform) {
      notify(locale === "es" ? "Pega un enlace valido de Spotify, YouTube, YouTube Music o SoundCloud." : "Paste a valid Spotify, YouTube, YouTube Music, or SoundCloud song link.");
      return;
    }
    if (!songLanguage || feedbackFocus.length === 0) {
      notify(locale === "es" ? "Selecciona idioma y foco de feedback." : "Select song language and feedback focus.");
      return;
    }
    const formData = new FormData(event.currentTarget);
    const submission: SongSubmission = {
      title: String(formData.get("songTitle") ?? ""),
      artistName: String(formData.get("artistName") ?? ""),
      coverImageUrl: String(formData.get("coverImageUrl") ?? ""),
      musicUrl: musicLink,
      platform: platformDetection.platform,
      genre: String(formData.get("genre") ?? "") as Genre,
      language: songLanguage,
      feedbackFocus,
      country: String(formData.get("country") ?? ""),
    };

    setSaving(true);
    const saved = await onSubmitted(founderFree, submission);
    setSaving(false);
    if (!saved) return;

    setPlatform(platformDetection.platform);
    setSubmitted(true);
    notify(locale === "es" ? "Cancion enviada. Ya entra a la cola de reviews." : "Song submitted. It is now entering the review queue.");
  };

  if (submitted) {
    return (
      <main className="content submit-success">
        <section>
          <div className="success-orbit"><Check size={36} /></div>
          <span className="eyebrow">{copy.app.submit.received}</span>
          <h2>{copy.app.submit.queue}</h2>
          <p>{copy.app.submit.saved}</p>
          <div className="success-song">
            <div className="success-cover"><Music2 size={28} /></div>
            <span>
              <strong>{copy.app.submit.newRelease}</strong>
              <small>
                {platform} / {songLanguage && optionLabel(locale, songLanguage)} / {copy.app.submit.waiting}
              </small>
            </span>
            <CheckCircle2 size={20} />
          </div>
          <button className="primary-button" onClick={() => setSubmitted(false)}>
            {copy.app.submit.another}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="content submit-layout">
      <section className="submit-form-card">
        <div className="submit-heading">
          <div className="submit-icon"><Link2 size={21} /></div>
          <div>
            <span className="eyebrow">{copy.app.submit.linkNotUpload}</span>
            <h2>{copy.app.submit.tellUs}</h2>
            <p>{copy.app.submit.body}</p>
          </div>
        </div>

        {!unlocked && (
          <div className="locked-banner">
            <LockKeyhole size={19} />
            <div>
              <strong>{copy.app.submit.completeReviews}</strong>
              <p>{locale === "es" ? "Cada envio empieza aportando feedback util." : "Every submission starts with giving useful feedback first."}</p>
            </div>
          </div>
        )}
        {founderFree && (
          <div className="founder-unlock-banner">
            <BadgeCheck size={19} />
            <div>
              <strong>{copy.app.submit.founderFree}</strong>
              <p>{copy.app.submit.founderFreeBody}</p>
            </div>
          </div>
        )}

        <form onSubmit={submitSong}>
          <div className="field full">
            <label htmlFor="music-link">{copy.app.submit.musicLink}</label>
            <div className="input-with-icon">
              <Link2 size={17} />
              <input
                disabled={!unlocked}
                id="music-link"
                name="musicUrl"
                onChange={(event) => {
                  const nextLink = event.target.value;
                  setMusicLink(nextLink);
                  setPlatform(detectMusicPlatform(nextLink).platform);
                }}
                placeholder="https://open.spotify.com/track/..."
                required
                type="url"
                value={musicLink}
              />
            </div>
            <small className={platformDetection.valid ? "link-valid" : "link-invalid"}>
              {platformMessage}
            </small>
          </div>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="song-title">{copy.app.submit.songTitle}</label>
              <input
                disabled={!unlocked}
                id="song-title"
                name="songTitle"
                placeholder={locale === "es" ? "ej. Neon Weather" : "e.g. Neon Weather"}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="artist-name">{copy.app.submit.artistName}</label>
              <input
                disabled={!unlocked}
                id="artist-name"
                name="artistName"
                placeholder={locale === "es" ? "Tu nombre artistico" : "Your artist name"}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="genre">{copy.app.submit.genre}</label>
              <select disabled={!unlocked} id="genre" name="genre" required defaultValue="">
                <option disabled value="">
                  {locale === "es" ? "Selecciona un genero" : "Select a genre"}
                </option>
                {genreOptions.map((genre) => (
                  <option key={genre} value={genre}>{optionLabel(locale, genre)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="song-language">{copy.app.submit.songLanguage}</label>
              <select
                disabled={!unlocked}
                id="song-language"
                name="songLanguage"
                onChange={(event) => setSongLanguage(event.target.value as SongLanguage)}
                required
                value={songLanguage}
              >
                <option disabled value="">
                  {locale === "es" ? "Selecciona un idioma" : "Select a language"}
                </option>
                {songLanguageOptions.map((language) => (
                  <option key={language} value={language}>{optionLabel(locale, language)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="country">{copy.app.submit.country}</label>
              <select disabled={!unlocked} id="country" name="country" required defaultValue="">
                <option disabled value="">
                  {locale === "es" ? "Selecciona un pais" : "Select a country"}
                </option>
                <option>United States</option>
                <option>Canada</option>
                <option>Mexico</option>
                <option>United Kingdom</option>
                <option>Spain</option>
                <option>{optionLabel(locale, "Other")}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="cover-url">{copy.app.submit.cover}</label>
              <input
                disabled={!unlocked}
                id="cover-url"
                name="coverImageUrl"
                placeholder="https://..."
                required
                type="url"
              />
            </div>
          </div>

          <div className="field full">
            <label>{copy.app.submit.feedbackLookingFor}</label>
            <div className="focus-picker">
              {feedbackFocusOptions.map((focus) => (
                <button
                  className={feedbackFocus.includes(focus) ? "selected" : ""}
                  disabled={!unlocked}
                  key={focus}
                  onClick={() => setFeedbackFocus(toggleFocus(feedbackFocus, focus))}
                  type="button"
                >
                  {feedbackFocus.includes(focus) && <Check size={13} />}
                  {optionLabel(locale, focus)}
                </button>
              ))}
            </div>
          </div>

          <div className="platform-picker">
            <label>{copy.app.submit.detectedPlatform}</label>
            <div>
              {(["Spotify", "YouTube", "YouTube Music", "SoundCloud"] as Platform[]).map((item) => (
                <button className={platform === item ? "active" : ""} disabled key={item} type="button">
                  {platform === item ? <Check size={14} /> : <PlatformIcon platform={item} size={14} />}
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="privacy-note">
            <LockKeyhole size={16} />
            <span>
              <strong>{copy.app.submit.privacyTitle}</strong>
              {copy.app.submit.privacyBody}
            </span>
          </div>

          <button
            className="primary-button wide"
            disabled={!unlocked || !platformDetection.valid || !songLanguage || feedbackFocus.length === 0 || saving}
            type="submit"
          >
            {saving
              ? "..."
              : unlocked
              ? founderFree
                ? copy.app.submit.useFounder
                : copy.app.submit.submitFeedback
              : copy.app.submit.locked}
            {unlocked ? <ArrowRight size={17} /> : <LockKeyhole size={16} />}
          </button>
        </form>
      </section>

      <aside className="submission-side">
        <ReviewProgress count={reviewCount} copy={copy} founderFree={founderFree} />
        <div className="expect-card">
          <span className="eyebrow">{locale === "es" ? "Que sigue" : "What happens next"}</span>
          {[
            ["01", locale === "es" ? "Tu enlace entra a la cola de escucha." : "Your link enters the listening queue."],
            ["02", locale === "es" ? "Reviewers ven idioma, genero y foco de feedback." : "Reviewers see the song language, genre, and feedback focus."],
            ["03", locale === "es" ? "Los resultados aparecen en tu dashboard privado." : "Results appear privately in your dashboard."],
          ].map(([number, text]) => (
            <div key={number}><span>{number}</span><p>{text}</p></div>
          ))}
        </div>
      </aside>
    </main>
  );
}

type FirstListenAppProps = {
  onLogout: () => void;
  locale: InterfaceLocale;
  onLocaleChange: (locale: InterfaceLocale) => void;
  listenerLanguages?: ListenerLanguage[];
  genrePreferences?: Genre[];
  initialFounder?: boolean;
  initialFounderFree?: boolean;
  initialReviewCredits?: number;
  initialTotalCreditsEarned?: number;
  initialReviewQualityScore?: number;
};

export function FirstListenApp({
  onLogout,
  locale,
  onLocaleChange,
  listenerLanguages,
  genrePreferences,
  initialFounder,
  initialFounderFree,
  initialReviewCredits,
  initialTotalCreditsEarned,
  initialReviewQualityScore,
}: FirstListenAppProps) {
  const copy = getCopy(locale);
  const [view, setView] = useState<View>("review");
  const [reviewCount, setReviewCount] = useState(initialReviewCredits ?? 3);
  const [totalCreditsEarned, setTotalCreditsEarned] = useState(initialTotalCreditsEarned ?? 3);
  const [reviewQualityScores, setReviewQualityScores] = useState<number[]>(
    initialReviewQualityScore ? [initialReviewQualityScore] : [92, 88, 94],
  );
  const [priorComments, setPriorComments] = useState<string[]>([]);
  const [founder, setFounder] = useState(initialFounder ?? false);
  const [founderFree, setFounderFree] = useState(initialFounderFree ?? false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [languages, setLanguages] = useState<ListenerLanguage[]>(
    listenerLanguages?.length ? listenerLanguages : defaultListenerLanguages,
  );
  const [genres, setGenres] = useState<Genre[]>(
    genrePreferences?.length ? genrePreferences : defaultGenrePreferences,
  );
  const [queueSongs, setQueueSongs] = useState<Song[]>(reviewQueue);

  useEffect(() => {
    document.documentElement.lang = locale;
    setToast("");
  }, [locale]);

  useEffect(() => {
    if (initialReviewCredits === undefined) {
      const stored = window.localStorage.getItem("first-listen-review-count");
      if (stored) setReviewCount(Number(stored));
    }
    if (initialTotalCreditsEarned === undefined) {
      const storedTotalCredits = window.localStorage.getItem("first-listen-total-credits");
      if (storedTotalCredits) setTotalCreditsEarned(Number(storedTotalCredits));
    }
    if (initialReviewQualityScore === undefined) {
      const storedQualityScores = window.localStorage.getItem("first-listen-quality-scores");
      if (storedQualityScores) setReviewQualityScores(JSON.parse(storedQualityScores));
    }
    const storedComments = window.localStorage.getItem("first-listen-prior-comments");
    if (storedComments) setPriorComments(JSON.parse(storedComments));
    if (initialFounder === undefined) {
      setFounder(window.localStorage.getItem("first-listen-founder") === "true");
    }
    if (initialFounderFree === undefined) {
      setFounderFree(window.localStorage.getItem("first-listen-founder-free") === "true");
    }
    if (!listenerLanguages?.length) {
      const storedLanguages = window.localStorage.getItem("first-listen-listener-languages");
      if (storedLanguages) setLanguages(JSON.parse(storedLanguages));
    }
    if (!genrePreferences?.length) {
      const storedGenres = window.localStorage.getItem("first-listen-genre-preferences");
      if (storedGenres) setGenres(JSON.parse(storedGenres));
    }
    setDarkMode(window.localStorage.getItem("first-listen-theme") === "dark");
  }, [
    genrePreferences,
    initialFounder,
    initialFounderFree,
    initialReviewCredits,
    initialReviewQualityScore,
    initialTotalCreditsEarned,
    listenerLanguages,
  ]);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;

    let active = true;
    supabase.rpc("get_smart_review_queue", { queue_limit: 20 }).then(({ data, error }) => {
      if (!active || error || !data) return;
      setQueueSongs(
        data.map((row: Record<string, unknown>) => ({
          id: String(row.song_id),
          title: String(row.title),
          artist: String(row.artist_name),
          coverUrl: String(row.cover_image_url),
          link: String(row.music_url),
          platform: displayPlatform[String(row.platform)] ?? "Spotify",
          genre: String(row.genre) as Genre,
          language: String(row.song_language) as SongLanguage,
          feedbackFocus: (row.feedback_focus ?? []) as FeedbackFocus[],
          country: String(row.country),
          submittedAt: String(row.submitted_at),
          accent: "#c8ff4f",
        })),
      );
    });

    return () => {
      active = false;
    };
  }, []);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const averageReviewQuality = Math.round(
    reviewQualityScores.reduce((sum, score) => sum + score, 0) / reviewQualityScores.length,
  );
  const activityScore = Math.min(25, Math.round(totalCreditsEarned * 3 + averageReviewQuality / 10));

  const handleReviewed = async (
    songId: string,
    form: ReviewForm,
    pastedWithoutEditing: boolean,
    clientQualityScore: number,
  ): Promise<ReviewSubmissionResult> => {
    let qualityScore = clientQualityScore;
    const supabase = createClient();
    const isDatabaseSong = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(songId);

    if (supabase && isDatabaseSong) {
      const { data, error } = await supabase.rpc("submit_review", {
        reviewed_song_id: songId,
        review_listen_full: form.listenFull,
        review_add_to_playlist: form.addPlaylist,
        review_grabbed_attention: form.grabbedAttention,
        review_share_with_friend: form.shareWithFriend,
        review_rating: form.rating,
        review_comment: form.comment.trim(),
        review_pasted_comment_detected: pastedWithoutEditing,
      });
      const result = Array.isArray(data) ? data[0] : data;
      if (error || !result?.accepted) {
        return {
          accepted: false,
          qualityScore: Number(result?.quality_score ?? 0),
          warning: result?.warning || error?.message,
        };
      }
      qualityScore = Number(result.quality_score);
    }

    setReviewCount((current) => {
      const next = current + 1;
      window.localStorage.setItem("first-listen-review-count", String(next));
      return next;
    });
    setTotalCreditsEarned((current) => {
      const next = current + 1;
      window.localStorage.setItem("first-listen-total-credits", String(next));
      return next;
    });
    setReviewQualityScores((current) => {
      const next = [...current, qualityScore];
      window.localStorage.setItem("first-listen-quality-scores", JSON.stringify(next));
      return next;
    });
    setPriorComments((current) => {
      const next = [...current, form.comment.trim()].slice(-20);
      window.localStorage.setItem("first-listen-prior-comments", JSON.stringify(next));
      return next;
    });
    setQueueSongs((current) => current.filter((song) => song.id !== songId));
    return { accepted: true, qualityScore };
  };

  const handleSongSubmitted = async (
    usedFounderFree: boolean,
    submission: SongSubmission,
  ) => {
    const supabase = createClient();
    if (supabase) {
      const { error } = await supabase.rpc("submit_song", {
        song_title: submission.title,
        song_artist_name: submission.artistName,
        song_cover_image_url: submission.coverImageUrl,
        song_music_url: submission.musicUrl,
        song_platform: databasePlatform[submission.platform],
        song_genre: submission.genre,
        song_language: submission.language,
        song_feedback_focus: submission.feedbackFocus,
        song_country: submission.country,
      });
      if (error) {
        notify(error.message);
        return false;
      }
    }

    if (usedFounderFree) {
      setFounderFree(false);
      window.localStorage.setItem("first-listen-founder-free", "false");
      return true;
    }

    setReviewCount((current) => {
      const next = Math.max(0, current - 5);
      window.localStorage.setItem("first-listen-review-count", String(next));
      return next;
    });
    return true;
  };

  const toggleTheme = () => {
    setDarkMode((current) => {
      const next = !current;
      window.localStorage.setItem("first-listen-theme", next ? "dark" : "light");
      return next;
    });
  };

  const changeView = (nextView: View) => {
    setView(nextView);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const viewContent = useMemo(() => {
    if (view === "dashboard") {
      return (
        <DashboardView
          copy={copy}
          founder={founder}
          locale={locale}
          reviewCredits={reviewCount}
          reviewQualityScore={averageReviewQuality}
          setView={changeView}
          totalCreditsEarned={totalCreditsEarned}
        />
      );
    }
    if (view === "submit") {
      return (
        <SubmitView
          copy={copy}
          founderFree={founderFree}
          locale={locale}
          notify={notify}
          onSubmitted={handleSongSubmitted}
          reviewCount={reviewCount}
        />
      );
    }
    return (
      <ReviewView
        activityScore={activityScore}
        copy={copy}
        founderFree={founderFree}
        genrePreferences={genres}
        listenerLanguages={languages}
        locale={locale}
        notify={notify}
        onReviewed={handleReviewed}
        priorComments={priorComments}
        queueSongs={queueSongs}
        reviewCount={reviewCount}
        setView={changeView}
      />
    );
  }, [
    activityScore,
    averageReviewQuality,
    copy,
    founder,
    founderFree,
    genres,
    languages,
    locale,
    priorComments,
    queueSongs,
    reviewCount,
    totalCreditsEarned,
    view,
  ]);

  return (
    <div className={darkMode ? "app-shell theme-dark" : "app-shell"}>
      <Sidebar
        copy={copy}
        founder={founder}
        founderFree={founderFree}
        onLogout={onLogout}
        reviewCount={reviewCount}
        setView={changeView}
        view={view}
      />
      <div className="app-main">
        <Topbar
          copy={copy}
          darkMode={darkMode}
          locale={locale}
          onLocaleChange={onLocaleChange}
          onLogout={onLogout}
          onMenu={() => setMenuOpen(true)}
          onToggleTheme={toggleTheme}
          view={view}
        />
        {viewContent}
      </div>

      <div className={menuOpen ? "mobile-drawer open" : "mobile-drawer"}>
        <div className="drawer-backdrop" onClick={() => setMenuOpen(false)} />
        <div className="drawer-panel">
          <div className="drawer-head">
            <Logo />
            <button onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={20} /></button>
          </div>
          <nav>
            {navItems(copy).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={view === item.id ? "active" : ""}
                  key={item.id}
                  onClick={() => changeView(item.id)}
                >
                  <Icon size={19} />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <button className="drawer-signout" onClick={onLogout}>
            <LogOut size={17} />
            {copy.common.signOut}
          </button>
        </div>
      </div>

      <nav className="mobile-nav">
        {navItems(copy).map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={view === item.id ? "active" : ""}
              key={item.id}
              onClick={() => changeView(item.id)}
            >
              <Icon size={20} />
              <span>{shortMobileLabel(locale, item.id, copy)}</span>
              {item.id === "submit" && reviewCount < 5 && !founderFree && <i />}
            </button>
          );
        })}
      </nav>

      <div className={toast ? "toast visible" : "toast"}>
        <CheckCircle2 size={18} />
        {toast}
      </div>
    </div>
  );
}
