"use client";

import {
  ArrowRight,
  BarChart3,
  Bell,
  Bookmark,
  CheckCircle2,
  CircleHelp,
  Coins,
  Copy,
  Gauge,
  Headphones,
  Heart,
  KeyRound,
  LayoutDashboard,
  ListMusic,
  LockKeyhole,
  LogIn,
  Menu,
  MessageSquareText,
  Music2,
  Pause,
  Play,
  ShieldCheck,
  Share2,
  SkipForward,
  Sparkles,
  Trophy,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
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
import type { InterfaceLocale } from "@/lib/catalog";
import { displayPlatform } from "@/lib/content-economy";
import { safeCoverUrl } from "@/lib/media";
import { createClient } from "@/lib/supabase/client";
import type { Song } from "@/lib/types";

type GuestSession = {
  token: string;
  listenerId: string;
  recoveryCode: string;
  nickname: string;
  locale: InterfaceLocale;
  validListens: number;
};

type GuestListeningState = {
  sessionId: string | null;
  liveSeconds: number;
  verifiedSeconds: number;
  validRequirementSeconds: number;
  validListenRecorded: boolean;
  completeListenRecorded: boolean;
  warning: string;
};

type GuestDiscoveryItem = {
  feedKind: "spotlight" | "top" | "recent";
  position: number;
  badge: string;
  song: Song;
  reviewsReceived: number;
  averageRating: number;
  hookScore: number;
  commentsCount: number;
  likesCount: number;
  followersCount: number;
};

type GuestView = "review" | "dashboard" | "discovery" | "rankings";

type GuestExperienceSummary = {
  summarySince: string;
  communityActivityCount: number;
  communityListensCount: number;
  communityCommentsCount: number;
  communityLikesCount: number;
  communityFollowsCount: number;
  communitySharesCount: number;
  newSongsCount: number;
  validListens: number;
  totalListeningSeconds: number;
  songsExplored: number;
  likesCount: number;
  commentsCount: number;
  followingCount: number;
  savedSongsCount: number;
  sharesCount: number;
  queueSongCount: number;
};

const emptyListeningState: GuestListeningState = {
  sessionId: null,
  liveSeconds: 0,
  verifiedSeconds: 0,
  validRequirementSeconds: 30,
  validListenRecorded: false,
  completeListenRecorded: false,
  warning: "",
};

function formatClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(
    safe % 60,
  ).padStart(2, "0")}`;
}

function mapGuestSongs(rows: Array<Record<string, unknown>>): Song[] {
  return rows.map((row) => ({
    id: String(row.song_id),
    artistId: String(row.artist_id),
    title: String(row.title),
    artist: String(row.artist_name),
    coverUrl: safeCoverUrl(String(row.cover_image_url)),
    link: String(row.music_url),
    platform: displayPlatform[String(row.platform)] ?? "YouTube",
    genre: String(row.genre) as Song["genre"],
    language: String(row.song_language) as Song["language"],
    feedbackFocus: (row.feedback_focus ?? []) as Song["feedbackFocus"],
    explicitContent: Boolean(row.explicit_content),
    country: String(row.country),
    submittedAt: String(row.submitted_at),
    accent: "#c8ff4f",
  }));
}

function mapGuestIdentity(
  row: Record<string, unknown>,
  token?: string,
): GuestSession {
  return {
    token: token ?? String(row.guest_access_token),
    listenerId: String(row.guest_listener_id),
    recoveryCode: String(row.recovery_code),
    nickname: String(row.nickname),
    locale: row.interface_language === "es" ? "es" : "en",
    validListens: Number(row.valid_listens ?? 0),
  };
}

function mapGuestDiscovery(
  rows: Array<Record<string, unknown>>,
): GuestDiscoveryItem[] {
  return rows.map((row) => ({
    feedKind: String(row.feed_kind) as GuestDiscoveryItem["feedKind"],
    position: Number(row.feed_position ?? 0),
    badge: String(row.badge ?? ""),
    song: mapGuestSongs([row])[0],
    reviewsReceived: Number(row.reviews_received ?? 0),
    averageRating: Number(row.average_rating ?? 0),
    hookScore: Number(row.hook_score ?? 0),
    commentsCount: Number(row.comments_count ?? 0),
    likesCount: Number(row.likes_count ?? 0),
    followersCount: Number(row.followers_count ?? 0),
  }));
}

function mapGuestSummary(
  row: Record<string, unknown>,
): GuestExperienceSummary {
  return {
    summarySince: String(row.summary_since),
    communityActivityCount: Number(row.community_activity_count ?? 0),
    communityListensCount: Number(row.community_listens_count ?? 0),
    communityCommentsCount: Number(row.community_comments_count ?? 0),
    communityLikesCount: Number(row.community_likes_count ?? 0),
    communityFollowsCount: Number(row.community_follows_count ?? 0),
    communitySharesCount: Number(row.community_shares_count ?? 0),
    newSongsCount: Number(row.new_songs_count ?? 0),
    validListens: Number(row.valid_listens ?? 0),
    totalListeningSeconds: Number(row.total_listening_seconds ?? 0),
    songsExplored: Number(row.songs_explored ?? 0),
    likesCount: Number(row.likes_count ?? 0),
    commentsCount: Number(row.comments_count ?? 0),
    followingCount: Number(row.following_count ?? 0),
    savedSongsCount: Number(row.saved_songs_count ?? 0),
    sharesCount: Number(row.shares_count ?? 0),
    queueSongCount: Number(row.queue_song_count ?? 0),
  };
}

function persistGuest(guest: GuestSession) {
  window.localStorage.setItem("first-listen-guest-token", guest.token);
  window.localStorage.setItem(
    "first-listen-guest-recovery-code",
    guest.recoveryCode,
  );
  window.localStorage.setItem("first-listen-locale", guest.locale);
  document.cookie = `first-listen-guest-token=${guest.token}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`;
}

function GuestRegistrationGate({
  feature,
  locale,
  onClose,
}: {
  feature: string | null;
  locale: InterfaceLocale;
  onClose: () => void;
}) {
  if (!feature) return null;
  const spanish = locale === "es";
  return (
    <div
      aria-label={spanish ? "Registro requerido" : "Registration required"}
      aria-labelledby="guest-registration-title"
      aria-modal="true"
      className="guest-registration-gate"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
      role="dialog"
    >
      <section>
        <button
          aria-label={spanish ? "Cerrar" : "Close"}
          autoFocus
          className="guest-registration-close"
          onClick={onClose}
          type="button"
        >
          <X size={18} />
        </button>
        <span className="guest-registration-icon">
          <UserPlus size={22} />
        </span>
        <span className="eyebrow">{feature}</span>
        <h2 id="guest-registration-title">
          {spanish
            ? "Esta función está disponible para miembros registrados."
            : "This feature is available to registered members."}
        </h2>
        <p>
          {spanish
            ? "Crear una cuenta es gratis."
            : "Creating an account is free."}
        </p>
        <div>
          <Link href={`/signup?source=guest&feature=${encodeURIComponent(feature)}`}>
            {spanish ? "Crear cuenta gratis" : "Create Free Account"}
            <ArrowRight size={15} />
          </Link>
          <button onClick={onClose} type="button">
            {spanish ? "Quizás después" : "Maybe Later"}
          </button>
        </div>
      </section>
    </div>
  );
}

function GuestSidebar({
  guest,
  locale,
  view,
  onView,
  onGate,
  mobile = false,
}: {
  guest: GuestSession;
  locale: InterfaceLocale;
  view: GuestView;
  onView: (view: GuestView) => void;
  onGate: (feature: string) => void;
  mobile?: boolean;
}) {
  const spanish = locale === "es";
  const initials = guest.nickname
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const items = [
    {
      id: "review" as const,
      icon: Headphones,
      label: spanish ? "Review canciones" : "Review Songs",
    },
    {
      id: "dashboard" as const,
      icon: LayoutDashboard,
      label: spanish ? "Panel" : "Dashboard",
    },
    {
      id: "discovery" as const,
      icon: Music2,
      label: spanish ? "Descubrimiento" : "Discovery",
    },
    {
      id: "rankings" as const,
      icon: Trophy,
      label: spanish ? "Rankings" : "Rankings",
    },
  ];
  return (
    <aside className={`sidebar guest-sidebar${mobile ? " guest-sidebar-mobile" : ""}`}>
      <Logo />
      <nav>
        <span className="nav-label">{spanish ? "Comunidad" : "Community"}</span>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={view === item.id ? "active" : ""}
              key={item.id}
              onClick={() => onView(item.id)}
              type="button"
            >
              <Icon size={19} />
              <span>{item.label}</span>
              {item.id === "review" && <em>{guest.validListens}</em>}
            </button>
          );
        })}
        <button onClick={() => onGate(spanish ? "Subir canción" : "Upload Song")} type="button">
          <Upload size={19} />
          <span>{spanish ? "Enviar canción" : "Submit Song"}</span>
          <LockKeyhole className="nav-lock" size={14} />
        </button>
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-card">
          <div className="sidebar-card-icon"><Gauge size={18} /></div>
          <strong>{spanish ? "La atención crea oportunidades" : "Attention creates opportunity"}</strong>
          <p>
            {spanish
              ? "Escucha, comenta y descubre artistas junto a toda la comunidad."
              : "Listen, comment, and discover artists alongside the full community."}
          </p>
          <button onClick={() => onGate(spanish ? "Ganar tokens" : "Earn Tokens")} type="button">
            {spanish ? "Ver recompensas" : "View rewards"} <ArrowRight size={14} />
          </button>
        </div>
        <button
          className="profile-row"
          onClick={() =>
            onGate(spanish ? "Crear perfil de artista" : "Create Artist Profile")
          }
          type="button"
        >
          <span className="avatar">{initials || "FL"}</span>
          <span>
            <strong>{guest.nickname}</strong>
            <small>{guest.listenerId}</small>
          </span>
          <LockKeyhole size={14} />
        </button>
      </div>
    </aside>
  );
}

function GuestTopbar({
  locale,
  view,
  onLocaleChange,
  onMenu,
}: {
  locale: InterfaceLocale;
  view: GuestView;
  onLocaleChange: (locale: InterfaceLocale) => void;
  onMenu: () => void;
}) {
  const spanish = locale === "es";
  const titles = {
    review: {
      title: spanish ? "Review canciones" : "Review Songs",
      subtitle: spanish
        ? "Escucha, reacciona y ayuda a artistas reales."
        : "Listen, react, and help real artists.",
    },
    dashboard: {
      title: spanish ? "Tu actividad" : "Your Activity",
      subtitle: spanish
        ? "Tu historial como miembro de la comunidad."
        : "Your history as a community listener.",
    },
    discovery: {
      title: spanish ? "Descubrimiento" : "Discovery",
      subtitle: spanish
        ? "Spotlight, resultados y artistas activos."
        : "Spotlight, top results, and active artists.",
    },
    rankings: {
      title: "Rankings",
      subtitle: spanish
        ? "Resultados impulsados por actividad real."
        : "Results powered by real community activity.",
    },
  };
  return (
    <header className="topbar guest-topbar">
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
        <span className="app-status-pill">{spanish ? "Beta pública" : "Public Beta"}</span>
        <span className="app-founder-pill"><i /> {spanish ? "Programa fundador activo" : "Founding Artists Program Active"}</span>
        <Link className="help-button" href="/help" aria-label="Help Center">
          <CircleHelp size={19} />
        </Link>
        <Link className="session-button" href="/login">
          <LogIn size={15} />
          <b>{spanish ? "Iniciar sesión" : "Log In"}</b>
        </Link>
      </div>
    </header>
  );
}

function GuestAwaySummary({
  locale,
  summary,
  onViewActivity,
}: {
  locale: InterfaceLocale;
  summary: GuestExperienceSummary;
  onViewActivity: () => void;
}) {
  const spanish = locale === "es";
  return (
    <section className="offline-community-summary guest-away-summary">
      <div className="offline-community-heading">
        <span>
          <Bell size={17} />
          <strong>{spanish ? "Mientras no estabas" : "While You Were Away"}</strong>
        </span>
        <small>{new Date(summary.summarySince).toLocaleDateString()}</small>
      </div>
      <div className="offline-community-counts">
        <span><strong>{summary.communityListensCount}</strong> {spanish ? "escuchas y reviews" : "listens and reviews"}</span>
        <span><strong>{summary.communityLikesCount}</strong> {spanish ? "likes" : "likes"}</span>
        <span><strong>{summary.communityCommentsCount}</strong> {spanish ? "comentarios" : "comments"}</span>
        <span><strong>{summary.communityFollowsCount}</strong> {spanish ? "nuevos follows" : "new follows"}</span>
      </div>
      <div className="guest-away-details">
        <span><Share2 size={14} /> {summary.communitySharesCount} {spanish ? "compartidos" : "shares"}</span>
        <span><Music2 size={14} /> {summary.newSongsCount} {spanish ? "canciones nuevas" : "new songs"}</span>
        <span><Users size={14} /> {summary.communityActivityCount} {spanish ? "acciones de comunidad" : "community actions"}</span>
      </div>
      <button className="offline-community-action" onClick={onViewActivity} type="button">
        {spanish ? "Ver actividad" : "View Activity"} <ArrowRight size={14} />
      </button>
    </section>
  );
}

function GuestDashboard({
  locale,
  summary,
  onGate,
}: {
  locale: InterfaceLocale;
  summary: GuestExperienceSummary;
  onGate: (feature: string) => void;
}) {
  const spanish = locale === "es";
  const hours = Math.floor(summary.totalListeningSeconds / 3600);
  const minutes = Math.floor((summary.totalListeningSeconds % 3600) / 60);
  const stats = [
    [Headphones, spanish ? "Escuchas válidas" : "Valid Listens", summary.validListens],
    [Music2, spanish ? "Canciones exploradas" : "Songs Explored", summary.songsExplored],
    [Heart, "Likes", summary.likesCount],
    [MessageSquareText, spanish ? "Comentarios" : "Comments", summary.commentsCount],
    [Users, spanish ? "Artistas seguidos" : "Artists Followed", summary.followingCount],
    [Bookmark, spanish ? "Guardadas" : "Saved Songs", summary.savedSongsCount],
    [Share2, spanish ? "Compartidas" : "Shares", summary.sharesCount],
    [ListMusic, spanish ? "En tu cola" : "In Your Queue", summary.queueSongCount],
  ] as const;
  return (
    <section className="content guest-dashboard">
      <div className="guest-dashboard-heading">
        <div>
          <span className="eyebrow"><BarChart3 size={13} /> {spanish ? "Estadísticas" : "Statistics"}</span>
          <h2>{spanish ? "Tu impacto como listener" : "Your listener impact"}</h2>
          <p>
            {spanish
              ? `Tiempo total verificado: ${hours}h ${minutes}m.`
              : `Total verified listening time: ${hours}h ${minutes}m.`}
          </p>
        </div>
      </div>
      <div className="guest-stat-grid">
        {stats.map(([Icon, label, value]) => (
          <article key={label}>
            <span><Icon size={17} /></span>
            <small>{label}</small>
            <strong>{value}</strong>
          </article>
        ))}
      </div>
      <div className="guest-member-opportunities">
        <article>
          <Coins size={22} />
          <span className="eyebrow">{spanish ? "Tokens" : "Tokens"}</span>
          <h3>{spanish ? "Convierte tu escucha en oportunidades" : "Turn listening into opportunities"}</h3>
          <p>{spanish ? "Tu actividad permanece aquí. Regístrate para ganar y reclamar tokens." : "Your activity stays here. Register to earn and claim tokens."}</p>
          <button onClick={() => onGate(spanish ? "Ganar tokens" : "Earn Tokens")} type="button">
            {spanish ? "Ganar tokens" : "Earn Tokens"} <LockKeyhole size={13} />
          </button>
        </article>
        <article>
          <Sparkles size={22} />
          <span className="eyebrow">{spanish ? "Puntos" : "Points"}</span>
          <h3>{spanish ? "Participa más profundamente" : "Participate more deeply"}</h3>
          <p>{spanish ? "Los miembros pueden ganar puntos de comunidad y progreso." : "Members can earn community points and progression."}</p>
          <button onClick={() => onGate(spanish ? "Ganar puntos" : "Earn Points")} type="button">
            {spanish ? "Ganar puntos" : "Earn Points"} <LockKeyhole size={13} />
          </button>
        </article>
        <article>
          <UserPlus size={22} />
          <span className="eyebrow">{spanish ? "Perfil de artista" : "Artist Profile"}</span>
          <h3>{spanish ? "Comparte tu propia música" : "Share your own music"}</h3>
          <p>{spanish ? "Crea un perfil público y envía canciones cuando estés listo." : "Create a public profile and submit songs when you are ready."}</p>
          <button onClick={() => onGate(spanish ? "Crear perfil de artista" : "Create Artist Profile")} type="button">
            {spanish ? "Crear perfil" : "Create Artist Profile"} <LockKeyhole size={13} />
          </button>
        </article>
      </div>
    </section>
  );
}

function GuestDiscoveryShelves({
  discoveryFeed,
  locale,
  onPlay,
}: {
  discoveryFeed: GuestDiscoveryItem[];
  locale: InterfaceLocale;
  onPlay: (item: GuestDiscoveryItem) => void;
}) {
  const spanish = locale === "es";
  if (!discoveryFeed.length) return null;
  return (
    <section className="guest-discovery-hub">
      {(
        [
          ["spotlight", "Spotlight"],
          ["top", spanish ? "Top 10 de la comunidad" : "Community Top 10"],
          ["recent", spanish ? "Actividad reciente" : "Recently Active"],
        ] as const
      ).map(([kind, title]) => {
        const items = discoveryFeed.filter((item) => item.feedKind === kind);
        if (!items.length) return null;
        return (
          <section className="guest-discovery-shelf" key={kind}>
            <div className="guest-discovery-heading">
              <span className="eyebrow">
                {kind === "spotlight" ? <Sparkles size={13} /> : <Users size={13} />}
                {title}
              </span>
              <h2>
                {kind === "spotlight"
                  ? spanish ? "Artistas para descubrir ahora" : "Artists to discover now"
                  : spanish ? "Impulsado por escuchas y reacciones reales" : "Powered by real listens and reactions"}
              </h2>
            </div>
            <div className="guest-discovery-grid">
              {items.map((item) => (
                <article key={`${kind}-${item.song.id}`}>
                  <div className="guest-discovery-cover">
                    <Image
                      alt={`${item.song.title} cover`}
                      fill
                      sizes="(max-width: 700px) 76vw, 180px"
                      src={item.song.coverUrl}
                      unoptimized
                    />
                    <span>{kind === "top" ? `#${item.position}` : item.badge}</span>
                  </div>
                  <div className="guest-discovery-copy">
                    <strong>{item.song.title}</strong>
                    <Link href={`/artists/${item.song.artistId}`}>{item.song.artist}</Link>
                    <small>
                      {item.reviewsReceived} reviews / {item.averageRating.toFixed(1)} rating / Hook {Math.round(item.hookScore)}
                    </small>
                    <div>
                      <span><Heart size={12} /> {item.likesCount}</span>
                      <span><MessageSquareText size={12} /> {item.commentsCount}</span>
                      <span><Users size={12} /> {item.followersCount}</span>
                    </div>
                    <button onClick={() => onPlay(item)} type="button">
                      <Play fill="currentColor" size={13} />
                      {spanish ? "Escuchar y reaccionar" : "Listen and react"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </section>
  );
}

function GuestRankings({
  discoveryFeed,
  locale,
  onGate,
  onPlay,
}: {
  discoveryFeed: GuestDiscoveryItem[];
  locale: InterfaceLocale;
  onGate: (feature: string) => void;
  onPlay: (item: GuestDiscoveryItem) => void;
}) {
  const spanish = locale === "es";
  const results = discoveryFeed
    .filter((item) => item.feedKind === "top")
    .sort((left, right) => left.position - right.position);
  return (
    <section className="content guest-rankings">
      <div className="guest-dashboard-heading">
        <div>
          <span className="eyebrow"><Trophy size={13} /> {spanish ? "Mejores resultados" : "Top Results"}</span>
          <h2>{spanish ? "Ranking de la comunidad" : "Community Rankings"}</h2>
          <p>{spanish ? "Todos pueden explorar. La participación en rankings requiere una cuenta gratuita." : "Everyone can explore. Ranking participation requires a free account."}</p>
        </div>
        <button onClick={() => onGate(spanish ? "Participar en rankings" : "Participate In Rankings")} type="button">
          {spanish ? "Participar en rankings" : "Participate In Rankings"} <LockKeyhole size={14} />
        </button>
      </div>
      <div className="guest-ranking-list">
        {results.map((item) => (
          <article key={item.song.id}>
            <strong>#{item.position}</strong>
            <Image alt="" height={58} src={item.song.coverUrl} unoptimized width={58} />
            <div>
              <h3>{item.song.title}</h3>
              <Link href={`/artists/${item.song.artistId}`}>{item.song.artist}</Link>
              <small>{item.song.genre} / {item.song.language}</small>
            </div>
            <span><b>{Math.round(item.hookScore)}</b> Hook</span>
            <span><Heart size={13} /> {item.likesCount}</span>
            <span><Users size={13} /> {item.followersCount}</span>
            <button onClick={() => onPlay(item)} type="button"><Play size={14} /> {spanish ? "Escuchar" : "Listen"}</button>
          </article>
        ))}
      </div>
    </section>
  );
}

export function GuestExperience() {
  const [locale, setLocale] = useState<InterfaceLocale>("en");
  const [guest, setGuest] = useState<GuestSession | null>(null);
  const [view, setView] = useState<GuestView>("review");
  const [menuOpen, setMenuOpen] = useState(false);
  const [gateFeature, setGateFeature] = useState<string | null>(null);
  const [summary, setSummary] = useState<GuestExperienceSummary | null>(null);
  const [nickname, setNickname] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoverMode, setRecoverMode] = useState(false);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityMessage, setIdentityMessage] = useState("");
  const [showCredentials, setShowCredentials] = useState(false);
  const [songs, setSongs] = useState<Song[]>([]);
  const [discoveryFeed, setDiscoveryFeed] = useState<GuestDiscoveryItem[]>([]);
  const [songIndex, setSongIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState("");
  const [listening, setListening] =
    useState<GuestListeningState>(emptyListeningState);
  const playerRef = useRef<HTMLDivElement>(null);
  const listeningSessionRef = useRef<string | null>(null);
  const heartbeatInFlightRef = useRef(false);
  const lastHeartbeatAtRef = useRef(0);
  const lastLiveSampleRef = useRef<{ at: number; position: number } | null>(
    null,
  );
  const liveSecondsRef = useRef(0);
  const autoAdvanceStartedRef = useRef(false);
  const currentSong = songs[songIndex] ?? null;
  const songLoadedAt = useMemo(
    () => (currentSong ? new Date().toISOString() : null),
    [currentSong],
  );
  const spanish = locale === "es";

  const loadSummary = useCallback(
    async (token: string, markActivitySeen = false) => {
      const supabase = createClient();
      if (!supabase) return;
      const { data, error } = await supabase.rpc(
        "get_guest_experience_summary",
        {
          guest_access_token: token,
          mark_activity_seen: markActivitySeen,
        },
      );
      const row = Array.isArray(data) ? data[0] : data;
      if (!error && row) {
        setSummary(mapGuestSummary(row as Record<string, unknown>));
      }
    },
    [],
  );

  const loadQueue = useCallback(async (token: string) => {
    const supabase = createClient();
    if (!supabase) throw new Error("First Listen is not configured.");
    const { data, error } = await supabase.rpc("get_guest_song_queue", {
      guest_access_token: token,
      queue_limit: 12,
    });
    if (error) throw error;
    setSongs(mapGuestSongs((data ?? []) as Array<Record<string, unknown>>));
    setSongIndex(0);
  }, []);

  useEffect(() => {
    if (!guest) return;
    const interval = window.setInterval(
      () => void loadSummary(guest.token),
      30_000,
    );
    return () => window.clearInterval(interval);
  }, [guest, loadSummary]);

  useEffect(() => {
    if (!gateFeature) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setGateFeature(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [gateFeature]);

  useEffect(() => {
    let active = true;
    const loadDiscovery = async () => {
      const supabase = createClient();
      if (!supabase) return;
      const { data, error } = await supabase.rpc(
        "get_public_discovery_feed",
        { feed_limit: 8 },
      );
      if (active && !error) {
        setDiscoveryFeed(
          mapGuestDiscovery(
            (data ?? []) as Array<Record<string, unknown>>,
          ),
        );
      }
    };
    void loadDiscovery();
    const interval = window.setInterval(() => void loadDiscovery(), 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      const browserLocale: InterfaceLocale =
        navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
      const storedLocale = window.localStorage.getItem("first-listen-locale");
      const preferredLocale =
        storedLocale === "en" || storedLocale === "es"
          ? storedLocale
          : browserLocale;
      setLocale(preferredLocale);
      document.documentElement.lang = preferredLocale;

      const token = window.localStorage.getItem("first-listen-guest-token");
      if (!token) {
        setLoading(false);
        return;
      }

      const supabase = createClient();
      if (!supabase) {
        setFatalError("First Listen is not configured.");
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.rpc("get_guest_identity", {
        guest_access_token: token,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (!active) return;
      if (error || !row) {
        window.localStorage.removeItem("first-listen-guest-token");
        setLoading(false);
        return;
      }

      const returningGuest = mapGuestIdentity(
        row as Record<string, unknown>,
        token,
      );
      persistGuest(returningGuest);
      setGuest(returningGuest);
      setLocale(returningGuest.locale);
      document.documentElement.lang = returningGuest.locale;
      try {
        await Promise.all([loadQueue(token), loadSummary(token, true)]);
      } catch (queueError) {
        setFatalError(
          queueError instanceof Error
            ? queueError.message
            : "Music could not be loaded.",
        );
      } finally {
        setLoading(false);
      }
    };
    void initialize();
    return () => {
      active = false;
    };
  }, [loadQueue, loadSummary]);

  const completeIdentity = async (
    event: FormEvent<HTMLFormElement>,
    mode: "create" | "recover",
  ) => {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase) return;
    setIdentityMessage("");
    setIdentityBusy(true);
    const result =
      mode === "create"
        ? await supabase.rpc("create_guest_identity", {
            guest_nickname: nickname.trim(),
            guest_language: locale,
          })
        : await supabase.rpc("recover_guest_identity", {
            submitted_recovery_code: recoveryCode.trim(),
          });
    setIdentityBusy(false);
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (result.error || !row) {
      setIdentityMessage(
        result.error?.message ??
          (spanish
            ? "No encontramos ese perfil de invitado."
            : "We could not find that guest profile."),
      );
      return;
    }

    const nextGuest = mapGuestIdentity(row as Record<string, unknown>);
    persistGuest(nextGuest);
    setGuest(nextGuest);
    setLocale(nextGuest.locale);
    document.documentElement.lang = nextGuest.locale;
    setShowCredentials(mode === "create");
    try {
      await Promise.all([
        loadQueue(nextGuest.token),
        loadSummary(nextGuest.token, true),
      ]);
    } catch (queueError) {
      setFatalError(
        queueError instanceof Error
          ? queueError.message
          : "Music could not be loaded.",
      );
    }
  };

  useEffect(() => {
    listeningSessionRef.current = null;
    lastHeartbeatAtRef.current = 0;
    lastLiveSampleRef.current = null;
    liveSecondsRef.current = 0;
    autoAdvanceStartedRef.current = false;
    setCountdown(null);
    setListening(emptyListeningState);
  }, [currentSong]);

  useEffect(() => {
    if (!playing || !currentSong) return;
    const frame = window.requestAnimationFrame(() => {
      playerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentSong, playing]);

  const startCurrentSong = useCallback(async () => {
    if (!guest || !currentSong) return;
    setPlaying(true);
    const supabase = createClient();
    if (!supabase) return;
    const { data, error } = await supabase.rpc(
      "start_guest_listening_session",
      {
        guest_access_token: guest.token,
        target_song_id: currentSong.id,
      },
    );
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row?.listening_session_id) {
      setListening((current) => ({
        ...current,
        warning: error?.message ?? "Listening verification could not start.",
      }));
      return;
    }
    listeningSessionRef.current = String(row.listening_session_id);
    setListening((current) => ({
      ...current,
      sessionId: String(row.listening_session_id),
      validRequirementSeconds: Number(row.valid_requirement_seconds ?? 30),
    }));

    await supabase.rpc("record_song_view", {
      target_song_id: currentSong.id,
      guest_access_token: guest.token,
    });
  }, [currentSong, guest]);

  const finishCurrentSession = useCallback(async () => {
    if (!guest || !listeningSessionRef.current) return;
    const supabase = createClient();
    if (!supabase) return;
    await supabase.rpc("finish_guest_listening_session", {
      guest_access_token: guest.token,
      target_session_id: listeningSessionRef.current,
    });
  }, [guest]);

  const nextSong = useCallback(async () => {
    if (!guest || songs.length === 0) return;
    await finishCurrentSession();
    const nextIndex = songIndex + 1;
    if (nextIndex < songs.length) {
      setSongIndex(nextIndex);
      setPlaying(true);
      return;
    }
    try {
      await loadQueue(guest.token);
      setPlaying(true);
    } catch (error) {
      setFatalError(
        error instanceof Error ? error.message : "The next song could not load.",
      );
    }
  }, [finishCurrentSession, guest, loadQueue, songIndex, songs.length]);

  const playDiscoverySong = useCallback(
    async (item: GuestDiscoveryItem) => {
      await finishCurrentSession();
      const existingIndex = songs.findIndex(
        (candidate) => candidate.id === item.song.id,
      );
      if (existingIndex >= 0) {
        setSongIndex(existingIndex);
      } else {
        setSongs((current) => [
          item.song,
          ...current.filter((candidate) => candidate.id !== item.song.id),
        ]);
        setSongIndex(0);
      }
      setPlaying(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [finishCurrentSession, songs],
  );

  useEffect(() => {
    if (!playing || !currentSong || listeningSessionRef.current) return;
    void startCurrentSong();
  }, [currentSong, playing, startCurrentSong]);

  const handleTelemetry = useCallback(
    async (snapshot: ProviderTelemetrySnapshot) => {
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
          setListening((current) => ({
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
        snapshot.playbackState === "ended" &&
        autoPlay &&
        !autoAdvanceStartedRef.current
      ) {
        autoAdvanceStartedRef.current = true;
        setCountdown(3);
      }
      if (snapshot.playbackState === "playing" && autoAdvanceStartedRef.current) {
        autoAdvanceStartedRef.current = false;
        setCountdown(null);
      }

      const sessionId = listeningSessionRef.current;
      if (
        !guest ||
        !sessionId ||
        !snapshot.supported ||
        !["playing", "ended"].includes(snapshot.playbackState) ||
        heartbeatInFlightRef.current
      ) {
        return;
      }
      const heartbeatDue =
        snapshot.playbackState === "ended" ||
        Date.now() - lastHeartbeatAtRef.current >= 10000;
      if (!heartbeatDue) return;

      const supabase = createClient();
      if (!supabase) return;
      heartbeatInFlightRef.current = true;
      lastHeartbeatAtRef.current = Date.now();
      const { data, error } = await supabase.rpc(
        "record_guest_listening_heartbeat",
        {
          guest_access_token: guest.token,
          target_session_id: sessionId,
          playback_position_seconds: snapshot.currentTime,
          playback_duration_seconds: snapshot.duration,
          playback_state: snapshot.playbackState,
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
        setListening((current) => ({
          ...current,
          warning: error?.message ?? "Listening progress could not be verified.",
        }));
        return;
      }
      const becameValid =
        Boolean(row.valid_listen_recorded) &&
        !listening.validListenRecorded;
      setListening((current) => ({
        ...current,
        verifiedSeconds: Number(row.session_verified_seconds ?? 0),
        validListenRecorded: Boolean(row.valid_listen_recorded),
        completeListenRecorded: Boolean(row.complete_listen_recorded),
        validRequirementSeconds: Number(
          row.valid_requirement_seconds ?? current.validRequirementSeconds,
        ),
        warning: String(row.warning ?? ""),
      }));
      if (becameValid) {
        setGuest((current) =>
          current
            ? { ...current, validListens: current.validListens + 1 }
            : current,
        );
        void loadSummary(guest.token);
      }
    },
    [autoPlay, guest, listening.validListenRecorded, loadSummary],
  );

  useEffect(() => {
    if (countdown === null) return;
    const timeout = window.setTimeout(() => {
      if (countdown === 1) {
        setCountdown(null);
        void nextSong();
        return;
      }
      setCountdown((current) =>
        current === null ? null : Math.max(1, current - 1),
      );
    }, 1000);
    return () => window.clearTimeout(timeout);
  }, [countdown, nextSong]);

  const changeLocale = (nextLocale: InterfaceLocale) => {
    setLocale(nextLocale);
    window.localStorage.setItem("first-listen-locale", nextLocale);
    document.documentElement.lang = nextLocale;
    setGuest((current) =>
      current ? { ...current, locale: nextLocale } : current,
    );
    if (guest) {
      const supabase = createClient();
      if (supabase) {
        void supabase.rpc("update_guest_language", {
          guest_access_token: guest.token,
          guest_language: nextLocale,
        });
      }
    }
  };

  if (loading) {
    return (
      <main className="guest-page guest-loading">
        <Logo />
        <span><Headphones size={22} /> Preparing your guest profile...</span>
      </main>
    );
  }

  if (!guest) {
    return (
      <main className="guest-page guest-identity-page">
        <header className="guest-header">
          <Link href="/"><Logo /></Link>
          <LanguageSelector compact locale={locale} onChange={changeLocale} />
        </header>
        <section className="guest-identity-card">
          <span className="eyebrow">
            <Headphones size={14} />
            {spanish ? "Visita para escuchar" : "Guest Listener"}
          </span>
          <h1>
            {spanish
              ? "Participa en la comunidad sin crear una cuenta."
              : "Join the community without creating an account."}
          </h1>
          <p>
            {spanish
              ? "Elige un nombre para mostrar. Es opcional y aparecerá cuando participes."
              : "Choose a display name. It is optional and appears when you participate."}
          </p>
          <div className="guest-identity-benefits">
            <span><Heart size={14} /> {spanish ? "Des Like" : "Like songs"}</span>
            <span><MessageSquareText size={14} /> {spanish ? "Comentes" : "Comment"}</span>
            <span><UserPlus size={14} /> {spanish ? "Sigas artistas" : "Follow artists"}</span>
            <span><Bookmark size={14} /> {spanish ? "Guardes canciones" : "Save songs"}</span>
            <span><Share2 size={14} /> {spanish ? "Compartas canciones" : "Share songs"}</span>
          </div>

          {!recoverMode ? (
            <form onSubmit={(event) => void completeIdentity(event, "create")}>
              <label htmlFor="guest-nickname">
                {spanish ? "Nickname" : "Nickname"}
              </label>
              <input
                autoComplete="nickname"
                id="guest-nickname"
                maxLength={30}
                onChange={(event) => setNickname(event.target.value)}
                placeholder={spanish ? "Nickname (opcional)" : "Nickname (optional)"}
                value={nickname}
              />
              <small>
                {spanish
                  ? "Si lo dejas vacío, crearemos un nombre Listener automáticamente."
                  : "Leave it blank and we will generate a Listener name automatically."}
              </small>
              <button disabled={identityBusy} type="submit">
                {identityBusy
                  ? spanish
                    ? "Preparando..."
                    : "Preparing..."
                  : spanish
                    ? "Continuar"
                    : "Continue"}{" "}
                <ArrowRight size={15} />
              </button>
            </form>
          ) : (
            <form onSubmit={(event) => void completeIdentity(event, "recover")}>
              <label htmlFor="guest-recovery-code">
                {spanish ? "Código de recuperación" : "Recovery Code"}
              </label>
              <input
                id="guest-recovery-code"
                onChange={(event) => setRecoveryCode(event.target.value)}
                placeholder="MUSIC-RIVER-4821"
                required
                value={recoveryCode}
              />
              <button disabled={identityBusy || !recoveryCode.trim()} type="submit">
                {identityBusy
                  ? spanish
                    ? "Recuperando..."
                    : "Recovering..."
                  : spanish
                    ? "Recuperar perfil"
                    : "Recover Profile"}{" "}
                <KeyRound size={15} />
              </button>
            </form>
          )}

          <button
            className="guest-recovery-toggle"
            onClick={() => {
              setRecoverMode((current) => !current);
              setIdentityMessage("");
            }}
            type="button"
          >
            {recoverMode
              ? spanish
                ? "Crear un perfil nuevo"
                : "Create a new profile"
              : spanish
                ? "¿Ya tienes un perfil de invitado? Recuperar perfil"
                : "Already have a guest profile? Recover Profile"}
          </button>
          {identityMessage && <p className="guest-identity-error" role="alert">{identityMessage}</p>}
          <small>
            <ShieldCheck size={13} />
            {spanish
              ? "Sin email, contraseña ni fecha de vencimiento."
              : "No email, password, or expiration date."}
          </small>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell guest-app-shell">
      <GuestSidebar
        guest={guest}
        locale={locale}
        onGate={setGateFeature}
        onView={setView}
        view={view}
      />
      <div className="app-main">
        <GuestTopbar
          locale={locale}
          onLocaleChange={changeLocale}
          onMenu={() => setMenuOpen(true)}
          view={view}
        />
        <main className="guest-page">
      {showCredentials && (
        <section className="guest-credentials" role="status">
          <div>
            <span className="eyebrow">
              <KeyRound size={13} />
              {spanish ? "Guarda tu código de recuperación" : "Save your recovery code"}
            </span>
            <strong>{guest.recoveryCode}</strong>
            <p>
              {spanish
                ? "Úsalo para recuperar tus likes, comentarios, artistas seguidos, canciones guardadas e historial en otro dispositivo."
                : "Use it to recover your likes, comments, follows, saved songs, and history on another device."}
            </p>
          </div>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(guest.recoveryCode);
              setIdentityMessage(spanish ? "Código copiado." : "Code copied.");
            }}
            type="button"
          >
            <Copy size={14} /> {spanish ? "Copiar" : "Copy"}
          </button>
          <button onClick={() => setShowCredentials(false)} type="button">
            {spanish ? "Listo" : "Done"}
          </button>
        </section>
      )}

      {summary && (
        <GuestAwaySummary
          locale={locale}
          onViewActivity={() => setView("discovery")}
          summary={summary}
        />
      )}

      {view === "dashboard" && summary && (
        <GuestDashboard
          locale={locale}
          onGate={setGateFeature}
          summary={summary}
        />
      )}

      {view === "discovery" && (
        <>
          <GuestDiscoveryShelves
            discoveryFeed={discoveryFeed}
            locale={locale}
            onPlay={(item) => {
              setView("review");
              void playDiscoverySong(item);
            }}
          />
          <CommunityPulse locale={locale} />
        </>
      )}

      {view === "rankings" && (
        <GuestRankings
          discoveryFeed={discoveryFeed}
          locale={locale}
          onGate={setGateFeature}
          onPlay={(item) => {
            setView("review");
            void playDiscoverySong(item);
          }}
        />
      )}

      {view === "review" && (
      <>
      <section className="guest-welcome guest-welcome-compact">
        <span className="eyebrow"><Sparkles size={13} /> Review Songs</span>
        <h1>
          {spanish
            ? `Escucha, reacciona y descubre, ${guest.nickname}.`
            : `Listen, react, and discover, ${guest.nickname}.`}
        </h1>
        <p>
          {spanish
            ? "La música empieza aquí. Tus reacciones ayudan a artistas reales."
            : "The music starts here. Your reactions help real artists."}
        </p>
        <div>
          <span><CheckCircle2 size={14} /> {guest.validListens} {spanish ? "escuchas válidas" : "valid listens"}</span>
          <span><Users size={14} /> {spanish ? "Comunidad completa" : "Full community access"}</span>
          <span><Headphones size={14} /> {spanish ? "Perfil permanente" : "Permanent listener profile"}</span>
        </div>
      </section>

      {fatalError && (
        <section className="guest-message" role="alert">
          <ShieldCheck size={20} />
          <div>
            <strong>{fatalError}</strong>
            <Link href="/">{spanish ? "Volver al inicio" : "Return home"} <ArrowRight size={14} /></Link>
          </div>
        </section>
      )}

      {!fatalError && currentSong && (
        <section className="content review-layout guest-listening-layout">
          <div className="review-card guest-player-column">
            <div className="guest-now-playing">
              <span className="eyebrow"><Headphones size={13} /> {spanish ? "Ahora escuchando" : "Now Listening"}</span>
              <h2>{currentSong.title}</h2>
              <Link href={`/artists/${currentSong.artistId}`}>
                {currentSong.artist} <ArrowRight size={13} />
              </Link>
              <p>
                {currentSong.platform} / {currentSong.genre} /{" "}
                {currentSong.language}
              </p>
            </div>

            {!playing ? (
              <button
                className="guest-listen-button"
                onClick={() => setPlaying(true)}
                type="button"
              >
                <Play fill="currentColor" size={19} />
                {spanish ? "Escuchar ahora" : "Listen Now"}
              </button>
            ) : (
              <div className="guest-player-wrap" ref={playerRef}>
                <ProviderPlayer
                  artist={currentSong.artist}
                  autoPlay
                  coverUrl={currentSong.coverUrl}
                  link={currentSong.link}
                  locale={locale}
                  onTelemetry={handleTelemetry}
                  platform={currentSong.platform}
                  songLoadedAt={songLoadedAt}
                  title={currentSong.title}
                />
                {countdown !== null && (
                  <div className="auto-advance-overlay" role="status">
                    <strong>{spanish ? "Canción terminada" : "Song Finished"}</strong>
                    <span>{spanish ? "Siguiente canción en" : "Starting next song in"}</span>
                    <b>{countdown}</b>
                  </div>
                )}
              </div>
            )}

            <div className="guest-listening-progress">
              <div>
                <span><Headphones size={14} /> {spanish ? "Tiempo escuchado" : "Listening Time"}</span>
                <strong>{formatClock(listening.liveSeconds)}</strong>
              </div>
              <div>
                <span><CheckCircle2 size={14} /> {spanish ? "Escucha válida" : "Valid Listen"}</span>
                <strong>
                  {listening.validListenRecorded
                    ? spanish ? "Completada" : "Completed"
                    : `${formatClock(listening.verifiedSeconds)} / ${formatClock(listening.validRequirementSeconds)}`}
                </strong>
              </div>
              <div className="progress-track">
                <i
                  style={{
                    width: `${Math.min(
                      100,
                      (listening.verifiedSeconds /
                        Math.max(1, listening.validRequirementSeconds)) *
                        100,
                    )}%`,
                  }}
                />
              </div>
              {listening.warning && <small>{listening.warning}</small>}
            </div>

            <SongActionBar
              artist={currentSong.artist}
              artistId={currentSong.artistId}
              guestToken={guest.token}
              link={currentSong.link}
              locale={locale}
              platform={currentSong.platform}
              songId={currentSong.id}
              title={currentSong.title}
            />

            <div className="guest-player-controls">
              <button onClick={() => void nextSong()} type="button">
                <SkipForward size={15} /> {spanish ? "Siguiente canción" : "Next Song"}
              </button>
              <button
                className={autoPlay ? "active" : ""}
                onClick={() => {
                  setAutoPlay((current) => !current);
                  setCountdown(null);
                }}
                type="button"
              >
                {autoPlay ? <Pause size={15} /> : <Play size={15} />}
                {autoPlay
                  ? spanish ? "Pausar auto play" : "Pause Auto Play"
                  : spanish ? "Reanudar auto play" : "Resume Auto Play"}
              </button>
            </div>
          </div>

          <aside className="review-side guest-side">
            <section>
              <span className="eyebrow"><Users size={13} /> {spanish ? "Comunidad real" : "Real community"}</span>
              <h2>{spanish ? "Eres parte de la escucha" : "You are part of the listening community"}</h2>
              <p>
                {spanish
                  ? "Tus likes, comentarios, follows y canciones guardadas aparecen junto a la actividad de todos los listeners."
                  : "Your likes, comments, follows, and saved songs appear alongside every listener's community activity."}
              </p>
            </section>
            <section>
              <span className="eyebrow"><ListMusic size={13} /> {spanish ? "Cola de reviews" : "Review Queue"}</span>
              <h2>
                {songs.length - songIndex - 1}{" "}
                {spanish ? "canciones siguientes" : "songs up next"}
              </h2>
              {songs.slice(songIndex + 1, songIndex + 4).map((song) => (
                <button
                  key={song.id}
                  onClick={() => {
                    const index = songs.findIndex((item) => item.id === song.id);
                    setSongIndex(index);
                    setPlaying(true);
                  }}
                  type="button"
                >
                  <span>{song.title}</span>
                  <small>{song.artist}</small>
                </button>
              ))}
            </section>
            <section className="guest-conversion-card">
              <UserPlus size={22} />
              <h2>{spanish ? "¿También creas música?" : "Do you create music too?"}</h2>
              <p>
                {spanish
                  ? "Tu actividad de listener ya está guardada. Regístrate cuando quieras subir música o ganar recompensas."
                  : "Your listener activity is already saved. Register whenever you want to upload music or earn rewards."}
              </p>
              <button
                onClick={() =>
                  setGateFeature(
                    spanish ? "Crear perfil de artista" : "Create Artist Profile",
                  )
                }
                type="button"
              >
                {spanish ? "Crear perfil de artista" : "Create Artist Profile"} <ArrowRight size={14} />
              </button>
            </section>
          </aside>
        </section>
      )}

      {!fatalError && songs.length === 0 && (
        <section className="guest-message">
          <CheckCircle2 size={22} />
          <div>
            <strong>{spanish ? "Estás al día" : "You are all caught up"}</strong>
            <p>{spanish ? "Explora perfiles mientras llegan nuevas canciones." : "Explore artist profiles while new songs arrive."}</p>
            <Link href="/">{spanish ? "Explorar First Listen" : "Explore First Listen"}</Link>
          </div>
        </section>
      )}

      <GuestDiscoveryShelves
        discoveryFeed={discoveryFeed}
        locale={locale}
        onPlay={(item) => void playDiscoverySong(item)}
      />

      <CommunityPulse locale={locale} />
      </>
      )}
        </main>
      </div>
      {menuOpen && (
        <div className="guest-mobile-drawer">
          <button
            aria-label={spanish ? "Cerrar menú" : "Close menu"}
            className="guest-mobile-backdrop"
            onClick={() => setMenuOpen(false)}
            type="button"
          />
          <GuestSidebar
            guest={guest}
            locale={locale}
            mobile
            onGate={(feature) => {
              setMenuOpen(false);
              setGateFeature(feature);
            }}
            onView={(nextView) => {
              setView(nextView);
              setMenuOpen(false);
            }}
            view={view}
          />
          <button
            aria-label={spanish ? "Cerrar menú" : "Close menu"}
            className="guest-mobile-close"
            onClick={() => setMenuOpen(false)}
            type="button"
          >
            <X size={19} />
          </button>
        </div>
      )}
      <GuestRegistrationGate
        feature={gateFeature}
        locale={locale}
        onClose={() => setGateFeature(null)}
      />
    </div>
  );
}
