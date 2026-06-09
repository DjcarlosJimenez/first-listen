"use client";

import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Cloud,
  Disc3,
  ExternalLink,
  Flag,
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
  UserPlus,
  Radio,
  X,
  Youtube,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { LanguageSelector } from "@/components/language-selector";
import { Logo } from "@/components/logo";
import { ProviderPlayer } from "@/components/provider-player";
import {
  feedbackFocusOptions,
  genreOptions,
  songLanguageOptions,
  type FeedbackFocus,
  type Genre,
  type InterfaceLocale,
  type ListenerLanguage,
  type SongLanguage,
} from "@/lib/catalog";
import { getCopy, optionLabel } from "@/lib/i18n";
import { getDiscoveryLinks } from "@/lib/discovery";
import { describeMatch, prioritizeReviewQueue } from "@/lib/matching";
import { detectMusicPlatform } from "@/lib/platform";
import { getProviderEmbed } from "@/lib/player";
import { evaluateReviewQuality } from "@/lib/review-quality";
import { createClient } from "@/lib/supabase/client";
import type {
  AccountSummary,
  Platform,
  Review,
  Song,
  SongDashboardSummary,
} from "@/lib/types";

export type View = "review" | "dashboard" | "submit";
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
  creditsBalance?: number;
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
  explicitContent: boolean;
};

const databasePlatform: Record<Platform, string> = {
  Spotify: "spotify",
  YouTube: "youtube",
  "YouTube Music": "youtube_music",
  SoundCloud: "soundcloud",
  "Apple Music": "apple_music",
};

const displayPlatform: Record<string, Platform> = {
  spotify: "Spotify",
  youtube: "YouTube",
  youtube_music: "YouTube Music",
  soundcloud: "SoundCloud",
  apple_music: "Apple Music",
};

function mapQueueRows(data: Array<Record<string, unknown>>): Song[] {
  return data.map((row) => ({
    id: String(row.song_id),
    artistId: String(row.artist_id),
    title: String(row.title),
    artist: String(row.artist_name),
    coverUrl: String(row.cover_image_url),
    link: String(row.music_url),
    platform: displayPlatform[String(row.platform)] ?? "Spotify",
    genre: String(row.genre) as Genre,
    language: String(row.song_language) as SongLanguage,
    feedbackFocus: (row.feedback_focus ?? []) as FeedbackFocus[],
    explicitContent: Boolean(row.explicit_content),
    country: String(row.country),
    submittedAt: String(row.submitted_at),
    accent: "#c8ff4f",
  }));
}

const emptyReview: ReviewForm = {
  listenFull: null,
  addPlaylist: null,
  grabbedAttention: null,
  shareWithFriend: null,
  rating: 0,
  comment: "",
};

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
  if (platform === "Apple Music") {
    return <Radio size={size} />;
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

function ReviewProgress({
  count,
  founderFree = false,
  copy,
  unlimited = false,
}: {
  count: number;
  founderFree?: boolean;
  copy: Copy;
  unlimited?: boolean;
}) {
  return (
    <div className="review-progress">
      <div>
        <span className="eyebrow">
          <Sparkles size={13} />
          Submission credits
        </span>
        <strong>
          {unlimited ? "∞" : count}<span>{unlimited ? "" : " available"}</span>
        </strong>
      </div>
      <div className="progress-track" aria-label={`${unlimited ? "Unlimited" : count} submission credits`}>
        <i style={{ width: `${unlimited ? 100 : Math.min(count, 10) * 10}%` }} />
      </div>
      <p>
        {founderFree
          ? copy.app.review.founderReady
          : unlimited
            ? "Super Admin accounts can submit without spending credits."
            : count >= 1
              ? "One credit submits one validated song."
              : "Complete review milestones to earn more credits."}
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
  account,
  onProfile,
  copy,
  unlimitedCredits,
  adminAccess,
  onAdmin,
}: {
  view: View;
  setView: (view: View) => void;
  reviewCount: number;
  founder: boolean;
  founderFree: boolean;
  account: AccountSummary;
  onProfile: () => void;
  copy: Copy;
  unlimitedCredits: boolean;
  adminAccess: boolean;
  onAdmin: () => void;
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
              {item.id === "review" && <em>{unlimitedCredits ? "\u221e" : reviewCount}</em>}
              {item.id === "submit" && reviewCount < 1 && !founderFree && !unlimitedCredits && (
                <LockKeyhole className="nav-lock" size={14} />
              )}
            </button>
          );
        })}
        {adminAccess && (
          <button onClick={onAdmin}>
            <ShieldCheck size={19} />
            <span>Admin Panel</span>
          </button>
        )}
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
        <button className="profile-row" onClick={onProfile}>
          <span className="avatar">{account.initials}</span>
          <span>
            <strong>{account.displayName}</strong>
            <small>{account.email || "Profile"}</small>
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
  onHelp,
  darkMode,
  onToggleTheme,
  copy,
  locale,
  onLocaleChange,
}: {
  view: View;
  onMenu: () => void;
  onLogout: () => void;
  onHelp: () => void;
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
        <button className="help-button" onClick={onHelp} aria-label="Help Center">
          <CircleHelp size={19} />
        </button>
        <button className="session-button" onClick={onLogout} title={copy.common.signOut}>
          <LogOut size={15} />
          <b>{copy.common.signOut}</b>
        </button>
      </div>
    </header>
  );
}

function PostReviewDiscovery({
  song,
  notify,
}: {
  song: Song;
  notify: (message: string) => void;
}) {
  const links = getDiscoveryLinks(song);
  const [following, setFollowing] = useState(false);
  const [saved, setSaved] = useState(false);

  const followArtist = async () => {
    const supabase = createClient();
    if (!supabase || !song.artistId) {
      notify("Log in again to follow this artist.");
      return;
    }
    const { error } = await supabase.rpc("follow_artist", {
      target_artist_id: song.artistId,
    });
    if (error) {
      notify(error.message);
      return;
    }
    setFollowing(true);
    notify(`You are now following ${song.artist}.`);
  };

  const saveForLater = async () => {
    const supabase = createClient();
    if (!supabase) {
      notify("Log in again to save this song.");
      return;
    }
    const { error } = await supabase.rpc("save_song_for_later", {
      target_song_id: song.id,
    });
    if (error) {
      notify(error.message);
      return;
    }
    setSaved(true);
    notify(`${song.title} was saved for later.`);
  };

  return (
    <div className="discovery-card">
      <span className="eyebrow"><Sparkles size={13} /> Review complete</span>
      <h3>Keep listening</h3>
      <p>Your next review is ready. First Listen stays open when you visit a music platform.</p>
      <div className="discovery-links">
        <a href={links.spotify} rel="noreferrer" target="_blank">
          <Disc3 size={15} /> Listen Full Song on Spotify
        </a>
        <a href={links.youtube} rel="noreferrer" target="_blank">
          <Youtube size={15} /> Listen Full Song on YouTube
        </a>
        <a href={links.apple} rel="noreferrer" target="_blank">
          <Radio size={15} /> Listen Full Song on Apple Music
        </a>
      </div>
      <div className="discovery-actions">
        <button disabled={following || !song.artistId} onClick={followArtist} type="button">
          <UserPlus size={14} /> {following ? "Following" : "Follow Artist"}
        </button>
        <button disabled={saved} onClick={saveForLater} type="button">
          <Bookmark size={14} /> {saved ? "Saved" : "Save For Later"}
        </button>
      </div>
      {song.artistId && (
        <Link href={`/artists/${song.artistId}`}>
          View {song.artist}&apos;s profile <ArrowRight size={13} />
        </Link>
      )}
    </div>
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
  unlimitedCredits,
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
  unlimitedCredits: boolean;
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
  const songLoadedAt = useMemo(
    () => (song ? new Date().toISOString() : null),
    [song],
  );
  const matchReason = song ? describeMatch(song, reviewerProfile) : "";
  const [form, setForm] = useState<ReviewForm>(emptyReview);
  const [pastedWithoutEditing, setPastedWithoutEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reportReason, setReportReason] = useState("spam");
  const [lastReviewedSong, setLastReviewedSong] = useState<Song | null>(null);

  useEffect(() => {
    setForm(emptyReview);
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
    setLastReviewedSong(song);
    notify(
      locale === "es"
        ? "Review enviada. La siguiente cancion ya esta lista."
        : "Review submitted. The next song is ready.",
    );
  };

  const reportSong = async () => {
    const supabase = createClient();
    if (!supabase || !song) return;
    const { error } = await supabase.rpc("report_song", {
      reported_song_id: song.id,
      report_reason: reportReason,
      report_details: null,
    });
    notify(
      error
        ? error.message
        : locale === "es"
          ? "Reporte enviado para moderacion."
          : "Report sent to moderation.",
    );
  };

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
          <ReviewProgress count={reviewCount} copy={copy} founderFree={founderFree} unlimited={unlimitedCredits} />
        </aside>
      </main>
    );
  }

  return (
    <main className="content review-layout">
      <section className="review-card">
        <div className="song-hero">
          <div className="cover-wrap">
            <ProviderPlayer
              artist={song.artist}
              coverUrl={song.coverUrl}
              link={song.link}
              locale={locale}
              platform={song.platform}
              songLoadedAt={songLoadedAt}
              title={song.title}
            />
            <span className="listen-badge">
              <Clock3 size={13} /> {locale === "es" ? "Reproductor oficial" : "Provider player"}
            </span>
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
            <p className="provider-player-note">
              {locale === "es"
                ? `${song.platform} controla la reproducción, el progreso, el volumen y la duración.`
                : `Playback, progress, volume, and duration are controlled by ${song.platform}.`}
            </p>
            <a href={song.link} target="_blank" rel="noreferrer">
              Open on {song.platform} <ExternalLink size={14} />
            </a>
            <div className="report-control">
              <select
                aria-label="Report reason"
                onChange={(event) => setReportReason(event.target.value)}
                value={reportReason}
              >
                <option value="spam">Spam</option>
                <option value="broken_link">Broken Link</option>
                <option value="not_music">Not Music</option>
                <option value="illegal_content">Illegal Content</option>
                <option value="offensive_content">Offensive Content</option>
              </select>
              <button onClick={reportSong} type="button"><Flag size={13} /> Report Song</button>
            </div>
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
        {lastReviewedSong && (
          <PostReviewDiscovery notify={notify} song={lastReviewedSong} />
        )}
        <ReviewProgress count={reviewCount} copy={copy} founderFree={founderFree} unlimited={unlimitedCredits} />
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
  song,
  songSummaries,
  songReviews,
}: {
  setView: (view: View) => void;
  founder: boolean;
  totalCreditsEarned: number;
  reviewCredits: number;
  reviewQualityScore: number;
  copy: Copy;
  locale: InterfaceLocale;
  song: Song | null;
  songSummaries: SongDashboardSummary[];
  songReviews: Review[];
}) {
  const reviews = songReviews;
  if (!song) {
    return (
      <main className="content submit-success">
        <section>
          <div className="success-orbit"><Music2 size={34} /></div>
          <span className="eyebrow">{copy.app.dashboard.latest}</span>
          <h2>No songs submitted yet.</h2>
          <p>Submit a validated music link to begin collecting private feedback.</p>
          <button className="primary-button" onClick={() => setView("submit")}>
            <Plus size={16} /> {copy.app.dashboard.newSubmission}
          </button>
        </section>
      </main>
    );
  }
  const average = reviews.length
    ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
    : 0;
  const percentage = (
    key: "listenFull" | "addPlaylist" | "grabbedAttention" | "shareWithFriend",
  ) => reviews.length
    ? Math.round((reviews.filter((review) => review[key]).length / reviews.length) * 100)
    : 0;

  const ratingCounts = Array.from({ length: 10 }, (_, index) => {
    const rating = index + 1;
    return reviews.filter((review) => review.rating === rating).length;
  });
  const maxCount = Math.max(1, ...ratingCounts);
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
          <Image src={song.coverUrl} alt={`${song.title} cover`} unoptimized width={90} height={90} />
          <div className="active-song-copy">
            <div>
              <span className="live-dot">{copy.app.dashboard.collecting}</span>
              <span className="platform-label">{song.platform}</span>
              {founder && <span className="song-founder-badge"><BadgeCheck size={12} /> {copy.app.dashboard.founder}</span>}
            </div>
            <h3>{song.title}</h3>
            <p>
              {song.artistId ? (
                <Link href={`/artists/${song.artistId}`}>{song.artist}</Link>
              ) : song.artist}
              {" / "}{optionLabel(locale, song.genre)} / {optionLabel(locale, song.language)}
            </p>
            <div className="active-song-tags">
              {song.feedbackFocus.map((focus) => <span key={focus}>{optionLabel(locale, focus)}</span>)}
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

        <section className="panel song-performance-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Song performance</span>
              <h3>Every submitted song</h3>
            </div>
            <span>{songSummaries.length} total</span>
          </div>
          <div className="song-performance-list">
            {songSummaries.map((summary) => (
              <article key={summary.id}>
                <div className="song-performance-title">
                  <strong>{summary.title}</strong>
                  <small>
                    {summary.platform} / Submitted{" "}
                    {new Date(summary.submittedAt).toLocaleDateString(locale, { timeZone: "UTC" })}
                  </small>
                </div>
                <div><strong>{summary.reviewsReceived}</strong><span>Reviews received</span></div>
                <div><strong>{summary.averageRating.toFixed(1)}</strong><span>Average rating</span></div>
                <div><strong>{summary.hookScore}</strong><span>Hook score</span></div>
                <div><strong>{summary.reportCount}</strong><span>Reports</span></div>
                <Link href={`/dashboard/comments?song=${summary.id}`}>
                  Comments <ArrowRight size={13} />
                </Link>
              </article>
            ))}
          </div>
        </section>

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
        <Link className="all-comments-button" href={`/dashboard/comments?song=${song.id}`}>
          {locale === "es" ? "Ver todos los comentarios" : "View all comments"} <ArrowRight size={15} />
        </Link>
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
  unlimitedCredits,
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
  unlimitedCredits: boolean;
}) {
  const unlocked = reviewCount >= 1 || founderFree || unlimitedCredits;
  const [submitted, setSubmitted] = useState(false);
  const [musicLink, setMusicLink] = useState("");
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [songTitle, setSongTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [genre, setGenre] = useState<Genre | "">("");
  const [songLanguage, setSongLanguage] = useState<SongLanguage | "">("");
  const [country, setCountry] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [feedbackFocus, setFeedbackFocus] = useState<FeedbackFocus[]>(["Hook Strength"]);
  const [explicitContent, setExplicitContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [browserOrigin, setBrowserOrigin] = useState<string>();
  const platformDetection = detectMusicPlatform(musicLink);
  const providerEmbed =
    platformDetection.platform && platformDetection.valid
      ? getProviderEmbed(musicLink, platformDetection.platform, browserOrigin)
      : null;
  const platformMessage = translatedPlatformMessage(
    locale,
    musicLink,
    platformDetection.platform,
    platformDetection.valid,
    platformDetection.message,
  );
  const validationFailures = useMemo(() => {
    const failures: string[] = [];
    if (!unlocked) {
      failures.push(
        locale === "es"
          ? "Necesitas al menos un credito para enviar una cancion."
          : "At least one credit is required to submit a song.",
      );
    }
    if (!platformDetection.valid || !platformDetection.platform) {
      failures.push(
        locale === "es"
          ? "Usa un enlace valido de una plataforma compatible."
          : "Use a valid link from a supported platform.",
      );
    }
    if (!songTitle.trim()) {
      failures.push(locale === "es" ? "Escribe el titulo de la cancion." : "Enter the song title.");
    }
    if (!artistName.trim()) {
      failures.push(locale === "es" ? "Escribe el nombre del artista." : "Enter the artist name.");
    }
    if (!genre) {
      failures.push(locale === "es" ? "Selecciona un genero." : "Select a genre.");
    }
    if (!songLanguage) {
      failures.push(locale === "es" ? "Selecciona el idioma de la cancion." : "Select the song language.");
    }
    if (!country) {
      failures.push(locale === "es" ? "Selecciona un pais." : "Select a country.");
    }
    if (feedbackFocus.length === 0) {
      failures.push(
        locale === "es"
          ? "Selecciona al menos un enfoque de feedback."
          : "Select at least one feedback focus.",
      );
    }
    if (coverImageUrl && !/^https:\/\//i.test(coverImageUrl.trim())) {
      failures.push(
        locale === "es"
          ? "La portada opcional debe usar una URL https://."
          : "The optional cover image must use an https:// URL.",
      );
    }
    return failures;
  }, [
    artistName,
    country,
    coverImageUrl,
    feedbackFocus.length,
    genre,
    locale,
    platformDetection.platform,
    platformDetection.valid,
    songLanguage,
    songTitle,
    unlocked,
  ]);
  const submitDisabled = saving || validationFailures.length > 0;

  useEffect(() => {
    setBrowserOrigin(window.location.origin);
    setDebugEnabled(new URLSearchParams(window.location.search).get("debug") === "1");
  }, []);

  useEffect(() => {
    if (!platformDetection.valid || !platformDetection.parsedUrl) {
      setMetadataLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setMetadataLoading(true);
      try {
        const response = await fetch(
          `/api/music-metadata?url=${encodeURIComponent(platformDetection.parsedUrl ?? "")}`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const metadata = (await response.json()) as {
          artistName?: string;
          coverImageUrl?: string;
          title?: string;
        };
        setSongTitle((current) => current || metadata.title?.trim() || "");
        setArtistName((current) => current || metadata.artistName?.trim() || "");
        setCoverImageUrl((current) => current || metadata.coverImageUrl?.trim() || "");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("[First Listen submission] Metadata lookup failed", error);
        }
      } finally {
        setMetadataLoading(false);
      }
    }, 500);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [platformDetection.parsedUrl, platformDetection.valid]);

  useEffect(() => {
    console.info("[First Listen submission] Validation state", {
      detectedPlatform: platformDetection.platform,
      embedUrl: providerEmbed?.src ?? null,
      parsedUrl: platformDetection.parsedUrl,
      resourceId: platformDetection.resourceId,
      resourceType: platformDetection.resourceType,
      submitDisabled,
      validationFailures,
    });
  }, [
    platformDetection.parsedUrl,
    platformDetection.platform,
    platformDetection.resourceId,
    platformDetection.resourceType,
    providerEmbed?.src,
    submitDisabled,
    validationFailures,
  ]);

  const submitSong = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (validationFailures.length > 0 || !platformDetection.platform || !songLanguage || !genre) {
      console.warn("[First Listen submission] Submission blocked", {
        validationFailures,
      });
      notify(
        locale === "es"
          ? "Corrige los campos marcados antes de enviar."
          : "Fix the listed validation issues before submitting.",
      );
      return;
    }
    const submission: SongSubmission = {
      title: songTitle.trim(),
      artistName: artistName.trim(),
      coverImageUrl:
        coverImageUrl.trim() || "https://www.firstlisten.net/covers/default-song.svg",
      musicUrl: musicLink,
      platform: platformDetection.platform,
      genre,
      language: songLanguage,
      feedbackFocus,
      country,
      explicitContent,
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
              <strong>{locale === "es" ? "Necesitas 1 credito para enviar" : "One credit is required to submit"}</strong>
              <p>{locale === "es" ? "Completa hitos de reviews para ganar creditos." : "Complete review milestones to earn credits."}</p>
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

        <form noValidate onSubmit={submitSong}>
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
                onChange={(event) => setSongTitle(event.target.value)}
                placeholder={locale === "es" ? "ej. Neon Weather" : "e.g. Neon Weather"}
                required
                value={songTitle}
              />
            </div>
            <div className="field">
              <label htmlFor="artist-name">{copy.app.submit.artistName}</label>
              <input
                disabled={!unlocked}
                id="artist-name"
                name="artistName"
                onChange={(event) => setArtistName(event.target.value)}
                placeholder={locale === "es" ? "Tu nombre artistico" : "Your artist name"}
                required
                value={artistName}
              />
            </div>
            <div className="field">
              <label htmlFor="genre">{copy.app.submit.genre}</label>
              <select
                disabled={!unlocked}
                id="genre"
                name="genre"
                onChange={(event) => setGenre(event.target.value as Genre)}
                required
                value={genre}
              >
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
              <select
                disabled={!unlocked}
                id="country"
                name="country"
                onChange={(event) => setCountry(event.target.value)}
                required
                value={country}
              >
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
              <label htmlFor="cover-url">
                {copy.app.submit.cover} ({locale === "es" ? "opcional" : "optional"})
              </label>
              <input
                disabled={!unlocked}
                id="cover-url"
                name="coverImageUrl"
                onChange={(event) => setCoverImageUrl(event.target.value)}
                placeholder="https://..."
                type="url"
                value={coverImageUrl}
              />
              <small>
                {metadataLoading
                  ? locale === "es"
                    ? "Buscando portada y metadatos..."
                    : "Looking up cover art and metadata..."
                  : locale === "es"
                    ? "Se completa automaticamente cuando el proveedor lo permite."
                    : "Filled automatically when the provider exposes it."}
              </small>
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

          <fieldset className="explicit-field" disabled={!unlocked}>
            <legend>Explicit Content</legend>
            <label>
              <input
                checked={!explicitContent}
                name="explicitContent"
                onChange={() => setExplicitContent(false)}
                type="radio"
                value="no"
              />
              No
            </label>
            <label>
              <input
                checked={explicitContent}
                name="explicitContent"
                onChange={() => setExplicitContent(true)}
                type="radio"
                value="yes"
              />
              Yes
            </label>
          </fieldset>

          <div className="platform-picker">
            <label>{copy.app.submit.detectedPlatform}</label>
            <div>
              {(["Spotify", "YouTube", "YouTube Music", "SoundCloud", "Apple Music"] as Platform[]).map((item) => (
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

          {validationFailures.length > 0 && (
            <div className="submission-validation" role="alert">
              <strong>
                {locale === "es" ? "Antes de enviar:" : "Before you can submit:"}
              </strong>
              <ul>
                {validationFailures.map((failure) => <li key={failure}>{failure}</li>)}
              </ul>
            </div>
          )}

          {debugEnabled && (
            <dl className="submission-debug" data-testid="submission-debug">
              <div><dt>Detected platform</dt><dd>{platformDetection.platform ?? "none"}</dd></div>
              <div><dt>Parsed URL</dt><dd>{platformDetection.parsedUrl ?? "invalid"}</dd></div>
              <div><dt>Resource</dt><dd>{platformDetection.resourceType ?? "none"} / {platformDetection.resourceId ?? "none"}</dd></div>
              <div><dt>Embed URL</dt><dd>{providerEmbed?.src ?? "unavailable"}</dd></div>
              <div><dt>Validation</dt><dd>{validationFailures.length === 0 ? "valid" : "invalid"}</dd></div>
              <div><dt>Submit</dt><dd>{submitDisabled ? `disabled: ${validationFailures.join(" | ") || "saving"}` : "enabled"}</dd></div>
            </dl>
          )}

          <button
            className="primary-button wide"
            disabled={submitDisabled}
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
        <ReviewProgress count={reviewCount} copy={copy} founderFree={founderFree} unlimited={unlimitedCredits} />
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
  account: AccountSummary;
  initialView?: View;
  locale: InterfaceLocale;
  onLocaleChange: (locale: InterfaceLocale) => void;
  listenerLanguages: ListenerLanguage[];
  genrePreferences: Genre[];
  initialFounder: boolean;
  initialFounderFree: boolean;
  initialReviewCredits: number;
  initialTotalCreditsEarned: number;
  initialReviewQualityScore: number;
  role: "super_admin" | "admin" | "moderator" | "user";
  initialUserSong: Song | null;
  initialSongSummaries: SongDashboardSummary[];
  initialSongReviews: Review[];
};

export function FirstListenApp({
  onLogout,
  account,
  initialView = "review",
  locale,
  onLocaleChange,
  listenerLanguages,
  genrePreferences,
  initialFounder,
  initialFounderFree,
  initialReviewCredits,
  initialTotalCreditsEarned,
  initialReviewQualityScore,
  role,
  initialUserSong,
  initialSongSummaries,
  initialSongReviews,
}: FirstListenAppProps) {
  const router = useRouter();
  const copy = getCopy(locale);
  const [view, setView] = useState<View>(initialView);
  const [reviewCount, setReviewCount] = useState(initialReviewCredits);
  const [totalCreditsEarned, setTotalCreditsEarned] = useState(initialTotalCreditsEarned);
  const [reviewQualityScores, setReviewQualityScores] = useState<number[]>([
    initialReviewQualityScore,
  ]);
  const [priorComments, setPriorComments] = useState<string[]>([]);
  const founder = initialFounder;
  const founderFree = initialFounderFree;
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [languages] = useState<ListenerLanguage[]>(listenerLanguages);
  const [genres] = useState<Genre[]>(genrePreferences);
  const [queueSongs, setQueueSongs] = useState<Song[]>([]);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  useEffect(() => {
    document.documentElement.lang = locale;
    setToast("");
  }, [locale]);

  useEffect(() => {
    const storedComments = window.localStorage.getItem("first-listen-prior-comments");
    if (storedComments) setPriorComments(JSON.parse(storedComments));
    setDarkMode(window.localStorage.getItem("first-listen-theme") === "dark");
  }, []);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;

    let active = true;
    supabase.rpc("get_smart_review_queue", { queue_limit: 20 }).then(({ data, error }) => {
      if (!active || error || !data) return;
      setQueueSongs(mapQueueRows(data));
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

    if (!supabase || !isDatabaseSong) {
      return {
        accepted: false,
        qualityScore: 0,
        warning: "Review service is unavailable. Please refresh and try again.",
      };
    }

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
    const { data: currentProfile } = await supabase
      .from("profiles")
      .select("credits, total_review_credits_earned")
      .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "")
      .maybeSingle();
    if (currentProfile) {
      setReviewCount(Number(currentProfile.credits));
      setTotalCreditsEarned(Number(currentProfile.total_review_credits_earned));
    }

    setReviewQualityScores((current) => {
      return [...current, qualityScore];
    });
    setPriorComments((current) => {
      const next = [...current, form.comment.trim()].slice(-20);
      window.localStorage.setItem("first-listen-prior-comments", JSON.stringify(next));
      return next;
    });
    const needsRefill = queueSongs.length <= 1;
    setQueueSongs((current) => current.filter((song) => song.id !== songId));
    if (supabase && needsRefill) {
      const { data } = await supabase.rpc("get_smart_review_queue", { queue_limit: 20 });
      if (data) setQueueSongs(mapQueueRows(data));
    }
    return { accepted: true, qualityScore };
  };

  const handleSongSubmitted = async (
    _usedFounderFree: boolean,
    submission: SongSubmission,
  ) => {
    const supabase = createClient();
    if (!supabase) {
      notify("Submission service is unavailable. Please refresh and try again.");
      return false;
    }
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
      song_explicit_content: submission.explicitContent,
    });
    if (error) {
      notify(error.message);
      return false;
    }

    setReviewCount((current) => {
      const next = role === "super_admin" ? current : Math.max(0, current - 1);
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
    setMenuOpen(false);
    if (nextView === view) return;
    const debug =
      new URLSearchParams(window.location.search).get("debug") === "1";
    router.push(`/${nextView}${debug ? "?debug=1" : ""}`);
  };

  const viewContent = (() => {
    if (view === "dashboard") {
      return (
        <DashboardView
          copy={copy}
          founder={founder}
          locale={locale}
          reviewCredits={reviewCount}
          reviewQualityScore={averageReviewQuality}
          setView={changeView}
          song={initialUserSong}
          songSummaries={initialSongSummaries}
          songReviews={initialSongReviews}
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
          unlimitedCredits={role === "super_admin"}
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
        unlimitedCredits={role === "super_admin"}
      />
    );
  })();

  return (
    <div className={darkMode ? "app-shell theme-dark" : "app-shell"}>
      <Sidebar
        account={account}
        copy={copy}
        founder={founder}
        founderFree={founderFree}
        onProfile={() => router.push("/profile")}
        reviewCount={reviewCount}
        setView={changeView}
        unlimitedCredits={role === "super_admin"}
        adminAccess={role === "super_admin" || role === "admin"}
        onAdmin={() => router.push("/admin")}
        view={view}
      />
      <div className="app-main">
        <Topbar
          copy={copy}
          darkMode={darkMode}
          locale={locale}
          onLocaleChange={onLocaleChange}
          onLogout={onLogout}
          onHelp={() => router.push("/help")}
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
            {(role === "super_admin" || role === "admin") && (
              <button onClick={() => router.push("/admin")}>
                <ShieldCheck size={19} />
                Admin Panel
              </button>
            )}
            <button onClick={() => router.push("/help")}>
              <CircleHelp size={19} />
              Help Center
            </button>
            <button onClick={() => router.push("/profile")}>
              <UserRound size={19} />
              {account.displayName}
            </button>
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
              {item.id === "submit" && reviewCount < 1 && !founderFree && role !== "super_admin" && <i />}
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
