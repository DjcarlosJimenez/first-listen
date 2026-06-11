"use client";

import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bell,
  Bookmark,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clapperboard,
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
  LoaderCircle,
  Menu,
  MessageSquareText,
  Moon,
  Music2,
  Plus,
  Pause,
  Play,
  Rocket,
  Send,
  Share2,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Star,
  Sun,
  Target,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  UserPlus,
  Users,
  Radio,
  Trophy,
  X,
  Youtube,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LanguageSelector } from "@/components/language-selector";
import { CommunityPulse } from "@/components/community-pulse";
import { Logo } from "@/components/logo";
import {
  ProviderPlayer,
  type ProviderTelemetrySnapshot,
} from "@/components/provider-player";
import { SongActionBar } from "@/components/song-action-bar";
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
import {
  allPlatforms,
  compactClassificationLabel,
  contentClassificationLabel,
  databasePlatform,
  economySettingFor,
  isExternalPlatform,
  nextEconomyActivation,
  submissionTokenCost,
} from "@/lib/content-economy";
import { safeCoverUrl } from "@/lib/media";
import { describeMatch, prioritizeReviewQueue } from "@/lib/matching";
import { detectMusicPlatform } from "@/lib/platform";
import { getProviderEmbed } from "@/lib/player";
import { evaluateReviewQuality } from "@/lib/review-quality";
import { createClient } from "@/lib/supabase/client";
import type {
  AccountSummary,
  CommunityNotification,
  CommunityNotificationSummary,
  CommunityProgram,
  ContentEconomySetting,
  DailyMissionStatus,
  DiscoverySong,
  FollowedArtist,
  ListeningBankStatus,
  Platform,
  Review,
  Song,
  SongDashboardSummary,
  TodaySupportSummary,
} from "@/lib/types";

export type View = "review" | "dashboard" | "submit";
type BinaryAnswer = boolean | null;
type Copy = ReturnType<typeof getCopy>;

type SubmissionDuplicate = {
  song_id: string;
  existing_title: string;
  existing_music_url: string;
  existing_platform: string;
  catalog_status: string;
  exact_match: boolean;
  similarity_score: number;
  submitted_at: string;
};

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
  listeningSecondsBanked?: number;
  listeningBankSeconds?: number;
  communityPointsAwarded?: number;
  warning?: string;
};

type ListeningSessionUi = {
  sessionId: string | null;
  earningEligible: boolean | null;
  verifiedSeconds: number;
  liveSeconds: number;
  dailySecondsRemaining: number;
  heartbeatIntervalSeconds: number;
  interactionGraceSeconds: number;
  validListenRecorded: boolean;
  completeListenRecorded: boolean;
  validRequirementSeconds: number;
  playbackDurationSeconds: number;
  warning: string;
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
  contentKind:
    | "song"
    | "music_video"
    | "remix"
    | "live_session"
    | "performance"
    | "long_form";
  durationSeconds: number | null;
};

function mapQueueRows(data: Array<Record<string, unknown>>): Song[] {
  return data.map((row) => ({
    id: String(row.song_id),
    artistId: String(row.artist_id),
    title: String(row.title),
    artist: String(row.artist_name),
    coverUrl: safeCoverUrl(String(row.cover_image_url)),
    link: String(row.music_url),
    platform:
      allPlatforms.find(
        (platform) => databasePlatform[platform] === String(row.platform),
      ) ?? "Spotify",
    genre: String(row.genre) as Genre,
    language: String(row.song_language) as SongLanguage,
    feedbackFocus: (row.feedback_focus ?? []) as FeedbackFocus[],
    explicitContent: Boolean(row.explicit_content),
    country: String(row.country),
    submittedAt: String(row.submitted_at),
    accent: "#c8ff4f",
  }));
}

function mapNotificationRows(
  data: Array<Record<string, unknown>>,
): CommunityNotification[] {
  return data.map((row) => ({
    id: String(row.notification_id),
    type: String(row.event_type) as CommunityNotification["type"],
    actorId: row.actor_id ? String(row.actor_id) : undefined,
    actorName: String(row.actor_name ?? "Anonymous Listener"),
    songId: row.song_id ? String(row.song_id) : undefined,
    songTitle: row.song_title ? String(row.song_title) : undefined,
    read: Boolean(row.is_read),
    createdAt: String(row.created_at),
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

function formatPreciseMinutes(seconds: number) {
  const minutes = Math.max(0, seconds) / 60;
  if (minutes === 0) return "0 min";
  if (minutes < 10) return `${minutes.toFixed(1)} min`;
  return `${Math.floor(minutes)} min`;
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatClock(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatMinutesSeconds(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safeSeconds / 60)}m ${safeSeconds % 60}s`;
}

function secondsToNextReward(bankSeconds: number, exchangeSeconds: number) {
  const remainder = bankSeconds % exchangeSeconds;
  if (remainder === 0 && bankSeconds >= exchangeSeconds) return 0;
  return exchangeSeconds - remainder;
}

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
  if (!rawLink.trim()) return "Pega un enlace público de una canción.";
  if (valid && platform) return `${platform} detectado.`;
  if (platform === "Spotify") return "Usa un enlace directo de Spotify track.";
  if (platform === "YouTube") return "Usa un enlace directo de YouTube.";
  if (platform === "YouTube Music") return "Usa un enlace watch de YouTube Music.";
  if (platform === "SoundCloud") return "Usa un enlace público de SoundCloud.";
  if (platform === "TikTok") return "Usa un enlace público directo de TikTok.";
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
  if (platform === "TikTok") {
    return <Clapperboard size={size} />;
  }
  return <Music2 size={size} />;
}

function ProviderClassificationBadge({
  platform,
  compact = false,
}: {
  platform: Platform;
  compact?: boolean;
}) {
  const external = isExternalPlatform(platform);
  return (
    <span
      className={
        external
          ? "content-classification external"
          : "content-classification internal"
      }
    >
      {external ? <Link2 size={12} /> : <Music2 size={12} />}
      {compact
        ? compactClassificationLabel(platform)
        : contentClassificationLabel(platform)}
    </span>
  );
}

function EconomyNotice({
  settings,
  locale,
}: {
  settings: ContentEconomySetting[];
  locale: InterfaceLocale;
}) {
  const [now, setNow] = useState(() => Date.now());
  const nextActivation = nextEconomyActivation(settings, now);
  const externalSettings = settings.filter(
    (setting) => setting.classification === "external",
  );
  const effectiveCosts = Array.from(
    new Set(
      externalSettings.map((setting) =>
        submissionTokenCost(settings, setting.platform, now),
      ),
    ),
  ).sort((left, right) => left - right);
  const betaActive = externalSettings.some(
    (setting) =>
      submissionTokenCost(settings, setting.platform, now) ===
      setting.currentTokenCost,
  );
  const effectiveCostLabel =
    effectiveCosts.length > 1
      ? `${effectiveCosts[0]}-${effectiveCosts.at(-1)}`
      : `${effectiveCosts[0] ?? 1}`;

  useEffect(() => {
    if (!settings.some((setting) => setting.activationAt)) return;
    const interval = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(interval);
  }, [settings]);

  const daysRemaining = nextActivation?.activationAt
    ? Math.max(
        0,
        Math.ceil(
          (new Date(nextActivation.activationAt).getTime() - now) / 86400000,
        ),
      )
    : null;
  const spanish = locale === "es";

  return (
    <section className="economy-notice" aria-label="Founder Beta pricing">
      <span>
        <ShieldCheck size={15} />
        <strong>
          {betaActive
            ? spanish
              ? "Periodo Founder Beta"
              : "Founder Beta Period"
            : spanish
              ? "Economia de Contenido Activa"
              : "Content Economy Active"}
        </strong>
      </span>
      <p>
        {spanish
          ? `El contenido externo cuesta actualmente ${effectiveCostLabel} ${effectiveCostLabel === "1" ? "token" : "tokens"}. La actividad en plataformas externas no cuenta como escucha válida.`
          : `External Content currently costs ${effectiveCostLabel} ${effectiveCostLabel === "1" ? "token" : "tokens"}. Activity on external platforms does not count as a valid listen.`}
      </p>
      <span className="economy-countdown">
        {daysRemaining === null
          ? betaActive
            ? spanish
              ? "Fecha de actualizacion pendiente"
              : "Economy update date not scheduled"
            : spanish
              ? "Precios programados activos"
              : "Scheduled pricing active"
          : spanish
            ? `${daysRemaining} dias restantes`
            : `${daysRemaining} days remaining`}
      </span>
    </section>
  );
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
          Submission tokens
        </span>
        <strong>
          {unlimited ? "∞" : count}<span>{unlimited ? "" : " available"}</span>
        </strong>
      </div>
      <div className="progress-track" aria-label={`${unlimited ? "Unlimited" : count} submission tokens`}>
        <i style={{ width: `${unlimited ? 100 : Math.min(count, 10) * 10}%` }} />
      </div>
      <p>
        {founderFree
          ? copy.app.review.founderReady
          : unlimited
            ? "Super Admin accounts can submit without spending tokens."
            : count >= 1
              ? "One token submits one validated song."
              : "Bank verified listening minutes and claim tokens manually."}
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
  ownerAccess,
  onAdmin,
  onOwner,
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
  ownerAccess: boolean;
  onAdmin: () => void;
  onOwner: () => void;
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
        {ownerAccess && (
          <button onClick={onOwner}>
            <Gauge size={19} />
            <span>Owner Control Center</span>
          </button>
        )}
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
  locale,
  onContinueListening,
  onNextSong,
  validListenRecorded,
  todaySupport,
  listeningBank,
}: {
  song: Song;
  notify: (message: string) => void;
  locale: InterfaceLocale;
  onContinueListening: () => void;
  onNextSong: () => void;
  validListenRecorded: boolean;
  todaySupport: TodaySupportSummary;
  listeningBank: ListeningBankStatus;
}) {
  const links = getDiscoveryLinks(song);
  const [following, setFollowing] = useState(false);
  const [saved, setSaved] = useState(false);
  const spanish = locale === "es";
  const exchangeSeconds = Math.max(60, listeningBank.minutesPerCredit * 60);
  const tokenProgressSeconds = listeningBank.bankSeconds % exchangeSeconds;
  const tokenProgress = Math.min(
    100,
    (tokenProgressSeconds / exchangeSeconds) * 100,
  );

  const followArtist = async () => {
    const supabase = createClient();
    if (!supabase || !song.artistId) {
      notify(
        spanish
          ? "Inicia sesión de nuevo para seguir a este artista."
          : "Log in again to follow this artist.",
      );
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
    notify(
        spanish
        ? `Ahora sigues a ${song.artist}.`
        : `You are now following ${song.artist}.`,
    );
  };

  const saveForLater = async () => {
    const supabase = createClient();
    if (!supabase) {
      notify(
        spanish
          ? "Inicia sesión de nuevo para guardar esta canción."
          : "Log in again to save this song.",
      );
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
    notify(
        spanish
        ? `${song.title} se guardó para después.`
        : `${song.title} was saved for later.`,
    );
  };

  return (
    <div className="discovery-card">
      <span className="eyebrow">
        <Sparkles size={13} /> {spanish ? "Review completada" : "Review complete"}
      </span>
      <h3>{spanish ? "Sigue escuchando" : "Keep listening"}</h3>
      <p>
        {spanish
          ? "Tu review fue enviada. Puedes terminar la canción o avanzar cuando estés listo."
          : "Your review was submitted. Finish the song or move on when you are ready."}
      </p>
      <div className="post-review-choice">
        <button onClick={onContinueListening} type="button">
          <Play size={14} /> {spanish ? "Continuar escuchando" : "Continue Listening"}
        </button>
        <button className="primary-button" onClick={onNextSong} type="button">
          <ArrowRight size={14} /> {spanish ? "Siguiente canción" : "Next Song"}
        </button>
      </div>
      {validListenRecorded && (
        <strong className="valid-listen-confirmation">
          <CheckCircle2 size={15} />
          {spanish ? "Escucha válida registrada" : "Valid Listen Recorded"}
        </strong>
      )}
      <section className="post-review-impact" aria-label="Your impact today">
        <div className="post-review-impact-heading">
          <span>
            <Headphones size={15} />
            {spanish ? "Tu impacto hoy" : "Your Impact Today"}
          </span>
          <strong>{todaySupport.communityRank}</strong>
        </div>
        <div className="post-review-impact-stats">
          <div>
            <strong>{todaySupport.songsSupported}</strong>
            <span>{spanish ? "Canciones apoyadas" : "Songs Supported"}</span>
          </div>
          <div>
            <strong>{formatMinutesSeconds(todaySupport.listeningSeconds)}</strong>
            <span>{spanish ? "Minutos escuchados" : "Minutes Listened"}</span>
          </div>
          <div>
            <strong>{todaySupport.creatorsSupported}</strong>
            <span>{spanish ? "Artistas apoyados" : "Artists Supported"}</span>
          </div>
        </div>
        <div className="next-token-progress">
          <span>
            <Target size={14} />
            {spanish ? "Siguiente token" : "Next Token"}
          </span>
          <strong>
            {Math.floor(tokenProgressSeconds / 60)}m /{" "}
            {listeningBank.minutesPerCredit}m
          </strong>
          <div className="progress-track">
            <i style={{ width: `${tokenProgress}%` }} />
          </div>
          <small>
            {Math.ceil(listeningBank.secondsToNextCredit / 60)}m{" "}
            {spanish ? "restantes" : "remaining"}
          </small>
        </div>
      </section>
      <div className="discovery-links">
        <a href={links.spotify} rel="noreferrer" target="_blank">
          <Disc3 size={15} />{" "}
          {spanish ? "Escuchar completa en Spotify" : "Listen Full Song on Spotify"}
        </a>
        <a href={links.youtube} rel="noreferrer" target="_blank">
          <Youtube size={15} />{" "}
          {spanish ? "Escuchar completa en YouTube" : "Listen Full Song on YouTube"}
        </a>
        <a href={links.apple} rel="noreferrer" target="_blank">
          <Radio size={15} />{" "}
          {spanish ? "Escuchar completa en Apple Music" : "Listen Full Song on Apple Music"}
        </a>
      </div>
      <div className="discovery-actions">
        <button disabled={following || !song.artistId} onClick={followArtist} type="button">
          <UserPlus size={14} />{" "}
          {following
            ? spanish
              ? "Siguiendo"
              : "Following"
            : spanish
              ? "Seguir artista"
              : "Follow Artist"}
        </button>
        <button disabled={saved} onClick={saveForLater} type="button">
          <Bookmark size={14} />{" "}
          {saved
            ? spanish
              ? "Guardada"
              : "Saved"
            : spanish
              ? "Guardar para después"
              : "Save For Later"}
        </button>
      </div>
      {song.artistId && (
        <Link href={`/artists/${song.artistId}`}>
          {spanish ? `Ver perfil de ${song.artist}` : `View ${song.artist}'s profile`}{" "}
          <ArrowRight size={13} />
        </Link>
      )}
    </div>
  );
}

function notificationText(
  notification: CommunityNotification,
  locale: InterfaceLocale,
) {
  const spanish = locale === "es";
  if (notification.type === "follow") {
    return spanish
      ? `${notification.actorName} ahora te sigue`
      : `${notification.actorName} followed you`;
  }
  if (notification.type === "review") {
    return spanish
      ? `Nueva review recibida para ${notification.songTitle ?? "tu canción"}`
      : `New review received for ${notification.songTitle ?? "your song"}`;
  }
  if (notification.type === "complete_listen") {
    return spanish
      ? `${notification.actorName} completó ${notification.songTitle ?? "tu canción"}`
      : `${notification.actorName} completed ${notification.songTitle ?? "your song"}`;
  }
  return spanish
    ? `${notification.actorName} apoyó ${notification.songTitle ?? "tu canción"}`
    : `${notification.actorName} supported ${notification.songTitle ?? "your song"}`;
}

function FloatingCommunityNotifications({
  notifications,
  locale,
  onFollow,
}: {
  notifications: CommunityNotification[];
  locale: InterfaceLocale;
  onFollow: (artistId: string) => void;
}) {
  if (!notifications.length) return null;
  return (
    <aside className="community-live-stack" aria-live="polite">
      {notifications.slice(0, 3).map((notification) => (
        <article key={notification.id}>
          <span className="community-live-icon">
            {notification.type === "follow" ? (
              <UserPlus size={16} />
            ) : notification.type === "review" ? (
              <Star size={16} />
            ) : (
              <Headphones size={16} />
            )}
          </span>
          <div>
            <small>{locale === "es" ? "Actividad en vivo" : "Live activity"}</small>
            <strong>{notificationText(notification, locale)}</strong>
            {notification.actorId && (
              <span>
                <Link href={`/artists/${notification.actorId}`}>
                  {locale === "es" ? "Ver perfil" : "View profile"}
                </Link>
                <button
                  onClick={() => onFollow(notification.actorId as string)}
                  type="button"
                >
                  {locale === "es" ? "Seguir" : "Follow"}
                </button>
              </span>
            )}
          </div>
        </article>
      ))}
    </aside>
  );
}

function OfflineCommunitySummary({
  summary,
  notifications,
  locale,
  onDismiss,
  onViewActivity,
}: {
  summary: CommunityNotificationSummary;
  notifications: CommunityNotification[];
  locale: InterfaceLocale;
  onDismiss: () => void;
  onViewActivity: () => void;
}) {
  if (summary.unreadCount < 1) return null;
  const spanish = locale === "es";
  return (
    <section className="offline-community-summary">
      <div className="offline-community-heading">
        <span>
          <Bell size={17} />
          <strong>{spanish ? "Mientras no estabas" : "While You Were Away"}</strong>
        </span>
        <button aria-label="Dismiss activity summary" onClick={onDismiss}>
          <X size={16} />
        </button>
      </div>
      <div className="offline-community-counts">
        <span>
          <strong>{summary.supportersCount}</strong>{" "}
          {spanish
            ? summary.supportersCount === 1
              ? "persona apoyó tu contenido"
              : "personas apoyaron tu contenido"
            : summary.supportersCount === 1
              ? "person supported your content"
              : "people supported your content"}
        </span>
        <span>
          <strong>{summary.followersCount}</strong>{" "}
          {spanish
            ? summary.followersCount === 1
              ? "seguidor nuevo"
              : "seguidores nuevos"
            : summary.followersCount === 1
              ? "new follower"
              : "new followers"}
        </span>
        <span>
          <strong>{summary.reviewsCount}</strong>{" "}
          {spanish
            ? summary.reviewsCount === 1
              ? "review nueva"
              : "reviews nuevas"
            : summary.reviewsCount === 1
              ? "new review"
              : "new reviews"}
        </span>
        <span>
          <strong>{summary.validListensCount}</strong>{" "}
          {spanish
            ? summary.validListensCount === 1
              ? "escucha válida"
              : "escuchas válidas"
            : summary.validListensCount === 1
              ? "valid listen"
              : "valid listens"}
        </span>
      </div>
      <div className="offline-community-details">
        {summary.mostSupportedSongTitle && (
          <div>
            <small>{spanish ? "Canción más apoyada" : "Most Supported Song"}</small>
            <strong>{summary.mostSupportedSongTitle}</strong>
            <span>
              {summary.mostSupportedSongValidListens}{" "}
              {spanish
                ? summary.mostSupportedSongValidListens === 1
                  ? "escucha"
                  : "escuchas"
                : summary.mostSupportedSongValidListens === 1
                  ? "listen"
                  : "listens"}
            </span>
          </div>
        )}
        {summary.topSupporterName && (
          <div>
            <small>{spanish ? "Mayor colaborador" : "Top Supporter"}</small>
            <strong>{summary.topSupporterName}</strong>
            <span>{spanish ? "Colaborador público" : "Public supporter"}</span>
          </div>
        )}
      </div>
      <div className="offline-community-events">
        {notifications.filter((item) => !item.read).slice(0, 3).map((item) => (
          <span key={item.id}>{notificationText(item, locale)}</span>
        ))}
      </div>
      <button className="offline-community-action" onClick={onViewActivity}>
        {spanish ? "Ver actividad" : "View Activity"} <ArrowRight size={14} />
      </button>
    </section>
  );
}

function EmptyQueueRetention({
  spotlightSongs,
  topTenSongs,
  followedArtists,
  previouslySupportedSongs,
  todaySupport,
  locale,
  onSubmit,
}: {
  spotlightSongs: DiscoverySong[];
  topTenSongs: DiscoverySong[];
  followedArtists: FollowedArtist[];
  previouslySupportedSongs: DiscoverySong[];
  todaySupport: TodaySupportSummary;
  locale: InterfaceLocale;
  onSubmit: () => void;
}) {
  const spanish = locale === "es";
  const featuredArtists = Array.from(
    new Map(
      [...spotlightSongs, ...topTenSongs].map((song) => [
        song.artistId,
        { id: song.artistId, name: song.artist, genre: song.genre },
      ]),
    ).values(),
  ).slice(0, 6);

  return (
    <main className="content queue-retention">
      <section className="review-complete-card queue-retention-hero">
        <div className="success-orbit"><CheckCircle2 size={34} /></div>
        <span className="eyebrow">
          {spanish ? "Apoyo completado" : "Community support complete"}
        </span>
        <h2>{spanish ? "Estás al día" : "You’re All Caught Up"}</h2>
        <p>
          {spanish
            ? "Has apoyado a cada creador disponible actualmente en tu cola."
            : "You have supported every available creator currently in the queue."}
        </p>
        <button className="primary-button" onClick={onSubmit}>
          {spanish ? "Enviar una canción" : "Submit a Song"} <ArrowRight size={17} />
        </button>
      </section>

      <section className="queue-retention-stats" aria-label={spanish ? "Estadísticas de hoy" : "Today’s support"}>
        <div><strong>{todaySupport.songsReviewed}</strong><span>{spanish ? "Canciones revisadas hoy" : "Songs Reviewed Today"}</span></div>
        <div><strong>{todaySupport.creatorsSupported}</strong><span>{spanish ? "Creadores apoyados" : "Creators Supported"}</span></div>
        <div><strong>{formatDuration(todaySupport.listeningSeconds)}</strong><span>{spanish ? "Tiempo de escucha ganado" : "Listening Time Earned"}</span></div>
        <div><strong>{todaySupport.communityRank}</strong><span>{spanish ? "Rango comunitario" : "Current Community Rank"}</span></div>
      </section>

      <section className="queue-retention-support panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow"><Headphones size={13} /> {spanish ? "Apoyo de hoy" : "Today’s Support"}</span>
            <h3>{spanish ? "Escucha justa y verificable" : "Fair, verifiable listening"}</h3>
          </div>
        </div>
        <div className="queue-retention-stats compact">
          <div><strong>{todaySupport.validListens}</strong><span>{spanish ? "Escuchas válidas" : "Valid Listens"}</span></div>
          <div><strong>{todaySupport.completeListens}</strong><span>{spanish ? "Escuchas completas" : "Complete Listens"}</span></div>
          <div><strong>{Math.round(todaySupport.averageCompletionRate)}%</strong><span>{spanish ? "Finalización promedio" : "Average Completion Rate"}</span></div>
        </div>
      </section>

      <section className="queue-retention-grid">
        <div className="panel queue-retention-panel">
          <div className="panel-heading">
            <div><span className="eyebrow"><Sparkles size={13} /> {spanish ? "Artistas destacados" : "Featured Artists"}</span><h3>{spanish ? "Descubre creadores activos" : "Discover active creators"}</h3></div>
          </div>
          <div className="retention-link-list">
            {featuredArtists.map((artist) => (
              <Link href={`/artists/${artist.id}`} key={artist.id}>
                <span className="retention-avatar">{artist.name.slice(0, 2).toUpperCase()}</span>
                <span><strong>{artist.name}</strong><small>{optionLabel(locale, artist.genre)}</small></span>
                <ArrowRight size={14} />
              </Link>
            ))}
            {!featuredArtists.length && <p className="discovery-empty">{spanish ? "Los artistas destacados aparecerán aquí." : "Featured artists will appear here."}</p>}
          </div>
        </div>

        <div className="panel queue-retention-panel">
          <div className="panel-heading">
            <div><span className="eyebrow"><Users size={13} /> {spanish ? "Artistas que sigues" : "Artists You Follow"}</span><h3>{spanish ? "Vuelve a sus perfiles" : "Reconnect with their music"}</h3></div>
          </div>
          <div className="retention-link-list">
            {followedArtists.map((artist) => (
              <Link href={`/artists/${artist.id}`} key={artist.id}>
                <span className="retention-avatar">{artist.name.slice(0, 2).toUpperCase()}</span>
                <span><strong>{artist.name}</strong><small>{artist.followers} {spanish ? "seguidores" : "followers"} / {artist.communityRank}</small></span>
                <ArrowRight size={14} />
              </Link>
            ))}
            {!followedArtists.length && <p className="discovery-empty">{spanish ? "Sigue artistas para encontrarlos aquí." : "Follow artists to find them here."}</p>}
          </div>
        </div>
      </section>

      <section className="panel queue-retention-panel">
        <div className="panel-heading">
          <div><span className="eyebrow"><Trophy size={13} /> {spanish ? "Canciones principales" : "Top Songs"}</span><h3>{spanish ? "Ganado por resultados" : "Earned by listener response"}</h3></div>
        </div>
        <div className="retention-song-grid">
          {topTenSongs.slice(0, 4).map((song) => (
            <a href={song.link} key={song.id} rel="noreferrer" target="_blank">
              <Image alt="" height={64} src={song.coverUrl} unoptimized width={64} />
              <span><strong>{song.title}</strong><small>{song.artist} / Hook {song.hookScore}</small></span>
              <ExternalLink size={14} />
            </a>
          ))}
          {!topTenSongs.length && <p className="discovery-empty">{spanish ? "El ranking aparecerá cuando haya suficientes reviews." : "Rankings will appear after enough verified reviews."}</p>}
        </div>
      </section>

      <section className="panel queue-retention-panel">
        <div className="panel-heading">
          <div><span className="eyebrow"><ListMusic size={13} /> {spanish ? "Canciones apoyadas antes" : "Previously Supported Songs"}</span><h3>{spanish ? "Escucha otra vez sin ganar recompensas duplicadas" : "Listen again without duplicate rewards"}</h3></div>
        </div>
        <div className="retention-song-grid">
          {previouslySupportedSongs.map((song) => (
            <a href={song.link} key={song.id} rel="noreferrer" target="_blank">
              <Image alt="" height={64} src={song.coverUrl} unoptimized width={64} />
              <span><strong>{song.title}</strong><small>{song.artist} / {song.platform}</small></span>
              <ExternalLink size={14} />
            </a>
          ))}
          {!previouslySupportedSongs.length && <p className="discovery-empty">{spanish ? "Tus canciones apoyadas aparecerán aquí." : "Songs you support will appear here."}</p>}
        </div>
      </section>
    </main>
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
  approvedListeningSeconds,
  onListeningCredited,
  onAdvanceSong,
  queueLoading,
  spotlightSongs,
  topTenSongs,
  followedArtists,
  previouslySupportedSongs,
  todaySupport,
  listeningBank,
  autoPlayNextSong,
  onAutoPlayChange,
  externalRedirectNoticeDisabled,
  onExternalRedirectPreferenceChange,
}: {
  reviewCount: number;
  onReviewed: (
    songId: string,
    form: ReviewForm,
    pastedWithoutEditing: boolean,
    clientQualityScore: number,
    listeningSessionId: string | null,
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
  approvedListeningSeconds: number;
  onListeningCredited: (
    seconds: number,
    becameValid: boolean,
    becameComplete: boolean,
    completionRate: number,
  ) => void;
  onAdvanceSong: (songId: string) => Promise<void>;
  queueLoading: boolean;
  spotlightSongs: DiscoverySong[];
  topTenSongs: DiscoverySong[];
  followedArtists: FollowedArtist[];
  previouslySupportedSongs: DiscoverySong[];
  todaySupport: TodaySupportSummary;
  listeningBank: ListeningBankStatus;
  autoPlayNextSong: boolean;
  onAutoPlayChange: (enabled: boolean) => void;
  externalRedirectNoticeDisabled: boolean;
  onExternalRedirectPreferenceChange: (disabled: boolean) => void;
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
  const externalContent = song ? isExternalPlatform(song.platform) : false;
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
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [autoAdvanceCountdown, setAutoAdvanceCountdown] =
    useState<number | null>(null);
  const [autoPlayCurrentSong, setAutoPlayCurrentSong] = useState(false);
  const [listeningSession, setListeningSession] =
    useState<ListeningSessionUi>({
      sessionId: null,
      earningEligible: null,
      verifiedSeconds: 0,
      liveSeconds: 0,
      dailySecondsRemaining: 180 * 60,
      heartbeatIntervalSeconds: 15,
      interactionGraceSeconds: 300,
      validListenRecorded: false,
      completeListenRecorded: false,
      validRequirementSeconds: 30,
      playbackDurationSeconds: 0,
      warning: "",
    });
  const listeningSessionRef = useRef<string | null>(null);
  const startingSessionRef = useRef(false);
  const heartbeatInFlightRef = useRef(false);
  const lastHeartbeatAtRef = useRef(0);
  const heartbeatIntervalRef = useRef(15);
  const interactionGraceRef = useRef(300);
  const latestTelemetryRef = useRef<ProviderTelemetrySnapshot | null>(null);
  const lastLiveSampleRef = useRef<{ at: number; position: number } | null>(
    null,
  );
  const currentLiveSecondsRef = useRef(0);
  const autoAdvanceStartedRef = useRef(false);
  const validListenRef = useRef(false);
  const completeListenRef = useRef(false);

  useEffect(() => {
    setForm(emptyReview);
    setPastedWithoutEditing(false);
    setReviewSubmitted(false);
    setLastReviewedSong(null);
    listeningSessionRef.current = null;
    startingSessionRef.current = false;
    heartbeatInFlightRef.current = false;
    lastHeartbeatAtRef.current = 0;
    heartbeatIntervalRef.current = 15;
    interactionGraceRef.current = 300;
    latestTelemetryRef.current = null;
    validListenRef.current = false;
    completeListenRef.current = false;
    lastLiveSampleRef.current = null;
    currentLiveSecondsRef.current = 0;
    autoAdvanceStartedRef.current = false;
    setAutoAdvanceCountdown(null);
    setListeningSession({
      sessionId: null,
      earningEligible: null,
      verifiedSeconds: 0,
      liveSeconds: 0,
      dailySecondsRemaining: 180 * 60,
      heartbeatIntervalSeconds: 15,
      interactionGraceSeconds: 300,
      validListenRecorded: false,
      completeListenRecorded: false,
      validRequirementSeconds: 30,
      playbackDurationSeconds: 0,
      warning: "",
    });
  }, [song?.id]);

  const handleListeningTelemetry = useCallback(
    async (snapshot: ProviderTelemetrySnapshot, force = false) => {
      latestTelemetryRef.current = snapshot;
      if (!song) return;
      const sampleAt = Date.now();
      const liveEligible =
        snapshot.supported &&
        snapshot.pageVisible &&
        snapshot.pageFocused &&
        snapshot.muted === false &&
        (snapshot.volume ?? 0) > 0;
      const previousLiveSample = lastLiveSampleRef.current;
      if (
        liveEligible &&
        (snapshot.playbackState === "playing" ||
          snapshot.playbackState === "ended") &&
        previousLiveSample &&
        snapshot.currentTime >= previousLiveSample.position
      ) {
        const wallDelta = Math.max(
          0,
          (sampleAt - previousLiveSample.at) / 1000,
        );
        const positionDelta = Math.max(
          0,
          snapshot.currentTime - previousLiveSample.position,
        );
        const liveDelta = Math.min(positionDelta, wallDelta + 1);
        if (liveDelta > 0 && liveDelta <= 5) {
          currentLiveSecondsRef.current += liveDelta;
          setListeningSession((current) => ({
            ...current,
            liveSeconds: currentLiveSecondsRef.current,
          }));
        }
      }
      lastLiveSampleRef.current =
        liveEligible && snapshot.playbackState === "playing"
          ? { at: sampleAt, position: snapshot.currentTime }
          : null;

      const playbackEnded = snapshot.playbackState === "ended";
      if (
        snapshot.playbackState === "playing" &&
        autoAdvanceStartedRef.current
      ) {
        autoAdvanceStartedRef.current = false;
        setAutoAdvanceCountdown(null);
      }
      if (
        playbackEnded &&
        autoPlayNextSong &&
        !autoAdvanceStartedRef.current
      ) {
        autoAdvanceStartedRef.current = true;
        setAutoAdvanceCountdown(3);
      }
      const calculatedRequirement =
        snapshot.duration > 0
          ? Math.min(120, Math.max(30, Math.ceil(snapshot.duration * 0.25)))
          : 30;
      setListeningSession((current) => ({
        ...current,
        playbackDurationSeconds: Math.max(
          current.playbackDurationSeconds,
          snapshot.duration,
        ),
        validRequirementSeconds:
          snapshot.duration > 0
            ? calculatedRequirement
            : current.validRequirementSeconds,
      }));
      if (!snapshot.supported) {
        setListeningSession((current) => ({
          ...current,
          earningEligible: false,
          warning:
            locale === "es"
              ? "Este proveedor no ofrece suficientes datos para ganar minutos."
              : "This provider does not expose enough playback data for listening rewards.",
        }));
        return;
      }
      if (snapshot.playbackState !== "playing" && !playbackEnded) return;

      const supabase = createClient();
      if (!supabase) return;

      if (playbackEnded && !listeningSessionRef.current) return;
      if (!listeningSessionRef.current && !startingSessionRef.current) {
        startingSessionRef.current = true;
        const { data, error } = await supabase.rpc("start_listening_session", {
          target_song_id: song.id,
        });
        startingSessionRef.current = false;
        const result = Array.isArray(data) ? data[0] : data;
        if (error || !result?.session_id) {
          setListeningSession((current) => ({
            ...current,
            warning: error?.message ?? "Listening session could not start.",
          }));
          return;
        }
        listeningSessionRef.current = result.session_id;
        heartbeatIntervalRef.current = Number(
          result.heartbeat_interval_seconds ?? 15,
        );
        interactionGraceRef.current = Number(
          result.interaction_grace_seconds ?? 300,
        );
        setListeningSession({
          sessionId: result.session_id,
          earningEligible: Boolean(result.earning_eligible),
          verifiedSeconds: 0,
          liveSeconds: currentLiveSecondsRef.current,
          dailySecondsRemaining: Number(result.daily_cap_seconds ?? 10800),
          heartbeatIntervalSeconds: heartbeatIntervalRef.current,
          interactionGraceSeconds: interactionGraceRef.current,
          validListenRecorded: false,
          completeListenRecorded: false,
          validRequirementSeconds: calculatedRequirement,
          playbackDurationSeconds: snapshot.duration,
          warning: result.earning_eligible
            ? ""
            : "This provider cannot verify reward-eligible playback.",
        });
      }

      const sessionId = listeningSessionRef.current;
      if (!sessionId || heartbeatInFlightRef.current) return;
      const now = Date.now();
      const intervalMilliseconds = heartbeatIntervalRef.current * 1000;
      if (
        !force &&
        !playbackEnded &&
        lastHeartbeatAtRef.current &&
        now - lastHeartbeatAtRef.current < intervalMilliseconds
      ) {
        return;
      }

      heartbeatInFlightRef.current = true;
      lastHeartbeatAtRef.current = now;
      const { data, error } = await supabase.rpc(
        "record_listening_heartbeat",
        {
          target_session_id: sessionId,
          playback_position_seconds: snapshot.currentTime,
          playback_duration_seconds: snapshot.duration,
          playback_state: playbackEnded ? "playing" : snapshot.playbackState,
          playback_muted: snapshot.muted,
          playback_volume: snapshot.volume,
          page_visible: snapshot.pageVisible,
          page_focused: snapshot.pageFocused,
          interaction_recent:
            now - snapshot.lastInteractionAt <=
            interactionGraceRef.current * 1000,
        },
      );
      heartbeatInFlightRef.current = false;
      const result = Array.isArray(data) ? data[0] : data;
      if (error || !result) {
        setListeningSession((current) => ({
          ...current,
          warning: error?.message ?? "Listening progress could not be verified.",
        }));
        return;
      }
      const validListenRecorded = Boolean(result.valid_listen_recorded);
      const completeListenRecorded = Boolean(
        result.complete_listen_recorded,
      );
      const becameValid =
        validListenRecorded && !validListenRef.current;
      const becameComplete =
        completeListenRecorded && !completeListenRef.current;
      validListenRef.current = validListenRecorded;
      completeListenRef.current = completeListenRecorded;
      const secondsCounted = Number(result.seconds_counted ?? 0);
      currentLiveSecondsRef.current = Math.max(
        currentLiveSecondsRef.current,
        Number(result.session_verified_seconds ?? 0),
      );
      setListeningSession((current) => ({
        ...current,
        verifiedSeconds: Number(result.session_verified_seconds ?? 0),
        liveSeconds: Math.max(
          current.liveSeconds,
          currentLiveSecondsRef.current,
          Number(result.session_verified_seconds ?? 0),
        ),
        dailySecondsRemaining: Number(result.daily_seconds_remaining ?? 0),
        validListenRecorded,
        completeListenRecorded,
        validRequirementSeconds: Number(
          result.valid_requirement_seconds ?? current.validRequirementSeconds,
        ),
        playbackDurationSeconds: Math.max(
          current.playbackDurationSeconds,
          snapshot.duration,
        ),
        warning: result.warning ?? "",
      }));
      if (secondsCounted > 0 || becameValid || becameComplete) {
        onListeningCredited(
          secondsCounted,
          becameValid,
          becameComplete,
          snapshot.duration > 0
            ? Math.min(100, (snapshot.currentTime / snapshot.duration) * 100)
            : 0,
        );
      }
    },
    [autoPlayNextSong, locale, onListeningCredited, song],
  );

  const flushListeningTelemetry = useCallback(async () => {
    const snapshot = latestTelemetryRef.current;
    if (!snapshot || snapshot.playbackState !== "playing") return;
    for (let attempt = 0; attempt < 10 && heartbeatInFlightRef.current; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    await handleListeningTelemetry(snapshot, true);
  }, [handleListeningTelemetry]);

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
    await flushListeningTelemetry();
    const result = await onReviewed(
      song.id,
      form,
      pastedWithoutEditing,
      reviewQuality.score,
      listeningSessionRef.current,
    );
    setSubmitting(false);
    if (!result.accepted) {
      notify(result.warning || copy.app.review.warning);
      return;
    }
    setLastReviewedSong(song);
    setReviewSubmitted(true);
    notify(
      locale === "es"
        ? `Review enviada. +${result.communityPointsAwarded ?? 5} puntos de comunidad.`
        : `Review submitted. +${result.communityPointsAwarded ?? 5} Community Points.`,
    );
  };

  const advanceToNextSong = useCallback(async (continuePlayback = false) => {
    if (!song) return;
    setAutoAdvanceCountdown(null);
    autoAdvanceStartedRef.current = false;
    await flushListeningTelemetry();
    const sessionId = listeningSessionRef.current;
    if (sessionId) {
      const supabase = createClient();
      if (supabase) {
        const { error } = await supabase.rpc("finish_listening_session", {
          target_session_id: sessionId,
        });
        if (error) {
          notify(error.message);
          return;
        }
      }
    }
    setLastReviewedSong(null);
    setAutoPlayCurrentSong(continuePlayback);
    await onAdvanceSong(song.id);
  }, [flushListeningTelemetry, notify, onAdvanceSong, song]);

  useEffect(() => {
    if (autoAdvanceCountdown === null) return;
    const timeout = window.setTimeout(() => {
      if (autoAdvanceCountdown === 1) {
        setAutoAdvanceCountdown(null);
        void advanceToNextSong(true);
        return;
      }
      setAutoAdvanceCountdown((current) =>
        current === null ? null : current - 1,
      );
    }, 1000);
    return () => window.clearTimeout(timeout);
  }, [advanceToNextSong, autoAdvanceCountdown]);

  useEffect(() => {
    if (autoPlayNextSong) return;
    autoAdvanceStartedRef.current = false;
    setAutoAdvanceCountdown(null);
  }, [autoPlayNextSong]);

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
    if (queueLoading) {
      return (
        <main className="content review-complete-wrap">
          <section className="review-complete-card">
            <div className="success-orbit"><Headphones size={34} /></div>
            <span className="eyebrow">{locale === "es" ? "Preparando cola" : "Preparing queue"}</span>
            <h2>{locale === "es" ? "Buscando la mejor coincidencia..." : "Finding the best match..."}</h2>
            <p>{locale === "es" ? "Estamos comparando idioma, género y equidad de cola." : "We’re matching language, genre, and queue fairness."}</p>
          </section>
        </main>
      );
    }
    return (
      <EmptyQueueRetention
        followedArtists={followedArtists}
        locale={locale}
        onSubmit={() => setView("submit")}
        previouslySupportedSongs={previouslySupportedSongs}
        spotlightSongs={spotlightSongs}
        todaySupport={todaySupport}
        topTenSongs={topTenSongs}
      />
    );
  }

  return (
    <>
    <main className="content review-layout review-layout-content-first">
      <section className="review-card review-primary-flow">
        <div className="song-hero">
          <div className="player-listening-column">
            <div className="cover-wrap">
              <ProviderPlayer
                artist={song.artist}
                autoPlay={autoPlayCurrentSong}
                coverUrl={song.coverUrl}
                link={song.link}
                locale={locale}
                platform={song.platform}
                songLoadedAt={songLoadedAt}
                title={song.title}
                onTelemetry={handleListeningTelemetry}
                skipExternalRedirectWarning={externalRedirectNoticeDisabled}
                onExternalRedirectPreferenceChange={
                  onExternalRedirectPreferenceChange
                }
              />
              {autoAdvanceCountdown !== null && (
                <div className="auto-advance-overlay" role="status">
                  <strong>
                    {locale === "es" ? "Canción terminada" : "Song Finished"}
                  </strong>
                  <span>
                    {locale === "es"
                      ? "La siguiente canción comienza en"
                      : "Starting next song in"}
                  </span>
                  <b>{autoAdvanceCountdown}</b>
                  <button
                    onClick={() => {
                      autoAdvanceStartedRef.current = false;
                      setAutoAdvanceCountdown(null);
                      onAutoPlayChange(false);
                    }}
                    type="button"
                  >
                    <Pause size={14} />
                    {locale === "es" ? "Pausar auto play" : "Pause Auto Play"}
                  </button>
                </div>
              )}
              <span className="listen-badge">
                {externalContent ? <Link2 size={13} /> : <Clock3 size={13} />}
                {externalContent
                  ? locale === "es"
                    ? "Plataforma externa"
                    : "External platform"
                  : locale === "es"
                    ? "Reproductor oficial"
                  : "Provider player"}
              </span>
            </div>
            <SongActionBar
              artist={song.artist}
              artistId={song.artistId}
              compact
              link={song.link}
              locale={locale}
              platform={song.platform}
              songId={song.id}
              title={song.title}
            />
            {externalContent ? (
              <div className="external-content-notice" aria-live="polite">
                <Link2 size={17} />
                <span>
                  <strong>External Content</strong>
                  {locale === "es"
                    ? `Reproducir abrirá ${song.platform}. No se verifican escuchas ni recompensas externas.`
                    : `Playing this content opens ${song.platform}. External listening and rewards are not verified.`}
                </span>
              </div>
            ) : (
            <div className="listen-tracking-panel" aria-live="polite">
              <div>
                <span><Headphones size={13} /> {locale === "es" ? "Tiempo escuchado" : "Listening Time"}</span>
                <strong>{formatClock(listeningSession.liveSeconds)}</strong>
              </div>
              <div>
                <span><Target size={13} /> {locale === "es" ? "Escucha válida" : "Valid Listen Requirement"}</span>
                <strong>
                  {formatClock(listeningSession.validRequirementSeconds)}
                  {listeningSession.validListenRecorded
                    ? locale === "es"
                      ? " Completada"
                      : " Completed"
                    : ""}
                </strong>
              </div>
              <div className="listen-tracking-progress">
                <span>
                  {locale === "es" ? "Progreso" : "Progress"}{" "}
                  <b>
                    {Math.min(
                      100,
                      Math.floor(
                        (listeningSession.verifiedSeconds /
                          Math.max(1, listeningSession.validRequirementSeconds)) *
                          100,
                      ),
                    )}%
                  </b>
                </span>
                <div className="progress-track">
                  <i
                    style={{
                      width: `${Math.min(
                        100,
                        (listeningSession.verifiedSeconds /
                          Math.max(1, listeningSession.validRequirementSeconds)) *
                          100,
                      )}%`,
                    }}
                  />
                </div>
              </div>
              {listeningSession.validListenRecorded && (
                <div className="valid-listen-confirmation">
                  <CheckCircle2 size={15} />
                  <strong>
                    {locale === "es"
                      ? "Gracias por apoyar a este artista"
                      : "Valid Listen Recorded"}
                  </strong>
                  <button
                    onClick={() => void advanceToNextSong(autoPlayNextSong)}
                    type="button"
                  >
                    {locale === "es" ? "Siguiente canción" : "Next Song"}{" "}
                    <ArrowRight size={13} />
                  </button>
                </div>
              )}
            </div>
            )}
            <div className="continuous-listening-controls">
              <button
                onClick={() => void advanceToNextSong(autoPlayNextSong)}
                type="button"
              >
                <SkipForward size={15} />
                {locale === "es" ? "Siguiente canción" : "Next Song"}
              </button>
              <button
                className={autoPlayNextSong ? "active" : ""}
                onClick={() => onAutoPlayChange(!autoPlayNextSong)}
                type="button"
              >
                {autoPlayNextSong ? <Pause size={15} /> : <Play size={15} />}
                {autoPlayNextSong
                  ? locale === "es"
                    ? "Pausar auto play"
                    : "Pause Auto Play"
                  : locale === "es"
                    ? "Reanudar auto play"
                    : "Resume Auto Play"}
              </button>
            </div>
          </div>
          <div className="song-copy">
            <div className="song-meta-row">
              <span className="platform-pill">
                <PlatformIcon platform={song.platform} size={13} />
                {song.platform}
              </span>
              <ProviderClassificationBadge platform={song.platform} compact />
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
              {externalContent
                ? locale === "es"
                  ? "Este contenido se abre en su plataforma original. First Listen no promete ni cuenta actividad externa."
                  : "This content opens on its original platform. First Listen does not promise or count external activity."
                : locale === "es"
                  ? `${song.platform} controla la reproducción, el progreso, el volumen y la duración.`
                  : `Playback, progress, volume, and duration are controlled by ${song.platform}.`}
            </p>
            {!externalContent && (
              <a href={song.link} target="_blank" rel="noreferrer">
                Open on {song.platform} <ExternalLink size={14} />
              </a>
            )}
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
              <span className="eyebrow">
                {locale === "es" ? "Review opcional" : "Optional Review"} /{" "}
                {copy.app.review.firstImpression}
              </span>
              <h3>{copy.app.review.direct}</h3>
              <p className="optional-review-note">
                {externalContent
                  ? locale === "es"
                    ? "La actividad externa no se verifica. Regresa a First Listen para dejar feedback util."
                    : "External activity is not verified. Return to First Listen to leave useful feedback."
                  : locale === "es"
                    ? "Puedes apoyar al artista solo escuchando. Completa la review para ganar 5 puntos de comunidad."
                    : "Listening supports the artist by itself. Complete the review to earn 5 Community Points."}
              </p>
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

          <div className="review-respect-note">
            <ShieldCheck size={15} />
            <p>
              <strong>{locale === "es" ? "Por favor sé respetuoso." : "Please be respectful."}</strong>{" "}
              {locale === "es"
                ? "Enfoca el feedback en el contenido. El acoso, discriminación, spam, amenazas o ataques personales pueden resultar en moderación."
                : "Focus feedback on the content. Harassment, discrimination, spam, threats, or personal attacks may result in moderation action."}
            </p>
          </div>

          <button
            className="submit-review-button"
            disabled={!complete || submitting || reviewSubmitted}
            onClick={submitReview}
          >
            {reviewSubmitted
              ? locale === "es"
                ? "Review enviada"
                : "Review Submitted"
              : submitting
                ? "..."
                : copy.app.review.submitReview}{" "}
            <Send size={17} />
          </button>
        </div>
        <div className="review-secondary-stats">
          <div className="listening-session-card">
            <span className="eyebrow">
              <Headphones size={13} />{" "}
              {locale === "es" ? "Banco de escucha" : "Listening Bank"}
            </span>
            <div className="listening-validation-totals">
              <div>
                <span>
                  {locale === "es" ? "SesiÃ³n verificada" : "Verified Session"}
                </span>
                <strong>{formatClock(listeningSession.liveSeconds)}</strong>
              </div>
              <div>
                <span>
                  {locale === "es" ? "Banco aprobado" : "Approved Bank"}
                </span>
                <strong>{formatPreciseMinutes(approvedListeningSeconds)}</strong>
              </div>
            </div>
            <p>
              {externalContent
                ? locale === "es"
                  ? "El contenido externo no gana minutos, escuchas vÃ¡lidas ni recompensas."
                  : "External Content does not earn minutes, valid listens, or rewards."
                : listeningSession.earningEligible === false
                  ? locale === "es"
                    ? "La reproducciÃ³n estÃ¡ disponible, pero este proveedor no puede ganar minutos verificados."
                    : "Playback is available, but this provider cannot earn verified minutes."
                  : locale === "es"
                    ? "Cada segundo verificado se agrega al banco sin redondear. La review es opcional."
                    : "Every verified second is banked without rounding. The review is optional."}
            </p>
            <div className="progress-track">
              <i
                style={{
                  width: `${Math.min(
                    100,
                    (listeningSession.verifiedSeconds /
                      Math.max(1, listeningSession.validRequirementSeconds)) *
                      100,
                  )}%`,
                }}
              />
            </div>
            {listeningSession.warning && (
              <small>{listeningSession.warning}</small>
            )}
          </div>
          <ReviewProgress
            count={reviewCount}
            copy={copy}
            founderFree={founderFree}
            unlimited={unlimitedCredits}
          />
        </div>
      </section>

      <aside className="review-side">
        <div className="listening-session-card">
          <span className="eyebrow">
            <Headphones size={13} />{" "}
            {locale === "es" ? "Banco de escucha" : "Listening Bank"}
          </span>
          <div className="listening-validation-totals">
            <div>
              <span>{locale === "es" ? "Sesión verificada" : "Verified Session"}</span>
              <strong>{formatClock(listeningSession.liveSeconds)}</strong>
            </div>
            <div>
              <span>{locale === "es" ? "Banco aprobado" : "Approved Bank"}</span>
              <strong>{formatPreciseMinutes(approvedListeningSeconds)}</strong>
            </div>
          </div>
          <p>
            {externalContent
              ? locale === "es"
                ? "El contenido externo no gana minutos, escuchas válidas ni recompensas."
                : "External Content does not earn minutes, valid listens, or rewards."
              : listeningSession.earningEligible === false
              ? locale === "es"
                ? "La reproducción está disponible, pero este proveedor no puede ganar minutos verificados."
                : "Playback is available, but this provider cannot earn verified minutes."
              : locale === "es"
                ? "Cada segundo verificado se agrega al banco sin redondear. La review es opcional."
                : "Every verified second is banked without rounding. The review is optional."}
          </p>
          <div className="progress-track">
            <i
              style={{
                width: `${Math.min(
                  100,
                  (listeningSession.verifiedSeconds /
                    Math.max(1, listeningSession.validRequirementSeconds)) *
                    100,
                )}%`,
              }}
            />
          </div>
          {listeningSession.warning && (
            <small>{listeningSession.warning}</small>
          )}
        </div>
        {lastReviewedSong && (
          <PostReviewDiscovery
            locale={locale}
            notify={notify}
            onContinueListening={() => {
              setLastReviewedSong(null);
              notify(
                locale === "es"
                  ? "Sigue escuchando. Tu tiempo verificado continúa contando."
                  : "Keep listening. Your verified time is still counting.",
              );
            }}
            onNextSong={() => void advanceToNextSong(autoPlayNextSong)}
            listeningBank={listeningBank}
            song={lastReviewedSong}
            todaySupport={todaySupport}
            validListenRecorded={listeningSession.validListenRecorded}
          />
        )}
        <ReviewProgress count={reviewCount} copy={copy} founderFree={founderFree} unlimited={unlimitedCredits} />
        <div className="side-note">
          <MessageSquareText size={20} />
          <div>
            <strong>{locale === "es" ? "¿Qué hace una buena review?" : "What makes a good review?"}</strong>
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
    <section className="content review-community-hub">
      <DiscoverySections
        externalRedirectNoticeDisabled={externalRedirectNoticeDisabled}
        locale={locale}
        onListeningCredited={onListeningCredited}
        onExternalRedirectPreferenceChange={
          onExternalRedirectPreferenceChange
        }
        spotlightSongs={spotlightSongs}
        topTenSongs={topTenSongs}
      />
      <div data-platform-module="community_activity">
        <CommunityPulse locale={locale} />
      </div>
    </section>
    </>
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

function ListeningBankPanel({
  status,
  credits,
  claiming,
  onClaim,
  locale,
}: {
  status: ListeningBankStatus;
  credits: number;
  claiming: boolean;
  onClaim: () => void;
  locale: InterfaceLocale;
}) {
  const spanish = locale === "es";
  const spanishLevelNames: Record<string, string> = {
        Explorer: "Explorador",
        Discoverer: "Descubridor",
        "Talent Scout": "Cazatalentos",
        Curator: "Curador",
        "Elite Curator": "Curador Elite",
      };
  const levelName = spanish
    ? spanishLevelNames[status.levelName] ?? status.levelName
    : status.levelName;
  const exchangeSeconds = status.minutesPerCredit * 60;
  const progressSeconds =
    status.bankSeconds % Math.max(1, exchangeSeconds);
  const progress =
    status.availableRewardCredits > 0 && status.secondsToNextCredit === 0
      ? 100
      : Math.round((progressSeconds / Math.max(1, exchangeSeconds)) * 100);

  return (
    <section className="listening-bank-panel">
      <div className="listening-bank-heading">
        <div>
          <span className="eyebrow">
            <Headphones size={13} /> {spanish ? "Banco de escucha" : "Listening Bank"}
          </span>
          <strong>{formatPreciseMinutes(status.bankSeconds)}</strong>
        </div>
        <div className="listener-level">
          <span>{spanish ? "Rango comunitario" : "Community Rank"}</span>
          <strong>{status.communityRank}</strong>
          <small>
            {status.communityPoints} {spanish ? "puntos" : "points"} /{" "}
            {spanish ? "Nivel de escucha" : "Listening level"} {status.levelNumber}:{" "}
            {levelName}
          </small>
        </div>
      </div>
      <div className="listening-bank-stats">
        <div>
          <strong>{formatClock(status.todaySeconds)}</strong>
          <span>{spanish ? "Escucha verificada hoy" : "Today's Verified Listening"}</span>
        </div>
        <div>
          <strong>{formatPreciseMinutes(status.bankSeconds)}</strong>
          <span>{spanish ? "Banco disponible" : "Available Listening Bank"}</span>
        </div>
        <div><strong>{credits}</strong><span>{spanish ? "Tokens disponibles" : "Available Tokens"}</span></div>
        <div><strong>{status.validListens}</strong><span>{spanish ? "Escuchas válidas" : "Valid Listens"}</span></div>
        <div><strong>{status.completeListens}</strong><span>{spanish ? "Escuchas completas" : "Complete Listens"}</span></div>
        <div><strong>{formatDuration(status.weeklySeconds)}</strong><span>{spanish ? "Escucha verificada semanal" : "Weekly Verified Listening"}</span></div>
        <div><strong>{formatDuration(status.monthlySeconds)}</strong><span>{spanish ? "Escucha verificada mensual" : "Monthly Verified Listening"}</span></div>
        <div><strong>{formatDuration(status.lifetimeSeconds)}</strong><span>{spanish ? "Escucha total" : "Lifetime Listening"}</span></div>
      </div>
      <div className="today-support-strip">
        <span>{spanish ? "Apoyo de hoy" : "Today’s Support"}</span>
        <strong>{status.todayValidListens} {spanish ? "válidas" : "valid"}</strong>
        <strong>{status.todayCompleteListens} {spanish ? "completas" : "complete"}</strong>
        <strong>{Math.round(status.todayAverageCompletionRate)}% {spanish ? "promedio" : "average completion"}</strong>
      </div>
      <div className="listening-bank-progress">
        <div>
          <span>{spanish ? "Siguiente token" : "Next token"}</span>
          <strong>
            {status.availableRewardCredits > 0
              ? spanish ? "Token listo para reclamar" : "Token ready to claim"
              : `${Math.ceil(status.secondsToNextCredit / 60)} min ${spanish ? "restantes" : "remaining"}`}
          </strong>
        </div>
        <div className="progress-track" aria-label={`${progress}% toward the next listening reward`}>
          <i style={{ width: `${progress}%` }} />
        </div>
        <small>
          {status.minutesPerCredit} {spanish ? "minutos de escucha" : "listening minutes"} = 1{" "}
          {spanish ? "token" : "token"} / {spanish ? "Límite diario" : "Daily cap"}{" "}
          {status.dailyCapMinutes} min
        </small>
      </div>
      <button
        className="primary-button listening-claim-button"
        disabled={
          claiming ||
          !status.rewardsEnabled ||
          status.availableRewardCredits < 1
        }
        onClick={onClaim}
        type="button"
      >
        {claiming
          ? spanish ? "Reclamando..." : "Claiming..."
          : spanish ? "Reclamar token" : "Claim Token"}{" "}
        <ArrowRight size={16} />
      </button>
    </section>
  );
}

function DiscoverySongCard({
  song,
  active,
  onPlay,
  onListeningCredited,
  locale,
  topTen,
  externalRedirectNoticeDisabled,
  onExternalRedirectPreferenceChange,
}: {
  song: DiscoverySong;
  active: boolean;
  onPlay: () => void;
  onListeningCredited: (
    seconds: number,
    becameValid: boolean,
    becameComplete: boolean,
    completionRate: number,
  ) => void;
  locale: InterfaceLocale;
  topTen?: boolean;
  externalRedirectNoticeDisabled: boolean;
  onExternalRedirectPreferenceChange: (disabled: boolean) => void;
}) {
  const [details, setDetails] = useState<"reviews" | "statistics" | null>(null);
  const [listenState, setListenState] = useState({
    liveSeconds: 0,
    verifiedSeconds: 0,
    validRequirementSeconds: 30,
    validListenRecorded: false,
    warning: "",
  });
  const playerRef = useRef<HTMLDivElement>(null);
  const listeningSessionRef = useRef<string | null>(null);
  const startingSessionRef = useRef(false);
  const heartbeatInFlightRef = useRef(false);
  const lastHeartbeatAtRef = useRef(0);
  const lastLiveSampleRef = useRef<{ at: number; position: number } | null>(
    null,
  );
  const liveSecondsRef = useRef(0);
  const validListenRef = useRef(false);
  const completeListenRef = useRef(false);
  const scrolledForPlaybackRef = useRef(false);
  const spanish = locale === "es";

  const scrollPlayerIntoView = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    const root = document.documentElement;
    const previousScrollBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    const top = window.scrollY + player.getBoundingClientRect().top - 92;
    window.scrollTo(0, Math.max(0, top));
    window.requestAnimationFrame(() => {
      root.style.scrollBehavior = previousScrollBehavior;
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(scrollPlayerIntoView);
    const settle = window.setTimeout(scrollPlayerIntoView, 700);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [active, scrollPlayerIntoView]);

  useEffect(() => {
    if (active) return;
    scrolledForPlaybackRef.current = false;
    listeningSessionRef.current = null;
    startingSessionRef.current = false;
    heartbeatInFlightRef.current = false;
    lastHeartbeatAtRef.current = 0;
    lastLiveSampleRef.current = null;
    liveSecondsRef.current = 0;
    validListenRef.current = false;
    completeListenRef.current = false;
    setListenState({
      liveSeconds: 0,
      verifiedSeconds: 0,
      validRequirementSeconds: 30,
      validListenRecorded: false,
      warning: "",
    });
  }, [active]);

  const handleDiscoveryTelemetry = useCallback(
    async (snapshot: ProviderTelemetrySnapshot) => {
      if (!active) return;
      if (
        snapshot.playbackState === "playing" &&
        !scrolledForPlaybackRef.current
      ) {
        scrolledForPlaybackRef.current = true;
        window.requestAnimationFrame(scrollPlayerIntoView);
      }
      const sampleAt = Date.now();
      const liveEligible =
        snapshot.supported &&
        snapshot.pageVisible &&
        snapshot.pageFocused &&
        snapshot.muted === false &&
        (snapshot.volume ?? 0) > 0;
      const previous = lastLiveSampleRef.current;
      if (
        liveEligible &&
        snapshot.playbackState === "playing" &&
        previous &&
        snapshot.currentTime >= previous.position
      ) {
        const wallDelta = Math.max(0, (sampleAt - previous.at) / 1000);
        const positionDelta = Math.max(
          0,
          snapshot.currentTime - previous.position,
        );
        const delta = Math.min(positionDelta, wallDelta + 1);
        if (delta > 0 && delta <= 5) {
          liveSecondsRef.current += delta;
          setListenState((current) => ({
            ...current,
            liveSeconds: liveSecondsRef.current,
          }));
        }
      }
      lastLiveSampleRef.current =
        liveEligible && snapshot.playbackState === "playing"
          ? { at: sampleAt, position: snapshot.currentTime }
          : null;

      if (
        !snapshot.supported ||
        !["playing", "ended"].includes(snapshot.playbackState)
      ) {
        if (!snapshot.supported) {
          setListenState((current) => ({
            ...current,
            warning: spanish
              ? "Este proveedor no ofrece verificacion de escucha."
              : "This provider does not expose verified listening.",
          }));
        }
        return;
      }

      const supabase = createClient();
      if (!supabase) return;
      if (!listeningSessionRef.current && !startingSessionRef.current) {
        startingSessionRef.current = true;
        const { data, error } = await supabase.rpc("start_listening_session", {
          target_song_id: song.id,
        });
        startingSessionRef.current = false;
        const row = Array.isArray(data) ? data[0] : data;
        if (error || !row?.session_id) {
          setListenState((current) => ({
            ...current,
            warning:
              error?.message ??
              (spanish
                ? "Esta canción no es elegible para otra escucha verificada."
                : "This song is not eligible for another verified listen."),
          }));
          return;
        }
        listeningSessionRef.current = String(row.session_id);
      }

      const sessionId = listeningSessionRef.current;
      if (!sessionId || heartbeatInFlightRef.current) return;
      const heartbeatDue =
        snapshot.playbackState === "ended" ||
        Date.now() - lastHeartbeatAtRef.current >= 15000;
      if (!heartbeatDue) return;

      heartbeatInFlightRef.current = true;
      lastHeartbeatAtRef.current = Date.now();
      const { data, error } = await supabase.rpc(
        "record_listening_heartbeat",
        {
          target_session_id: sessionId,
          playback_position_seconds: snapshot.currentTime,
          playback_duration_seconds: snapshot.duration,
          playback_state:
            snapshot.playbackState === "ended"
              ? "playing"
              : snapshot.playbackState,
          playback_muted: snapshot.muted,
          playback_volume: snapshot.volume,
          page_visible: snapshot.pageVisible,
          page_focused: snapshot.pageFocused,
          interaction_recent:
            Date.now() - snapshot.lastInteractionAt <= 5 * 60 * 1000,
        },
      );
      heartbeatInFlightRef.current = false;
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row) {
        setListenState((current) => ({
          ...current,
          warning: error?.message ?? "Listening progress could not be verified.",
        }));
        return;
      }
      const valid = Boolean(row.valid_listen_recorded);
      const complete = Boolean(row.complete_listen_recorded);
      const becameValid = valid && !validListenRef.current;
      const becameComplete = complete && !completeListenRef.current;
      validListenRef.current = valid;
      completeListenRef.current = complete;
      const seconds = Number(row.seconds_counted ?? 0);
      setListenState((current) => ({
        ...current,
        verifiedSeconds: Number(row.session_verified_seconds ?? 0),
        validRequirementSeconds: Number(
          row.valid_requirement_seconds ?? current.validRequirementSeconds,
        ),
        validListenRecorded: valid,
        warning: String(row.warning ?? ""),
      }));
      onListeningCredited(
        seconds,
        becameValid,
        becameComplete,
        snapshot.duration > 0
          ? Math.min(100, (snapshot.currentTime / snapshot.duration) * 100)
          : 0,
      );
    },
    [active, onListeningCredited, scrollPlayerIntoView, song.id, spanish],
  );

  const togglePlayer = async () => {
    if (active && listeningSessionRef.current) {
      const supabase = createClient();
      if (supabase) {
        await supabase.rpc("finish_listening_session", {
          target_session_id: listeningSessionRef.current,
        });
      }
    }
    if (!active) {
      setDetails(null);
      const supabase = createClient();
      if (supabase) {
        void supabase.rpc("record_song_view", {
          target_song_id: song.id,
          guest_access_token: null,
        });
      }
    }
    onPlay();
  };

  return (
    <article className="discovery-song-card">
      <div className="discovery-song-cover">
        <Image
          alt={`${song.title} cover`}
          fill
          sizes="(max-width: 760px) 100vw, 320px"
          src={song.coverUrl}
          unoptimized
        />
        <span>
          {topTen
            ? `Top ${song.position}`
            : song.badge || `Spotlight #${song.position}`}
        </span>
      </div>
      <div className="discovery-song-copy">
        <span className="eyebrow">
          {topTen ? <Trophy size={13} /> : <Sparkles size={13} />}
          {topTen
            ? spanish
              ? "Ranking orgánico"
              : "Organic ranking"
            : spanish
              ? "Seleccion editorial"
              : "Editorial selection"}
        </span>
        <h4>{song.title}</h4>
        <Link href={`/artists/${song.artistId}`}>{song.artist}</Link>
        <small>
          {song.platform} / {compactClassificationLabel(song.platform)} /{" "}
          {optionLabel(locale, song.genre)} /{" "}
          {optionLabel(locale, song.language)}
        </small>
      </div>
      <div className="discovery-song-actions">
        <button className="primary-button" onClick={() => void togglePlayer()} type="button">
          <Play size={14} fill="currentColor" />
          {active
            ? spanish
              ? "Ocultar reproductor"
              : "Hide Player"
            : spanish
              ? "Escuchar ahora"
              : "Listen Now"}
        </button>
        <a href={song.link} rel="noreferrer" target="_blank">
          <ExternalLink size={14} />
          {spanish ? "Abrir plataforma" : "Open Platform"}
        </a>
        <button
          className={details === "reviews" ? "active" : ""}
          onClick={() =>
            setDetails((current) => (current === "reviews" ? null : "reviews"))
          }
          type="button"
        >
          <MessageSquareText size={14} />
          {spanish ? "Reviews" : "Reviews"}
        </button>
        <button
          className={details === "statistics" ? "active" : ""}
          onClick={() =>
            setDetails((current) =>
              current === "statistics" ? null : "statistics",
            )
          }
          type="button"
        >
          <BarChart3 size={14} />
          {spanish ? "Estadísticas" : "Statistics"}
        </button>
      </div>
      {active && (
        <div className="discovery-inline-player" ref={playerRef}>
          <ProviderPlayer
            artist={song.artist}
            autoPlay
            coverUrl={song.coverUrl}
            link={song.link}
            locale={locale}
            onReady={scrollPlayerIntoView}
            onTelemetry={handleDiscoveryTelemetry}
            platform={song.platform}
            songLoadedAt={null}
            title={song.title}
            skipExternalRedirectWarning={externalRedirectNoticeDisabled}
            onExternalRedirectPreferenceChange={
              onExternalRedirectPreferenceChange
            }
          />
          <div className="discovery-listen-progress" aria-live="polite">
            <span>
              <Headphones size={13} />
              {spanish ? "Tiempo en vivo" : "Live"}{" "}
              <strong>{formatClock(listenState.liveSeconds)}</strong>
            </span>
            <span>
              <CheckCircle2 size={13} />
              {listenState.validListenRecorded
                ? spanish ? "Escucha válida" : "Valid Listen"
                : `${formatClock(listenState.verifiedSeconds)} / ${formatClock(
                    listenState.validRequirementSeconds,
                  )}`}
            </span>
            {listenState.warning && <small>{listenState.warning}</small>}
          </div>
        </div>
      )}
      <SongActionBar
        artist={song.artist}
        artistId={song.artistId}
        compact
        link={song.link}
        locale={locale}
        platform={song.platform}
        songId={song.id}
        title={song.title}
      />
      {details && (
        <div className="discovery-song-details" role="status">
          {details === "reviews" ? (
            <>
              <div>
                <strong>{song.reviewsReceived}</strong>
                <span>{spanish ? "Reviews recibidas" : "Reviews received"}</span>
              </div>
              <div>
                <strong>{song.averageRating.toFixed(1)}</strong>
                <span>{spanish ? "Rating promedio" : "Average rating"}</span>
              </div>
              <div>
                <strong>{song.hookScore}</strong>
                <span>Hook Score</span>
              </div>
            </>
          ) : (
            <>
              <div>
                <strong>{formatDuration(song.totalListeningSeconds)}</strong>
                <span>{spanish ? "Tiempo escuchado" : "Listening time"}</span>
              </div>
              <div>
                <strong>{Math.round(song.completionRate)}%</strong>
                <span>{spanish ? "Finalización" : "Completion"}</span>
              </div>
              {topTen && (
                <div>
                  <strong>{song.rankingScore?.toFixed(1) ?? "0.0"}</strong>
                  <span>{spanish ? "Score orgánico" : "Organic score"}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}

function DiscoverySections({
  spotlightSongs,
  topTenSongs,
  locale,
  onListeningCredited,
  externalRedirectNoticeDisabled,
  onExternalRedirectPreferenceChange,
}: {
  spotlightSongs: DiscoverySong[];
  topTenSongs: DiscoverySong[];
  locale: InterfaceLocale;
  onListeningCredited: (
    seconds: number,
    becameValid: boolean,
    becameComplete: boolean,
    completionRate: number,
  ) => void;
  externalRedirectNoticeDisabled: boolean;
  onExternalRedirectPreferenceChange: (disabled: boolean) => void;
}) {
  const [activeSongId, setActiveSongId] = useState<string | null>(null);
  const spanish = locale === "es";
  const spotlightIds = new Set(spotlightSongs.map((song) => song.id));
  const visibleTopTenSongs = topTenSongs.filter(
    (song) => !spotlightIds.has(song.id),
  );

  return (
    <div className="dashboard-discovery">
      <section
        className="panel discovery-section"
        data-platform-module="spotlight"
      >
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              <Sparkles size={13} /> Spotlight
            </span>
            <h3>
              {spanish
                ? "Dos selecciones editoriales"
                : "Two editorial selections"}
            </h3>
          </div>
          <small>
            {spanish
              ? "Seleccionado manualmente"
              : "Manually selected"}
          </small>
        </div>
        {spotlightSongs.length ? (
          <div className="discovery-song-grid">
            {spotlightSongs.map((song) => (
              <DiscoverySongCard
                active={activeSongId === song.id}
                key={`spotlight-${song.id}`}
                locale={locale}
                onListeningCredited={onListeningCredited}
                onPlay={() =>
                  setActiveSongId((current) =>
                    current === song.id ? null : song.id,
                  )
                }
                externalRedirectNoticeDisabled={
                  externalRedirectNoticeDisabled
                }
                onExternalRedirectPreferenceChange={
                  onExternalRedirectPreferenceChange
                }
                song={song}
              />
            ))}
          </div>
        ) : (
          <p className="discovery-empty">
            {spanish
              ? "Los próximos Spotlight aparecerán aquí."
              : "The next Spotlight selections will appear here."}
          </p>
        )}
      </section>

      <section
        className="panel discovery-section top-ten-section"
        data-platform-module="top_results"
      >
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              <Trophy size={13} /> Top 10
            </span>
            <h3>
              {spanish ? "Ganado por resultados" : "Earned by performance"}
            </h3>
          </div>
          <small>
            {spanish
              ? "Sin patrocinio ni control editorial"
              : "No sponsorship or editorial control"}
          </small>
        </div>
        {visibleTopTenSongs.length ? (
          <div className="discovery-song-grid top-ten-grid">
            {visibleTopTenSongs.map((song) => (
              <DiscoverySongCard
                active={activeSongId === song.id}
                key={`top-${song.id}`}
                locale={locale}
                onListeningCredited={onListeningCredited}
                onPlay={() =>
                  setActiveSongId((current) =>
                    current === song.id ? null : song.id,
                  )
                }
                externalRedirectNoticeDisabled={
                  externalRedirectNoticeDisabled
                }
                onExternalRedirectPreferenceChange={
                  onExternalRedirectPreferenceChange
                }
                song={song}
                topTen
              />
            ))}
          </div>
        ) : (
          <p className="discovery-empty">
            {spanish
              ? "El Top 10 aparecerá cuando haya suficientes reviews verificadas."
              : "Top 10 will appear after songs receive verified reviews."}
          </p>
        )}
      </section>

      <section
        className="panel discovery-section external-discovery-section"
        data-platform-module="external_discovery"
      >
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              <ExternalLink size={13} /> External Discovery
            </span>
            <h3>
              {spanish
                ? "Explora plataformas conectadas"
                : "Explore connected platforms"}
            </h3>
          </div>
          <small>
            {spanish ? "Spotify / Apple / TikTok / SoundCloud" : "Spotify / Apple / TikTok / SoundCloud"}
          </small>
        </div>
        <p className="discovery-empty">
          {spanish
            ? "El Founder puede controlar si el contenido externo se mezcla con la cola, aparece separado o permanece oculto."
            : "The Founder can control whether external content is mixed with the queue, shown separately, or hidden."}
        </p>
      </section>
    </div>
  );
}

function DailyMissionPanel({
  mission,
  claiming,
  locale,
  onClaim,
}: {
  mission: DailyMissionStatus | null;
  claiming: boolean;
  locale: InterfaceLocale;
  onClaim: () => void;
}) {
  if (!mission) return null;
  const spanish = locale === "es";
  const progress = Math.min(
    100,
    Math.round((mission.progressCount / Math.max(1, mission.targetCount)) * 100),
  );
  const reward =
    mission.rewardKind === "credit"
      ? `${mission.rewardAmount} ${spanish ? "token" : "token"}`
      : `${mission.rewardAmount} ${spanish ? "min del Banco" : "Bank min"}`;

  return (
    <section className="daily-mission-panel">
      <div className="daily-mission-icon">
        <Target size={22} />
      </div>
      <div>
        <span className="eyebrow">
          {spanish ? "Misión diaria" : "Daily Mission"}
        </span>
        <h3>{spanish ? mission.titleEs : mission.titleEn}</h3>
        <p>{spanish ? mission.descriptionEs : mission.descriptionEn}</p>
      </div>
      <div className="daily-mission-progress">
        <strong>
          {mission.progressCount}/{mission.targetCount}
          {mission.completed ? ` ${spanish ? "Completa" : "Complete"}` : ""}
        </strong>
        <div className="progress-track">
          <i style={{ width: `${progress}%` }} />
        </div>
        <small>
          {spanish ? "Recompensa" : "Reward"}: {reward}
        </small>
      </div>
      <button
        disabled={!mission.completed || mission.claimed || claiming}
        onClick={onClaim}
        type="button"
      >
        {mission.claimed
          ? spanish
            ? "Reclamada"
            : "Claimed"
          : claiming
            ? "..."
            : spanish
              ? "Reclamar"
              : "Claim"}
      </button>
    </section>
  );
}

function CommunityProgramsPanel({
  programs,
  locale,
}: {
  programs: CommunityProgram[];
  locale: InterfaceLocale;
}) {
  if (!programs.length) return null;
  const spanish = locale === "es";
  return (
    <section className="panel community-programs-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            <CalendarDays size={13} />{" "}
            {spanish ? "Comunidad" : "Community"}
          </span>
          <h3>{spanish ? "Concursos y eventos activos" : "Active contests and events"}</h3>
        </div>
      </div>
      <div className="community-program-grid">
        {programs.map((program) => (
          <article key={program.id}>
            <span>
              {program.kind === "contest"
                ? spanish
                  ? "Concurso"
                  : "Contest"
                : spanish
                  ? "Evento especial"
                  : "Special event"}
            </span>
            <h4>{program.title}</h4>
            <p>{program.description}</p>
            <small>
              {program.genre ? `${optionLabel(locale, program.genre)} / ` : ""}
              {new Date(program.endsAt).toLocaleDateString(locale)}
              {program.kind === "contest"
                ? ` / ${program.entryCount} ${spanish ? "entradas" : "entries"}`
                : ""}
            </small>
          </article>
        ))}
      </div>
    </section>
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
  listeningBank,
  claimingReward,
  onClaimReward,
  spotlightSongs,
  topTenSongs,
  dailyMission,
  claimingMission,
  onClaimMission,
  communityPrograms,
  onBoostSong,
  onListeningCredited,
  externalRedirectNoticeDisabled,
  onExternalRedirectPreferenceChange,
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
  listeningBank: ListeningBankStatus;
  claimingReward: boolean;
  onClaimReward: () => void;
  spotlightSongs: DiscoverySong[];
  topTenSongs: DiscoverySong[];
  dailyMission: DailyMissionStatus | null;
  claimingMission: boolean;
  onClaimMission: () => void;
  communityPrograms: CommunityProgram[];
  onBoostSong: (songId: string) => void;
  onListeningCredited: (
    seconds: number,
    becameValid: boolean,
    becameComplete: boolean,
    completionRate: number,
  ) => void;
  externalRedirectNoticeDisabled: boolean;
  onExternalRedirectPreferenceChange: (disabled: boolean) => void;
}) {
  const reviews = songReviews;
  if (!song) {
    return (
      <main className="content dashboard-empty">
        <ListeningBankPanel
          claiming={claimingReward}
          credits={reviewCredits}
          onClaim={onClaimReward}
          status={listeningBank}
          locale={locale}
        />
        <DailyMissionPanel
          claiming={claimingMission}
          locale={locale}
          mission={dailyMission}
          onClaim={onClaimMission}
        />
        <DiscoverySections
          externalRedirectNoticeDisabled={externalRedirectNoticeDisabled}
          locale={locale}
          onListeningCredited={onListeningCredited}
          onExternalRedirectPreferenceChange={
            onExternalRedirectPreferenceChange
          }
          spotlightSongs={spotlightSongs}
          topTenSongs={topTenSongs}
        />
        <CommunityProgramsPanel locale={locale} programs={communityPrograms} />
        <section className="review-complete-card">
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
  const latestSummary =
    songSummaries.find((summary) => summary.id === song.id) ?? null;

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

        <ListeningBankPanel
          claiming={claimingReward}
          credits={reviewCredits}
          onClaim={onClaimReward}
          status={listeningBank}
          locale={locale}
        />
        <DailyMissionPanel
          claiming={claimingMission}
          locale={locale}
          mission={dailyMission}
          onClaim={onClaimMission}
        />
      <DiscoverySections
        externalRedirectNoticeDisabled={externalRedirectNoticeDisabled}
        locale={locale}
        onListeningCredited={onListeningCredited}
        onExternalRedirectPreferenceChange={
          onExternalRedirectPreferenceChange
        }
        spotlightSongs={spotlightSongs}
          topTenSongs={topTenSongs}
        />
        <CommunityProgramsPanel locale={locale} programs={communityPrograms} />

        <div className="active-song">
          <Image src={song.coverUrl} alt={`${song.title} cover`} unoptimized width={90} height={90} />
          <div className="active-song-copy">
            <div>
              <span className="live-dot">{copy.app.dashboard.collecting}</span>
              <span className="platform-label">{song.platform}</span>
              <ProviderClassificationBadge platform={song.platform} compact />
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
          <StatCard
            label={locale === "es" ? "Escucha total" : "Total Listening"}
            value={formatDuration(latestSummary?.totalListeningSeconds ?? 0)}
            detail={locale === "es" ? "Sesiones verificadas" : "Verified review sessions"}
            icon={Clock3}
          />
          <StatCard
            label={locale === "es" ? "Escucha promedio" : "Average Listen"}
            value={formatDuration(latestSummary?.averageListeningSeconds ?? 0)}
            detail={locale === "es" ? "Por review válida" : "Per qualified review"}
            icon={Headphones}
          />
          <StatCard
            label={locale === "es" ? "Tasa de finalización" : "Completion Rate"}
            value={`${Math.round(latestSummary?.completionRate ?? 0)}%`}
            detail={locale === "es" ? "Alcanzo al menos 90%" : "Reached at least 90%"}
            icon={CheckCircle2}
          />
          <StatCard
            label={locale === "es" ? "Retencion" : "Listener Retention"}
            value={`${Math.round(latestSummary?.listenerRetention ?? 0)}%`}
            detail={locale === "es" ? "Progreso verificado promedio" : "Average verified progress"}
            icon={Gauge}
          />
        </div>

        <section className="panel song-performance-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                {locale === "es" ? "Rendimiento" : "Song performance"}
              </span>
              <h3>
                {locale === "es" ? "Cada canción enviada" : "Every submitted song"}
              </h3>
            </div>
            <span>{songSummaries.length} {locale === "es" ? "total" : "total"}</span>
          </div>
          <div className="song-performance-list">
            {songSummaries.map((summary) => (
              <article key={summary.id}>
                <div className="song-performance-title">
                  <strong>{summary.title}</strong>
                  <small>
                    {summary.platform} / {locale === "es" ? "Enviada" : "Submitted"}{" "}
                    {new Date(summary.submittedAt).toLocaleDateString(locale, { timeZone: "UTC" })}
                  </small>
                </div>
                <div><strong>{summary.reviewsReceived}</strong><span>{locale === "es" ? "Reviews recibidas" : "Reviews received"}</span></div>
                <div><strong>{summary.averageRating.toFixed(1)}</strong><span>{locale === "es" ? "Rating promedio" : "Average rating"}</span></div>
                <div><strong>{summary.hookScore}</strong><span>Hook score</span></div>
                <div><strong>{formatDuration(summary.totalListeningSeconds)}</strong><span>{locale === "es" ? "Tiempo escuchado" : "Listening time"}</span></div>
                <div><strong>{summary.reportCount}</strong><span>{locale === "es" ? "Reportes" : "Reports"}</span></div>
                <Link href={`/dashboard/comments?song=${summary.id}`}>
                  {locale === "es" ? "Comentarios" : "Comments"} <ArrowRight size={13} />
                </Link>
                <button
                  className="song-boost-button"
                  disabled={
                    summary.boostStatus === "pending" ||
                    summary.boostStatus === "approved"
                  }
                  onClick={() => onBoostSong(summary.id)}
                  type="button"
                >
                  <Rocket size={13} />
                  {summary.boostStatus === "pending"
                    ? locale === "es"
                      ? "Boost pendiente"
                      : "Boost pending"
                    : summary.boostStatus === "approved"
                      ? locale === "es"
                        ? "Boost activo"
                        : "Boost active"
                      : locale === "es"
                        ? "Impulsar canción"
                        : "Boost Song"}
                </button>
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
  contentEconomy,
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
  contentEconomy: ContentEconomySetting[];
}) {
  const [submitted, setSubmitted] = useState(false);
  const [musicLink, setMusicLink] = useState("");
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [songTitle, setSongTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [genre, setGenre] = useState<Genre | "">("");
  const [songLanguage, setSongLanguage] = useState<SongLanguage | "">("");
  const [country, setCountry] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [feedbackFocus, setFeedbackFocus] = useState<FeedbackFocus[]>([]);
  const [explicitContent, setExplicitContent] = useState<boolean | null>(null);
  const [contentKind, setContentKind] =
    useState<SongSubmission["contentKind"]>("song");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [submittedForApproval, setSubmittedForApproval] = useState(false);
  const [saving, setSaving] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [duplicateCheckLoading, setDuplicateCheckLoading] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<
    SubmissionDuplicate[]
  >([]);
  const [duplicateWarningAccepted, setDuplicateWarningAccepted] =
    useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [browserOrigin, setBrowserOrigin] = useState<string>();
  const platformDetection = detectMusicPlatform(musicLink);
  const requiredTokenCost = platformDetection.platform
    ? submissionTokenCost(contentEconomy, platformDetection.platform)
    : 1;
  const unlocked =
    reviewCount >= requiredTokenCost || founderFree || unlimitedCredits;
  const selectedEconomy = platformDetection.platform
    ? economySettingFor(contentEconomy, platformDetection.platform)
    : undefined;
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
  const reportedDurationSeconds =
    Number(durationMinutes || 0) * 60 + Number(durationSeconds || 0);
  const exactDuplicate = duplicateMatches.find((match) => match.exact_match);
  const possibleDuplicates = duplicateMatches.filter(
    (match) => !match.exact_match,
  );
  const validationFailures = useMemo(() => {
    const failures: string[] = [];
    if (!unlocked) {
      failures.push(
        locale === "es"
          ? `Necesitas ${requiredTokenCost} ${requiredTokenCost === 1 ? "token" : "tokens"} para enviar este contenido.`
          : `${requiredTokenCost} ${requiredTokenCost === 1 ? "token is" : "tokens are"} required to submit this content.`,
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
      failures.push(locale === "es" ? "Escribe el título de la canción." : "Enter the song title.");
    }
    if (!artistName.trim()) {
      failures.push(locale === "es" ? "Escribe el nombre del artista." : "Enter the artist name.");
    }
    if (!genre) {
      failures.push(locale === "es" ? "Selecciona un género." : "Select a genre.");
    }
    if (!songLanguage) {
      failures.push(locale === "es" ? "Selecciona el idioma de la canción." : "Select the song language.");
    }
    if (!country) {
      failures.push(locale === "es" ? "Selecciona un país." : "Select a country.");
    }
    if (feedbackFocus.length === 0) {
      failures.push(
        locale === "es"
          ? "Selecciona al menos un enfoque de feedback."
          : "Select at least one feedback focus.",
      );
    }
    if (explicitContent === null) {
      failures.push(
        locale === "es"
          ? "Indica si la canción contiene contenido explícito."
          : "Choose whether the song contains explicit content.",
      );
    }
    if (
      !Number.isInteger(reportedDurationSeconds) ||
      reportedDurationSeconds < 15 ||
      reportedDurationSeconds > 43200 ||
      Number(durationSeconds || 0) > 59
    ) {
      failures.push(
        locale === "es"
          ? "Escribe una duración válida en minutos y segundos."
          : "Enter a valid content duration in minutes and seconds.",
      );
    }
    if (coverImageUrl && !/^https:\/\//i.test(coverImageUrl.trim())) {
      failures.push(
        locale === "es"
          ? "La portada opcional debe usar una URL https://."
          : "The optional cover image must use an https:// URL.",
      );
    }
    if (exactDuplicate) {
      failures.push(
        locale === "es"
          ? "Canción ya enviada."
          : "Song already submitted.",
      );
    } else if (
      possibleDuplicates.length > 0 &&
      !duplicateWarningAccepted
    ) {
      failures.push(
        locale === "es"
          ? "Revisa la posible canción duplicada antes de continuar."
          : "Review the possible duplicate before continuing.",
      );
    }
    return failures;
  }, [
    artistName,
    country,
    durationSeconds,
    coverImageUrl,
    feedbackFocus.length,
    genre,
    explicitContent,
    exactDuplicate,
    locale,
    platformDetection.platform,
    platformDetection.valid,
    songLanguage,
    songTitle,
    unlocked,
    reportedDurationSeconds,
    requiredTokenCost,
    possibleDuplicates.length,
    duplicateWarningAccepted,
  ]);
  const submitDisabled =
    saving || duplicateCheckLoading || validationFailures.length > 0;

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
    setDuplicateWarningAccepted(false);
    if (
      !platformDetection.valid ||
      !platformDetection.platform ||
      !musicLink.trim() ||
      songTitle.trim().length < 3
    ) {
      setDuplicateMatches([]);
      setDuplicateCheckLoading(false);
      return;
    }

    let active = true;
    const timeout = window.setTimeout(async () => {
      const supabase = createClient();
      if (!supabase) return;
      setDuplicateCheckLoading(true);
      const { data, error } = await supabase.rpc(
        "check_song_submission_duplicates",
        {
          song_title: songTitle.trim(),
          song_platform: databasePlatform[platformDetection.platform!],
          song_music_url: musicLink.trim(),
        },
      );
      if (!active) return;
      setDuplicateMatches(
        error ? [] : ((data ?? []) as SubmissionDuplicate[]),
      );
      setDuplicateCheckLoading(false);
    }, 450);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [
    musicLink,
    platformDetection.platform,
    platformDetection.valid,
    songTitle,
  ]);

  useEffect(() => {
    console.info("[First Listen submission] Validation state", {
      detectedPlatform: platformDetection.platform,
      embedUrl: providerEmbed?.src ?? null,
      parsedUrl: platformDetection.parsedUrl,
      resourceId: platformDetection.resourceId,
      resourceType: platformDetection.resourceType,
      submitDisabled,
      validationFailures,
      duplicateMatches,
      duplicateCheckLoading,
    });
  }, [
    platformDetection.parsedUrl,
    platformDetection.platform,
    platformDetection.resourceId,
    platformDetection.resourceType,
    providerEmbed?.src,
    submitDisabled,
    validationFailures,
    duplicateCheckLoading,
    duplicateMatches,
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
      explicitContent: explicitContent ?? false,
      contentKind,
      durationSeconds: reportedDurationSeconds,
    };

    setSaving(true);
    const saved = await onSubmitted(founderFree, submission);
    setSaving(false);
    if (!saved) return;

    setPlatform(platformDetection.platform);
    setSubmittedForApproval(
      reportedDurationSeconds > 480 || contentKind === "long_form",
    );
    setSubmitted(true);
    notify(locale === "es" ? "Canción enviada. Ya entra a la cola de reviews." : "Song submitted. It is now entering the review queue.");
  };

  const resetSubmissionForm = () => {
    setMusicLink("");
    setPlatform(null);
    setSongTitle("");
    setArtistName("");
    setGenre("");
    setSongLanguage("");
    setCountry("");
    setCoverImageUrl("");
    setFeedbackFocus([]);
    setExplicitContent(null);
    setContentKind("song");
    setDurationMinutes("");
    setDurationSeconds("");
    setSubmittedForApproval(false);
    setMetadataLoading(false);
    setDuplicateCheckLoading(false);
    setDuplicateMatches([]);
    setDuplicateWarningAccepted(false);
    setSaving(false);
    setSubmitted(false);
  };

  if (submitted) {
    return (
      <main className="content submit-success">
        <section>
          <div className="success-orbit"><Check size={36} /></div>
          <span className="eyebrow">{copy.app.submit.received}</span>
          <h2>{copy.app.submit.queue}</h2>
          <p>
            {submittedForApproval
              ? locale === "es"
                ? "El contenido de más de 8 minutos fue guardado y está esperando aprobación manual antes de entrar a la cola pública."
                : "Content over 8 minutes was saved and is awaiting manual approval before entering the public queue."
              : copy.app.submit.saved}
          </p>
          <div className="success-song">
            <div className="success-cover"><Music2 size={28} /></div>
            <span>
              <strong>{copy.app.submit.newRelease}</strong>
              <small>
                {platform} /{" "}
                {platform ? compactClassificationLabel(platform) : ""} /{" "}
                {songLanguage && optionLabel(locale, songLanguage)} /{" "}
                {submittedForApproval
                  ? locale === "es"
                    ? "Aprobación pendiente"
                    : "Pending approval"
                  : copy.app.submit.waiting}
              </small>
            </span>
            <CheckCircle2 size={20} />
          </div>
          <button className="primary-button" onClick={resetSubmissionForm}>
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

        <div className="content-economy-education">
          <article className="internal">
            <span><Music2 size={17} /> Internal Content</span>
            <strong>Cost: 1 Token</strong>
            <p>
              {locale === "es"
                ? "Mejor valor. Mantiene a los oyentes en First Listen y permite reviews, seguidores, comunidad, descubrimiento y escucha verificable."
                : "Best value. Keeps listeners inside First Listen and supports reviews, followers, community activity, discovery, and verified listening."}
            </p>
            <small>YouTube / YouTube Music / SoundCloud</small>
          </article>
          <article className="external">
            <span><Link2 size={17} /> External Content</span>
            <strong>
              Effective now: {requiredTokenCost}{" "}
              {requiredTokenCost === 1 ? "Token" : "Tokens"} / Scheduled:{" "}
              {selectedEconomy?.classification === "external"
                ? selectedEconomy.scheduledTokenCost
                : 8} Tokens
            </strong>
            <p>
              {locale === "es"
                ? "Redirige fuera de First Listen. No ofrece verificación de reproducción interna ni recompensas por actividad externa."
                : "Redirects outside First Listen. No internal playback verification or rewards are provided for external activity."}
            </p>
            <small>Spotify / Apple Music / TikTok</small>
          </article>
        </div>

        {!unlocked && (
          <div className="locked-banner">
            <LockKeyhole size={19} />
            <div>
              <strong>
                {locale === "es"
                  ? `Necesitas ${requiredTokenCost} ${requiredTokenCost === 1 ? "token" : "tokens"} para enviar`
                  : `${requiredTokenCost} ${requiredTokenCost === 1 ? "token is" : "tokens are"} required to submit`}
              </strong>
              <p>
                {locale === "es"
                  ? "Acumula minutos verificados y reclama una recompensa."
                  : "Bank verified listening minutes and claim a reward."}
              </p>
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
                  {locale === "es" ? "Selecciona un género" : "Select a genre"}
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
                  {locale === "es" ? "Selecciona un país" : "Select a country"}
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
              <label htmlFor="content-kind">
                {locale === "es" ? "Tipo de contenido" : "Content type"}
              </label>
              <select
                disabled={!unlocked}
                id="content-kind"
                onChange={(event) =>
                  setContentKind(
                    event.target.value as SongSubmission["contentKind"],
                  )
                }
                value={contentKind}
              >
                <option value="song">{locale === "es" ? "Canción" : "Song"}</option>
                <option value="music_video">{locale === "es" ? "Video musical" : "Music Video"}</option>
                <option value="remix">Remix</option>
                <option value="live_session">{locale === "es" ? "Sesión en vivo corta" : "Short Live Session"}</option>
                <option value="performance">{locale === "es" ? "Presentación corta" : "Short Performance"}</option>
                <option value="long_form">{locale === "es" ? "Contenido largo" : "Long-form Content"}</option>
              </select>
            </div>
            <div className="field">
              <label>
                {locale === "es" ? "Duración" : "Content duration"}
              </label>
              <div className="duration-inputs">
                <input
                  aria-label={locale === "es" ? "Minutos" : "Minutes"}
                  disabled={!unlocked}
                  max={720}
                  min={0}
                  onChange={(event) => setDurationMinutes(event.target.value)}
                  placeholder="min"
                  type="number"
                  value={durationMinutes}
                />
                <span>:</span>
                <input
                  aria-label={locale === "es" ? "Segundos" : "Seconds"}
                  disabled={!unlocked}
                  max={59}
                  min={0}
                  onChange={(event) => setDurationSeconds(event.target.value)}
                  placeholder="sec"
                  type="number"
                  value={durationSeconds}
                />
              </div>
              <small>
                {locale === "es"
                  ? "Hasta 8:00 entra automáticamente. Más de 8:00 requiere aprobación."
                  : "Up to 8:00 enters automatically. Longer content requires approval."}
              </small>
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
                    ? "Se completa automáticamente cuando el proveedor lo permite."
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
                checked={explicitContent === false}
                name="explicitContent"
                onChange={() => setExplicitContent(false)}
                type="radio"
                value="no"
              />
              No
            </label>
            <label>
              <input
                checked={explicitContent === true}
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
              {allPlatforms.map((item) => (
                <button className={platform === item ? "active" : ""} disabled key={item} type="button">
                  {platform === item ? <Check size={14} /> : <PlatformIcon platform={item} size={14} />}
                  <span>
                    {item}
                    <small>{compactClassificationLabel(item)}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {duplicateCheckLoading && (
            <div className="duplicate-check-card checking" role="status">
              <LoaderCircle className="spin" size={17} />
              <span>
                <strong>
                  {locale === "es"
                    ? "Buscando duplicados"
                    : "Checking your song library"}
                </strong>
                {locale === "es"
                  ? "Estamos comparando el enlace y el título."
                  : "Comparing this link and title with your submissions."}
              </span>
            </div>
          )}

          {exactDuplicate && (
            <div className="duplicate-check-card exact" role="alert">
              <Flag size={18} />
              <span>
                <strong>
                  {locale === "es"
                    ? "Canción ya enviada"
                    : "Song already submitted"}
                </strong>
                {exactDuplicate.existing_title} /{" "}
                {exactDuplicate.catalog_status.replaceAll("_", " ")}
              </span>
              <Link
                href={
                  exactDuplicate.catalog_status === "removed"
                    ? "/profile#removed-song-history"
                    : `/profile#song-${exactDuplicate.song_id}`
                }
              >
                {locale === "es"
                  ? "Ver envio existente"
                  : "View existing submission"}
              </Link>
            </div>
          )}

          {!exactDuplicate && possibleDuplicates.length > 0 && (
            <div className="duplicate-check-card possible" role="alert">
              <Flag size={18} />
              <span>
                <strong>
                  {locale === "es"
                    ? "Posible duplicado detectado"
                    : "Possible duplicate detected"}
                </strong>
                {possibleDuplicates[0].existing_title} /{" "}
                {Math.round(
                  Number(possibleDuplicates[0].similarity_score) * 100,
                )}
                % title match
              </span>
              <Link href={`/profile#song-${possibleDuplicates[0].song_id}`}>
                {locale === "es"
                  ? "Ver envio existente"
                  : "View existing submission"}
              </Link>
              <button
                className={
                  duplicateWarningAccepted ? "accepted" : ""
                }
                onClick={() => setDuplicateWarningAccepted(true)}
                type="button"
              >
                {duplicateWarningAccepted ? (
                  <>
                    <Check size={14} />{" "}
                    {locale === "es" ? "Revisado" : "Reviewed"}
                  </>
                ) : locale === "es" ? (
                  "Continuar de todos modos"
                ) : (
                  "Continue anyway"
                )}
              </button>
            </div>
          )}

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
              <div><dt>Duplicate check</dt><dd>{duplicateCheckLoading ? "checking" : exactDuplicate ? "exact duplicate" : possibleDuplicates.length ? "possible duplicate" : "clear"}</dd></div>
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
                : `${copy.app.submit.submitFeedback} (${requiredTokenCost} ${requiredTokenCost === 1 ? "token" : "tokens"})`
              : copy.app.submit.locked}
            {unlocked ? <ArrowRight size={17} /> : <LockKeyhole size={16} />}
          </button>
        </form>
      </section>

      <aside className="submission-side">
        <ReviewProgress count={reviewCount} copy={copy} founderFree={founderFree} unlimited={unlimitedCredits} />
        <div className="expect-card">
          <span className="eyebrow">{locale === "es" ? "Qué sigue" : "What happens next"}</span>
          {[
            ["01", locale === "es" ? "Tu enlace entra a la cola de escucha." : "Your link enters the listening queue."],
            ["02", locale === "es" ? "Reviewers ven idioma, género y foco de feedback." : "Reviewers see the song language, genre, and feedback focus."],
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
  initialFounderSubmissionsRemaining: number;
  initialReviewCredits: number;
  initialTotalCreditsEarned: number;
  initialReviewQualityScore: number;
  initialListeningBank: ListeningBankStatus;
  initialSpotlightSongs: DiscoverySong[];
  initialTopTenSongs: DiscoverySong[];
  initialFollowedArtists: FollowedArtist[];
  initialPreviouslySupportedSongs: DiscoverySong[];
  initialTodaySupport: TodaySupportSummary;
  initialNotifications: CommunityNotification[];
  initialNotificationSummary: CommunityNotificationSummary;
  initialCommunityVisibility: "public" | "anonymous";
  initialAutoplayNextSong: boolean;
  initialExternalRedirectNoticeDisabled: boolean;
  contentEconomy: ContentEconomySetting[];
  initialDailyMission: DailyMissionStatus | null;
  initialCommunityPrograms: CommunityProgram[];
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
  initialFounderSubmissionsRemaining,
  initialReviewCredits,
  initialTotalCreditsEarned,
  initialReviewQualityScore,
  initialListeningBank,
  initialSpotlightSongs,
  initialTopTenSongs,
  initialFollowedArtists,
  initialPreviouslySupportedSongs,
  initialTodaySupport,
  initialNotifications,
  initialNotificationSummary,
  initialCommunityVisibility,
  initialAutoplayNextSong,
  initialExternalRedirectNoticeDisabled,
  contentEconomy,
  initialDailyMission,
  initialCommunityPrograms,
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
  const [listeningBank, setListeningBank] =
    useState<ListeningBankStatus>(initialListeningBank);
  const [todaySupport, setTodaySupport] =
    useState<TodaySupportSummary>(initialTodaySupport);
  const [notifications, setNotifications] =
    useState<CommunityNotification[]>(initialNotifications);
  const [notificationSummary, setNotificationSummary] =
    useState<CommunityNotificationSummary>(initialNotificationSummary);
  const [liveNotifications, setLiveNotifications] = useState<
    CommunityNotification[]
  >([]);
  const [communityVisibility] = useState(initialCommunityVisibility);
  const [autoPlayNextSong, setAutoPlayNextSong] = useState(
    initialAutoplayNextSong,
  );
  const [
    externalRedirectNoticeDisabled,
    setExternalRedirectNoticeDisabled,
  ] = useState(initialExternalRedirectNoticeDisabled);
  const [claimingReward, setClaimingReward] = useState(false);
  const [claimingMission, setClaimingMission] = useState(false);
  const [dailyMission, setDailyMission] =
    useState<DailyMissionStatus | null>(initialDailyMission);
  const [songSummaries, setSongSummaries] = useState(
    initialSongSummaries,
  );
  const [priorComments, setPriorComments] = useState<string[]>([]);
  const founder = initialFounder;
  const [founderSubmissionsRemaining, setFounderSubmissionsRemaining] =
    useState(initialFounderSubmissionsRemaining);
  const founderFree = founderSubmissionsRemaining > 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [languages] = useState<ListenerLanguage[]>(listenerLanguages);
  const [genres] = useState<Genre[]>(genrePreferences);
  const [queueSongs, setQueueSongs] = useState<Song[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);

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
      if (!active) return;
      if (!error && data) setQueueSongs(mapQueueRows(data));
      setQueueLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;

    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session?.access_token) {
        supabase.realtime.setAuth(data.session.access_token);
      }

      channel = supabase
        .channel(`community-notifications:${account.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "community_notifications",
            filter: `recipient_id=eq.${account.id}`,
          },
          async (payload) => {
            console.info(
              "[First Listen realtime] Community notification received",
              payload.new.id,
            );
            const { data: rows, error } = await supabase.rpc(
              "get_my_community_notifications",
              { notification_limit: 20 },
            );
            const mapped = mapNotificationRows(
              (rows ?? []) as Array<Record<string, unknown>>,
            );
            console.info(
              "[First Listen realtime] Community notifications refreshed",
              error?.message ?? "ok",
              mapped.length,
            );
            setNotifications(mapped);
            const newest = mapped[0];
            if (newest) {
              setLiveNotifications((current) => [
                newest,
                ...current.filter((item) => item.id !== newest.id),
              ].slice(0, 3));
              window.setTimeout(() => {
                setLiveNotifications((current) =>
                  current.filter((item) => item.id !== newest.id),
                );
              }, 6500);
            }
          },
        )
        .subscribe((status) => {
          console.info(
            "[First Listen realtime] Community notifications",
            status,
          );
        });
    });

    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [account.id]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const changeAutoPlayNextSong = async (enabled: boolean) => {
    setAutoPlayNextSong(enabled);
    const supabase = createClient();
    if (!supabase) return;
    const { error } = await supabase.rpc("update_community_preferences", {
      profile_community_visibility: communityVisibility,
      profile_autoplay_next_song: enabled,
    });
    if (error) {
      setAutoPlayNextSong((current) => !current);
      notify(error.message);
      return;
    }
    notify(
      enabled
        ? locale === "es"
          ? "Auto play activado."
          : "Auto play enabled."
        : locale === "es"
          ? "Auto play pausado."
          : "Auto play paused.",
    );
  };

  const changeExternalRedirectPreference = async (disabled: boolean) => {
    setExternalRedirectNoticeDisabled(disabled);
    const supabase = createClient();
    if (!supabase) return;
    const { error } = await supabase.rpc(
      "update_external_redirect_preference",
      { notice_disabled: disabled },
    );
    if (error) {
      setExternalRedirectNoticeDisabled(!disabled);
      notify(error.message);
    }
  };

  const followFromNotification = async (artistId: string) => {
    const supabase = createClient();
    if (!supabase) return;
    const { error } = await supabase.rpc("follow_artist", {
      target_artist_id: artistId,
    });
    notify(
      error
        ? error.message
        : locale === "es"
          ? "Artista seguido."
          : "Artist followed.",
    );
  };

  const dismissCommunitySummary = async () => {
    setNotificationSummary((current) => ({ ...current, unreadCount: 0 }));
    setNotifications((current) =>
      current.map((notification) => ({ ...notification, read: true })),
    );
    const supabase = createClient();
    if (supabase) await supabase.rpc("mark_community_notifications_read");
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
    listeningSessionId: string | null,
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

    const { data, error } = await supabase.rpc("submit_review_with_listening", {
      reviewed_song_id: songId,
      review_listen_full: form.listenFull,
      review_add_to_playlist: form.addPlaylist,
      review_grabbed_attention: form.grabbedAttention,
      review_share_with_friend: form.shareWithFriend,
      review_rating: form.rating,
      review_comment: form.comment.trim(),
      review_pasted_comment_detected: pastedWithoutEditing,
      listening_session_id: listeningSessionId,
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
    const bankedSeconds = Number(result.listening_seconds_banked ?? 0);
    const bankSeconds = Number(
      result.listening_bank_seconds ?? listeningBank.bankSeconds,
    );
    const exchangeSeconds = listeningBank.minutesPerCredit * 60;
    setListeningBank((current) => ({
      ...current,
      bankSeconds,
      pendingSeconds: 0,
      lifetimeSeconds: current.lifetimeSeconds + bankedSeconds,
      todaySeconds: current.todaySeconds + bankedSeconds,
      availableRewardCredits: Math.floor(bankSeconds / exchangeSeconds),
      secondsToNextCredit: secondsToNextReward(bankSeconds, exchangeSeconds),
    }));
    const { data: listeningStatusRows } = await supabase.rpc(
      "get_listening_bank_status_v2",
    );
    const listeningStatus = Array.isArray(listeningStatusRows)
      ? listeningStatusRows[0]
      : listeningStatusRows;
    if (listeningStatus) {
      setListeningBank({
        bankSeconds: Number(listeningStatus.bank_seconds ?? bankSeconds),
        pendingSeconds: Number(listeningStatus.pending_seconds ?? 0),
        lifetimeSeconds: Number(listeningStatus.lifetime_seconds ?? 0),
        todaySeconds: Number(listeningStatus.today_seconds ?? 0),
        weeklySeconds: Number(listeningStatus.weekly_seconds ?? 0),
        monthlySeconds: Number(listeningStatus.monthly_seconds ?? 0),
        availableRewardCredits: Number(
          listeningStatus.available_reward_credits ?? 0,
        ),
        secondsToNextCredit: Number(
          listeningStatus.seconds_to_next_credit ?? exchangeSeconds,
        ),
        minutesPerCredit: Number(
          listeningStatus.minutes_per_credit ??
            listeningBank.minutesPerCredit,
        ),
        dailyCapMinutes: Number(
          listeningStatus.daily_cap_minutes ?? listeningBank.dailyCapMinutes,
        ),
        levelNumber: Number(listeningStatus.level_number ?? 1),
        levelName: String(listeningStatus.level_name ?? "Explorer"),
        rewardsEnabled: Boolean(listeningStatus.rewards_enabled ?? true),
        communityPoints: Number(listeningStatus.community_points ?? 0),
        communityRank: String(
          listeningStatus.community_rank ?? "New Member",
        ),
        validListens: Number(listeningStatus.valid_listens ?? 0),
        completeListens: Number(listeningStatus.complete_listens ?? 0),
        todayValidListens: Number(
          listeningStatus.today_valid_listens ?? 0,
        ),
        todayCompleteListens: Number(
          listeningStatus.today_complete_listens ?? 0,
        ),
        todayAverageCompletionRate: Number(
          listeningStatus.today_average_completion_rate ?? 0,
        ),
      });
    }
    const { data: todaySupportRows } = await supabase.rpc(
      "get_today_support_summary",
    );
    const support = Array.isArray(todaySupportRows)
      ? todaySupportRows[0]
      : todaySupportRows;
    if (support) {
      setTodaySupport({
        songsReviewed: Number(support.songs_reviewed_today ?? 0),
        songsSupported: Number(support.songs_supported_today ?? 0),
        creatorsSupported: Number(support.creators_supported ?? 0),
        listeningSeconds: Number(support.listening_seconds_today ?? 0),
        communityRank: String(support.community_rank ?? "New Member"),
        validListens: Number(support.valid_listens_today ?? 0),
        completeListens: Number(support.complete_listens_today ?? 0),
        averageCompletionRate: Number(
          support.average_completion_rate ?? 0,
        ),
      });
    }
    const { data: currentProfile } = await supabase
      .from("profiles")
      .select("credits, total_review_credits_earned")
      .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "")
      .maybeSingle();
    if (currentProfile) {
      setReviewCount(Number(currentProfile.credits));
      setTotalCreditsEarned(Number(currentProfile.total_review_credits_earned));
    }
    const { data: missionStatusRows } = await supabase.rpc(
      "get_daily_mission_status",
    );
    const missionStatus = Array.isArray(missionStatusRows)
      ? missionStatusRows[0]
      : missionStatusRows;
    if (missionStatus) {
      setDailyMission({
        id: String(missionStatus.mission_id),
        key: String(missionStatus.mission_key),
        titleEn: String(missionStatus.title_en),
        titleEs: String(missionStatus.title_es),
        descriptionEn: String(missionStatus.description_en),
        descriptionEs: String(missionStatus.description_es),
        targetCount: Number(missionStatus.target_count),
        progressCount: Number(missionStatus.progress_count),
        rewardKind: missionStatus.reward_kind,
        rewardAmount: Number(missionStatus.reward_amount),
        completed: Boolean(missionStatus.completed),
        claimed: Boolean(missionStatus.claimed),
      });
    }

    setReviewQualityScores((current) => {
      return [...current, qualityScore];
    });
    setPriorComments((current) => {
      const next = [...current, form.comment.trim()].slice(-20);
      window.localStorage.setItem("first-listen-prior-comments", JSON.stringify(next));
      return next;
    });
    return {
      accepted: true,
      qualityScore,
      listeningSecondsBanked: bankedSeconds,
      listeningBankSeconds: bankSeconds,
      communityPointsAwarded: Number(
        result.community_points_awarded ?? 5,
      ),
      warning: result.warning,
    };
  };

  const handleListeningCredited = useCallback(
    (
      seconds: number,
      becameValid: boolean,
      becameComplete: boolean,
      completionRate: number,
    ) => {
      if (seconds <= 0 && !becameValid && !becameComplete) return;
      setListeningBank((current) => {
        const bankSeconds = current.bankSeconds + Math.max(0, seconds);
        const exchangeSeconds = current.minutesPerCredit * 60;
        return {
          ...current,
          bankSeconds,
          lifetimeSeconds: current.lifetimeSeconds + Math.max(0, seconds),
          todaySeconds: current.todaySeconds + Math.max(0, seconds),
          weeklySeconds: current.weeklySeconds + Math.max(0, seconds),
          monthlySeconds: current.monthlySeconds + Math.max(0, seconds),
          availableRewardCredits: Math.floor(
            bankSeconds / Math.max(1, exchangeSeconds),
          ),
          secondsToNextCredit: secondsToNextReward(
            bankSeconds,
            Math.max(1, exchangeSeconds),
          ),
          communityPoints:
            current.communityPoints + (becameValid ? 1 : 0),
          validListens: current.validListens + (becameValid ? 1 : 0),
          completeListens:
            current.completeListens + (becameComplete ? 1 : 0),
          todayValidListens:
            current.todayValidListens + (becameValid ? 1 : 0),
          todayCompleteListens:
            current.todayCompleteListens + (becameComplete ? 1 : 0),
          todayAverageCompletionRate: Math.max(
            current.todayAverageCompletionRate,
            completionRate,
          ),
        };
      });
      setTodaySupport((current) => ({
        ...current,
        listeningSeconds: current.listeningSeconds + Math.max(0, seconds),
        songsSupported:
          current.songsSupported + (becameValid ? 1 : 0),
        validListens: current.validListens + (becameValid ? 1 : 0),
        completeListens:
          current.completeListens + (becameComplete ? 1 : 0),
        averageCompletionRate: Math.max(
          current.averageCompletionRate,
          completionRate,
        ),
      }));
    },
    [],
  );

  const advanceReviewQueue = async (songId: string) => {
    const needsRefill = queueSongs.length <= 2;
    setQueueSongs((current) => current.filter((song) => song.id !== songId));
    if (!needsRefill) return;
    const supabase = createClient();
    if (!supabase) return;
    setQueueLoading(true);
    const { data } = await supabase.rpc("get_smart_review_queue", {
      queue_limit: 20,
    });
    if (data) setQueueSongs(mapQueueRows(data));
    setQueueLoading(false);
  };

  const claimListeningReward = async () => {
    const supabase = createClient();
    if (!supabase) {
      notify(
        locale === "es"
          ? "El servicio de recompensas no esta disponible. Actualiza la pagina."
          : "Reward service is unavailable. Please refresh and try again.",
      );
      return;
    }
    setClaimingReward(true);
    const { data, error } = await supabase.rpc("claim_listening_reward");
    setClaimingReward(false);
    const result = Array.isArray(data) ? data[0] : data;
    if (error || !result) {
      notify(
        error?.message ??
          (locale === "es"
            ? "No se pudo reclamar la recompensa."
            : "Listening reward could not be claimed."),
      );
      return;
    }
    const bankSeconds = Number(result.bank_seconds ?? 0);
    const exchangeSeconds = listeningBank.minutesPerCredit * 60;
    setReviewCount(Number(result.credits_balance ?? reviewCount + 1));
    setTotalCreditsEarned((current) => current + 1);
    setListeningBank((current) => ({
      ...current,
      bankSeconds,
      availableRewardCredits: Number(
        result.available_reward_credits ?? 0,
      ),
      secondsToNextCredit: secondsToNextReward(bankSeconds, exchangeSeconds),
    }));
    notify(
      locale === "es"
        ? "Recompensa reclamada. Se agregó un token a tu cuenta."
        : "Listening reward claimed. One token was added to your account.",
    );
  };

  const claimDailyMission = async () => {
    if (!dailyMission) return;
    const supabase = createClient();
    if (!supabase) return;
    setClaimingMission(true);
    const { data, error } = await supabase.rpc("claim_daily_mission_reward", {
      target_mission_id: dailyMission.id,
    });
    setClaimingMission(false);
    const result = Array.isArray(data) ? data[0] : data;
    if (error || !result) {
      notify(
        error?.message ??
          (locale === "es"
            ? "No se pudo reclamar la misión."
            : "Mission reward could not be claimed."),
      );
      return;
    }
    setDailyMission((current) =>
      current ? { ...current, claimed: true } : current,
    );
    setReviewCount(Number(result.credits_balance ?? reviewCount));
    const bankSeconds = Number(
      result.bank_seconds ?? listeningBank.bankSeconds,
    );
    const exchangeSeconds = listeningBank.minutesPerCredit * 60;
    setListeningBank((current) => ({
      ...current,
      bankSeconds,
      availableRewardCredits: Math.floor(bankSeconds / exchangeSeconds),
      secondsToNextCredit: secondsToNextReward(bankSeconds, exchangeSeconds),
    }));
    notify(
      locale === "es"
        ? "Recompensa de misión agregada."
        : "Daily mission reward added.",
    );
  };

  const requestSongBoost = async (songId: string) => {
    const supabase = createClient();
    if (!supabase) return;
    const { error } = await supabase.rpc("request_song_boost", {
      target_song_id: songId,
    });
    if (error) {
      notify(error.message);
      return;
    }
    setSongSummaries((current) =>
      current.map((summary) =>
        summary.id === songId
          ? { ...summary, boostStatus: "pending" }
          : summary,
      ),
    );
    notify(
      locale === "es"
          ? "Solicitud de boost enviada para aprobación."
        : "Boost request submitted for approval.",
    );
  };

  const handleSongSubmitted = async (
    usedFounderFree: boolean,
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
      song_content_kind: submission.contentKind,
      song_duration_seconds: submission.durationSeconds,
    });
    if (error) {
      notify(error.message);
      return false;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: updatedProfile } = await supabase
        .from("profiles")
        .select("credits, founder_free_submissions_remaining")
        .eq("id", user.id)
        .maybeSingle();
      if (updatedProfile) {
        setReviewCount(Number(updatedProfile.credits ?? 0));
        setFounderSubmissionsRemaining(
          Number(updatedProfile.founder_free_submissions_remaining ?? 0),
        );
      }
    } else if (usedFounderFree) {
      setFounderSubmissionsRemaining((current) => Math.max(0, current - 1));
    }
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
          listeningBank={listeningBank}
          claimingReward={claimingReward}
          onClaimReward={() => void claimListeningReward()}
          reviewCredits={reviewCount}
          reviewQualityScore={averageReviewQuality}
          setView={changeView}
          song={initialUserSong}
          songSummaries={songSummaries}
          songReviews={initialSongReviews}
          totalCreditsEarned={totalCreditsEarned}
          spotlightSongs={initialSpotlightSongs}
          topTenSongs={initialTopTenSongs}
          dailyMission={dailyMission}
          claimingMission={claimingMission}
          onClaimMission={() => void claimDailyMission()}
          communityPrograms={initialCommunityPrograms}
          onBoostSong={(songId) => void requestSongBoost(songId)}
          onListeningCredited={handleListeningCredited}
          externalRedirectNoticeDisabled={externalRedirectNoticeDisabled}
          onExternalRedirectPreferenceChange={(disabled) =>
            void changeExternalRedirectPreference(disabled)
          }
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
          contentEconomy={contentEconomy}
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
        approvedListeningSeconds={listeningBank.bankSeconds}
        onListeningCredited={handleListeningCredited}
        onAdvanceSong={advanceReviewQueue}
        queueLoading={queueLoading}
        spotlightSongs={initialSpotlightSongs}
        topTenSongs={initialTopTenSongs}
        followedArtists={initialFollowedArtists}
        previouslySupportedSongs={initialPreviouslySupportedSongs}
        todaySupport={todaySupport}
        listeningBank={listeningBank}
        autoPlayNextSong={autoPlayNextSong}
        onAutoPlayChange={(enabled) => void changeAutoPlayNextSong(enabled)}
        externalRedirectNoticeDisabled={externalRedirectNoticeDisabled}
        onExternalRedirectPreferenceChange={(disabled) =>
          void changeExternalRedirectPreference(disabled)
        }
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
        ownerAccess={role === "super_admin"}
        onAdmin={() => router.push("/admin")}
        onOwner={() => router.push("/owner")}
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
        <EconomyNotice locale={locale} settings={contentEconomy} />
        <OfflineCommunitySummary
          locale={locale}
          notifications={notifications}
          onDismiss={() => void dismissCommunitySummary()}
          onViewActivity={() => router.push("/profile#community-activity")}
          summary={notificationSummary}
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
            {role === "super_admin" && (
              <button onClick={() => router.push("/owner")}>
                <Gauge size={19} />
                Owner Control Center
              </button>
            )}
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
      <FloatingCommunityNotifications
        locale={locale}
        notifications={liveNotifications}
        onFollow={(artistId) => void followFromNotification(artistId)}
      />
    </div>
  );
}
