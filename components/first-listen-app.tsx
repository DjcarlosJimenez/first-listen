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
import { createPortal } from "react-dom";
import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LanguageSelector } from "@/components/language-selector";
import { PwaInstallButton } from "@/components/pwa-install-prompt";
import {
  ArtistNameLink,
  ArtistProfileButton,
} from "@/components/artist-profile-link";
import { CommunityPulse } from "@/components/community-pulse";
import { Logo } from "@/components/logo";
import {
  ProviderPlayer,
  type ProviderTelemetrySnapshot,
} from "@/components/provider-player";
import {
  ProfilePanel,
  type ProfilePanelProps,
} from "@/components/profile-panel";
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
import {
  getDiscoveryLinks,
  getPrimaryPlatformLinks,
  sortPlatformLinks,
} from "@/lib/discovery";
import {
  allPlatforms,
  compactClassificationLabel,
  contentClassificationLabel,
  databasePlatform,
  economySettingFor,
  isPrimaryPlatform,
  isExternalPlatform,
  primaryPlatforms,
  submissionTokenCost,
} from "@/lib/content-economy";
import { safeCoverUrl } from "@/lib/media";
import { discoveryGenreSlug } from "@/lib/discovery-routing";
import { describeMatch, prioritizeReviewQueue } from "@/lib/matching";
import { detectMusicPlatform } from "@/lib/platform";
import { getProviderEmbed } from "@/lib/player";
import { evaluateReviewQuality } from "@/lib/review-quality";
import { createClient } from "@/lib/supabase/client";
import {
  dismissYoutubeMusicDiscovery,
  shouldShowYoutubeMusicDiscoveryRecommendation,
} from "@/lib/youtube-music-discovery";
import {
  defaultPlatformControlConfig,
  type DiscoveryHubSectionKey,
  type PlatformControlConfig,
} from "@/lib/platform-control";
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
  PrimaryPlatform,
  Review,
  Song,
  SongPlatformLink,
  SongDashboardSummary,
  TodaySupportSummary,
} from "@/lib/types";

export type View = "review" | "dashboard" | "profile" | "submit";
export type DiscoveryDestination =
  | { type: "genres" }
  | { slug: string; type: "genre" };
type WorkspaceQueueMode =
  | "review"
  | "discovery"
  | "genre"
  | "random"
  | "top10";
type WorkspacePanel =
  | { type: View }
  | { destination: DiscoveryDestination; type: "discover" };
type WorkspacePlayableSong = {
  artist: string;
  artistId?: string;
  coverUrl: string;
  id: string;
  link: string;
  platform: Platform;
  title: string;
};
type WorkspaceActiveQueue = {
  currentIndex: number;
  id: string;
  mode: WorkspaceQueueMode;
  songs: WorkspacePlayableSong[];
  title: string;
  total: number;
};
type WorkspacePlaybackContext = {
  label: string;
  mode: WorkspaceQueueMode;
  panel: WorkspacePanel;
  source: "review" | "discovery";
};
type WorkspacePlaybackControls = {
  autoPlayEnabled?: boolean;
  nextEnabled?: boolean;
  onAutoPlayChange?: (enabled: boolean) => void;
  onNext?: () => void;
};
type WorkspacePlaybackRequest = {
  autoPlay?: boolean;
  context: WorkspacePlaybackContext;
  controls?: WorkspacePlaybackControls;
  onReady?: () => void;
  onTelemetry?: (snapshot: ProviderTelemetrySnapshot) => void;
  queue?: WorkspaceActiveQueue | null;
  slotId: string;
  song: WorkspacePlayableSong;
  songLoadedAt?: string | null;
};
type WorkspacePlaybackController = {
  activeControlChannel: string | null;
  activeContext: WorkspacePlaybackContext | null;
  activeControls: WorkspacePlaybackControls | null;
  activeQueue: WorkspaceActiveQueue | null;
  activeSong: WorkspacePlayableSong | null;
  activeTelemetry: ProviderTelemetrySnapshot | null;
  activeWorkspacePanel: WorkspacePanel;
  queueMode: WorkspaceQueueMode;
  registerPlaybackSlot: (
    slotId: string,
    element: HTMLDivElement | null,
  ) => void;
  requestPlayback: (request: WorkspacePlaybackRequest) => void;
  stopPlayback: (slotId?: string) => void;
};
type BinaryAnswer = boolean | null;
type Copy = ReturnType<typeof getCopy>;

function workspacePanelForRoute(
  view: View,
  discoveryDestination?: DiscoveryDestination,
): WorkspacePanel {
  if (discoveryDestination) {
    return { destination: discoveryDestination, type: "discover" };
  }
  return { type: view };
}

function workspacePathForView(view: View) {
  return view === "dashboard" ? "/dashboard" : `/${view}`;
}

function workspacePathForDiscoveryDestination(
  destination?: DiscoveryDestination,
) {
  if (!destination) return "/dashboard";
  if (destination.type === "genres") return "/discover/genres";
  return `/discover/genre/${encodeURIComponent(destination.slug)}`;
}

function workspaceRouteFromPath(pathname: string):
  | { destination?: DiscoveryDestination; view: View }
  | null {
  if (pathname === "/review") return { view: "review" };
  if (pathname === "/dashboard") return { view: "dashboard" };
  if (pathname === "/profile") return { view: "profile" };
  if (pathname === "/submit") return { view: "submit" };
  if (pathname === "/discover/genres") {
    return { destination: { type: "genres" }, view: "dashboard" };
  }
  const genreMatch = pathname.match(/^\/discover\/genre\/([^/]+)$/);
  if (genreMatch) {
    return {
      destination: {
        slug: decodeURIComponent(genreMatch[1]),
        type: "genre",
      },
      view: "dashboard",
    };
  }
  return null;
}

type RewardClaimFeedback = {
  awarded: number;
  beforeCredits: number;
  afterCredits: number;
  claimedAt: number;
};

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

type PlatformLinkRow = {
  platform?: string;
  music_url?: string;
  is_primary?: boolean;
  resolution_source?: string;
  confidence_score?: number;
};

type PlatformPresenceResult = {
  platform?: string;
  music_url?: string;
  platform_links?: PlatformLinkRow[];
};

type PlatformManagedSong = Pick<
  Song,
  "id" | "link" | "platform" | "platformLinks" | "title"
>;

function mergePlatformLink(
  links: SongPlatformLink[] | undefined,
  nextLink: SongPlatformLink,
) {
  return sortPlatformLinks([
    ...(links ?? []).filter((link) => link.platform !== nextLink.platform),
    nextLink,
  ]);
}

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
  platform: PrimaryPlatform;
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
  return data.map((row) => {
    const platform =
      allPlatforms.find(
        (item) => databasePlatform[item] === String(row.platform),
      ) ?? "Spotify";
    return {
      id: String(row.song_id),
      artistId: String(row.artist_id),
      title: String(row.title),
      artist: String(row.artist_name),
      coverUrl: safeCoverUrl(String(row.cover_image_url)),
      link: String(row.music_url),
      platform,
      platformLinks: mapSongPlatformLinks(
        row.platform_links,
        platform,
        String(row.music_url),
      ),
      recommendedPlatform:
        allPlatforms.find(
          (item) =>
            databasePlatform[item] === String(row.recommended_platform),
        ) ?? platform,
      genre: String(row.genre) as Genre,
      language: String(row.song_language) as SongLanguage,
      feedbackFocus: (row.feedback_focus ?? []) as FeedbackFocus[],
      explicitContent: Boolean(row.explicit_content),
      country: String(row.country),
      submittedAt: String(row.submitted_at),
      accent: "#c8ff4f",
    };
  });
}

function mapSongPlatformLinks(
  value: unknown,
  fallbackPlatform: Platform,
  fallbackUrl: string,
): SongPlatformLink[] {
  const rows = Array.isArray(value) ? (value as PlatformLinkRow[]) : [];
  if (!rows.length) {
    return [
      {
        platform: fallbackPlatform,
        url: fallbackUrl,
        primary: true,
        resolutionSource: "submitted",
        confidenceScore: 100,
      },
    ];
  }
  return rows
    .map((link) => {
      const platform =
        allPlatforms.find(
          (item) => databasePlatform[item] === String(link.platform),
        ) ?? fallbackPlatform;
      return {
        platform,
        url: String(link.music_url ?? fallbackUrl),
        primary: Boolean(link.is_primary),
        resolutionSource:
          link.resolution_source === "manual" ||
          link.resolution_source === "inferred" ||
          link.resolution_source === "verified"
            ? link.resolution_source
            : "submitted",
        confidenceScore: Number(link.confidence_score ?? 100),
      } satisfies SongPlatformLink;
    })
    .filter((link) => link.url.trim().length > 0);
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
    { id: "dashboard", label: copy.app.nav.dashboard, icon: Sparkles },
    { id: "submit", label: copy.app.nav.submit, icon: Plus },
    { id: "profile", label: copy.app.topbar.profileTitle, icon: UserRound },
  ];
}

function shortMobileLabel(locale: InterfaceLocale, view: View) {
  if (view === "review") return locale === "es" ? "Review" : "Review";
  if (view === "submit") return locale === "es" ? "Enviar" : "Submit";
  if (view === "profile") return locale === "es" ? "Perfil" : "Profile";
  return locale === "es" ? "Descubrir" : "Discover";
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
  if (platform === "Amazon Music") return "Usa un enlace público de Amazon Music.";
  if (platform === "Deezer") return "Usa un enlace público de Deezer.";
  if (platform === "Facebook Video") return "Usa un enlace público de Facebook Video.";
  if (platform === "Instagram") return "Usa un enlace público de Instagram.";
  if (platform === "Other") return "Usa un enlace público https://.";
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
  if (platform === "Amazon Music" || platform === "Deezer") {
    return <Radio size={size} />;
  }
  if (platform === "Facebook Video" || platform === "Instagram") {
    return <Clapperboard size={size} />;
  }
  return <Music2 size={size} />;
}

function platformPresenceIconSize() {
  if (typeof document === "undefined") return 14;
  const size = document.documentElement.dataset.platformPresenceIconSize;
  if (size === "large") return 18;
  if (size === "standard") return 16;
  return 14;
}

function sortPlatformPresenceLinks(links: SongPlatformLink[]) {
  if (typeof document === "undefined") return sortPlatformLinks(links);
  const order = document.documentElement.dataset.platformPresenceOrder
    ?.split(",")
    .filter(Boolean);
  if (!order?.length) return sortPlatformLinks(links);
  return [...links].sort((left, right) => {
    const leftIndex = order.indexOf(databasePlatform[left.platform]);
    const rightIndex = order.indexOf(databasePlatform[right.platform]);
    return (
      (leftIndex === -1 ? 99 : leftIndex) -
        (rightIndex === -1 ? 99 : rightIndex) ||
      Number(right.primary) - Number(left.primary) ||
      right.confidenceScore - left.confidenceScore
    );
  });
}

function PlatformPresenceIconRow({
  links,
  songId,
}: {
  links: SongPlatformLink[];
  songId: string;
}) {
  const iconSize = platformPresenceIconSize();
  return (
    <div className="platform-presence-row">
      {sortPlatformPresenceLinks(links).map((link) => (
        <a
          aria-label={`Open ${link.platform}`}
          data-ui-component="openPlatformButton"
          href={link.url}
          key={`${songId}-presence-${link.platform}`}
          rel="noreferrer"
          target="_blank"
          title={link.platform}
        >
          <PlatformIcon platform={link.platform} size={iconSize} />
          <span className="sr-only">{link.platform}</span>
        </a>
      ))}
    </div>
  );
}

function ProviderClassificationBadge({
  platform,
  locale,
  compact = false,
}: {
  platform: Platform;
  locale: InterfaceLocale;
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
        ? compactClassificationLabel(platform, locale)
        : contentClassificationLabel(platform, locale)}
    </span>
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
              : "Save listening time and claim tokens manually."}
      </p>
    </div>
  );
}

function WorkspacePlaybackSlot({
  className,
  controller,
  slotId,
}: {
  className?: string;
  controller: WorkspacePlaybackController;
  slotId: string;
}) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const { registerPlaybackSlot } = controller;

  useEffect(() => {
    registerPlaybackSlot(slotId, slotRef.current);
    return () => registerPlaybackSlot(slotId, null);
  }, [registerPlaybackSlot, slotId]);

  return (
    <div
      className={className}
      data-workspace-player-slot={slotId}
      ref={slotRef}
    />
  );
}

function WorkspacePlayerHost({
  externalRedirectNoticeDisabled,
  locale,
  onExternalRedirectPreferenceChange,
  onPlaybackTelemetry,
  playback,
  slotElement,
}: {
  externalRedirectNoticeDisabled: boolean;
  locale: InterfaceLocale;
  onExternalRedirectPreferenceChange: (disabled: boolean) => void;
  onPlaybackTelemetry: (snapshot: ProviderTelemetrySnapshot) => void;
  playback: WorkspacePlaybackRequest | null;
  slotElement: HTMLDivElement | null;
}) {
  const parkingRef = useRef<HTMLDivElement | null>(null);
  const [hostElement, setHostElement] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = document.createElement("div");
    element.className = "workspace-player-host";
    setHostElement(element);
    return () => {
      element.remove();
      setHostElement(null);
    };
  }, []);

  useEffect(() => {
    if (!hostElement) return;
    const target = slotElement ?? parkingRef.current;
    if (target && hostElement.parentElement !== target) {
      target.appendChild(hostElement);
    }
  }, [hostElement, slotElement]);

  return (
    <>
      <div
        aria-hidden="true"
        className="workspace-player-parking"
        ref={parkingRef}
      />
      {playback && hostElement
        ? createPortal(
            <ProviderPlayer
              key={playback.context.source}
              artist={playback.song.artist}
              autoPlay={playback.autoPlay ?? false}
              coverUrl={playback.song.coverUrl}
              link={playback.song.link}
              locale={locale}
              onReady={playback.onReady}
              onTelemetry={(snapshot) => {
                onPlaybackTelemetry(snapshot);
                playback.onTelemetry?.(snapshot);
              }}
              platform={playback.song.platform}
              songLoadedAt={playback.songLoadedAt ?? null}
              title={playback.song.title}
              controlChannel={playback.slotId}
              skipExternalRedirectWarning={externalRedirectNoticeDisabled}
              onExternalRedirectPreferenceChange={
                onExternalRedirectPreferenceChange
              }
            />,
            hostElement,
          )
        : null}
    </>
  );
}

function workspacePlaybackStateLabel(
  state: ProviderTelemetrySnapshot["playbackState"] | null | undefined,
  locale: InterfaceLocale,
  activeSong: WorkspacePlayableSong | null,
) {
  const spanish = locale === "es";
  if (!activeSong) return spanish ? "Lista" : "Ready";
  if (state === "playing") return spanish ? "Reproduciendo" : "Playing";
  if (state === "paused") return spanish ? "Pausado" : "Paused";
  if (state === "ended") return spanish ? "Completada" : "Completed";
  if (state === "buffering" || state === "unknown") {
    return spanish ? "Cargando" : "Loading";
  }
  if (state === "cued" || state === "unstarted") {
    return spanish ? "Lista para reproducir" : "Ready to play";
  }
  return spanish ? "Cargando" : "Loading";
}

function WorkspaceShellTop({
  controller,
  status,
  todaySupport,
  credits,
  unlimitedCredits,
  claimingReward,
  rewardClaimFeedback,
  onClaimReward,
  locale,
}: {
  controller: WorkspacePlaybackController;
  status: ListeningBankStatus;
  todaySupport: TodaySupportSummary;
  credits: number;
  unlimitedCredits: boolean;
  claimingReward: boolean;
  rewardClaimFeedback: RewardClaimFeedback | null;
  onClaimReward: () => void;
  locale: InterfaceLocale;
}) {
  const spanish = locale === "es";
  const activeSong = controller.activeSong;
  const activeContext = controller.activeContext;
  const activeControls = controller.activeControls;
  const activeQueue = controller.activeQueue;
  const activeTelemetry = controller.activeTelemetry;
  const telemetryCurrentSeconds =
    activeSong && activeTelemetry
      ? Math.max(0, activeTelemetry.currentTime)
      : 0;
  const telemetryDurationSeconds =
    activeSong && activeTelemetry
      ? Math.max(0, activeTelemetry.duration)
      : 0;
  const playbackIsActive = activeTelemetry?.playbackState === "playing";
  const liveSessionSeconds =
    activeSong && playbackIsActive ? telemetryCurrentSeconds : 0;
  const visibleBankSeconds = status.bankSeconds + liveSessionSeconds;
  const exchangeSeconds = Math.max(1, status.minutesPerCredit * 60);
  const ready = status.rewardsEnabled && status.availableRewardCredits > 0;
  const progressSeconds = ready
    ? exchangeSeconds
    : visibleBankSeconds % exchangeSeconds;
  const progress = Math.min(
    100,
    Math.round((progressSeconds / exchangeSeconds) * 100),
  );
  const timePlayedToday = Math.max(
    todaySupport.listeningSeconds,
    status.todaySeconds,
  );
  const visiblePlayedSeconds = timePlayedToday + liveSessionSeconds;
  const currentProgressLabel =
    telemetryDurationSeconds > 0
      ? `${formatClock(telemetryCurrentSeconds)} / ${formatClock(
          telemetryDurationSeconds,
        )}`
      : formatClock(telemetryCurrentSeconds);
  const queuePosition = activeQueue
    ? `${activeQueue.currentIndex + 1}/${activeQueue.total}`
    : activeSong
      ? "1/1"
      : "-";
  const remainingSongs = activeQueue
    ? Math.max(0, activeQueue.total - activeQueue.currentIndex - 1)
    : 0;
  const playbackState = workspacePlaybackStateLabel(
    activeTelemetry?.playbackState,
    locale,
    activeSong,
  );
  const nextEnabled = Boolean(
    activeControls?.onNext && activeControls.nextEnabled !== false,
  );
  const sendPlaybackCommand = (command: "pause" | "play") => {
    if (!controller.activeControlChannel) return;
    window.dispatchEvent(
      new CustomEvent("first-listen:playback-command", {
        detail: {
          channel: controller.activeControlChannel,
          command,
        },
      }),
    );
  };

  return (
    <section
      aria-label={
        spanish ? "Reproductor de First Listen" : "First Listen workspace player"
      }
      className={
        activeTelemetry?.playbackState === "playing"
          ? "workspace-top-area playing"
          : "workspace-top-area"
      }
    >
      <div className="workspace-player-panel">
        <div className="workspace-player-copy">
          <span className="eyebrow">
            <Radio size={13} />{" "}
            {spanish ? "Reproductor persistente" : "Persistent player"}
          </span>
          <strong>
            {activeSong
              ? activeSong.title
              : spanish
                ? "Elige una cancion para empezar"
                : "Choose a song to start"}
          </strong>
          <small>
            {activeSong
              ? `${activeSong.artist} / ${
                  activeContext?.label ?? activeSong.platform
                }`
              : spanish
                ? "El reproductor se mantiene activo al cambiar de seccion."
                : "The player stays active while you switch sections."}
          </small>
        </div>
        <div
          className={
            activeSong
              ? "workspace-persistent-player-slot"
              : "workspace-persistent-player-slot empty"
          }
        >
          <WorkspacePlaybackSlot
            controller={controller}
            slotId="workspace:persistent"
          />
          {!activeSong && (
            <div className="workspace-player-empty-state">
              <Play size={22} />
              <span>
                {spanish ? "Listo para descubrir musica" : "Ready to discover music"}
              </span>
            </div>
          )}
        </div>
        <div className="workspace-playback-controls" aria-live="polite">
          <div className="workspace-playback-buttons">
            <button
              disabled={!activeSong}
              onClick={() => sendPlaybackCommand("play")}
              type="button"
            >
              <Play size={14} fill="currentColor" />
              {spanish ? "Play" : "Play"}
            </button>
            <button
              disabled={!activeSong}
              onClick={() => sendPlaybackCommand("pause")}
              type="button"
            >
              <Pause size={14} />
              {spanish ? "Pausa" : "Pause"}
            </button>
            <button
              disabled={!nextEnabled}
              onClick={() => activeControls?.onNext?.()}
              type="button"
            >
              <SkipForward size={14} />
              {spanish ? "Siguiente canción" : "Next Song"}
            </button>
            <button
              className={activeControls?.autoPlayEnabled ? "active" : ""}
              disabled={!activeControls?.onAutoPlayChange}
              onClick={() =>
                activeControls?.onAutoPlayChange?.(
                  !activeControls.autoPlayEnabled,
                )
              }
              type="button"
            >
              {activeControls?.autoPlayEnabled ? (
                <Pause size={14} />
              ) : (
                <Play size={14} />
              )}
              AutoPlay
            </button>
          </div>
          <div className="workspace-queue-strip">
            <span>
              <ListMusic size={13} />
              {activeContext?.label ??
                (spanish ? "Cola pendiente" : "Pending queue")}
            </span>
            <strong>{queuePosition}</strong>
            <small>
              {remainingSongs}{" "}
              {spanish ? "canciones restantes" : "songs remaining"}
            </small>
            <small>
              {spanish ? "Estado" : "State"}: {playbackState}
            </small>
          </div>
        </div>
      </div>

      <div className="workspace-status-bars">
        <div className="workspace-session-status-bar" aria-live="polite">
          <div>
            <span>
              <CheckCircle2 size={13} />{" "}
              {spanish ? "Sesion verificada" : "Verified Session"}
            </span>
            <strong>
              {playbackState}
            </strong>
          </div>
          <div className="workspace-live-counter">
            <span>
              <Radio size={13} /> {spanish ? "Tiempo en vivo" : "Time Live"}
            </span>
            <strong>{formatClock(liveSessionSeconds)}</strong>
          </div>
          <div>
            <span>
              <Headphones size={13} />{" "}
              {spanish ? "Tiempo reproducido" : "Time Played"}
            </span>
            <strong>{formatClock(visiblePlayedSeconds)}</strong>
          </div>
          <div className="workspace-progress-counter">
            <span>
              <Clock3 size={13} />{" "}
              {spanish ? "Progreso actual" : "Current Progress"}
            </span>
            <strong>{currentProgressLabel}</strong>
          </div>
          <div>
            <span>
              <Clock3 size={13} /> {spanish ? "Banco de Tiempo" : "Time Bank"}
            </span>
            <strong>{formatPreciseMinutes(visibleBankSeconds)}</strong>
          </div>
          <div>
            <span>
              <Sparkles size={13} />{" "}
              {spanish ? "Tokens de Envio" : "Submission Tokens"}
            </span>
            <strong>
              {unlimitedCredits ? (spanish ? "Ilimitados" : "Unlimited") : credits}
            </strong>
          </div>
        </div>

        <div
          className={
            ready
              ? "workspace-reward-status-bar ready"
              : "workspace-reward-status-bar"
          }
        >
          <div className="workspace-reward-copy">
            <span>
              <Target size={13} />{" "}
              {spanish ? "Progreso de recompensa" : "Reward Progress"}
            </span>
            <strong>
              {ready
                ? spanish
                  ? "Token listo para reclamar"
                  : "Token ready to claim"
                : `${Math.ceil(status.secondsToNextCredit / 60)} ${
                    spanish ? "min restantes" : "min remaining"
                  }`}
            </strong>
          </div>
          <div className="workspace-reward-meter">
            <div
              aria-label={`${progress}% toward the next token`}
              className="progress-track"
            >
              <i style={{ width: `${progress}%` }} />
            </div>
            <small>
              {spanish ? "Recompensas disponibles" : "Available Rewards"}:{" "}
              <b>{status.availableRewardCredits}</b> /{" "}
              {formatPreciseMinutes(visibleBankSeconds)} /{" "}
              {unlimitedCredits
                ? spanish
                  ? "Tokens ilimitados"
                  : "Unlimited tokens"
                : `${credits} tokens`}
            </small>
          </div>
          <button
            disabled={claimingReward || !ready}
            onClick={onClaimReward}
            type="button"
          >
            {claimingReward
              ? spanish
                ? "Reclamando..."
                : "Claiming..."
              : spanish
                ? "Reclamar token"
                : "Claim token"}
          </button>
          {rewardClaimFeedback && (
            <small className="workspace-reward-feedback">
              +{rewardClaimFeedback.awarded}{" "}
              {spanish ? "token otorgado" : "token awarded"}:{" "}
              {rewardClaimFeedback.beforeCredits} -&gt;{" "}
              {rewardClaimFeedback.afterCredits}
            </small>
          )}
        </div>
      </div>
    </section>
  );
}

function Sidebar({
  view,
  setView,
  reviewCount,
  founder,
  founderFree,
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
      </div>
    </aside>
  );
}

function Topbar({
  view,
  onMenu,
  onLogout,
  onHelp,
  onProfile,
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
  onProfile: () => void;
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
    profile: {
      title: copy.app.topbar.profileTitle,
      subtitle: copy.app.topbar.profileSubtitle,
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
        <button
          className="topbar-profile-link"
          data-ui-component="headerProfileShortcut"
          onClick={onProfile}
          type="button"
        >
          <UserRound size={15} />
          <span>{locale === "es" ? "Mi Perfil" : "My Profile"}</span>
        </button>
        <PwaInstallButton compact locale={locale} />
        <span className="app-status-pill">{copy.common.publicBeta}</span>
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
  const resolvedLinks = getPrimaryPlatformLinks(song);
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
        <button
          data-ui-component="playNowButton"
          onClick={onContinueListening}
          type="button"
        >
          <Play size={14} /> {spanish ? "Continuar escuchando" : "Continue Listening"}
        </button>
        <button
          className="primary-button"
          data-ui-component="nextSongButton"
          onClick={onNextSong}
          type="button"
        >
          <ArrowRight size={14} /> {spanish ? "Siguiente canción" : "Next Song"}
        </button>
      </div>
      {validListenRecorded && (
        <strong className="valid-listen-confirmation">
          <CheckCircle2 size={15} />
          {spanish ? "Reproducción que suma registrada" : "Play counted"}
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
      {validListenRecorded && resolvedLinks.length > 1 && (
        <section className="platform-recommendation-card">
          <span className="eyebrow">
            <Globe2 size={13} />
            {spanish ? "Disponible en:" : "Available On:"}
          </span>
          <p>
            {spanish
              ? "Enlaces agregados por el artista. No crean sesiones de reproducción adicionales."
              : "Artist-added destinations. They do not create extra playback sessions."}
          </p>
          <PlatformPresenceIconRow links={resolvedLinks} songId={song.id} />
        </section>
      )}
      <div className="discovery-links">
        <a
          data-ui-component="openPlatformButton"
          href={links.spotify}
          rel="noreferrer"
          target="_blank"
        >
          <Disc3 size={15} />{" "}
          {spanish ? "Escuchar completa en Spotify" : "Listen Full Song on Spotify"}
        </a>
        <a
          data-ui-component="openPlatformButton"
          href={links.youtube}
          rel="noreferrer"
          target="_blank"
        >
          <Youtube size={15} />{" "}
          {spanish ? "Escuchar completa en YouTube" : "Listen Full Song on YouTube"}
        </a>
        <a
          data-ui-component="openPlatformButton"
          href={links.apple}
          rel="noreferrer"
          target="_blank"
        >
          <Radio size={15} />{" "}
          {spanish ? "Escuchar completa en Apple Music" : "Listen Full Song on Apple Music"}
        </a>
      </div>
      <div className="discovery-actions">
        <button
          data-artist-follow-button
          data-ui-component="followButton"
          disabled={following || !song.artistId}
          onClick={followArtist}
          type="button"
        >
          <UserPlus size={14} />{" "}
          {following
            ? spanish
              ? "Siguiendo"
              : "Following"
            : spanish
              ? "Seguir artista"
              : "Follow Artist"}
        </button>
        <button
          data-ui-component="saveButton"
          disabled={saved}
          onClick={saveForLater}
          type="button"
        >
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
        <ArtistProfileButton
          artistId={song.artistId}
          artistName={song.artist}
          className="artist-profile-link-button post-review-artist-profile"
          locale={locale}
        />
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
                <Link
                  data-artist-profile-button
                  data-ui-component="artistProfileButton"
                  href={`/artists/${notification.actorId}`}
                >
                  {locale === "es" ? "Ver artista" : "View Artist"}
                </Link>
                <button
                  data-artist-follow-button
                  data-ui-component="followButton"
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
          🎁 <strong>{summary.validListensCount}</strong>{" "}
          {spanish
            ? summary.validListensCount === 1
              ? "token listo para reclamar"
              : "tokens listos para reclamar"
            : summary.validListensCount === 1
              ? "token ready to claim"
              : "tokens ready to claim"}
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
  externalDiscoverySongs,
  followedArtists,
  previouslySupportedSongs,
  todaySupport,
  locale,
  onSubmit,
}: {
  spotlightSongs: DiscoverySong[];
  topTenSongs: DiscoverySong[];
  externalDiscoverySongs: DiscoverySong[];
  followedArtists: FollowedArtist[];
  previouslySupportedSongs: DiscoverySong[];
  todaySupport: TodaySupportSummary;
  locale: InterfaceLocale;
  onSubmit: () => void;
}) {
  const spanish = locale === "es";
  const featuredArtists = Array.from(
    new Map(
      [...spotlightSongs, ...topTenSongs, ...externalDiscoverySongs].map((song) => [
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
        <div><strong>{formatDuration(todaySupport.listeningSeconds)}</strong><span>{spanish ? "Tiempo reproducido ganado" : "Play Time Earned"}</span></div>
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
          <div><strong>{todaySupport.validListens}</strong><span>{spanish ? "Reproducciones que suman" : "Plays that count"}</span></div>
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
              <Link data-artist-name-link href={`/artists/${artist.id}`} key={artist.id}>
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
              <Link data-artist-name-link href={`/artists/${artist.id}`} key={artist.id}>
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
            <article key={song.id}>
              <a href={song.link} rel="noreferrer" target="_blank">
                <Image alt="" height={64} src={song.coverUrl} unoptimized width={64} />
                <span><strong>{song.title}</strong><small>{song.artist} / Hook {song.hookScore}</small></span>
                <ExternalLink size={14} />
              </a>
              <ArtistProfileButton
                artistId={song.artistId}
                artistName={song.artist}
                compact
                locale={locale}
              />
            </article>
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
            <article key={song.id}>
              <a href={song.link} rel="noreferrer" target="_blank">
                <Image alt="" height={64} src={song.coverUrl} unoptimized width={64} />
                <span><strong>{song.title}</strong><small>{song.artist} / {song.platform}</small></span>
                <ExternalLink size={14} />
              </a>
              <ArtistProfileButton
                artistId={song.artistId}
                artistName={song.artist}
                compact
                locale={locale}
              />
            </article>
          ))}
          {!previouslySupportedSongs.length && <p className="discovery-empty">{spanish ? "Tus canciones apoyadas aparecerán aquí." : "Songs you support will appear here."}</p>}
        </div>
      </section>
    </main>
  );
}

function ReviewView({
  reviewCount,
  reviewCredits,
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
  externalDiscoverySongs,
  followedArtists,
  previouslySupportedSongs,
  todaySupport,
  listeningBank,
  claimingReward,
  onClaimReward,
  rewardClaimFeedback,
  autoPlayNextSong,
  onAutoPlayChange,
  platformConfig,
  onNavigateDiscoveryDestination,
  workspacePlayback,
  showCommunityDiscovery = true,
}: {
  reviewCount: number;
  reviewCredits: number;
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
  externalDiscoverySongs: DiscoverySong[];
  followedArtists: FollowedArtist[];
  previouslySupportedSongs: DiscoverySong[];
  todaySupport: TodaySupportSummary;
  listeningBank: ListeningBankStatus;
  claimingReward: boolean;
  onClaimReward: () => void;
  rewardClaimFeedback: RewardClaimFeedback | null;
  autoPlayNextSong: boolean;
  onAutoPlayChange: (enabled: boolean) => void;
  platformConfig: PlatformControlConfig;
  onNavigateDiscoveryDestination: (
    destination?: DiscoveryDestination,
  ) => void;
  workspacePlayback: WorkspacePlaybackController;
  showCommunityDiscovery?: boolean;
}) {
  const { requestPlayback } = workspacePlayback;
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
  const reviewPlayerSlotId = song ? `review:${song.id}` : "review:empty";
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
  const playerColumnRef = useRef<HTMLDivElement | null>(null);
  const advanceToNextSongRef = useRef<
    ((continuePlayback?: boolean) => Promise<void>) | null
  >(null);

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
          warning: error?.message ?? (locale === "es" ? "No pudimos actualizar el tiempo de escucha." : "We could not update listening time."),
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

  useEffect(() => {
    if (!song) return;
    requestPlayback({
      autoPlay: autoPlayCurrentSong,
      context: {
        label: locale === "es" ? "Escuchar y apoyar artistas" : "Review Songs",
        mode: "review",
        panel: { type: "review" },
        source: "review",
      },
      controls: {
        autoPlayEnabled: autoPlayNextSong,
        nextEnabled: true,
        onAutoPlayChange,
        onNext: () =>
          void advanceToNextSongRef.current?.(autoPlayNextSong),
      },
      onTelemetry: handleListeningTelemetry,
      queue: {
        currentIndex: queueIndex,
        id: "review",
        mode: "review",
        songs: matchedQueue,
        title: locale === "es" ? "Lista de canciones por escuchar" : "Review queue",
        total: matchedQueue.length,
      },
      slotId: reviewPlayerSlotId,
      song,
      songLoadedAt,
    });
  }, [
    autoPlayCurrentSong,
    autoPlayNextSong,
    handleListeningTelemetry,
    locale,
    matchedQueue,
    onAutoPlayChange,
    reviewPlayerSlotId,
    song,
    songLoadedAt,
    requestPlayback,
  ]);

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
    advanceToNextSongRef.current = advanceToNextSong;
  }, [advanceToNextSong]);

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
        externalDiscoverySongs={externalDiscoverySongs}
        spotlightSongs={spotlightSongs}
        todaySupport={todaySupport}
        topTenSongs={topTenSongs}
      />
    );
  }

  const currentPlatformLinks = getPrimaryPlatformLinks(song);
  const platformPresenceUnlocked =
    listeningSession.validListenRecorded ||
    (listeningSession.playbackDurationSeconds > 0 &&
      listeningSession.verifiedSeconds /
        Math.max(1, listeningSession.playbackDurationSeconds) >=
        0.5);

  return (
    <>
    <WorkspaceQueueOverview
      locale={locale}
      queueIndex={queueIndex}
      queueModeLabel={
        locale === "es"
          ? "Lista de canciones por escuchar"
          : "Review queue"
      }
      songs={matchedQueue}
    />
    <main className="content review-layout review-layout-content-first">
      <section className="review-card review-primary-flow">
        <div className="song-hero">
          <div className="player-listening-column" ref={playerColumnRef}>
            <div className="cover-wrap">
              <WorkspacePlaybackSlot
                controller={workspacePlayback}
                slotId={reviewPlayerSlotId}
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
                    data-ui-component="pauseAutoplayButton"
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
                    ? `Reproduciendo desde: ${song.platform}`
                  : `Playing From: ${song.platform}`}
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
                  <strong>{locale === "es" ? "Abre fuera de First Listen" : "Opens outside First Listen"}</strong>
                  {locale === "es"
                    ? `Este contenido abre ${song.platform}. La actividad fuera de First Listen no suma tiempo ni tokens.`
                    : `This content opens ${song.platform}. Activity outside First Listen does not earn time or tokens.`}
                </span>
              </div>
            ) : (
            <div className="listen-tracking-panel" aria-live="polite">
              <div>
                <span><Headphones size={13} /> {locale === "es" ? "Tiempo reproducido" : "Time Played"}</span>
                <strong>{formatClock(listeningSession.liveSeconds)}</strong>
              </div>
              <div>
                <span><Target size={13} /> {locale === "es" ? "Tiempo que cuenta" : "Time toward tokens"}</span>
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
                      : "Play counted"}
                  </strong>
                  <button
                    data-ui-component="nextSongButton"
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
            {platformPresenceUnlocked &&
              currentPlatformLinks.length > 1 && (
                <section className="platform-reveal-inline">
                  <span className="eyebrow">
                    <Music2 size={13} />
                    {locale === "es" ? "Disponible en:" : "Available On:"}
                  </span>
                  <PlatformPresenceIconRow
                    links={currentPlatformLinks}
                    songId={song.id}
                  />
                </section>
              )}
            <div className="continuous-listening-controls">
              <button
                data-ui-component="nextSongButton"
                onClick={() => void advanceToNextSong(autoPlayNextSong)}
                type="button"
              >
                <SkipForward size={15} />
                {locale === "es" ? "Siguiente canción" : "Next Song"}
              </button>
              <button
                className={autoPlayNextSong ? "active" : ""}
                data-ui-component="pauseAutoplayButton"
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
              <ProviderClassificationBadge platform={song.platform} locale={locale} compact />
              <span>{song.country}</span>
              <span>{optionLabel(locale, song.language)}</span>
            </div>
            <h2>{song.title}</h2>
            <p className="artist-name">
              <ArtistNameLink artistId={song.artistId} name={song.artist} />
            </p>
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
              <a
                data-ui-component="openPlatformButton"
                href={song.link}
                target="_blank"
                rel="noreferrer"
              >
                Open on {song.platform} <ExternalLink size={14} />
              </a>
            )}
            <ArtistProfileButton
              artistId={song.artistId}
              artistName={song.artist}
              locale={locale}
            />
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

        <div className="review-listening-trust-panel" aria-live="polite">
          <div>
            <span>
              <CheckCircle2 size={13} />
              {locale === "es" ? "Sesión verificada" : "Verified Session"}
            </span>
            <strong>{formatClock(listeningSession.verifiedSeconds)}</strong>
          </div>
          <div>
            <span>
              <Headphones size={13} />
              {locale === "es" ? "Tiempo reproducido" : "Time Played"}
            </span>
            <strong>{formatClock(listeningSession.liveSeconds)}</strong>
          </div>
          <div>
            <span>
              <Clock3 size={13} />
              {locale === "es" ? "Banco de Tiempo" : "Time Bank"}
            </span>
            <strong>{formatPreciseMinutes(approvedListeningSeconds)}</strong>
          </div>
          <div>
            <span>
              <Sparkles size={13} />
              {locale === "es" ? "Tokens de Envío" : "Submission Tokens"}
            </span>
            <strong>
              {unlimitedCredits
                ? locale === "es"
                  ? "Ilimitados"
                  : "Unlimited"
                : reviewCredits}
            </strong>
          </div>
          {listeningSession.warning && <small>{listeningSession.warning}</small>}
        </div>

        <ReviewRewardVisibility
          claiming={claimingReward}
          claimFeedback={rewardClaimFeedback}
          credits={reviewCredits}
          locale={locale}
          onClaim={onClaimReward}
          onContinueListening={() => {
            playerColumnRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          }}
          status={listeningBank}
          unlimitedCredits={unlimitedCredits}
        />

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
            data-ui-component="reviewButton"
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
        <div className="review-secondary-stats review-token-summary">
          <div className="listening-session-card">
            <span className="eyebrow">
              <Headphones size={13} />{" "}
              {locale === "es" ? "Banco de Tiempo" : "Time Bank"}
            </span>
            <div className="listening-validation-totals">
              <div>
                <span>
                  {locale === "es" ? "Sesión verificada" : "Verified Session"}
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
                  ? "El contenido externo no suma tiempo ni tokens dentro de First Listen."
                  : "Content that opens outside First Listen does not earn time or tokens inside First Listen."
                : listeningSession.earningEligible === false
                  ? locale === "es"
                    ? "Esta plataforma no permite sumar tiempo dentro de First Listen."
                    : "This platform cannot count time inside First Listen."
                  : locale === "es"
                    ? "Cada segundo que cuenta se agrega al Banco de Tiempo sin redondear. La review es opcional."
                    : "Every counted second is added to the Time Bank without rounding. The review is optional."}
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
              {locale === "es" ? "Banco de Tiempo" : "Time Bank"}
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
                ? "El contenido externo no suma tiempo ni tokens dentro de First Listen."
                : "Content that opens outside First Listen does not earn time or tokens inside First Listen."
              : listeningSession.earningEligible === false
              ? locale === "es"
                ? "Esta plataforma no permite sumar tiempo dentro de First Listen."
                : "This platform cannot count time inside First Listen."
              : locale === "es"
                ? "Cada segundo que cuenta se agrega al Banco de Tiempo sin redondear. La review es opcional."
                : "Every counted second is added to the Time Bank without rounding. The review is optional."}
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
                  : "Keep listening. Your saved time is still counting.",
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
    {showCommunityDiscovery && (
      <section className="content review-community-hub">
        <DiscoverySections
          externalDiscoverySongs={externalDiscoverySongs}
          locale={locale}
          onNavigateDestination={onNavigateDiscoveryDestination}
          platformConfig={platformConfig}
          onListeningCredited={onListeningCredited}
          spotlightSongs={spotlightSongs}
          topTenSongs={topTenSongs}
          workspacePlayback={workspacePlayback}
        />
        <div data-platform-module="community_activity">
          <CommunityPulse locale={locale} />
        </div>
      </section>
    )}
    </>
  );
}

function WorkspaceQueueOverview({
  locale,
  queueIndex,
  queueModeLabel,
  songs,
}: {
  locale: InterfaceLocale;
  queueIndex: number;
  queueModeLabel: string;
  songs: Song[];
}) {
  const spanish = locale === "es";
  const currentSong = songs[queueIndex] ?? null;
  const upcomingSongs = songs.slice(queueIndex + 1, queueIndex + 5);

  return (
    <section className="content workspace-queue-overview">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            <ListMusic size={13} />
            {spanish ? "Cola" : "Queue"}
          </span>
          <h2>{spanish ? "Canción actual" : "Current song"}</h2>
        </div>
        <small>
          {currentSong
            ? `${queueIndex + 1}/${songs.length}`
            : spanish
              ? "Sin canciones activas"
              : "No active songs"}
        </small>
      </div>
      <div className="workspace-queue-grid">
        <div className="workspace-current-song">
          {currentSong ? (
            <>
              <Image
                alt=""
                height={64}
                src={currentSong.coverUrl}
                unoptimized
                width={64}
              />
              <span>
                <strong>{currentSong.title}</strong>
                <small>
                  {currentSong.artist} / {optionLabel(locale, currentSong.genre)}
                </small>
              </span>
            </>
          ) : (
            <span>
              <strong>
                {spanish ? "Elige una canción para empezar" : "Choose a song to start"}
              </strong>
              <small>
                {spanish
                  ? "La cola aparecerá cuando haya canciones disponibles."
                  : "The queue appears when songs are available."}
              </small>
            </span>
          )}
        </div>
        <div className="workspace-queue-meta">
          <div>
            <span>{spanish ? "Tipo de cola" : "Queue type"}</span>
            <strong>{queueModeLabel}</strong>
          </div>
          <div>
            <span>{spanish ? "Próximas" : "Upcoming"}</span>
            <strong>{Math.max(0, songs.length - queueIndex - 1)}</strong>
          </div>
        </div>
      </div>
      {upcomingSongs.length > 0 && (
        <div className="workspace-upcoming-row" aria-label={spanish ? "Próximas canciones" : "Upcoming songs"}>
          {upcomingSongs.map((song) => (
            <span key={song.id}>
              <Image
                alt=""
                height={34}
                src={song.coverUrl}
                unoptimized
                width={34}
              />
              <b>{song.title}</b>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function ReviewRewardVisibility({
  status,
  credits,
  claiming,
  onClaim,
  onContinueListening,
  claimFeedback,
  locale,
  unlimitedCredits,
}: {
  status: ListeningBankStatus;
  credits: number;
  claiming: boolean;
  onClaim: () => void;
  onContinueListening: () => void;
  claimFeedback: RewardClaimFeedback | null;
  locale: InterfaceLocale;
  unlimitedCredits: boolean;
}) {
  const spanish = locale === "es";
  const exchangeSeconds = Math.max(1, status.minutesPerCredit * 60);
  const ready = status.rewardsEnabled && status.availableRewardCredits > 0;
  const progressSeconds = ready
    ? exchangeSeconds
    : status.bankSeconds % exchangeSeconds;
  const progress = Math.min(
    100,
    Math.round((progressSeconds / exchangeSeconds) * 100),
  );
  const remainingMinutes = Math.ceil(status.secondsToNextCredit / 60);

  return (
    <section
      aria-live="polite"
      className={ready ? "review-reward-card ready" : "review-reward-card"}
    >
      <div className="review-reward-copy">
        <span className="eyebrow">
          <Sparkles size={13} />{" "}
          {spanish ? "Progreso de recompensa" : "Reward Progress"}
        </span>
        <h3>
          {ready
            ? spanish
              ? "Token listo para reclamar"
              : "Token Ready To Claim"
            : spanish
              ? "Sigue escuchando para ganar el proximo token"
              : "Keep listening to earn the next token"}
        </h3>
        <p>
          {ready
            ? spanish
              ? `Alcanzaste ${status.minutesPerCredit} minutos de tiempo acumulado. Reclama manualmente para ver tu token agregado.`
              : `You have reached ${status.minutesPerCredit} saved minutes. Claim manually to see your token added.`
            : spanish
              ? `${remainingMinutes} min restantes para el proximo token.`
              : `${remainingMinutes} min remaining until the next token.`}
        </p>
      </div>

      <div className="review-reward-stats">
        <div>
          <span>{spanish ? "Banco de Tiempo" : "Time Bank"}</span>
          <strong>{formatPreciseMinutes(status.bankSeconds)}</strong>
        </div>
        <div>
          <span>{spanish ? "Recompensas disponibles" : "Available Rewards"}</span>
          <strong>{status.availableRewardCredits}</strong>
        </div>
        <div>
          <span>{spanish ? "Tokens de Envio" : "Submission Tokens"}</span>
          <strong>
            {unlimitedCredits
              ? spanish
                ? "Ilimitados"
                : "Unlimited"
              : credits}
          </strong>
        </div>
      </div>

      <div className="review-reward-progress">
        <div className="progress-track" aria-label={`${progress}% toward the next token`}>
          <i style={{ width: `${progress}%` }} />
        </div>
        <small>
          {status.minutesPerCredit}{" "}
          {spanish ? "tiempo acumulado = 1 token" : "saved time = 1 token"}
        </small>
      </div>

      <div className="review-reward-actions">
        <button
          className="review-claim-token-button"
          disabled={claiming || !ready}
          onClick={onClaim}
          type="button"
        >
          {claiming
            ? spanish
              ? "Reclamando..."
              : "Claiming..."
            : spanish
              ? "Reclamar token"
              : "Claim Token"}{" "}
          <ArrowRight size={15} />
        </button>
        <button
          className="review-continue-listening-button"
          onClick={onContinueListening}
          type="button"
        >
          {spanish ? "Continuar escuchando" : "Continue Listening"}
        </button>
      </div>

      {claimFeedback && (
        <div className="review-reward-claim-feedback">
          <strong>
            🎉 +{claimFeedback.awarded}{" "}
            {claimFeedback.awarded === 1
              ? spanish
                ? "Token otorgado"
                : "Token Awarded"
              : spanish
                ? "Tokens otorgados"
                : "Tokens Awarded"}
          </strong>
          <span>
            {spanish ? "Tokens de Envio" : "Submission Tokens"}:{" "}
            {claimFeedback.beforeCredits} → {claimFeedback.afterCredits}
          </span>
        </div>
      )}
    </section>
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
            <Headphones size={13} /> {spanish ? "Banco de Tiempo" : "Time Bank"}
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
        <div className="listening-bank-approved-field">
          <strong>{formatClock(status.todaySeconds)}</strong>
          <span>{spanish ? "Tiempo acumulado hoy" : "Time saved today"}</span>
        </div>
        <div className="listening-bank-approved-field">
          <strong>{formatClock(status.approvedSeconds)}</strong>
          <span>{spanish ? "Tiempo aprobado" : "Approved Time"}</span>
        </div>
        <div className="listening-bank-pending-field">
          <strong>{formatClock(status.pendingSeconds)}</strong>
          <span>{spanish ? "Tiempo pendiente" : "Pending Time"}</span>
        </div>
        <div className="listening-bank-rejected-field">
          <strong>{formatClock(status.rejectedSeconds)}</strong>
          <span>{spanish ? "Tiempo rechazado" : "Rejected Time"}</span>
        </div>
        <div>
          <strong>{formatPreciseMinutes(status.bankSeconds)}</strong>
          <span>{spanish ? "Banco de Tiempo disponible" : "Available Time Bank"}</span>
        </div>
        <div><strong>{credits}</strong><span>{spanish ? "Tokens disponibles" : "Available Tokens"}</span></div>
        <div><strong>{status.validListens}</strong><span>{spanish ? "Reproducciones que suman" : "Plays that count"}</span></div>
        <div><strong>{status.completeListens}</strong><span>{spanish ? "Reproducciones completas" : "Complete plays"}</span></div>
        <div><strong>{formatDuration(status.weeklySeconds)}</strong><span>{spanish ? "Tiempo acumulado semanal" : "Weekly saved time"}</span></div>
        <div><strong>{formatDuration(status.monthlySeconds)}</strong><span>{spanish ? "Tiempo acumulado mensual" : "Monthly saved time"}</span></div>
        <div><strong>{formatDuration(status.lifetimeSeconds)}</strong><span>{spanish ? "Tiempo reproducido total" : "Lifetime Play Time"}</span></div>
      </div>
      <div className="today-support-strip">
        <span>{spanish ? "Apoyo de hoy" : "Today’s Support"}</span>
        <strong>{status.todayValidListens} {spanish ? "que suman" : "counted"}</strong>
        <strong>{status.todayCompleteListens} {spanish ? "completas" : "complete"}</strong>
        <strong>{Math.round(status.todayAverageCompletionRate)}% {spanish ? "promedio" : "average completion"}</strong>
      </div>
      {status.lastRejectionReasonDescription && (
        <div className="listening-bank-rejection-reason">
          <span>{spanish ? "Ultimo rechazo" : "Last rejection"}</span>
          <strong>{status.lastRejectionReasonDescription}</strong>
          <small>
            {status.lastRejectionAt
              ? new Date(status.lastRejectionAt).toLocaleString(locale)
              : status.lastRejectionReasonCode ?? "rejection recorded"}
          </small>
        </div>
      )}
      <div className="listening-bank-progress listening-bank-token-conversion">
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
      <p className="listening-bank-transparency listening-bank-next-threshold">
        {spanish
          ? "El tiempo cuenta para tokens cuando la reproducción está activa y audible. Reclama manualmente cuando alcances la meta."
          : "Time counts toward tokens when playback is active and audible. Claim manually once you reach the goal."}
      </p>
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

const DISCOVERY_HEARD_HISTORY_KEY = "first-listen-discovery-heard-history";

function readDiscoveryHeardHistory(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(DISCOVERY_HEARD_HISTORY_KEY) ?? "{}",
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

function writeDiscoveryHeardHistory(history: Record<string, number>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    DISCOVERY_HEARD_HISTORY_KEY,
    JSON.stringify(history),
  );
}

function mergeDiscoverySongs(...groups: DiscoverySong[][]) {
  const map = new Map<string, DiscoverySong>();
  for (const group of groups) {
    for (const song of group) {
      const existing = map.get(song.id);
      map.set(song.id, {
        ...existing,
        ...song,
        platformLinks: song.platformLinks?.length
          ? song.platformLinks
          : existing?.platformLinks,
        submittedAt: song.submittedAt ?? existing?.submittedAt,
        commentsCount: song.commentsCount ?? existing?.commentsCount,
        likesCount: song.likesCount ?? existing?.likesCount,
        followersCount: song.followersCount ?? existing?.followersCount,
      });
    }
  }
  return Array.from(map.values());
}

function isInternalDiscoverySong(song: DiscoverySong) {
  return isQueuePlayableDiscoverySong(song);
}

function isQueuePlayableDiscoverySong(song: DiscoverySong) {
  return Boolean(getProviderEmbed(song.link, song.platform, undefined, true));
}

function filterQueuePlayableDiscoverySongs(songs: DiscoverySong[]) {
  return songs.filter(isQueuePlayableDiscoverySong);
}

function hasExternalDiscoveryDestination(song: DiscoverySong) {
  return (
    isExternalPlatform(song.platform) ||
    (song.platformLinks ?? []).some((link) => isExternalPlatform(link.platform))
  );
}

function supportScore(song: DiscoverySong) {
  return (
    (song.likesCount ?? 0) * 3 +
    (song.followersCount ?? 0) * 4 +
    song.reviewsReceived * 2 +
    Math.min(50, song.hookScore)
  );
}

function trendScore(song: DiscoverySong) {
  return (
    song.hookScore * 1.2 +
    song.completionRate * 0.5 +
    supportScore(song) +
    Math.min(100, song.totalListeningSeconds / 60)
  );
}

function exposureScore(song: DiscoverySong) {
  return (
    song.reviewsReceived * 8 +
    Math.min(100, song.totalListeningSeconds / 60) +
    supportScore(song) * 0.5
  );
}

function sortDiscoverySongs(
  songs: DiscoverySong[],
  sorter: (left: DiscoverySong, right: DiscoverySong) => number,
  limit = 8,
) {
  return [...songs].sort(sorter).slice(0, limit);
}

function smartDiscoveryPick(
  songs: DiscoverySong[],
  heardHistory: Record<string, number>,
  options: {
    randomReplayPoolSize?: number;
    replayWindowHours?: number;
    underexposedBoost?: number;
  } = {},
) {
  if (!songs.length) return null;
  const ranked = rankDiscoveryQueue(songs, heardHistory, options);
  const poolSize = Math.max(1, Math.round(options.randomReplayPoolSize ?? 6));
  const replayPool = ranked.slice(0, Math.min(poolSize, ranked.length));
  return replayPool[Math.floor(Math.random() * replayPool.length)] ?? ranked[0];
}

function submittedTime(song: DiscoverySong) {
  if (!song.submittedAt) return 0;
  const time = new Date(song.submittedAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function normalizedGenreKey(genre: string) {
  return discoveryGenreSlug(genre);
}

function discoveryGenreLabel(locale: InterfaceLocale, genre: string) {
  if (locale === "es") {
    if (genre === "Regional Mexican") return "Regional Mexicano";
    if (genre === "Hip Hop") return "Hip-Hop";
  }
  return genre === "Hip Hop" ? "Hip-Hop" : optionLabel(locale, genre);
}

function discoveryGenreEmoji(genre: string) {
  const emojiByGenre: Record<string, string> = {
    Bachata: "🎶",
    Cumbia: "💃",
    "Hip Hop": "🎤",
    "Regional Mexican": "🤠",
    Chilena: "🥁",
    Reggaeton: "🔥",
    Salsa: "🎺",
  };
  return emojiByGenre[genre] ?? "🎵";
}

function discoveryContextIcon(kind: string) {
  if (kind === "top") return <Trophy size={13} />;
  if (kind === "external") return <ExternalLink size={13} />;
  if (kind === "internal") return <Headphones size={13} />;
  if (kind === "trending") return <Rocket size={13} />;
  if (kind === "new") return <CalendarDays size={13} />;
  if (kind === "support") return <ThumbsUp size={13} />;
  if (kind === "listened") return <Gauge size={13} />;
  if (kind === "genre") return <Music2 size={13} />;
  if (kind === "random") return <Play size={13} />;
  return <Sparkles size={13} />;
}

type DiscoveryCategoryKey =
  | "top_results"
  | "internal_playback"
  | "random"
  | "external_discovery"
  | "genres"
  | "trending"
  | "newest_songs"
  | "most_supported"
  | "most_listened";

type DiscoveryQueueState = {
  id: string;
  title: string;
  description: string;
  mode: WorkspaceQueueMode;
  songs: DiscoverySong[];
  sourceSongs: DiscoverySong[];
  currentIndex: number;
  cycle: number;
  autoPlayEnabled: boolean;
};

function workspaceQueueModeForDiscoveryId(id: string): WorkspaceQueueMode {
  if (id === "random") return "random";
  if (id === "top_results") return "top10";
  if (id.startsWith("genre-")) return "genre";
  return "discovery";
}

function rankDiscoveryQueue(
  songs: DiscoverySong[],
  heardHistory: Record<string, number>,
  options: {
    replayWindowHours?: number;
    underexposedBoost?: number;
  } = {},
) {
  const now = Date.now();
  const replayWindowMs =
    Math.max(1, options.replayWindowHours ?? 24) * 60 * 60 * 1000;
  const underexposedBoost = Math.max(0, options.underexposedBoost ?? 1);
  return [...songs].sort((left, right) => {
    const leftHeardAt = heardHistory[left.id] ?? 0;
    const rightHeardAt = heardHistory[right.id] ?? 0;
    const leftRecentlyHeard =
      leftHeardAt > 0 && now - leftHeardAt < replayWindowMs;
    const rightRecentlyHeard =
      rightHeardAt > 0 && now - rightHeardAt < replayWindowMs;
    if (leftRecentlyHeard !== rightRecentlyHeard) {
      return leftRecentlyHeard ? 1 : -1;
    }
    if (Boolean(leftHeardAt) !== Boolean(rightHeardAt)) {
      return leftHeardAt ? 1 : -1;
    }
    const exposureDifference =
      (exposureScore(left) - exposureScore(right)) * underexposedBoost;
    if (Math.abs(exposureDifference) > 0.1) return exposureDifference;
    return trendScore(right) - trendScore(left);
  });
}

function rankContinuousInternalReplayQueue(
  songs: DiscoverySong[],
  heardHistory: Record<string, number>,
  options: {
    replayWindowHours?: number;
    underexposedBoost?: number;
  } = {},
) {
  const playableSongs = filterQueuePlayableDiscoverySongs(songs);
  if (!playableSongs.length) return [];

  const now = Date.now();
  const replayWindowMs =
    Math.max(1, options.replayWindowHours ?? 24) * 60 * 60 * 1000;
  const neverHeard: DiscoverySong[] = [];
  const notHeardRecently: DiscoverySong[] = [];
  const heardRecently: DiscoverySong[] = [];

  for (const song of playableSongs) {
    const heardAt = heardHistory[song.id] ?? 0;
    if (!heardAt) {
      neverHeard.push(song);
      continue;
    }
    if (now - heardAt >= replayWindowMs) {
      notHeardRecently.push(song);
      continue;
    }
    heardRecently.push(song);
  }

  return [
    ...rankDiscoveryQueue(neverHeard, heardHistory, options),
    ...rankDiscoveryQueue(notHeardRecently, heardHistory, options),
    ...rankDiscoveryQueue(heardRecently, heardHistory, options),
  ];
}

function DiscoverySongCard({
  song,
  active,
  onPlay,
  onListeningCredited,
  locale,
  topTen,
  contextKind = topTen ? "top" : "spotlight",
  contextLabel,
  queueLabel,
  queueIndex,
  queueLength,
  onQueueNext,
  onQueueEnded,
  onQueueAutoPlayChange,
  workspaceQueue,
  workspacePlayback,
  queueAutoPlayEnabled,
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
  contextKind?: string;
  contextLabel?: string;
  queueLabel?: string;
  queueIndex?: number;
  queueLength?: number;
  onQueueNext?: () => void;
  onQueueEnded?: () => void;
  onQueueAutoPlayChange?: (enabled: boolean) => void;
  workspaceQueue?: WorkspaceActiveQueue | null;
  workspacePlayback: WorkspacePlaybackController;
  queueAutoPlayEnabled?: boolean;
}) {
  const { requestPlayback, stopPlayback } = workspacePlayback;
  const [details, setDetails] = useState<"reviews" | "statistics" | null>(null);
  const [listenState, setListenState] = useState({
    liveSeconds: 0,
    verifiedSeconds: 0,
    validRequirementSeconds: 30,
    playbackDurationSeconds: 0,
    validListenRecorded: false,
    warning: "",
  });
  const playerRef = useRef<HTMLDivElement>(null);
  const togglePlayerRef = useRef<(() => Promise<void>) | null>(null);
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
  const queueEndedRef = useRef(false);
  const spanish = locale === "es";
  const platformLinks = getPrimaryPlatformLinks(song);
  const recommendedPlatform =
    song.recommendedPlatform && song.recommendedPlatform !== song.platform
      ? song.recommendedPlatform
      : null;
  const queueActive = Boolean(queueLabel && queueLength && queueLength > 0);
  const queueAutoPlayActive = queueActive && queueAutoPlayEnabled !== false;
  const playbackQueueMode =
    workspaceQueue?.mode ??
    (contextKind === "genre"
      ? "genre"
      : contextKind === "random"
        ? "random"
        : contextKind === "top"
          ? "top10"
          : "discovery");
  const playbackSlotId = `discovery:${playbackQueueMode}:${song.id}`;
  const skipProgressSeconds = Math.max(
    listenState.liveSeconds,
    listenState.verifiedSeconds,
  );
  const skipRequirementSeconds = Math.max(
    1,
    Math.round(listenState.validRequirementSeconds || 30),
  );
  const skipRemainingSeconds = Math.max(
    0,
    skipRequirementSeconds - skipProgressSeconds,
  );
  const queueSkipReady =
    listenState.validListenRecorded || skipRemainingSeconds <= 0;

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
      playbackDurationSeconds: 0,
      validListenRecorded: false,
      warning: "",
    });
  }, [active]);

  useEffect(() => {
    queueEndedRef.current = false;
  }, [active, song.id]);

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
      if (snapshot.duration > 0) {
        setListenState((current) => ({
          ...current,
          playbackDurationSeconds: snapshot.duration,
        }));
      }
      if (
        snapshot.playbackState === "ended" &&
        onQueueEnded &&
        queueAutoPlayActive &&
        !queueEndedRef.current
      ) {
        queueEndedRef.current = true;
        window.setTimeout(onQueueEnded, 700);
      }
      const sampleAt = Date.now();
      const liveEligible =
        snapshot.supported &&
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
              ? "Esta plataforma no permite sumar tiempo dentro de First Listen."
              : "This platform cannot count time inside First Listen.",
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
                ? "Esta canción no puede sumar otra reproducción por ahora."
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
          warning: error?.message ?? (spanish ? "No pudimos actualizar el tiempo de escucha." : "We could not update listening time."),
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
    [
      active,
      onListeningCredited,
      onQueueEnded,
      queueAutoPlayActive,
      scrollPlayerIntoView,
      song.id,
      spanish,
    ],
  );

  useEffect(() => {
    if (!active) return;
    requestPlayback({
      autoPlay: true,
      context: {
        label:
          contextLabel ??
          (topTen
            ? spanish
              ? "Top 10 por resultados"
              : "Top 10"
            : spanish
              ? "Descubrir música"
              : "Discover Music"),
        mode: playbackQueueMode,
        panel: { type: "dashboard" },
        source: "discovery",
      },
      controls: {
        autoPlayEnabled: queueAutoPlayActive,
        nextEnabled: queueActive ? queueSkipReady : false,
        onAutoPlayChange: queueActive ? onQueueAutoPlayChange : undefined,
        onNext: queueActive ? onQueueNext : undefined,
      },
      onReady: scrollPlayerIntoView,
      onTelemetry: handleDiscoveryTelemetry,
      queue: workspaceQueue ?? null,
      slotId: playbackSlotId,
      song,
      songLoadedAt: null,
    });
  }, [
    active,
    contextLabel,
    handleDiscoveryTelemetry,
    playbackQueueMode,
    playbackSlotId,
    queueActive,
    queueAutoPlayActive,
    queueSkipReady,
    scrollPlayerIntoView,
    song,
    spanish,
    topTen,
    onQueueNext,
    onQueueAutoPlayChange,
    requestPlayback,
    workspaceQueue,
  ]);

  const togglePlayer = useCallback(async () => {
    if (active && listeningSessionRef.current) {
      const supabase = createClient();
      if (supabase) {
        await supabase.rpc("finish_listening_session", {
          target_session_id: listeningSessionRef.current,
        });
      }
    }
    if (active) {
      stopPlayback(playbackSlotId);
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
  }, [active, onPlay, playbackSlotId, song.id, stopPlayback]);

  useEffect(() => {
    togglePlayerRef.current = togglePlayer;
  }, [togglePlayer]);

  return (
    <article
      className="discovery-song-card"
      data-external-feed-kind={song.feedKind}
    >
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
          {discoveryContextIcon(contextKind)}
          {contextLabel ??
            (topTen
              ? spanish
                ? "Ranking orgánico"
                : "Organic ranking"
              : spanish
                ? "Selección editorial"
                : "Editorial selection")}
        </span>
        <h4>{song.title}</h4>
        <ArtistNameLink artistId={song.artistId} name={song.artist} />
        <small>
          {song.platform} / {compactClassificationLabel(song.platform, locale)} /{" "}
          {optionLabel(locale, song.genre)} /{" "}
          {optionLabel(locale, song.language)}
        </small>
        {recommendedPlatform && (
          <div className="recommended-platform-inline">
            <Star size={13} />
            <span>
              {spanish ? "Plataforma recomendada" : "Recommended Platform"}:{" "}
              <strong>{recommendedPlatform}</strong>
            </span>
          </div>
        )}
      </div>
      <div className="discovery-song-actions">
        <button
          className="primary-button"
          data-ui-component="playNowButton"
          onClick={() => void togglePlayer()}
          type="button"
        >
          <Play size={14} fill="currentColor" />
          {active
            ? spanish
              ? "Ocultar reproductor"
              : "Hide Player"
            : spanish
              ? "Escuchar ahora"
              : "Listen Now"}
        </button>
        <a
          data-ui-component="openPlatformButton"
          href={song.link}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink size={14} />
          {spanish ? "Abrir plataforma" : "Open Platform"}
        </a>
        <ArtistProfileButton
          artistId={song.artistId}
          artistName={song.artist}
          compact
          locale={locale}
        />
        <button
          className={details === "reviews" ? "active" : ""}
          data-ui-component="reviewButton"
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
          data-ui-component="statisticsButton"
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
          <WorkspacePlaybackSlot
            controller={workspacePlayback}
            slotId={playbackSlotId}
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
                ? spanish ? "Tiempo que cuenta" : "Time toward tokens"
                : `${formatClock(listenState.verifiedSeconds)} / ${formatClock(
                    listenState.validRequirementSeconds,
                  )}`}
            </span>
            {listenState.warning && <small>{listenState.warning}</small>}
          </div>
          {queueActive && (
            <div className="discovery-queue-controls" aria-live="polite">
              <span>
                <SkipForward size={14} />
                {queueSkipReady
                  ? spanish
                    ? "Siguiente canción disponible"
                    : "Next song available"
                  : spanish
                    ? `Siguiente disponible en ${formatClock(
                        skipRemainingSeconds,
                      )}`
                    : `Next available in ${formatClock(skipRemainingSeconds)}`}
              </span>
              <strong>
                {queueLabel} {queueIndex ?? 1}/{queueLength ?? 1}
              </strong>
              <button
                disabled={!queueSkipReady}
                onClick={onQueueNext}
                type="button"
              >
                <SkipForward size={14} />
                {spanish ? "Siguiente canción" : "Next song"}
              </button>
              <button onClick={() => void togglePlayer()} type="button">
                <Pause size={14} />
                {spanish ? "Pausar cola" : "Pause queue"}
              </button>
            </div>
          )}
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
      {listenState.validListenRecorded && platformLinks.length > 1 && (
        <section className="platform-reveal-inline">
          <span className="eyebrow">
            <Globe2 size={13} />
            {spanish ? "Disponible en:" : "Available On:"}
          </span>
          <PlatformPresenceIconRow links={platformLinks} songId={song.id} />
        </section>
      )}
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
                <span>{spanish ? "Tiempo reproducido" : "Play time"}</span>
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
  destination,
  spotlightSongs,
  topTenSongs,
  externalDiscoverySongs,
  locale,
  platformConfig,
  onNavigateDestination,
  onListeningCredited,
  workspacePlayback,
}: {
  destination?: DiscoveryDestination;
  spotlightSongs: DiscoverySong[];
  topTenSongs: DiscoverySong[];
  externalDiscoverySongs: DiscoverySong[];
  locale: InterfaceLocale;
  platformConfig: PlatformControlConfig;
  onNavigateDestination: (destination?: DiscoveryDestination) => void;
  onListeningCredited: (
    seconds: number,
    becameValid: boolean,
    becameComplete: boolean,
    completionRate: number,
  ) => void;
  workspacePlayback: WorkspacePlaybackController;
}) {
  type DiscoveryCategoryConfig = {
    key: DiscoveryCategoryKey;
    icon: ReactNode;
    title: string;
    description: string;
    primaryLabel: string;
    secondaryLabel?: string;
    songs: DiscoverySong[];
    queueSongs?: DiscoverySong[];
    queueable?: boolean;
    preserveOrder?: boolean;
    contextKind: string;
    contextLabel: string;
    emptyText: string;
  };

  const [activeCardKey, setActiveCardKey] = useState<string | null>(null);
  const [heardHistory, setHeardHistory] = useState<Record<string, number>>({});
  const [activeQueue, setActiveQueue] = useState<DiscoveryQueueState | null>(
    null,
  );
  const [expandedCategory, setExpandedCategory] =
    useState<DiscoveryCategoryKey | null>(null);
  const spanish = locale === "es";
  const discoveryHub = platformConfig.discovery.hub;
  const limits = discoveryHub.limits;
  const queuePolicy = discoveryHub.queuePolicy;
  const sectionSettings = new Map(
    discoveryHub.sections.map((section) => [section.key, section]),
  );
  const sectionTitle = (
    key: DiscoveryHubSectionKey,
    fallback: string,
  ) => sectionSettings.get(key)?.title[locale] || fallback;
  const sectionVisible = (key: DiscoveryHubSectionKey) => {
    const setting = sectionSettings.get(key);
    if (setting?.visible === false) return false;
    const modules = platformConfig.discovery.modules;
    if (key === "spotlight") return modules.spotlight;
    if (key === "top_results") return modules.topResults || modules.rankings;
    if (key === "external_discovery") {
      return (
        platformConfig.discovery.externalContent.visibility !== "hidden" &&
        platformConfig.discovery.externalDiscovery.showExternalSongs
      );
    }
    if (key === "trending") return modules.trending;
    if (key === "newest_songs") return modules.newestSongs;
    if (key === "most_supported") return modules.mostSupported;
    return true;
  };
  const catalogPreviewLimit = Math.max(1, limits.catalogPreviewCount);
  const queueRankOptions = useMemo(
    () => ({
      replayWindowHours: queuePolicy.replayWindowHours,
      underexposedBoost: queuePolicy.underexposedBoost,
    }),
    [queuePolicy.replayWindowHours, queuePolicy.underexposedBoost],
  );

  const spotlightIds = new Set(spotlightSongs.map((song) => song.id));
  const visibleTopTenSongs = topTenSongs.filter(
    (song) => !spotlightIds.has(song.id),
  );
  const visibleSpotlightSongs = spotlightSongs.slice(0, limits.featuredCount);
  const allDiscoverySongs = useMemo(
    () =>
      mergeDiscoverySongs(
        spotlightSongs,
        topTenSongs,
        externalDiscoverySongs,
      ),
    [externalDiscoverySongs, spotlightSongs, topTenSongs],
  );
  const catalogLimit = Math.max(1, allDiscoverySongs.length);
  const internalPlaybackCatalog = useMemo(
    () =>
      [...allDiscoverySongs.filter(isQueuePlayableDiscoverySong)].sort(
        (left, right) =>
          exposureScore(left) - exposureScore(right) ||
          trendScore(right) - trendScore(left),
      ),
    [allDiscoverySongs],
  );
  const internalPlaybackSongs = useMemo(
    () =>
      internalPlaybackCatalog.slice(
        0,
        Math.min(catalogLimit, queuePolicy.queueLength),
      ),
    [catalogLimit, internalPlaybackCatalog, queuePolicy.queueLength],
  );
  const topTenQueueSongs = useMemo(
    () =>
      visibleTopTenSongs
        .filter(isQueuePlayableDiscoverySong)
        .slice(0, limits.topTenCount),
    [limits.topTenCount, visibleTopTenSongs],
  );
  const externalPlatformSongs = useMemo(
    () =>
      sortDiscoverySongs(
        allDiscoverySongs.filter(hasExternalDiscoveryDestination),
        (left, right) =>
          Number(right.feedKind === "external_song") -
          Number(left.feedKind === "external_song") ||
          submittedTime(right) - submittedTime(left) ||
          trendScore(right) - trendScore(left),
        limits.externalCount,
      ),
    [allDiscoverySongs, limits.externalCount],
  );
  const trendingSongs = useMemo(() => {
    const explicitTrending = allDiscoverySongs.filter(
      (song) => song.feedKind === "trending_external",
    );
    return sortDiscoverySongs(
      explicitTrending.length ? explicitTrending : allDiscoverySongs,
      (left, right) => trendScore(right) - trendScore(left),
      limits.trendingCount,
    );
  }, [allDiscoverySongs, limits.trendingCount]);
  const trendingQueueSongs = useMemo(() => {
    const playableSongs = filterQueuePlayableDiscoverySongs(allDiscoverySongs);
    const explicitTrending = playableSongs.filter(
      (song) => song.feedKind === "trending_external",
    );
    return sortDiscoverySongs(
      explicitTrending.length ? explicitTrending : playableSongs,
      (left, right) => trendScore(right) - trendScore(left),
      limits.trendingCount,
    );
  }, [allDiscoverySongs, limits.trendingCount]);
  const newestSongs = useMemo(
    () =>
      sortDiscoverySongs(
        allDiscoverySongs,
        (left, right) => submittedTime(right) - submittedTime(left),
        limits.newReleaseCount,
      ),
    [allDiscoverySongs, limits.newReleaseCount],
  );
  const newestQueueSongs = useMemo(
    () =>
      sortDiscoverySongs(
        filterQueuePlayableDiscoverySongs(allDiscoverySongs),
        (left, right) => submittedTime(right) - submittedTime(left),
        limits.newReleaseCount,
      ),
    [allDiscoverySongs, limits.newReleaseCount],
  );
  const mostSupportedSongs = useMemo(
    () =>
      sortDiscoverySongs(
        allDiscoverySongs,
        (left, right) => supportScore(right) - supportScore(left),
        limits.mostSupportedCount,
      ),
    [allDiscoverySongs, limits.mostSupportedCount],
  );
  const mostListenedSongs = useMemo(
    () =>
      sortDiscoverySongs(
        allDiscoverySongs,
        (left, right) =>
          right.totalListeningSeconds - left.totalListeningSeconds ||
          right.completionRate - left.completionRate,
        limits.mostPlayedCount,
      ),
    [allDiscoverySongs, limits.mostPlayedCount],
  );
  const mostListenedQueueSongs = useMemo(
    () =>
      sortDiscoverySongs(
        filterQueuePlayableDiscoverySongs(allDiscoverySongs),
        (left, right) =>
          right.totalListeningSeconds - left.totalListeningSeconds ||
          right.completionRate - left.completionRate,
        limits.mostPlayedCount,
      ),
    [allDiscoverySongs, limits.mostPlayedCount],
  );
  const randomQueueSongs = useMemo(
    () =>
      rankDiscoveryQueue(internalPlaybackSongs, heardHistory, queueRankOptions)
        .slice(0, queuePolicy.queueLength),
    [heardHistory, internalPlaybackSongs, queuePolicy.queueLength, queueRankOptions],
  );
  const genreSections = useMemo(() => {
    const grouped = new Map<string, DiscoverySong[]>();
    for (const song of internalPlaybackCatalog) {
      const genre = song.genre || "Other";
      if (discoveryHub.genres.visibility[genre] === false) continue;
      grouped.set(genre, [...(grouped.get(genre) ?? []), song]);
    }
    const priorityGenres = discoveryHub.genres.order;
    return Array.from(grouped.entries())
      .sort(([left], [right]) => {
        const leftPriority = priorityGenres.indexOf(left);
        const rightPriority = priorityGenres.indexOf(right);
        if (leftPriority !== -1 || rightPriority !== -1) {
          if (leftPriority === -1) return 1;
          if (rightPriority === -1) return -1;
          return leftPriority - rightPriority;
        }
        return left.localeCompare(right);
      })
      .map(([genre, songs]) => ({
        genre,
        songs: sortDiscoverySongs(
          songs,
          (left, right) =>
            exposureScore(left) - exposureScore(right) ||
            trendScore(right) - trendScore(left),
          Math.max(1, songs.length),
        ),
      }))
      .map((section) => ({
        ...section,
        queueSongs: sortDiscoverySongs(
          section.songs,
          (left, right) =>
            exposureScore(left) - exposureScore(right) ||
            trendScore(right) - trendScore(left),
          Math.min(
            Math.max(1, section.songs.length),
            queuePolicy.genreQueueSize,
          ),
        ),
      }))
      .filter((section) => section.queueSongs.length > 0)
      .slice(0, limits.genreCount);
  }, [
    discoveryHub.genres.order,
    discoveryHub.genres.visibility,
    internalPlaybackCatalog,
    limits.genreCount,
    queuePolicy.genreQueueSize,
  ]);
  const continuousDiscoverySongs = useMemo(
    () =>
      mergeDiscoverySongs(
        visibleSpotlightSongs.filter(isQueuePlayableDiscoverySong),
        topTenQueueSongs,
        newestQueueSongs,
        trendingQueueSongs,
        mostListenedQueueSongs,
        internalPlaybackSongs.filter(isQueuePlayableDiscoverySong),
        internalPlaybackCatalog,
        randomQueueSongs,
      ).filter(isQueuePlayableDiscoverySong),
    [
      internalPlaybackSongs,
      internalPlaybackCatalog,
      mostListenedQueueSongs,
      newestQueueSongs,
      randomQueueSongs,
      topTenQueueSongs,
      trendingQueueSongs,
      visibleSpotlightSongs,
    ],
  );
  const activeQueueSong = activeQueue?.songs[activeQueue.currentIndex] ?? null;

  useEffect(() => {
    setHeardHistory(readDiscoveryHeardHistory());
  }, []);

  const markSongHeard = useCallback((song: DiscoverySong) => {
    const timestamp = Date.now();
    setHeardHistory((current) => {
      const next = { ...current, [song.id]: timestamp };
      writeDiscoveryHeardHistory(next);
      return next;
    });
  }, []);

  const startDiscoveryQueue = useCallback(
    ({
      description,
      id,
      preserveOrder = false,
      preferredSongId,
      songs,
      title,
    }: {
      id: string;
      title: string;
      description: string;
      songs: DiscoverySong[];
      preserveOrder?: boolean;
      preferredSongId?: string;
    }) => {
      if (!songs.length) return;
      let queueSongs = preserveOrder
        ? [...songs]
        : rankDiscoveryQueue(songs, heardHistory, queueRankOptions);
      if (preferredSongId) {
        const selected = queueSongs.find((song) => song.id === preferredSongId);
        if (selected) {
          queueSongs = [
            selected,
            ...queueSongs.filter((song) => song.id !== preferredSongId),
          ];
        }
      }
      if (id === "random" && queueSongs.length > 1) {
        const poolSize = Math.min(
          Math.max(1, queuePolicy.randomReplayPoolSize),
          queueSongs.length,
        );
        const pool = queueSongs.slice(0, poolSize);
        const firstSong = pool[Math.floor(Math.random() * pool.length)];
        queueSongs = [
          firstSong,
          ...queueSongs.filter((song) => song.id !== firstSong.id),
        ];
      }
      const firstSong = queueSongs[0];
      setActiveCardKey(null);
      setExpandedCategory(null);
      setActiveQueue({
        autoPlayEnabled: true,
        cycle: 0,
        currentIndex: 0,
        description,
        id,
        mode: workspaceQueueModeForDiscoveryId(id),
        songs: queueSongs,
        sourceSongs: songs,
        title,
      });
      if (firstSong) markSongHeard(firstSong);
    },
    [
      heardHistory,
      markSongHeard,
      queuePolicy.randomReplayPoolSize,
      queueRankOptions,
    ],
  );

  const advanceDiscoveryQueue = useCallback(() => {
    if (!activeQueue) return;
    const nextIndex = activeQueue.currentIndex + 1;
    let replaySongs = rankContinuousInternalReplayQueue(
      activeQueue.sourceSongs,
      heardHistory,
      queueRankOptions,
    );
    if (activeQueue.id === "random" && replaySongs.length > 1) {
      const poolSize = Math.min(
        Math.max(1, queuePolicy.randomReplayPoolSize),
        replaySongs.length,
      );
      const pool = replaySongs.slice(0, poolSize);
      const firstSong = pool[Math.floor(Math.random() * pool.length)];
      replaySongs.splice(
        replaySongs.findIndex((song) => song.id === firstSong.id),
        1,
      );
      replaySongs.unshift(firstSong);
    }
    const queuedIds = new Set(activeQueue.songs.map((song) => song.id));
    const unplayedContinuousSongs = continuousDiscoverySongs.filter(
      (song) => !queuedIds.has(song.id),
    );
    const continuousReplaySongs = rankContinuousInternalReplayQueue(
      continuousDiscoverySongs,
      heardHistory,
      queueRankOptions,
    );
    const shouldContinueDiscovery =
      activeQueue.id !== "random" &&
      nextIndex >= activeQueue.songs.length &&
      (unplayedContinuousSongs.length > 0 || continuousReplaySongs.length > 0);
    if (shouldContinueDiscovery) {
      replaySongs = [
        ...unplayedContinuousSongs,
        ...continuousReplaySongs.filter(
          (song) => !unplayedContinuousSongs.some((next) => next.id === song.id),
        ),
      ];
    }
    const nextQueue =
      nextIndex < activeQueue.songs.length
        ? { ...activeQueue, currentIndex: nextIndex }
        : {
            ...activeQueue,
            description: shouldContinueDiscovery
              ? spanish
                ? "Seguimos con canciones reproducibles dentro de First Listen."
                : "Continuing with songs playable inside First Listen."
              : activeQueue.description,
            id: shouldContinueDiscovery
              ? "continuous_discovery"
              : activeQueue.id,
            currentIndex: 0,
            cycle: activeQueue.cycle + 1,
            songs: replaySongs.length ? replaySongs : activeQueue.songs,
            sourceSongs: shouldContinueDiscovery
              ? continuousDiscoverySongs
              : activeQueue.sourceSongs,
            title: shouldContinueDiscovery
              ? spanish
                ? "Descubrimiento continuo"
                : "Continuous discovery"
              : activeQueue.title,
          };
    const nextSong = nextQueue.songs[nextQueue.currentIndex] ?? null;
    setActiveQueue(nextQueue);
    if (nextSong) markSongHeard(nextSong);
  }, [
    activeQueue,
    continuousDiscoverySongs,
    heardHistory,
    markSongHeard,
    queuePolicy.randomReplayPoolSize,
    queueRankOptions,
    spanish,
  ]);

  const stopDiscoveryQueue = useCallback(() => {
    setActiveQueue(null);
  }, []);

  const changeDiscoveryQueueAutoPlay = useCallback((enabled: boolean) => {
    setActiveQueue((current) =>
      current ? { ...current, autoPlayEnabled: enabled } : current,
    );
  }, []);

  const toggleDiscoveryCard = useCallback(
    (cardKey: string, song: DiscoverySong) => {
      setActiveQueue(null);
      if (activeCardKey !== cardKey) markSongHeard(song);
      setActiveCardKey((current) => (current === cardKey ? null : cardKey));
    },
    [activeCardKey, markSongHeard],
  );

  const playDiscoveryCardQueue = useCallback(
    ({
      cardKey,
      description,
      id,
      preserveOrder = false,
      selectedSong,
      songs,
      title,
    }: {
      cardKey: string;
      id: string;
      title: string;
      description: string;
      songs: DiscoverySong[];
      selectedSong: DiscoverySong;
      preserveOrder?: boolean;
    }) => {
      if (!isQueuePlayableDiscoverySong(selectedSong)) {
        toggleDiscoveryCard(cardKey, selectedSong);
        return;
      }

      const playableSongs = songs.filter(isQueuePlayableDiscoverySong);
      const queueSongs = playableSongs.some(
        (song) => song.id === selectedSong.id,
      )
        ? playableSongs
        : [selectedSong, ...playableSongs];

      if (!queueSongs.length) {
        toggleDiscoveryCard(cardKey, selectedSong);
        return;
      }

      if (activeQueue?.id === id && activeQueueSong?.id === selectedSong.id) {
        stopDiscoveryQueue();
        return;
      }

      startDiscoveryQueue({
        description,
        id,
        preserveOrder,
        preferredSongId: selectedSong.id,
        songs: queueSongs,
        title,
      });
    },
    [
      activeQueue?.id,
      activeQueueSong?.id,
      startDiscoveryQueue,
      stopDiscoveryQueue,
      toggleDiscoveryCard,
    ],
  );

  const toggleCategory = (category: DiscoveryCategoryKey) => {
    setActiveQueue(null);
    setExpandedCategory((current) => (current === category ? null : category));
  };

  const playGenre = (genre: string, songs: DiscoverySong[]) => {
    startDiscoveryQueue({
      description: spanish
        ? "Cola de canciones del genero"
        : "Genre playback queue",
      id: `genre-${normalizedGenreKey(genre)}`,
      songs,
      title: discoveryGenreLabel(locale, genre),
    });
  };

  const playGenreSong = (
    genre: string,
    songs: DiscoverySong[],
    selectedSong: DiscoverySong,
  ) => {
    const rankedSongs = rankDiscoveryQueue(
      songs.filter((song) => song.id !== selectedSong.id),
      heardHistory,
      queueRankOptions,
    );
    const queueSongs = [selectedSong, ...rankedSongs].slice(
      0,
      Math.max(1, queuePolicy.genreQueueSize),
    );
    startDiscoveryQueue({
      description: spanish
        ? "Cola de canciones del genero"
        : "Genre playback queue",
      id: `genre-${normalizedGenreKey(genre)}`,
      preferredSongId: selectedSong.id,
      songs: queueSongs,
      title: discoveryGenreLabel(locale, genre),
    });
  };

  useEffect(() => {
    if (
      destination ||
      activeCardKey ||
      activeQueue ||
      workspacePlayback.activeSong ||
      !continuousDiscoverySongs.length
    ) {
      return;
    }

    startDiscoveryQueue({
      description: spanish
        ? "Una cola viva con canciones que pueden reproducirse dentro de First Listen."
        : "A live queue of songs playable inside First Listen.",
      id: "continuous_discovery",
      preserveOrder: true,
      songs: continuousDiscoverySongs,
      title: spanish ? "Descubrimiento continuo" : "Continuous discovery",
    });
  }, [
    activeCardKey,
    activeQueue,
    continuousDiscoverySongs,
    destination,
    spanish,
    startDiscoveryQueue,
    workspacePlayback.activeSong,
  ]);

  const rawCategoryConfigs: DiscoveryCategoryConfig[] = [
    {
      key: "top_results",
      icon: <Trophy size={18} />,
      title: sectionTitle(
        "top_results",
        spanish ? "Top 10 por resultados" : "Top 10 by results",
      ),
      description: spanish
        ? "Canciones con mejores resultados reales."
        : "Songs performing best with real listeners.",
      primaryLabel: spanish ? "Reproducir Top 10" : "Play Top 10",
      secondaryLabel: spanish ? "Ver lista" : "View list",
      songs: visibleTopTenSongs.slice(0, limits.topTenCount),
      queueSongs: topTenQueueSongs,
      queueable: true,
      preserveOrder: true,
      contextKind: "top",
      contextLabel: spanish ? "Resultados reales" : "Real results",
      emptyText: spanish
        ? "El Top 10 aparecera cuando haya suficientes respuestas."
        : "Top 10 will appear after enough responses.",
    },
    {
      key: "internal_playback",
      icon: <Headphones size={18} />,
      title: sectionTitle(
        "internal_playback",
        spanish
          ? "Reproduccion dentro de First Listen"
          : "Playback inside First Listen",
      ),
      description: spanish
        ? "Escucha y avanza hacia tokens."
        : "Listen and progress toward tokens.",
      primaryLabel: spanish ? "Reproducir" : "Play",
      secondaryLabel: spanish ? "Ver catalogo" : "View catalog",
      songs: internalPlaybackSongs,
      queueable: true,
      contextKind: "internal",
      contextLabel: spanish
        ? "Cuenta para Banco de Tiempo"
        : "Counts toward Time Bank",
      emptyText: spanish
        ? "Aun no hay canciones con reproduccion dentro de First Listen."
        : "No First Listen playback songs are available yet.",
    },
    {
      key: "random",
      icon: <Play size={18} />,
      title: sectionTitle("random", spanish ? "Modo Aleatorio" : "Random Mode"),
      description: spanish
        ? "Canciones no escuchadas primero; repeticion inteligente despues."
        : "Unheard songs first; smart replay after that.",
      primaryLabel: spanish ? "Descubrir sin filtros" : "Discover without filters",
      songs: randomQueueSongs,
      queueable: true,
      contextKind: "random",
      contextLabel: spanish
        ? "Descubrimiento aleatorio"
        : "Random discovery",
      emptyText: spanish
        ? "Agrega canciones con reproduccion dentro de First Listen para activar el modo aleatorio."
        : "Add songs playable inside First Listen to activate random discovery.",
    },
    {
      key: "external_discovery",
      icon: <ExternalLink size={18} />,
      title: sectionTitle(
        "external_discovery",
        spanish ? "Plataformas externas" : "External platforms",
      ),
      description: "Spotify / YouTube Music / Apple / SoundCloud",
      primaryLabel: spanish ? "Explorar" : "Explore",
      secondaryLabel: spanish ? "Ver canciones" : "View songs",
      songs: externalPlatformSongs,
      contextKind: "external",
      contextLabel: spanish
        ? "Abre fuera de First Listen"
        : "Opens outside First Listen",
      emptyText: spanish
        ? "Las plataformas externas apareceran cuando los artistas agreguen enlaces."
        : "External platforms will appear as artists add links.",
    },
    {
      key: "genres",
      icon: <Music2 size={18} />,
      title: sectionTitle("genres", spanish ? "Generos" : "Genres"),
      description: spanish
        ? "Reproduce una cola completa por estilo."
        : "Play a full queue by style.",
      primaryLabel: spanish ? "Ver generos" : "View genres",
      songs: genreSections.flatMap((section) => section.songs),
      contextKind: "genre",
      contextLabel: spanish ? "Genero" : "Genre",
      emptyText: spanish
        ? "Los generos apareceran cuando haya mas canciones."
        : "Genres will appear as the catalog grows.",
    },
    {
      key: "trending",
      icon: <Rocket size={18} />,
      title: sectionTitle("trending", spanish ? "Tendencias" : "Trending"),
      description: spanish
        ? "Canciones con actividad reciente."
        : "Songs with recent momentum.",
      primaryLabel: spanish ? "Ver canciones" : "View songs",
      songs: trendingSongs,
      contextKind: "trending",
      contextLabel: spanish ? "Creciendo rapido" : "Fast-growing",
      emptyText: spanish
        ? "Las tendencias apareceran cuando haya actividad reciente."
        : "Trending songs will appear after recent activity.",
    },
    {
      key: "newest_songs",
      icon: <CalendarDays size={18} />,
      title: sectionTitle(
        "newest_songs",
        spanish ? "Nuevos lanzamientos" : "New releases",
      ),
      description: spanish ? "Publicadas recientemente." : "Recently published.",
      primaryLabel: spanish ? "Ver canciones" : "View songs",
      songs: newestSongs,
      contextKind: "new",
      contextLabel: spanish ? "Nuevo lanzamiento" : "New release",
      emptyText: spanish
        ? "Los nuevos lanzamientos apareceran aqui."
        : "New releases will appear here.",
    },
    {
      key: "most_supported",
      icon: <ThumbsUp size={18} />,
      title: sectionTitle(
        "most_supported",
        spanish ? "Mas apoyadas" : "Most supported",
      ),
      description: spanish
        ? "Guardadas, seguidas y apoyadas por la comunidad."
        : "Saved, followed, and supported by the community.",
      primaryLabel: spanish ? "Ver canciones" : "View songs",
      songs: mostSupportedSongs,
      contextKind: "support",
      contextLabel: spanish
        ? "Apoyo de la comunidad"
        : "Community support",
      emptyText: spanish
        ? "Las canciones mas apoyadas apareceran con mas actividad."
        : "Most supported songs will appear with more activity.",
    },
    {
      key: "most_listened",
      icon: <Gauge size={18} />,
      title: sectionTitle(
        "most_listened",
        spanish ? "Mas escuchadas" : "Most listened",
      ),
      description: spanish
        ? "Mayor actividad de reproduccion."
        : "Highest listening activity.",
      primaryLabel: spanish ? "Ver canciones" : "View songs",
      songs: mostListenedSongs,
      contextKind: "listened",
      contextLabel: spanish
        ? "Mayor tiempo reproducido"
        : "Most play time",
      emptyText: spanish
        ? "Las canciones mas escuchadas apareceran cuando haya mas reproducciones."
        : "Most listened songs will appear after more playback activity.",
    },
  ];
  const categoryByKey = new Map(
    rawCategoryConfigs.map((config) => [config.key, config]),
  );
  const categoryConfigForSection = (key: DiscoveryHubSectionKey) =>
    key === "spotlight" ? undefined : categoryByKey.get(key as DiscoveryCategoryKey);
  const categoryConfigs = discoveryHub.sections
    .filter(
      (section) => section.key !== "spotlight" && sectionVisible(section.key),
    )
    .map((section) => categoryConfigForSection(section.key))
    .filter((config): config is DiscoveryCategoryConfig => Boolean(config));
  const expandedConfig =
    categoryConfigs.find((config) => config.key === expandedCategory) ?? null;

  const startCategoryQueue = (config: DiscoveryCategoryConfig) => {
    const queueSongs = config.queueSongs ?? config.songs;
    startDiscoveryQueue({
      description: config.description,
      id: config.key,
      preserveOrder: config.preserveOrder,
      songs: queueSongs,
      title: config.title,
    });
  };

  const renderSpotlightSection = () => (
    <section className="panel discovery-section" data-platform-module="spotlight">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            <Sparkles size={13} />
            {spanish ? "Destacadas" : "Featured"}
          </span>
          <h3>
            {sectionTitle(
              "spotlight",
              spanish
                ? "Destacadas por First Listen"
                : "Featured by First Listen",
            )}
          </h3>
        </div>
        <small>
          {spanish
            ? "Seleccionadas por First Listen"
            : "Selected by First Listen"}
        </small>
      </div>
      {visibleSpotlightSongs.length ? (
        <div className="discovery-song-grid">
          {visibleSpotlightSongs.map((song) => {
            const cardKey = `spotlight-${song.id}`;
            return (
              <DiscoverySongCard
                active={activeCardKey === cardKey}
                contextKind="spotlight"
                contextLabel={
                  spanish ? "Seleccion editorial" : "Editorial pick"
                }
                key={cardKey}
                locale={locale}
                onListeningCredited={onListeningCredited}
                onPlay={() =>
                  playDiscoveryCardQueue({
                    cardKey,
                    description: spanish
                      ? "Cola de canciones destacadas"
                      : "Featured song queue",
                    id: "spotlight",
                    preserveOrder: true,
                    selectedSong: song,
                    songs: visibleSpotlightSongs,
                    title: sectionTitle(
                      "spotlight",
                      spanish
                        ? "Destacadas por First Listen"
                        : "Featured by First Listen",
                    ),
                  })
                }
                song={song}
                workspacePlayback={workspacePlayback}
              />
            );
          })}
        </div>
      ) : (
        <p className="discovery-empty">
          {spanish
            ? "Las proximas canciones destacadas apareceran aqui."
            : "The next featured songs will appear here."}
        </p>
      )}
    </section>
  );

  const renderCatalogSongs = (
    songs: DiscoverySong[],
    config: DiscoveryCategoryConfig,
  ) => {
    if (!songs.length) {
      return <p className="discovery-empty">{config.emptyText}</p>;
    }
    const visibleSongs = songs.slice(0, catalogPreviewLimit);
    return (
      <>
        <div className="discovery-catalog-grid">
          {visibleSongs.map((song) => {
            const cardKey = `${config.key}-${song.id}`;
            return (
              <DiscoverySongCard
                active={activeCardKey === cardKey}
                contextKind={config.contextKind}
                contextLabel={config.contextLabel}
                key={cardKey}
                locale={locale}
                onListeningCredited={onListeningCredited}
                onPlay={() =>
                  playDiscoveryCardQueue({
                    cardKey,
                    description: config.description,
                    id: config.key,
                    preserveOrder: config.preserveOrder,
                    selectedSong: song,
                    songs: config.queueSongs ?? config.songs,
                    title: config.title,
                  })
                }
                song={song}
                topTen={config.key === "top_results"}
                workspacePlayback={workspacePlayback}
              />
            );
          })}
        </div>
        {songs.length > visibleSongs.length && (
          <p className="discovery-catalog-limit-note">
            {spanish
              ? `${visibleSongs.length} de ${songs.length} canciones visibles. Usa reproducir para escuchar la cola completa.`
              : `${visibleSongs.length} of ${songs.length} songs visible. Use play to hear the full queue.`}
          </p>
        )}
      </>
    );
  };

  const orderedVisibleSections = discoveryHub.sections.filter((section) =>
    sectionVisible(section.key),
  );
  const spotlightIndex = orderedVisibleSections.findIndex(
    (section) => section.key === "spotlight",
  );
  const navigationConfigsBeforeSpotlight =
    spotlightIndex === -1
      ? categoryConfigs
      : orderedVisibleSections
          .slice(0, spotlightIndex)
          .map((section) => categoryConfigForSection(section.key))
          .filter((config): config is DiscoveryCategoryConfig => Boolean(config));
  const navigationConfigsAfterSpotlight =
    spotlightIndex === -1
      ? []
      : orderedVisibleSections
          .slice(spotlightIndex + 1)
          .map((section) => categoryConfigForSection(section.key))
          .filter((config): config is DiscoveryCategoryConfig => Boolean(config));

  const renderNavigationPanel = (
    configs: DiscoveryCategoryConfig[],
    panelKey: string,
  ) => {
    if (!configs.length) return null;
    return (
      <section className="panel discovery-navigation-panel" key={panelKey}>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              <ListMusic size={13} />
              {spanish ? "Navegacion rapida" : "Quick navigation"}
            </span>
            <h3>
              {spanish
                ? "Elige como quieres descubrir"
                : "Choose how you want to discover"}
            </h3>
          </div>
          <small>
            {spanish
              ? "Sin scroll infinito"
              : "No endless scrolling"}
          </small>
        </div>
        <div className="discovery-navigation-grid">
          {configs.map((config) => {
            const queueSongs = config.queueSongs ?? config.songs;
            const primaryDisabled = config.queueable
              ? queueSongs.length === 0
              : config.songs.length === 0;
            const secondaryDisabled = config.songs.length === 0;
            const expanded = expandedCategory === config.key;
            return (
              <article
                className={`discovery-nav-card${expanded ? " active" : ""}`}
                data-platform-module={config.key}
                key={config.key}
              >
                <div className="discovery-nav-card-icon">{config.icon}</div>
                <div>
                  <h4>{config.title}</h4>
                  <p>{config.description}</p>
                  <small>
                    {config.key === "genres"
                      ? `${genreSections.length} ${spanish ? "generos" : "genres"}`
                      : `${config.songs.length} ${spanish ? "canciones" : "songs"}`}
                  </small>
                </div>
                <div className="discovery-nav-actions">
                  {config.queueable ? (
                    <button
                      disabled={primaryDisabled}
                      onClick={() => startCategoryQueue(config)}
                      type="button"
                    >
                      <Play size={14} />
                      {config.primaryLabel}
                    </button>
                  ) : (
                    <button
                      disabled={primaryDisabled}
                      onClick={() =>
                        config.key === "genres"
                          ? onNavigateDestination({ type: "genres" })
                          : toggleCategory(config.key)
                      }
                      type="button"
                    >
                      <ArrowRight size={14} />
                      {config.primaryLabel}
                    </button>
                  )}
                  {config.secondaryLabel && (
                    <button
                      disabled={secondaryDisabled}
                      onClick={() => toggleCategory(config.key)}
                      type="button"
                    >
                      <ListMusic size={14} />
                      {config.secondaryLabel}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    );
  };

  const renderActiveQueuePanel = () => {
    if (!activeQueue || !activeQueueSong) return null;
    const workspaceQueue: WorkspaceActiveQueue = {
      currentIndex: activeQueue.currentIndex,
      id: activeQueue.id,
      mode: activeQueue.mode,
      songs: activeQueue.songs,
      title: activeQueue.title,
      total: activeQueue.songs.length,
    };

    return (
      <section className="panel discovery-queue-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              <Play size={13} />
              {spanish ? "Cola activa" : "Active queue"}
            </span>
            <h3>{activeQueue.title}</h3>
          </div>
          <small>
            {activeQueue.currentIndex + 1}/{activeQueue.songs.length}
            {activeQueue.cycle > 0
              ? spanish
                ? " - repeticion inteligente"
                : " - smart replay"
              : ""}
          </small>
        </div>
        <p className="discovery-queue-copy">{activeQueue.description}</p>
        <div className="discovery-queue-grid">
          <DiscoverySongCard
            active
            contextKind={
              activeQueue.id.startsWith("genre-")
                ? "genre"
                : activeQueue.id === "top_results"
                  ? "top"
                  : activeQueue.id === "external_discovery"
                    ? "external"
                    : activeQueue.id === "internal_playback"
                      ? "internal"
                      : activeQueue.id
            }
            contextLabel={activeQueue.title}
            key={`${activeQueue.id}-${activeQueue.cycle}-${activeQueueSong.id}`}
            locale={locale}
            onListeningCredited={onListeningCredited}
            onQueueAutoPlayChange={changeDiscoveryQueueAutoPlay}
            onPlay={stopDiscoveryQueue}
            onQueueEnded={advanceDiscoveryQueue}
            onQueueNext={advanceDiscoveryQueue}
            queueAutoPlayEnabled={activeQueue.autoPlayEnabled}
            queueIndex={activeQueue.currentIndex + 1}
            queueLabel={activeQueue.title}
            queueLength={activeQueue.songs.length}
            song={activeQueueSong}
            topTen={activeQueue.id === "top_results"}
            workspacePlayback={workspacePlayback}
            workspaceQueue={workspaceQueue}
          />
        </div>
      </section>
    );
  };

  const renderGenreDestinationHero = ({
    copy,
    title,
  }: {
    copy: string;
    title: string;
  }) => (
    <section className="discovery-destination-hero">
      <div>
        <div className="discovery-breadcrumbs">
          <button type="button" onClick={() => onNavigateDestination()}>
            {spanish ? "Descubrir música" : "Discover music"}
          </button>
          <span>/</span>
          <button
            type="button"
            onClick={() => onNavigateDestination({ type: "genres" })}
          >
            {spanish ? "Géneros" : "Genres"}
          </button>
        </div>
        <span className="eyebrow">
          <Music2 size={13} />
          {spanish ? "Destino de descubrimiento" : "Discovery destination"}
        </span>
        <h2>{title}</h2>
        <p>{copy}</p>
      </div>
      <div className="discovery-hub-stats">
        <span>
          <strong>{genreSections.length}</strong>
          {spanish ? "géneros visibles" : "visible genres"}
        </span>
        <span>
          <strong>{internalPlaybackCatalog.length}</strong>
          {spanish ? "reproducen aquí" : "play here"}
        </span>
        <span>
          <strong>{queuePolicy.genreQueueSize}</strong>
          {spanish ? "por cola" : "per queue"}
        </span>
      </div>
    </section>
  );

  const renderGenresDestination = () => {
    const genresEnabled = sectionVisible("genres");

    return (
      <div className="dashboard-discovery discovery-destination-view">
        {renderGenreDestinationHero({
          copy: spanish
            ? "Elige un género para abrir una página dedicada con cola, canciones compactas y reproducción dentro de First Listen."
            : "Choose a genre to open a dedicated page with queue controls, compact songs, and playback inside First Listen.",
          title: spanish ? "Géneros" : "Genres",
        })}

        {renderActiveQueuePanel()}

        <section className="panel discovery-destination-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                <ListMusic size={13} />
                {spanish ? "Navega por estilo" : "Browse by style"}
              </span>
              <h3>
                {spanish
                  ? "Elige una cola de género"
                  : "Choose a genre queue"}
              </h3>
            </div>
            <small>
              {spanish
                ? "Configurado por Owner Control Center"
                : "Configured by Owner Control Center"}
            </small>
          </div>

          {!genresEnabled ? (
            <p className="discovery-empty">
              {spanish
                ? "Los géneros están ocultos por la configuración actual."
                : "Genres are hidden by the current configuration."}
            </p>
          ) : genreSections.length ? (
            <div className="genre-destination-grid">
              {genreSections.map(({ genre, queueSongs, songs }) => (
                <article className="genre-destination-card" key={genre}>
                  <header>
                    <span aria-hidden>{discoveryGenreEmoji(genre)}</span>
                    <div>
                      <h4>{discoveryGenreLabel(locale, genre)}</h4>
                      <small>
                        {songs.length} {spanish ? "canciones" : "songs"}
                      </small>
                    </div>
                  </header>
                  <p>
                    {spanish
                      ? "Abre una página dedicada o empieza una cola con canciones que pueden reproducirse dentro de First Listen."
                      : "Open a dedicated page or start a queue with songs playable inside First Listen."}
                  </p>
                  <div className="discovery-nav-actions">
                    <button
                      disabled={!queueSongs.length}
                      onClick={() => playGenre(genre, queueSongs)}
                      type="button"
                    >
                      <Play size={14} />
                      {spanish ? "Reproducir género" : "Play genre"}
                    </button>
                    <button
                      onClick={() =>
                        onNavigateDestination({
                          slug: discoveryGenreSlug(genre),
                          type: "genre",
                        })
                      }
                      type="button"
                    >
                      <ArrowRight size={14} />
                      {spanish ? "Ver canciones" : "View songs"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="discovery-empty">
              {spanish
                ? "Los géneros aparecerán cuando haya canciones reproducibles dentro de First Listen."
                : "Genres will appear when playable songs are available inside First Listen."}
            </p>
          )}
        </section>
      </div>
    );
  };

  const renderGenreSongRows = (
    genre: string,
    songs: DiscoverySong[],
  ) => {
    if (!songs.length) {
      return (
        <p className="discovery-empty">
          {spanish
            ? "Aún no hay canciones disponibles para este género."
            : "No songs are available for this genre yet."}
        </p>
      );
    }

    return (
      <div className="discovery-compact-list">
        {songs.map((song) => (
          <article className="discovery-compact-row" key={song.id}>
            <Image
              alt=""
              height={54}
              src={song.coverUrl}
              unoptimized
              width={54}
            />
            <div>
              <h4>{song.title}</h4>
              <ArtistNameLink artistId={song.artistId} name={song.artist} />
              <small>
                {song.platform} / {optionLabel(locale, song.language)}
              </small>
            </div>
            <button
              onClick={() => playGenreSong(genre, songs, song)}
              type="button"
            >
              <Play size={14} />
              {spanish ? "Escuchar" : "Listen"}
            </button>
          </article>
        ))}
      </div>
    );
  };

  const renderGenreDetailDestination = () => {
    const genresEnabled = sectionVisible("genres");
    const destinationSlug =
      destination?.type === "genre" ? destination.slug : "";
    const activeGenreSection =
      genreSections.find(
        (section) => discoveryGenreSlug(section.genre) === destinationSlug,
      ) ?? null;

    if (!genresEnabled || !activeGenreSection) {
      return (
        <div className="dashboard-discovery discovery-destination-view">
          {renderGenreDestinationHero({
            copy: spanish
              ? "Este género no está visible o no tiene canciones reproducibles dentro de First Listen."
              : "This genre is not visible or does not have playable songs inside First Listen.",
            title: spanish ? "Género no disponible" : "Genre unavailable",
          })}
          <section className="panel discovery-destination-panel">
            <p className="discovery-empty">
              {spanish
                ? "Vuelve a la lista de géneros para elegir una cola disponible."
                : "Return to the genre list to choose an available queue."}
            </p>
            <button
              className="secondary-button"
              onClick={() => onNavigateDestination({ type: "genres" })}
              type="button"
            >
              <ArrowRight size={14} />
              {spanish ? "Ver géneros" : "View genres"}
            </button>
          </section>
        </div>
      );
    }

    return (
      <div className="dashboard-discovery discovery-destination-view">
        {renderGenreDestinationHero({
          copy: spanish
            ? "Una cola enfocada en este género. Elige una canción o reproduce la cola completa."
            : "A focused queue for this genre. Pick a song or play the full queue.",
          title: `${discoveryGenreEmoji(activeGenreSection.genre)} ${discoveryGenreLabel(
            locale,
            activeGenreSection.genre,
          )}`,
        })}

        <section className="panel discovery-destination-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                <Headphones size={13} />
                {spanish ? "Cola del género" : "Genre queue"}
              </span>
              <h3>
                {discoveryGenreLabel(locale, activeGenreSection.genre)}
              </h3>
            </div>
            <small>
              {activeGenreSection.songs.length}{" "}
              {spanish ? "canciones" : "songs"}
            </small>
          </div>
          <div className="genre-destination-actions">
            <button
              className="primary-button"
              disabled={!activeGenreSection.queueSongs.length}
              onClick={() =>
                playGenre(
                  activeGenreSection.genre,
                  activeGenreSection.queueSongs,
                )
              }
              type="button"
            >
              <Play size={15} />
              {spanish ? "Reproducir género" : "Play genre"}
            </button>
            <button
              className="secondary-button"
              onClick={() => onNavigateDestination({ type: "genres" })}
              type="button"
            >
              <ListMusic size={14} />
              {spanish ? "Todos los géneros" : "All genres"}
            </button>
          </div>
        </section>

        {renderActiveQueuePanel()}

        <section className="panel discovery-destination-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                <ListMusic size={13} />
                {spanish ? "Canciones" : "Songs"}
              </span>
              <h3>
                {spanish ? "Lista compacta" : "Compact list"}
              </h3>
            </div>
            <small>
              {spanish
                ? "Un solo reproductor por cola"
                : "One player per queue"}
            </small>
          </div>
          {renderGenreSongRows(
            activeGenreSection.genre,
            activeGenreSection.songs,
          )}
        </section>
      </div>
    );
  };

  if (destination?.type === "genres") {
    return renderGenresDestination();
  }

  if (destination?.type === "genre") {
    return renderGenreDetailDestination();
  }

  return (
    <div className="dashboard-discovery">
      <section className="discovery-hub-hero">
        <div>
          <span className="eyebrow">
            <Sparkles size={13} />
            {spanish ? "Centro de descubrimiento" : "Discovery hub"}
          </span>
          <h2>{spanish ? "Descubrir mas musica" : "Discover more music"}</h2>
          <p>
            {spanish
              ? "Encuentra canciones para escuchar, artistas para apoyar y nuevos lanzamientos antes de revisar estadisticas."
              : "Find songs to play, artists to support, and new releases before digging into analytics."}
          </p>
        </div>
        <div className="discovery-hub-stats">
          <span>
            <strong>{allDiscoverySongs.length}</strong>
            {spanish ? "canciones" : "songs"}
          </span>
          <span>
            <strong>{internalPlaybackSongs.length}</strong>
            {spanish ? "reproducen aqui" : "play here"}
          </span>
          <span>
            <strong>{genreSections.length}</strong>
            {spanish ? "generos" : "genres"}
          </span>
        </div>
      </section>

      {renderNavigationPanel(navigationConfigsBeforeSpotlight, "before-spotlight")}
      {spotlightIndex !== -1 && renderSpotlightSection()}
      {renderNavigationPanel(navigationConfigsAfterSpotlight, "after-spotlight")}

      {renderActiveQueuePanel()}

      {expandedCategory === "genres" && (
        <section className="panel discovery-catalog-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                <Music2 size={13} />
                {spanish ? "Generos" : "Genres"}
              </span>
              <h3>{spanish ? "Reproducir por genero" : "Play by genre"}</h3>
            </div>
            <small>
              {spanish
                ? "Cada genero crea una cola"
                : "Each genre creates a queue"}
            </small>
          </div>
          {genreSections.length ? (
            <div className="genre-navigation-grid">
              {genreSections.map(({ genre, queueSongs, songs }) => (
                <article className="genre-nav-card" key={genre}>
                  <header>
                    <span aria-hidden>{discoveryGenreEmoji(genre)}</span>
                    <div>
                      <h4>{discoveryGenreLabel(locale, genre)}</h4>
                      <small>
                        {songs.length} {spanish ? "canciones" : "songs"}
                      </small>
                    </div>
                  </header>
                  <div className="discovery-nav-actions">
                    <button
                      onClick={() => playGenre(genre, queueSongs)}
                      type="button"
                    >
                      <Play size={14} />
                      {spanish ? "Reproducir genero" : "Play genre"}
                    </button>
                    <button
                      onClick={() =>
                        onNavigateDestination({
                          slug: discoveryGenreSlug(genre),
                          type: "genre",
                        })
                      }
                      type="button"
                    >
                      <ListMusic size={14} />
                      {spanish ? "Ver canciones" : "View songs"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="discovery-empty">
              {spanish
                ? "Los generos apareceran cuando haya canciones publicadas."
                : "Genres will appear after songs are published."}
            </p>
          )}
        </section>
      )}

      {expandedConfig && expandedConfig.key !== "genres" && (
        <section className="panel discovery-catalog-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{expandedConfig.icon}</span>
              <h3>{expandedConfig.title}</h3>
            </div>
            <small>{expandedConfig.description}</small>
          </div>
          {renderCatalogSongs(expandedConfig.songs, expandedConfig)}
        </section>
      )}

      <p className="discovery-scalability-note">
        {spanish
          ? "First Listen muestra rutas de descubrimiento compactas y usa colas para que el catalogo siga siendo facil de explorar cuando crezca."
          : "First Listen uses compact discovery routes and queues so the catalog stays easy to explore as it grows."}
      </p>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ExpandedDiscoverySections({
  spotlightSongs,
  topTenSongs,
  externalDiscoverySongs,
  locale,
  onListeningCredited,
  workspacePlayback,
}: {
  spotlightSongs: DiscoverySong[];
  topTenSongs: DiscoverySong[];
  externalDiscoverySongs: DiscoverySong[];
  locale: InterfaceLocale;
  onListeningCredited: (
    seconds: number,
    becameValid: boolean,
    becameComplete: boolean,
    completionRate: number,
  ) => void;
  workspacePlayback: WorkspacePlaybackController;
}) {
  const [activeCardKey, setActiveCardKey] = useState<string | null>(null);
  const [heardHistory, setHeardHistory] = useState<Record<string, number>>({});
  const [randomSong, setRandomSong] = useState<DiscoverySong | null>(null);
  const spanish = locale === "es";
  const spotlightIds = new Set(spotlightSongs.map((song) => song.id));
  const visibleTopTenSongs = topTenSongs.filter(
    (song) => !spotlightIds.has(song.id),
  );
  const allDiscoverySongs = useMemo(
    () =>
      mergeDiscoverySongs(
        spotlightSongs,
        topTenSongs,
        externalDiscoverySongs,
      ),
    [externalDiscoverySongs, spotlightSongs, topTenSongs],
  );
  const internalPlaybackSongs = useMemo(
    () =>
      sortDiscoverySongs(
        allDiscoverySongs.filter(isInternalDiscoverySong),
        (left, right) =>
          exposureScore(left) - exposureScore(right) ||
          trendScore(right) - trendScore(left),
        4,
      ),
    [allDiscoverySongs],
  );
  const externalPlatformSongs = useMemo(
    () =>
      sortDiscoverySongs(
        allDiscoverySongs.filter(hasExternalDiscoveryDestination),
        (left, right) =>
          Number(right.feedKind === "external_song") -
            Number(left.feedKind === "external_song") ||
          submittedTime(right) - submittedTime(left) ||
          trendScore(right) - trendScore(left),
        4,
      ),
    [allDiscoverySongs],
  );
  const trendingSongs = useMemo(() => {
    const explicitTrending = allDiscoverySongs.filter(
      (song) => song.feedKind === "trending_external",
    );
    return sortDiscoverySongs(
      explicitTrending.length ? explicitTrending : allDiscoverySongs,
      (left, right) => trendScore(right) - trendScore(left),
      4,
    );
  }, [allDiscoverySongs]);
  const newestSongs = useMemo(
    () =>
      sortDiscoverySongs(
        allDiscoverySongs,
        (left, right) => submittedTime(right) - submittedTime(left),
        4,
      ),
    [allDiscoverySongs],
  );
  const mostSupportedSongs = useMemo(
    () =>
      sortDiscoverySongs(
        allDiscoverySongs,
        (left, right) => supportScore(right) - supportScore(left),
        4,
      ),
    [allDiscoverySongs],
  );
  const mostListenedSongs = useMemo(
    () =>
      sortDiscoverySongs(
        allDiscoverySongs,
        (left, right) =>
          right.totalListeningSeconds - left.totalListeningSeconds ||
          right.completionRate - left.completionRate,
        4,
      ),
    [allDiscoverySongs],
  );
  const genreSections = useMemo(() => {
    const grouped = new Map<string, DiscoverySong[]>();
    for (const song of allDiscoverySongs) {
      const genre = song.genre || "Other";
      grouped.set(genre, [...(grouped.get(genre) ?? []), song]);
    }
    const priorityGenres = [
      "Cumbia",
      "Regional Mexican",
      "Hip Hop",
      "Bachata",
      "Chilena",
    ];
    return Array.from(grouped.entries())
      .sort(([left], [right]) => {
        const leftPriority = priorityGenres.indexOf(left);
        const rightPriority = priorityGenres.indexOf(right);
        if (leftPriority !== -1 || rightPriority !== -1) {
          if (leftPriority === -1) return 1;
          if (rightPriority === -1) return -1;
          return leftPriority - rightPriority;
        }
        return left.localeCompare(right);
      })
      .slice(0, 6)
      .map(([genre, songs]) => ({
        genre,
        songs: sortDiscoverySongs(
          songs,
          (left, right) =>
            exposureScore(left) - exposureScore(right) ||
            trendScore(right) - trendScore(left),
          2,
        ),
      }))
      .filter((section) => section.songs.length > 0);
  }, [allDiscoverySongs]);
  const randomCandidate =
    randomSong && allDiscoverySongs.some((song) => song.id === randomSong.id)
      ? randomSong
      : smartDiscoveryPick(allDiscoverySongs, heardHistory);

  useEffect(() => {
    setHeardHistory(readDiscoveryHeardHistory());
  }, []);

  const markSongHeard = useCallback((song: DiscoverySong) => {
    const timestamp = Date.now();
    setHeardHistory((current) => {
      const next = { ...current, [song.id]: timestamp };
      writeDiscoveryHeardHistory(next);
      return next;
    });
  }, []);

  const toggleDiscoveryCard = useCallback(
    (cardKey: string, song: DiscoverySong) => {
      if (activeCardKey !== cardKey) markSongHeard(song);
      setActiveCardKey((current) => (current === cardKey ? null : cardKey));
    },
    [activeCardKey, markSongHeard],
  );

  const openDiscoveryCard = useCallback(
    (cardKey: string, song: DiscoverySong) => {
      markSongHeard(song);
      setActiveCardKey(cardKey);
    },
    [markSongHeard],
  );

  const playRandomSong = () => {
    const selected = smartDiscoveryPick(allDiscoverySongs, heardHistory);
    if (!selected) return;
    setRandomSong(selected);
    openDiscoveryCard(`random-${selected.id}`, selected);
  };

  const playGenre = (genre: string, songs: DiscoverySong[]) => {
    const selected = smartDiscoveryPick(songs, heardHistory) ?? songs[0];
    if (!selected) return;
    openDiscoveryCard(
      `genre-${normalizedGenreKey(genre)}-${selected.id}`,
      selected,
    );
  };

  const renderSongSection = ({
    badge,
    cardContextKind,
    cardContextLabel,
    description,
    emptyText,
    module,
    songs,
    title,
    topTen,
  }: {
    badge: ReactNode;
    cardContextKind: string;
    cardContextLabel: string;
    description: string;
    emptyText: string;
    module: string;
    songs: DiscoverySong[];
    title: string;
    topTen?: boolean;
  }) => (
    <section className="panel discovery-section" data-platform-module={module}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{badge}</span>
          <h3>{title}</h3>
        </div>
        <small>{description}</small>
      </div>
      {songs.length ? (
        <div className="discovery-song-grid">
          {songs.map((song) => {
            const cardKey = `${module}-${song.id}`;
            return (
              <DiscoverySongCard
                active={activeCardKey === cardKey}
                contextKind={cardContextKind}
                contextLabel={cardContextLabel}
                key={cardKey}
                locale={locale}
                onListeningCredited={onListeningCredited}
                onPlay={() => toggleDiscoveryCard(cardKey, song)}
                song={song}
                topTen={topTen}
                workspacePlayback={workspacePlayback}
              />
            );
          })}
        </div>
      ) : (
        <p className="discovery-empty">{emptyText}</p>
      )}
    </section>
  );

  return (
    <div className="dashboard-discovery">
      <section className="discovery-hub-hero">
        <div>
          <span className="eyebrow">
            <Sparkles size={13} />
            {spanish ? "Centro de descubrimiento" : "Discovery hub"}
          </span>
          <h2>{spanish ? "Descubrir más música" : "Discover more music"}</h2>
          <p>
            {spanish
              ? "Encuentra canciones para escuchar, artistas para apoyar y nuevos lanzamientos antes de revisar las estadísticas."
              : "Find songs to play, artists to support, and new releases before digging into analytics."}
          </p>
        </div>
        <div className="discovery-hub-stats">
          <span>
            <strong>{allDiscoverySongs.length}</strong>
            {spanish ? "canciones" : "songs"}
          </span>
          <span>
            <strong>{internalPlaybackSongs.length}</strong>
            {spanish ? "reproducen aquí" : "play here"}
          </span>
          <span>
            <strong>{genreSections.length}</strong>
            {spanish ? "géneros" : "genres"}
          </span>
        </div>
      </section>

      {renderSongSection({
        badge: (
          <>
            <Sparkles size={13} />
            {spanish ? "Destacadas" : "Featured"}
          </>
        ),
        cardContextKind: "spotlight",
        cardContextLabel: spanish ? "Selección editorial" : "Editorial pick",
        description: spanish
          ? "Seleccionadas por First Listen"
          : "Selected by First Listen",
        emptyText: spanish
          ? "Las próximas canciones destacadas aparecerán aquí."
          : "The next featured songs will appear here.",
        module: "spotlight",
        songs: spotlightSongs,
        title: spanish
          ? "Destacadas por First Listen"
          : "Featured by First Listen",
      })}

      {renderSongSection({
        badge: (
          <>
            <Trophy size={13} />
            Top 10
          </>
        ),
        cardContextKind: "top",
        cardContextLabel: spanish ? "Resultados reales" : "Real results",
        description: spanish
          ? "Impulsadas por oyentes reales"
          : "Driven by real listener engagement",
        emptyText: spanish
          ? "El Top 10 aparecerá cuando haya suficientes respuestas y reproducciones."
          : "Top 10 will appear after songs receive enough responses and plays.",
        module: "top_results",
        songs: visibleTopTenSongs,
        title: spanish ? "Top 10 por resultados" : "Top 10 by results",
        topTen: true,
      })}

      {renderSongSection({
        badge: (
          <>
            <Headphones size={13} />
            {spanish ? "Reproduce aquí" : "Play here"}
          </>
        ),
        cardContextKind: "internal",
        cardContextLabel: spanish
          ? "Cuenta para Banco de Tiempo"
          : "Counts toward Time Bank",
        description: spanish
          ? "Descubre música y avanza hacia tokens"
          : "Discover music and progress toward tokens",
        emptyText: spanish
          ? "Aún no hay canciones con reproducción dentro de First Listen."
          : "No songs with First Listen playback are available yet.",
        module: "internal_playback",
        songs: internalPlaybackSongs,
        title: spanish
          ? "Reproducción dentro de First Listen"
          : "Playback inside First Listen",
      })}

      {renderSongSection({
        badge: (
          <>
            <ExternalLink size={13} />
            {spanish ? "Plataformas" : "Platforms"}
          </>
        ),
        cardContextKind: "external",
        cardContextLabel: spanish
          ? "Abre fuera de First Listen"
          : "Opens outside First Listen",
        description: "Spotify / YouTube Music / Apple / SoundCloud",
        emptyText: spanish
          ? "Las plataformas externas aparecerán cuando los artistas agreguen enlaces."
          : "External platforms will appear as artists add links.",
        module: "external_discovery",
        songs: externalPlatformSongs,
        title: spanish ? "Plataformas externas" : "External platforms",
      })}

      <section className="panel discovery-section discovery-random-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              <Play size={13} /> {spanish ? "MODO ALEATORIO" : "RANDOM MODE"}
            </span>
            <h3>
              {spanish ? "Descubrir sin filtros" : "Discover without filters"}
            </h3>
          </div>
          <small>
            {spanish
              ? "Prioriza canciones poco escuchadas"
              : "Prioritizes underexposed songs"}
          </small>
        </div>
        <div className="random-discovery-actions">
          <button
            className="primary-button"
            onClick={playRandomSong}
            type="button"
          >
            <Play size={15} />
            {spanish ? "Descubrir sin filtros" : "Discover without filters"}
          </button>
          <p>
            {spanish
              ? "Si ya escuchaste todo, First Listen mezcla contenido nuevo y canciones que necesitan más apoyo."
              : "When the catalog is exhausted, First Listen mixes new songs with older songs that still need support."}
          </p>
        </div>
        {randomCandidate ? (
          <div className="discovery-song-grid">
            <DiscoverySongCard
              active={activeCardKey === `random-${randomCandidate.id}`}
              contextKind="random"
              contextLabel={
                spanish ? "Descubrimiento aleatorio" : "Random discovery"
              }
              key={`random-${randomCandidate.id}`}
              locale={locale}
              onListeningCredited={onListeningCredited}
              onPlay={() =>
                toggleDiscoveryCard(
                  `random-${randomCandidate.id}`,
                  randomCandidate,
                )
              }
              song={randomCandidate}
              workspacePlayback={workspacePlayback}
            />
          </div>
        ) : (
          <p className="discovery-empty">
            {spanish
              ? "Agrega canciones para activar el modo aleatorio."
              : "Add songs to activate random discovery."}
          </p>
        )}
      </section>

      {genreSections.length > 0 && (
        <section className="panel discovery-section discovery-genre-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                <Music2 size={13} /> {spanish ? "Géneros" : "Genres"}
              </span>
              <h3>{spanish ? "Reproducir por género" : "Play by genre"}</h3>
            </div>
            <small>
              {spanish
                ? "Crece automáticamente con el catálogo"
                : "Expands automatically with the catalog"}
            </small>
          </div>
          <div className="genre-discovery-stack">
            {genreSections.map(({ genre, songs }) => (
              <div className="genre-discovery-row" key={genre}>
                <header>
                  <div>
                    <span aria-hidden>{discoveryGenreEmoji(genre)}</span>
                    <h4>{discoveryGenreLabel(locale, genre)}</h4>
                  </div>
                  <button onClick={() => playGenre(genre, songs)} type="button">
                    <Play size={14} />
                    {spanish ? "Reproducir género" : "Play genre"}
                  </button>
                </header>
                <div className="discovery-song-grid genre-discovery-grid">
                  {songs.map((song) => {
                    const cardKey = `genre-${normalizedGenreKey(genre)}-${song.id}`;
                    return (
                      <DiscoverySongCard
                        active={activeCardKey === cardKey}
                        contextKind="genre"
                        contextLabel={discoveryGenreLabel(locale, genre)}
                        key={cardKey}
                        locale={locale}
                        onListeningCredited={onListeningCredited}
                        onPlay={() => toggleDiscoveryCard(cardKey, song)}
                        song={song}
                        workspacePlayback={workspacePlayback}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {renderSongSection({
        badge: (
          <>
            <Rocket size={13} />
            {spanish ? "Tendencias" : "Trending"}
          </>
        ),
        cardContextKind: "trending",
        cardContextLabel: spanish ? "Creciendo rápido" : "Fast-growing",
        description: spanish
          ? "Actividad reciente de la comunidad"
          : "Recent community activity",
        emptyText: spanish
          ? "Las tendencias aparecerán cuando haya actividad reciente."
          : "Trending songs will appear after recent activity.",
        module: "trending",
        songs: trendingSongs,
        title: spanish ? "Tendencias" : "Trending",
      })}

      {renderSongSection({
        badge: (
          <>
            <CalendarDays size={13} />
            {spanish ? "Nuevo" : "New"}
          </>
        ),
        cardContextKind: "new",
        cardContextLabel: spanish ? "Nuevo lanzamiento" : "New release",
        description: spanish ? "Publicadas recientemente" : "Recently published",
        emptyText: spanish
          ? "Los nuevos lanzamientos aparecerán aquí."
          : "New releases will appear here.",
        module: "newest_songs",
        songs: newestSongs,
        title: spanish ? "Nuevos lanzamientos" : "New releases",
      })}

      {renderSongSection({
        badge: (
          <>
            <ThumbsUp size={13} />
            {spanish ? "Apoyo" : "Support"}
          </>
        ),
        cardContextKind: "support",
        cardContextLabel: spanish ? "Apoyo de la comunidad" : "Community support",
        description: spanish
          ? "Más guardadas, seguidas y apoyadas"
          : "Most saved, followed, and supported",
        emptyText: spanish
          ? "Las canciones más apoyadas aparecerán con más actividad."
          : "Most supported songs will appear with more activity.",
        module: "most_supported",
        songs: mostSupportedSongs,
        title: spanish ? "Más apoyadas" : "Most supported",
      })}

      {renderSongSection({
        badge: (
          <>
            <Gauge size={13} />
            {spanish ? "Escuchadas" : "Listened"}
          </>
        ),
        cardContextKind: "listened",
        cardContextLabel: spanish ? "Mayor tiempo reproducido" : "Most play time",
        description: spanish
          ? "Mayor actividad de reproducción"
          : "Highest listening activity",
        emptyText: spanish
          ? "Las canciones más escuchadas aparecerán cuando haya más reproducciones."
          : "Most listened songs will appear after more playback activity.",
        module: "most_listened",
        songs: mostListenedSongs,
        title: spanish ? "Más escuchadas" : "Most listened",
      })}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyDiscoverySections({
  spotlightSongs,
  topTenSongs,
  externalDiscoverySongs,
  locale,
  onListeningCredited,
  workspacePlayback,
}: {
  spotlightSongs: DiscoverySong[];
  topTenSongs: DiscoverySong[];
  externalDiscoverySongs: DiscoverySong[];
  locale: InterfaceLocale;
  onListeningCredited: (
    seconds: number,
    becameValid: boolean,
    becameComplete: boolean,
    completionRate: number,
  ) => void;
  workspacePlayback: WorkspacePlaybackController;
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
                song={song}
                workspacePlayback={workspacePlayback}
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
                song={song}
                topTen
                workspacePlayback={workspacePlayback}
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
        {externalDiscoverySongs.length ? (
          <div className="discovery-song-grid external-discovery-grid">
            {externalDiscoverySongs.slice(0, 12).map((song) => (
              <DiscoverySongCard
                active={activeSongId === song.id}
                key={`external-${song.badge ?? "feed"}-${song.id}-${song.position ?? 0}`}
                locale={locale}
                onListeningCredited={onListeningCredited}
                onPlay={() =>
                  setActiveSongId((current) =>
                    current === song.id ? null : song.id,
                  )
                }
                song={song}
                workspacePlayback={workspacePlayback}
              />
            ))}
          </div>
        ) : (
          <p className="discovery-empty">
            {spanish
              ? "La Discovery externa aparecera cuando haya enlaces o artistas externos activos."
              : "External Discovery will appear when external links or artists are active."}
          </p>
        )}
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

function PlatformPresenceManagerPanel({
  locale,
  notify,
  onLinkSaved,
  onLinkRemoved,
  onPrimaryChanged,
  song,
}: {
  locale: InterfaceLocale;
  notify?: (message: string) => void;
  onLinkSaved: (songId: string, link: SongPlatformLink) => void;
  onLinkRemoved: (songId: string, platform: Platform) => void;
  onPrimaryChanged: (
    songId: string,
    platform: PrimaryPlatform,
    url: string,
    links: SongPlatformLink[],
  ) => void;
  song: PlatformManagedSong;
}) {
  const spanish = locale === "es";
  const [targetPlatform, setTargetPlatform] = useState<Platform>(
    allPlatforms.find((platform) => platform !== song.platform) ?? "YouTube",
  );
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [youtubeMusicRecommendation, setYoutubeMusicRecommendation] =
    useState<SongPlatformLink | null>(null);
  const currentLinks = getPrimaryPlatformLinks(song);
  const primaryPlatformLink = currentLinks.find((link) => link.primary);
  const youtubeMusicLink = currentLinks.find(
    (link) => link.platform === "YouTube Music",
  );
  const showYoutubeMusicTip =
    Boolean(youtubeMusicLink) && primaryPlatformLink?.platform === "Spotify";
  const availablePlatforms = allPlatforms.filter(
    (platform) => platform !== song.platform,
  );
  const detection = detectMusicPlatform(url);
  const selectedMatches =
    !url.trim() ||
    (detection.valid &&
      (targetPlatform === "Other" || detection.platform === targetPlatform));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    if (!url.trim()) {
      setMessage(
        spanish ? "Pega un enlace verificado." : "Paste a verified link.",
      );
      return;
    }
    if (!selectedMatches) {
      setMessage(
        spanish
          ? `El enlace detectado no coincide con ${targetPlatform}.`
          : `The detected link does not match ${targetPlatform}.`,
      );
      return;
    }
    const supabase = createClient();
    if (!supabase) {
      setMessage(
        spanish
          ? "El servicio no esta disponible."
          : "The service is unavailable.",
      );
      return;
    }

    setSaving(true);
    const { data, error } = await supabase.rpc(
      "upsert_song_platform_presence_link",
      {
        target_song_id: song.id,
        target_platform: databasePlatform[targetPlatform],
        target_music_url: url.trim(),
        presence_note: note.trim() || null,
      },
    );
    setSaving(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    const row = data as PlatformLinkRow;
    const savedPlatform =
      allPlatforms.find(
        (platform) => databasePlatform[platform] === String(row.platform),
      ) ?? targetPlatform;
    const savedLink: SongPlatformLink = {
      platform: savedPlatform,
      url: String(row.music_url ?? url.trim()),
      primary: Boolean(row.is_primary),
      resolutionSource:
        row.resolution_source === "verified" ||
        row.resolution_source === "manual" ||
        row.resolution_source === "inferred"
          ? row.resolution_source
          : "submitted",
      confidenceScore: Number(row.confidence_score ?? 100),
    };
    onLinkSaved(song.id, savedLink);
    setUrl("");
    setNote("");
    setMessage(
      spanish
        ? "Destino de plataforma guardado."
        : "Platform destination saved.",
    );
    if (
      shouldShowYoutubeMusicDiscoveryRecommendation({
        primaryPlatform: savedLink.primary
          ? savedPlatform
          : primaryPlatformLink?.platform,
        savedPlatform,
        songId: song.id,
      })
    ) {
      setYoutubeMusicRecommendation(savedLink);
    }
  };

  const removeLink = async (link: SongPlatformLink) => {
    setMessage("");
    const supabase = createClient();
    if (!supabase) {
      setMessage(
        spanish
          ? "El servicio no esta disponible."
          : "The service is unavailable.",
      );
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("remove_song_platform_presence_link", {
      target_song_id: song.id,
      target_platform: databasePlatform[link.platform],
    });
    setSaving(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    onLinkRemoved(song.id, link.platform);
    setMessage(spanish ? "Enlace eliminado." : "Link removed.");
  };

  const makePrimary = async (
    link: SongPlatformLink,
    options?: { discoveryUpgrade?: boolean },
  ) => {
    setMessage("");
    if (!isPrimaryPlatform(link.platform)) {
      setMessage(
        spanish
          ? "Esta plataforma solo puede mostrarse como destino adicional."
          : "This platform can only be shown as an additional destination.",
      );
      return false;
    }
    const supabase = createClient();
    if (!supabase) {
      setMessage(
        spanish
          ? "El servicio no esta disponible."
          : "The service is unavailable.",
      );
      return false;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("set_song_primary_platform", {
      target_song_id: song.id,
      target_platform: databasePlatform[link.platform],
    });
    setSaving(false);
    if (error) {
      setMessage(error.message);
      return false;
    }
    const result = data as PlatformPresenceResult;
    const nextPlatform =
      allPlatforms.find(
        (platform) => databasePlatform[platform] === String(result.platform),
      ) ?? link.platform;
    if (!isPrimaryPlatform(nextPlatform)) {
      setMessage(
        spanish
          ? "No se pudo actualizar la plataforma principal de descubrimiento."
          : "The primary discovery platform could not be updated.",
      );
      return false;
    }
    const nextUrl = String(result.music_url ?? link.url);
    onPrimaryChanged(
      song.id,
      nextPlatform,
      nextUrl,
      mapSongPlatformLinks(result.platform_links, nextPlatform, nextUrl),
    );
    const successMessage = options?.discoveryUpgrade
      ? spanish
        ? "✅ Ajustes de descubrimiento actualizados. YouTube Music ahora es tu plataforma principal de descubrimiento."
        : "✅ Discovery settings updated. YouTube Music is now your Primary Discovery Platform."
      : spanish
        ? `${nextPlatform} ahora es la plataforma principal de descubrimiento.`
        : `${nextPlatform} is now the primary discovery platform.`;
    setMessage(successMessage);
    notify?.(successMessage);
    return true;
  };

  return (
    <section className="verified-platform-panel platform-presence-manager-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            <Globe2 size={13} />
            {spanish ? "Plataformas de descubrimiento" : "Discovery Platforms"}
          </span>
          <h3>
            {spanish
              ? "Edita dónde se puede descubrir tu canción"
              : "Edit where listeners can discover your song"}
          </h3>
        </div>
        <small>
          {spanish
            ? "Una canción, un reproductor, varios destinos."
            : "One song, one player, multiple destinations."}
        </small>
      </div>
      <div className="platform-disclaimer-card">
        <strong>{spanish ? "💡 Importante" : "💡 Important"}</strong>
        <p>
          {spanish
            ? "Las plataformas adicionales deben pertenecer a la misma cancion o video que estas publicando. Puedes agregarlas ahora o despues desde la configuracion de la cancion."
            : "Additional platforms must belong to the same song or video you are publishing. You can add them now or later from the song settings."}
        </p>
      </div>
      <div className="platform-reminder-card">
        <strong>{spanish ? "💡 Recordatorio" : "💡 Reminder"}</strong>
        <p>
          {spanish
            ? "La plataforma principal de descubrimiento controla la reproducción usada por First Listen. Los enlaces adicionales son destinos de descubrimiento y deben corresponder a la misma canción o video."
            : "The Primary Discovery Platform controls playback in First Listen. Additional links are discovery destinations and must match the same song or video."}
        </p>
      </div>
      {showYoutubeMusicTip && youtubeMusicLink && (
        <div className="platform-discovery-tip-card">
          <strong>{spanish ? "💡 Consejo de descubrimiento" : "💡 Discovery Tip"}</strong>
          <p>
            {spanish
              ? "YouTube Music está disponible para esta canción."
              : "YouTube Music is available for this song."}
            <br />
            {spanish
              ? "Las recomendaciones de YouTube pueden ayudar a nuevos oyentes a descubrir tu música."
              : "YouTube recommendations can help new listeners discover your music."}
          </p>
          <button
            className="primary-button"
            disabled={saving}
            onClick={() =>
              void makePrimary(youtubeMusicLink, { discoveryUpgrade: true })
            }
            type="button"
          >
            {spanish ? "🚀 Aumentar mi descubrimiento" : "🚀 Increase My Discovery"}
          </button>
        </div>
      )}
      <div className="platform-presence-management-list">
        {currentLinks.map((link) => (
          <article
            key={`${song.id}-verified-${link.platform}`}
          >
            <span>
              <PlatformIcon platform={link.platform} size={14} />
              <strong>{link.platform}</strong>
              <small>
                {link.primary
                  ? spanish
                    ? "Plataforma principal de descubrimiento"
                    : "Primary Discovery Platform"
                  : spanish
                    ? "Enlace adicional"
                    : "Additional Link"}
              </small>
            </span>
            <div>
              <a href={link.url} rel="noreferrer" target="_blank">
                <ExternalLink size={13} />
                {spanish ? "Abrir enlace" : "Open link"}
              </a>
              {!link.primary && isPrimaryPlatform(link.platform) && (
                <button
                  disabled={saving}
                  onClick={() => void makePrimary(link)}
                  type="button"
                >
                  {spanish ? "🚀 Aumentar descubrimiento" : "🚀 Increase discovery"}
                </button>
              )}
              {!link.primary && (
                <button
                  className="danger-lite-button"
                  disabled={saving}
                  onClick={() => void removeLink(link)}
                  type="button"
                >
                  {spanish ? "Eliminar" : "Remove"}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      <form className="verified-platform-form" onSubmit={submit}>
        <label>
          {spanish ? "Plataforma" : "Platform"}
          <select
            onChange={(event) =>
              setTargetPlatform(event.target.value as Platform)
            }
            value={targetPlatform}
          >
            {availablePlatforms.map((platform) => (
              <option key={platform} value={platform}>
                {platform}
              </option>
            ))}
          </select>
        </label>
        <label>
          {spanish ? "Enlace oficial" : "Official link"}
          <input
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://"
            type="url"
            value={url}
          />
        </label>
        <label>
          {spanish ? "Nota opcional" : "Optional note"}
          <input
            maxLength={120}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              spanish ? "Ej. enlace oficial del artista" : "Ex. official artist link"
            }
            value={note}
          />
        </label>
        <button className="secondary-button" disabled={saving} type="submit">
          <Link2 size={14} />
          {saving
            ? spanish
              ? "Guardando..."
              : "Saving..."
            : spanish
              ? "Guardar enlace"
              : "Save link"}
        </button>
      </form>
      {url.trim() && (
        <small className={selectedMatches ? "form-message" : "auth-error"}>
          {selectedMatches
            ? detection.message
            : spanish
              ? `Detectado: ${detection.platform ?? "no compatible"}`
              : `Detected: ${detection.platform ?? "unsupported"}`}
        </small>
      )}
      {message && <small className="form-message">{message}</small>}
      {youtubeMusicRecommendation && (
        <div className="platform-discovery-dialog-backdrop">
          <div
            aria-labelledby="youtube-music-discovery-title"
            aria-modal="true"
            className="platform-discovery-dialog"
            role="dialog"
          >
            <h3 id="youtube-music-discovery-title">
              {spanish
                ? "🚀 Más descubrimiento disponible"
                : "🚀 More Discovery Available"}
            </h3>
            <p>
              {spanish
                ? "Agregaste YouTube Music."
                : "You just added YouTube Music."}
            </p>
            <p>
              {spanish
                ? "Las recomendaciones de YouTube pueden ayudar a nuevos oyentes a descubrir tu música."
                : "YouTube recommendations can help new listeners discover your music."}
            </p>
            <p>
              {spanish
                ? "Cambiar a YouTube Music como plataforma principal de descubrimiento puede aumentar tus oportunidades de descubrimiento."
                : "Switching to YouTube Music as your Primary Discovery Platform may increase your discovery opportunities."}
            </p>
            <div className="platform-guidance-actions">
              <button
                className="primary-button"
                disabled={saving}
                onClick={async () => {
                  const updated = await makePrimary(youtubeMusicRecommendation, {
                    discoveryUpgrade: true,
                  });
                  if (updated) setYoutubeMusicRecommendation(null);
                }}
                type="button"
              >
                {spanish ? "🚀 Aumentar mi descubrimiento" : "🚀 Increase My Discovery"}
              </button>
              <button
                className="ghost-button"
                disabled={saving}
                onClick={() => {
                  dismissYoutubeMusicDiscovery(song.id);
                  setYoutubeMusicRecommendation(null);
                }}
                type="button"
              >
                {spanish ? "Ahora no" : "Not Right Now"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function DashboardView({
  discoveryDestination,
  workspaceContentOnly = false,
  setView,
  founder,
  totalCreditsEarned,
  reviewCredits,
  reviewQualityScore,
  copy,
  locale,
  song,
  notify,
  songSummaries,
  songReviews,
  listeningBank,
  claimingReward,
  onClaimReward,
  spotlightSongs,
  topTenSongs,
  externalDiscoverySongs,
  dailyMission,
  claimingMission,
  onClaimMission,
  communityPrograms,
  onBoostSong,
  onPlatformPresenceLinkSaved,
  onPlatformPresenceLinkRemoved,
  onPrimaryPlatformChanged,
  onNavigateDiscoveryDestination,
  onListeningCredited,
  platformConfig,
  workspacePlayback,
}: {
  discoveryDestination?: DiscoveryDestination;
  workspaceContentOnly?: boolean;
  setView: (view: View) => void;
  founder: boolean;
  totalCreditsEarned: number;
  reviewCredits: number;
  reviewQualityScore: number;
  copy: Copy;
  locale: InterfaceLocale;
  song: Song | null;
  notify: (message: string) => void;
  songSummaries: SongDashboardSummary[];
  songReviews: Review[];
  listeningBank: ListeningBankStatus;
  claimingReward: boolean;
  onClaimReward: () => void;
  spotlightSongs: DiscoverySong[];
  topTenSongs: DiscoverySong[];
  externalDiscoverySongs: DiscoverySong[];
  dailyMission: DailyMissionStatus | null;
  claimingMission: boolean;
  onClaimMission: () => void;
  communityPrograms: CommunityProgram[];
  onBoostSong: (songId: string) => void;
  onPlatformPresenceLinkSaved: (
    songId: string,
    link: SongPlatformLink,
  ) => void;
  onPlatformPresenceLinkRemoved: (songId: string, platform: Platform) => void;
  onPrimaryPlatformChanged: (
    songId: string,
    platform: PrimaryPlatform,
    url: string,
    links: SongPlatformLink[],
  ) => void;
  onNavigateDiscoveryDestination: (
    destination?: DiscoveryDestination,
  ) => void;
  onListeningCredited: (
    seconds: number,
    becameValid: boolean,
    becameComplete: boolean,
    completionRate: number,
  ) => void;
  platformConfig: PlatformControlConfig;
  workspacePlayback: WorkspacePlaybackController;
}) {
  const [managedPlatformSongId, setManagedPlatformSongId] = useState<
    string | null
  >(null);

  if (workspaceContentOnly || discoveryDestination) {
    return (
      <main className="content dashboard-discovery-destination">
        <DiscoverySections
          destination={discoveryDestination}
          externalDiscoverySongs={externalDiscoverySongs}
          locale={locale}
          onNavigateDestination={onNavigateDiscoveryDestination}
          platformConfig={platformConfig}
          onListeningCredited={onListeningCredited}
          spotlightSongs={spotlightSongs}
          topTenSongs={topTenSongs}
          workspacePlayback={workspacePlayback}
        />
      </main>
    );
  }

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
          destination={discoveryDestination}
          externalDiscoverySongs={externalDiscoverySongs}
          locale={locale}
          onNavigateDestination={onNavigateDiscoveryDestination}
          platformConfig={platformConfig}
          onListeningCredited={onListeningCredited}
          spotlightSongs={spotlightSongs}
          topTenSongs={topTenSongs}
          workspacePlayback={workspacePlayback}
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
        destination={discoveryDestination}
        externalDiscoverySongs={externalDiscoverySongs}
        locale={locale}
        onNavigateDestination={onNavigateDiscoveryDestination}
        platformConfig={platformConfig}
        onListeningCredited={onListeningCredited}
        spotlightSongs={spotlightSongs}
          topTenSongs={topTenSongs}
        workspacePlayback={workspacePlayback}
        />
        <CommunityProgramsPanel locale={locale} programs={communityPrograms} />

        <div className="active-song">
          <Image src={song.coverUrl} alt={`${song.title} cover`} unoptimized width={90} height={90} />
          <div className="active-song-copy">
            <div>
              <span className="live-dot">{copy.app.dashboard.collecting}</span>
              <span className="platform-label">{song.platform}</span>
              <ProviderClassificationBadge platform={song.platform} locale={locale} compact />
              {founder && <span className="song-founder-badge"><BadgeCheck size={12} /> {copy.app.dashboard.founder}</span>}
            </div>
            <h3>{song.title}</h3>
            <p>
              <ArtistNameLink artistId={song.artistId} name={song.artist} />
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

        <PlatformPresenceManagerPanel
          locale={locale}
          notify={notify}
          onLinkRemoved={onPlatformPresenceLinkRemoved}
          onLinkSaved={onPlatformPresenceLinkSaved}
          onPrimaryChanged={onPrimaryPlatformChanged}
          song={song}
        />

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
            {songSummaries.map((summary) => {
              const platformManagerOpen = managedPlatformSongId === summary.id;
              return (
              <div className="song-performance-entry" key={summary.id}>
              <article>
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
                <div><strong>{formatDuration(summary.totalListeningSeconds)}</strong><span>{locale === "es" ? "Tiempo reproducido" : "Play time"}</span></div>
                <div><strong>{summary.reportCount}</strong><span>{locale === "es" ? "Reportes" : "Reports"}</span></div>
                <Link href={`/dashboard/comments?song=${summary.id}`}>
                  {locale === "es" ? "Comentarios" : "Comments"} <ArrowRight size={13} />
                </Link>
                <button
                  className="song-platform-manage-button"
                  onClick={() =>
                    setManagedPlatformSongId((current) =>
                      current === summary.id ? null : summary.id,
                    )
                  }
                  type="button"
                >
                  <Globe2 size={13} />
                  {platformManagerOpen
                    ? locale === "es"
                      ? "Cerrar plataformas"
                      : "Close Platforms"
                    : locale === "es"
                      ? "Gestionar plataformas"
                      : "Manage Platforms"}
                </button>
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
              {platformManagerOpen && (
                <PlatformPresenceManagerPanel
                  locale={locale}
                  notify={notify}
                  onLinkRemoved={onPlatformPresenceLinkRemoved}
                  onLinkSaved={onPlatformPresenceLinkSaved}
                  onPrimaryChanged={onPrimaryPlatformChanged}
                  song={{
                    id: summary.id,
                    link: summary.link,
                    platform: summary.platform,
                    platformLinks: summary.platformLinks,
                    title: summary.title,
                  }}
                />
              )}
              </div>
              );
            })}
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
  const [externalGuidanceDismissed, setExternalGuidanceDismissed] =
    useState(false);
  const [showDirectPlaybackSetup, setShowDirectPlaybackSetup] =
    useState(false);
  const [directPlaybackLink, setDirectPlaybackLink] = useState("");
  const [externalConfirmationOpen, setExternalConfirmationOpen] =
    useState(false);
  const [externalConfirmationAcknowledged, setExternalConfirmationAcknowledged] =
    useState(false);
  const platformDetection = detectMusicPlatform(musicLink);
  const primaryPlatformDetected = isPrimaryPlatform(platformDetection.platform)
    ? platformDetection.platform
    : null;
  const directPlaybackDetection = detectMusicPlatform(directPlaybackLink);
  const directPlaybackPlatform =
    directPlaybackDetection.valid &&
    (directPlaybackDetection.platform === "YouTube" ||
      directPlaybackDetection.platform === "YouTube Music")
      ? directPlaybackDetection.platform
      : null;
  const requiredTokenCost = primaryPlatformDetected
    ? submissionTokenCost(contentEconomy, primaryPlatformDetected)
    : 1;
  const externalPrimaryDetected = Boolean(
    platformDetection.valid &&
      primaryPlatformDetected &&
      isExternalPlatform(primaryPlatformDetected),
  );
  const youtubeDirectPlaybackDetected =
    primaryPlatformDetected === "YouTube" ||
    primaryPlatformDetected === "YouTube Music";
  const tokenWord = requiredTokenCost === 1 ? "Token" : "Tokens";
  const currentBalanceLabel = unlimitedCredits
    ? locale === "es"
      ? "Ilimitado"
      : "Unlimited"
    : `${reviewCount} ${reviewCount === 1 ? "Token" : "Tokens"}`;
  const balanceAfterPublicationLabel = unlimitedCredits
    ? locale === "es"
      ? "Ilimitado"
      : "Unlimited"
    : `${Math.max(0, reviewCount - requiredTokenCost)} ${
        Math.max(0, reviewCount - requiredTokenCost) === 1
          ? "Token"
          : "Tokens"
      }`;
  const unlocked =
    reviewCount >= requiredTokenCost || founderFree || unlimitedCredits;
  const selectedEconomy = primaryPlatformDetected
    ? economySettingFor(contentEconomy, primaryPlatformDetected)
    : undefined;
  const providerEmbed =
    primaryPlatformDetected && platformDetection.valid
      ? getProviderEmbed(musicLink, primaryPlatformDetected, browserOrigin)
      : null;
  const platformMessage =
    platformDetection.valid && platformDetection.platform && !primaryPlatformDetected
      ? locale === "es"
        ? "Esta plataforma puede agregarse después como destino adicional. Usa una plataforma primaria para el reproductor."
        : "This platform can be added later as an additional destination. Use a primary platform for playback."
      : translatedPlatformMessage(
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
          ? "Usa un enlace válido de una plataforma compatible."
          : "Use a valid link from a supported platform.",
      );
    }
    if (platformDetection.valid && platformDetection.platform && !primaryPlatformDetected) {
      failures.push(
        locale === "es"
          ? "La plataforma principal de descubrimiento debe ser YouTube Music, YouTube, Spotify, Apple Music, TikTok o SoundCloud."
          : "Primary Discovery Platform must be YouTube Music, YouTube, Spotify, Apple Music, TikTok, or SoundCloud.",
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
    primaryPlatformDetected,
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
    setExternalGuidanceDismissed(false);
    setShowDirectPlaybackSetup(false);
    setDirectPlaybackLink("");
    setExternalConfirmationOpen(false);
    setExternalConfirmationAcknowledged(false);
  }, [platformDetection.parsedUrl]);

  useEffect(() => {
    if (!platformDetection.valid || !platformDetection.parsedUrl || !primaryPlatformDetected) {
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
  }, [platformDetection.parsedUrl, platformDetection.valid, primaryPlatformDetected]);

  useEffect(() => {
    setDuplicateWarningAccepted(false);
    if (
      !platformDetection.valid ||
      !primaryPlatformDetected ||
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
          song_platform: databasePlatform[primaryPlatformDetected],
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
    primaryPlatformDetected,
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

  const applyDirectPlaybackLink = () => {
    if (!directPlaybackPlatform) {
      notify(
        locale === "es"
          ? "Pega un enlace valido de YouTube o YouTube Music."
          : "Paste a valid YouTube or YouTube Music link.",
      );
      return;
    }
    setMusicLink(directPlaybackLink.trim());
    setPlatform(directPlaybackPlatform);
    setShowDirectPlaybackSetup(false);
    setExternalConfirmationOpen(false);
    setExternalConfirmationAcknowledged(false);
    notify(
      locale === "es"
        ? "Reproducción directa activada."
        : "Direct playback enabled.",
    );
  };

  const publishCurrentSubmission = async () => {
    if (!primaryPlatformDetected || !songLanguage || !genre) return;
    const submission: SongSubmission = {
      title: songTitle.trim(),
      artistName: artistName.trim(),
      coverImageUrl:
        coverImageUrl.trim() || "https://www.firstlisten.net/covers/default-song.svg",
      musicUrl: musicLink,
      platform: primaryPlatformDetected,
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
    if (!saved) {
      setExternalConfirmationAcknowledged(false);
      return;
    }

    setPlatform(primaryPlatformDetected);
    setSubmittedForApproval(
      reportedDurationSeconds > 480 || contentKind === "long_form",
    );
    setSubmitted(true);
    notify(locale === "es" ? "Canción enviada. Disponible para oyentes." : "Song submitted. It is now available to listeners.");
  };

  const submitSong = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (validationFailures.length > 0 || !primaryPlatformDetected || !songLanguage || !genre) {
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
    if (externalPrimaryDetected && !externalConfirmationAcknowledged) {
      setExternalConfirmationOpen(true);
      notify(
        locale === "es"
          ? "Confirma el costo de publicacion externa antes de continuar."
          : "Confirm the external publication cost before continuing.",
      );
      return;
    }
    await publishCurrentSubmission();
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
    setExternalGuidanceDismissed(false);
    setShowDirectPlaybackSetup(false);
    setDirectPlaybackLink("");
    setExternalConfirmationOpen(false);
    setExternalConfirmationAcknowledged(false);
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
                ? "El contenido de más de 8 minutos fue guardado y espera aprobación manual antes de aparecer para oyentes."
                : "Content over 8 minutes was saved and is awaiting manual approval before becoming available to listeners."
              : copy.app.submit.saved}
          </p>
          <div className="success-song">
            <div className="success-cover"><Music2 size={28} /></div>
            <span>
              <strong>{copy.app.submit.newRelease}</strong>
              <small>
                {platform} /{" "}
                {platform ? compactClassificationLabel(platform, locale) : ""} /{" "}
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
            <span><Music2 size={17} /> {locale === "es" ? "Reproduce dentro de First Listen" : "Plays inside First Listen"}</span>
            <strong>{locale === "es" ? "Costo: 1 token" : "Cost: 1 Token"}</strong>
            <p>
              {locale === "es"
                ? "Mejor valor. Mantiene a los oyentes en First Listen y permite reseñas, seguidores, comunidad, descubrimiento y tiempo que cuenta para tokens."
                : "Best value. Keeps listeners inside First Listen and supports reviews, followers, community activity, discovery, and time toward tokens."}
            </p>
            <small>YouTube / YouTube Music / SoundCloud</small>
          </article>
          <article className="external">
            <span><Link2 size={17} /> {locale === "es" ? "Abre fuera de First Listen" : "Opens outside First Listen"}</span>
            <strong>
              {locale === "es" ? "Costo actual" : "Current cost"}: {requiredTokenCost}{" "}
              {requiredTokenCost === 1 ? "Token" : "Tokens"} / {locale === "es" ? "Programado" : "Scheduled"}:{" "}
              {selectedEconomy?.classification === "external"
                ? selectedEconomy.scheduledTokenCost
                : 8} Tokens
            </strong>
            <p>
              {locale === "es"
                ? "Redirige fuera de First Listen. La actividad externa no suma tiempo ni tokens dentro de First Listen."
                : "Redirects outside First Listen. External activity does not earn time or tokens inside First Listen."}
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
                  ? "Acumula tiempo aprobado y reclama una recompensa."
                  : "Save listening time and claim a reward."}
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

          {externalPrimaryDetected && primaryPlatformDetected && !externalGuidanceDismissed && (
            <div className="platform-guidance-card external-only-guidance" role="note">
              <span className="platform-guidance-title">
                <Link2 size={16} />
                {locale === "es"
                  ? `🎵 ${primaryPlatformDetected} detectado`
                  : `🎵 ${primaryPlatformDetected} detected`}
              </span>
              <strong>{locale === "es" ? "💡 Consejo" : "💡 Tip"}</strong>
              <p>
                {locale === "es"
                  ? "Esta canción se abrirá fuera de First Listen. Si también está disponible en YouTube o YouTube Music, agrégala ahora para activar reproducción directa dentro de First Listen y publicar por solo 1 token."
                  : "This song will open outside of First Listen. If this song is also available on YouTube or YouTube Music, you can add it now to enable direct playback inside First Listen and publish for only 1 Token."}
              </p>
              <div className="platform-guidance-actions">
                <button
                  onClick={() => setShowDirectPlaybackSetup(true)}
                  type="button"
                >
                  <Plus size={14} /> {locale === "es" ? "Agregar plataforma" : "Add Platform"}
                </button>
                <button
                  className="ghost-button"
                  onClick={() => setExternalGuidanceDismissed(true)}
                  type="button"
                >
                  {locale === "es" ? "Continuar" : "Continue"}
                </button>
              </div>
            </div>
          )}

          {showDirectPlaybackSetup && (
            <div className="platform-direct-setup-card">
              <div className="platform-disclaimer-card">
                <strong>{locale === "es" ? "💡 Importante" : "💡 Important"}</strong>
                <p>
                  {locale === "es"
                    ? "Los enlaces adicionales deben pertenecer a la misma canción o video que estás publicando. Puedes agregarlos ahora o después desde los ajustes de la canción."
                    : "Additional platforms must belong to the same song or video you are publishing. You can add them now or later from the song settings."}
                </p>
              </div>
              <label>
                {locale === "es" ? "Enlace de YouTube o YouTube Music" : "YouTube or YouTube Music link"}
                <input
                  onChange={(event) => setDirectPlaybackLink(event.target.value)}
                  placeholder="https://music.youtube.com/watch?v=..."
                  type="url"
                  value={directPlaybackLink}
                />
              </label>
              {directPlaybackLink.trim() && (
                <small
                  className={
                    directPlaybackPlatform ? "link-valid" : "link-invalid"
                  }
                >
                  {directPlaybackPlatform
                    ? locale === "es"
                      ? `${directPlaybackPlatform} listo para reproducción directa.`
                      : `${directPlaybackPlatform} ready for direct playback.`
                    : locale === "es"
                      ? "Pega un enlace válido de YouTube o YouTube Music para activar reproducción directa."
                      : "Paste a valid YouTube or YouTube Music link to enable direct playback."}
                </small>
              )}
              <div className="platform-guidance-actions">
                <button
                  disabled={!directPlaybackPlatform}
                  onClick={applyDirectPlaybackLink}
                  type="button"
                >
                  <Check size={14} /> {locale === "es" ? "Usar enlace de reproducción directa" : "Use Direct Playback Link"}
                </button>
                <button
                  className="ghost-button"
                  onClick={() => setShowDirectPlaybackSetup(false)}
                  type="button"
                >
                  {locale === "es" ? "Más tarde" : "Maybe Later"}
                </button>
              </div>
            </div>
          )}

          {youtubeDirectPlaybackDetected && platformDetection.valid && (
            <div className="platform-guidance-card direct-playback-enabled" role="status">
              <span className="platform-guidance-title">
                <CheckCircle2 size={16} />
                {locale === "es" ? "🎉 Reproducción directa activada" : "🎉 Direct playback enabled"}
              </span>
              <p>
                {locale === "es" ? "Costo de publicación" : "Publication cost"}: {requiredTokenCost} {tokenWord}
              </p>
            </div>
          )}

          {externalConfirmationOpen && primaryPlatformDetected && (
            <div className="external-publication-dialog-backdrop">
              <section
                aria-labelledby="external-publication-title"
                aria-modal="true"
                className="external-publication-dialog"
                role="dialog"
              >
                <span className="eyebrow">
                  <LockKeyhole size={13} /> {locale === "es" ? "Confirmar envío" : "Confirm Publication"}
                </span>
                <h3 id="external-publication-title">
                  {locale === "es" ? "⚠️ Confirmar envío" : "⚠️ Confirm Publication"}
                </h3>
                <p>
                  {locale === "es"
                    ? "Esta canción se abrirá fuera de First Listen."
                    : "This song will use external playback."}
                </p>
                <div className="confirmation-math-grid">
                  <span>{locale === "es" ? "Costo de publicación:" : "Publication cost:"}</span>
                  <strong>
                    {requiredTokenCost} {tokenWord}
                  </strong>
                  <span>{locale === "es" ? "Saldo actual:" : "Current balance:"}</span>
                  <strong>{currentBalanceLabel}</strong>
                  <span>{locale === "es" ? "Saldo después de publicar:" : "Balance after publication:"}</span>
                  <strong>{balanceAfterPublicationLabel}</strong>
                </div>
                <div className="platform-guidance-actions">
                  <button
                    className="primary-button"
                    disabled={saving}
                    onClick={() => {
                      setExternalConfirmationAcknowledged(true);
                      setExternalConfirmationOpen(false);
                      void publishCurrentSubmission();
                    }}
                    type="button"
                  >
                    {locale === "es" ? "Publicar por" : "Publish for"} {requiredTokenCost} {tokenWord}
                  </button>
                  <button
                    onClick={() => {
                      setExternalConfirmationOpen(false);
                      setExternalGuidanceDismissed(true);
                      setShowDirectPlaybackSetup(true);
                    }}
                    type="button"
                  >
                    <Plus size={14} /> {locale === "es" ? "Agregar plataforma" : "Add Platform"}
                  </button>
                </div>
              </section>
            </div>
          )}

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
            <legend>{locale === "es" ? "Contenido explícito" : "Explicit Content"}</legend>
            <label>
              <input
                checked={explicitContent === false}
                name="explicitContent"
                onChange={() => setExplicitContent(false)}
                type="radio"
                value="no"
              />
              {locale === "es" ? "No" : "No"}
            </label>
            <label>
              <input
                checked={explicitContent === true}
                name="explicitContent"
                onChange={() => setExplicitContent(true)}
                type="radio"
                value="yes"
              />
              {locale === "es" ? "Sí" : "Yes"}
            </label>
          </fieldset>

          <div className="platform-picker">
            <label>{copy.app.submit.detectedPlatform}</label>
            <div>
              {primaryPlatforms.map((item) => (
                <button className={platform === item ? "active" : ""} disabled key={item} type="button">
                  {platform === item ? <Check size={14} /> : <PlatformIcon platform={item} size={14} />}
                  <span>
                    {item}
                    <small>{compactClassificationLabel(item, locale)}</small>
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
            ["03", locale === "es" ? "Los resultados aparecen en tus analíticas privadas." : "Results appear in your private analytics."],
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
  discoveryDestination?: DiscoveryDestination;
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
  initialExternalDiscoverySongs: DiscoverySong[];
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
  platformConfig: PlatformControlConfig;
  profilePanel: ProfilePanelProps;
};

export function FirstListenApp({
  onLogout,
  account,
  discoveryDestination,
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
  initialExternalDiscoverySongs,
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
  platformConfig = defaultPlatformControlConfig,
  profilePanel,
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
  const [rewardClaimFeedback, setRewardClaimFeedback] =
    useState<RewardClaimFeedback | null>(null);
  const [claimingMission, setClaimingMission] = useState(false);
  const [dailyMission, setDailyMission] =
    useState<DailyMissionStatus | null>(initialDailyMission);
  const [songSummaries, setSongSummaries] = useState(
    initialSongSummaries,
  );
  const [userSong, setUserSong] = useState<Song | null>(() => {
    if (!initialUserSong) return null;
    const summary = initialSongSummaries.find(
      (item) => item.id === initialUserSong.id,
    );
    return {
      ...initialUserSong,
      platformLinks:
        summary?.platformLinks?.length
          ? summary.platformLinks
          : initialUserSong.platformLinks,
      recommendedPlatform:
        summary?.recommendedPlatform ?? initialUserSong.recommendedPlatform,
    };
  });
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
  const [workspaceDiscoveryDestination, setWorkspaceDiscoveryDestination] =
    useState<DiscoveryDestination | undefined>(discoveryDestination);
  const [activeSong, setActiveSong] =
    useState<WorkspacePlayableSong | null>(null);
  const [activeQueue, setWorkspaceActiveQueue] =
    useState<WorkspaceActiveQueue | null>(null);
  const [activeContext, setActiveContext] =
    useState<WorkspacePlaybackContext | null>(null);
  const [activeWorkspacePanel, setActiveWorkspacePanel] =
    useState<WorkspacePanel>(() =>
      workspacePanelForRoute(initialView, discoveryDestination),
    );
  const [queueMode, setQueueMode] =
    useState<WorkspaceQueueMode>("review");
  const [workspacePlayback, setWorkspacePlayback] =
    useState<WorkspacePlaybackRequest | null>(null);
  const workspacePlaybackRef = useRef<WorkspacePlaybackRequest | null>(null);
  const [workspacePlaybackControls, setWorkspacePlaybackControls] =
    useState<WorkspacePlaybackControls | null>(null);
  const [workspacePlaybackTelemetry, setWorkspacePlaybackTelemetry] =
    useState<ProviderTelemetrySnapshot | null>(null);
  const [playbackSlots, setPlaybackSlots] = useState<
    Map<string, HTMLDivElement>
  >(() => new Map());

  useEffect(() => {
    workspacePlaybackRef.current = workspacePlayback;
  }, [workspacePlayback]);

  const registerPlaybackSlot = useCallback(
    (slotId: string, element: HTMLDivElement | null) => {
      setPlaybackSlots((current) => {
        const next = new Map(current);
        if (element) {
          next.set(slotId, element);
        } else {
          next.delete(slotId);
        }
        return next;
      });
    },
    [],
  );

  const requestWorkspacePlayback = useCallback(
    (request: WorkspacePlaybackRequest) => {
      setActiveSong(request.song);
      setWorkspaceActiveQueue(request.queue ?? null);
      setActiveContext(request.context);
      setActiveWorkspacePanel(request.context.panel);
      setQueueMode(request.context.mode);
      setWorkspacePlayback(request);
      setWorkspacePlaybackControls(request.controls ?? null);
      setWorkspacePlaybackTelemetry(null);
    },
    [],
  );

  const stopWorkspacePlayback = useCallback((slotId?: string) => {
    const current = workspacePlaybackRef.current;
    if (slotId && current?.slotId !== slotId) return;
    setWorkspacePlayback(null);
    setWorkspacePlaybackControls(null);
    setWorkspacePlaybackTelemetry(null);
    setActiveSong(null);
    setWorkspaceActiveQueue(null);
    setActiveContext(null);
  }, []);

  const workspacePlaybackController = useMemo<WorkspacePlaybackController>(
    () => ({
      activeControlChannel: workspacePlayback?.slotId ?? null,
      activeContext,
      activeControls: workspacePlaybackControls,
      activeQueue,
      activeSong,
      activeTelemetry: workspacePlaybackTelemetry,
      activeWorkspacePanel,
      queueMode,
      registerPlaybackSlot,
      requestPlayback: requestWorkspacePlayback,
      stopPlayback: stopWorkspacePlayback,
    }),
    [
      activeContext,
      activeQueue,
      activeSong,
      activeWorkspacePanel,
      queueMode,
      registerPlaybackSlot,
      requestWorkspacePlayback,
      stopWorkspacePlayback,
      workspacePlayback,
      workspacePlaybackControls,
      workspacePlaybackTelemetry,
    ],
  );
  const workspacePlaybackSlot =
    playbackSlots.get("workspace:persistent") ??
    (workspacePlayback?.slotId
      ? (playbackSlots.get(workspacePlayback.slotId) ?? null)
      : null);

  useEffect(() => {
    setView(initialView);
    setWorkspaceDiscoveryDestination(discoveryDestination);
  }, [discoveryDestination, initialView]);

  useEffect(() => {
    setActiveWorkspacePanel(
      workspacePanelForRoute(view, workspaceDiscoveryDestination),
    );
  }, [view, workspaceDiscoveryDestination]);

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
    const root = document.documentElement;
    const applyOwnerAutoplayDefault = () => {
      const value = root.dataset.autoPlayNextSongDefault;
      if (value === "true" || value === "false") {
        setAutoPlayNextSong(value === "true");
      }
    };
    applyOwnerAutoplayDefault();
    const observer = new MutationObserver(applyOwnerAutoplayDefault);
    observer.observe(root, {
      attributeFilter: ["data-auto-play-next-song-default"],
    });
    return () => observer.disconnect();
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

  useEffect(() => {
    if (!rewardClaimFeedback) return;
    const timeout = window.setTimeout(
      () => setRewardClaimFeedback(null),
      9000,
    );
    return () => window.clearTimeout(timeout);
  }, [rewardClaimFeedback]);

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
      approvedSeconds: current.approvedSeconds + bankedSeconds,
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
        approvedSeconds: Number(
          listeningStatus.approved_seconds ??
            listeningStatus.today_seconds ??
            0,
        ),
        rejectedSeconds: Number(listeningStatus.rejected_seconds ?? 0),
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
          approvedSeconds: current.approvedSeconds + Math.max(0, seconds),
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
    const beforeCredits = reviewCount;
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
    const creditsAwarded = Number(result.credits_awarded ?? 1);
    const afterCredits = Number(
      result.credits_balance ?? beforeCredits + creditsAwarded,
    );
    const exchangeSeconds = listeningBank.minutesPerCredit * 60;
    setReviewCount(afterCredits);
    setTotalCreditsEarned((current) => current + creditsAwarded);
    setListeningBank((current) => ({
      ...current,
      bankSeconds,
      availableRewardCredits: Number(
        result.available_reward_credits ?? 0,
      ),
      secondsToNextCredit: secondsToNextReward(bankSeconds, exchangeSeconds),
    }));
    setRewardClaimFeedback({
      awarded: creditsAwarded,
      beforeCredits,
      afterCredits,
      claimedAt: Date.now(),
    });
    notify(
      locale === "es"
        ? "Recompensa reclamada. Se agregó un token a tu cuenta."
        : `Listening reward claimed. ${creditsAwarded} token${creditsAwarded === 1 ? " was" : "s were"} added to your account.`,
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

  const handlePlatformPresenceLinkSaved = (
    songId: string,
    link: SongPlatformLink,
  ) => {
    setUserSong((current) =>
      current?.id === songId
        ? {
            ...current,
            platformLinks: mergePlatformLink(current.platformLinks, link),
            recommendedPlatform: current.recommendedPlatform ?? link.platform,
          }
        : current,
    );
    setSongSummaries((current) =>
      current.map((summary) =>
        summary.id === songId
          ? {
              ...summary,
              platformLinks: mergePlatformLink(summary.platformLinks, link),
              recommendedPlatform: summary.recommendedPlatform ?? link.platform,
            }
          : summary,
      ),
    );
    notify(
      locale === "es"
        ? "Destino de plataforma agregado."
        : "Platform destination added.",
    );
  };

  const handlePlatformPresenceLinkRemoved = (
    songId: string,
    platform: Platform,
  ) => {
    setUserSong((current) =>
      current?.id === songId
        ? {
            ...current,
            platformLinks: (current.platformLinks ?? []).filter(
              (link) => link.platform !== platform || link.primary,
            ),
          }
        : current,
    );
    setSongSummaries((current) =>
      current.map((summary) =>
        summary.id === songId
          ? {
              ...summary,
              platformLinks: (summary.platformLinks ?? []).filter(
                (link) => link.platform !== platform || link.primary,
              ),
            }
          : summary,
      ),
    );
    notify(
      locale === "es"
        ? "Destino de plataforma eliminado."
        : "Platform destination removed.",
    );
  };

  const handlePrimaryPlatformChanged = (
    songId: string,
    platform: PrimaryPlatform,
    url: string,
    links: SongPlatformLink[],
  ) => {
    setUserSong((current) =>
      current?.id === songId
        ? {
            ...current,
            platform,
            link: url,
            platformLinks: links,
            recommendedPlatform: platform,
          }
        : current,
    );
    setSongSummaries((current) =>
      current.map((summary) =>
        summary.id === songId
          ? {
              ...summary,
              platform,
              link: url,
              platformLinks: links,
              recommendedPlatform: platform,
            }
          : summary,
      ),
    );
    notify(
      locale === "es"
        ? `${platform} ahora controla la reproducción.`
        : `${platform} now controls playback.`,
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

  const pushWorkspacePath = useCallback((path: string) => {
    const debug =
      new URLSearchParams(window.location.search).get("debug") === "1";
    const nextPath = `${path}${debug ? "?debug=1" : ""}`;
    const currentPath = `${window.location.pathname}${window.location.search}`;
    if (currentPath === nextPath) return;
    window.history.pushState({ firstListenWorkspace: true }, "", nextPath);
  }, []);

  const changeDiscoveryDestination = useCallback(
    (destination?: DiscoveryDestination) => {
      setMenuOpen(false);
      setView("dashboard");
      setWorkspaceDiscoveryDestination(destination);
      pushWorkspacePath(workspacePathForDiscoveryDestination(destination));
    },
    [pushWorkspacePath],
  );

  const changeView = (nextView: View) => {
    setMenuOpen(false);
    setView(nextView);
    setWorkspaceDiscoveryDestination(undefined);
    pushWorkspacePath(workspacePathForView(nextView));
  };

  useEffect(() => {
    const syncWorkspaceRoute = () => {
      const route = workspaceRouteFromPath(window.location.pathname);
      if (!route) return;
      setMenuOpen(false);
      setView(route.view);
      setWorkspaceDiscoveryDestination(route.destination);
    };

    window.addEventListener("popstate", syncWorkspaceRoute);
    return () => window.removeEventListener("popstate", syncWorkspaceRoute);
  }, []);

  const viewContent = (() => {
    if (view === "dashboard") {
      return (
        <DashboardView
          copy={copy}
          discoveryDestination={workspaceDiscoveryDestination}
          founder={founder}
          locale={locale}
          listeningBank={listeningBank}
          claimingReward={claimingReward}
          notify={notify}
          onClaimReward={() => void claimListeningReward()}
          reviewCredits={reviewCount}
          reviewQualityScore={averageReviewQuality}
          setView={changeView}
          song={userSong}
          songSummaries={songSummaries}
          songReviews={initialSongReviews}
          totalCreditsEarned={totalCreditsEarned}
          spotlightSongs={initialSpotlightSongs}
          topTenSongs={initialTopTenSongs}
          externalDiscoverySongs={initialExternalDiscoverySongs}
          dailyMission={dailyMission}
          claimingMission={claimingMission}
          onClaimMission={() => void claimDailyMission()}
          communityPrograms={initialCommunityPrograms}
          onBoostSong={(songId) => void requestSongBoost(songId)}
          onPlatformPresenceLinkRemoved={handlePlatformPresenceLinkRemoved}
          onPlatformPresenceLinkSaved={handlePlatformPresenceLinkSaved}
          onPrimaryPlatformChanged={handlePrimaryPlatformChanged}
          onNavigateDiscoveryDestination={changeDiscoveryDestination}
          onListeningCredited={handleListeningCredited}
          platformConfig={platformConfig}
          workspacePlayback={workspacePlaybackController}
          workspaceContentOnly
        />
      );
    }
    if (view === "profile") {
      return (
        <ProfilePanel
          {...profilePanel}
          embedded
          onNavigate={changeView}
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
        reviewCredits={reviewCount}
        setView={changeView}
        unlimitedCredits={role === "super_admin"}
        approvedListeningSeconds={listeningBank.bankSeconds}
        onListeningCredited={handleListeningCredited}
        onAdvanceSong={advanceReviewQueue}
        queueLoading={queueLoading}
          spotlightSongs={initialSpotlightSongs}
          topTenSongs={initialTopTenSongs}
          externalDiscoverySongs={initialExternalDiscoverySongs}
          followedArtists={initialFollowedArtists}
        previouslySupportedSongs={initialPreviouslySupportedSongs}
        todaySupport={todaySupport}
        listeningBank={listeningBank}
        claimingReward={claimingReward}
        onClaimReward={() => void claimListeningReward()}
        rewardClaimFeedback={rewardClaimFeedback}
        autoPlayNextSong={autoPlayNextSong}
        onAutoPlayChange={(enabled) => void changeAutoPlayNextSong(enabled)}
        platformConfig={platformConfig}
        onNavigateDiscoveryDestination={changeDiscoveryDestination}
        workspacePlayback={workspacePlaybackController}
        showCommunityDiscovery={false}
      />
    );
  })();

  return (
    <div className={darkMode ? "app-shell theme-dark" : "app-shell"}>
      <Sidebar
        copy={copy}
        founder={founder}
        founderFree={founderFree}
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
          onProfile={() => changeView("profile")}
          onMenu={() => setMenuOpen(true)}
          onToggleTheme={toggleTheme}
          view={view}
        />
        <OfflineCommunitySummary
          locale={locale}
          notifications={notifications}
          onDismiss={() => void dismissCommunitySummary()}
          onViewActivity={() => changeView("profile")}
          summary={notificationSummary}
        />
        <WorkspaceShellTop
          controller={workspacePlaybackController}
          status={listeningBank}
          todaySupport={todaySupport}
          credits={reviewCount}
          unlimitedCredits={role === "super_admin"}
          claimingReward={claimingReward}
          rewardClaimFeedback={rewardClaimFeedback}
          onClaimReward={() => void claimListeningReward()}
          locale={locale}
        />
        <div className="workspace-shell-grid">
          <section className="workspace-center-panel">{viewContent}</section>
          <aside
            aria-hidden="true"
            className="workspace-right-panel-placeholder"
          />
        </div>
        <WorkspacePlayerHost
          externalRedirectNoticeDisabled={externalRedirectNoticeDisabled}
          locale={locale}
          onExternalRedirectPreferenceChange={(disabled) =>
            void changeExternalRedirectPreference(disabled)
          }
          onPlaybackTelemetry={setWorkspacePlaybackTelemetry}
          playback={workspacePlayback}
          slotElement={workspacePlaybackSlot}
        />
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
            <button onClick={() => changeView("profile")}>
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
              <span>{shortMobileLabel(locale, item.id)}</span>
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
