"use client";

import Link from "next/link";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Compass,
  Expand,
  Flag,
  Headphones,
  Home,
  ListMusic,
  LogIn,
  LogOut,
  MessageCircleQuestion,
  PanelTopOpen,
  Pause,
  Play,
  Radio,
  Repeat2,
  ShieldCheck,
  SkipForward,
  Sparkles,
  ThumbsDown,
  Timer,
  Upload,
  UserRound,
} from "lucide-react";
import {
  ProviderPlayer,
  type ProviderTelemetrySnapshot,
} from "@/components/provider-player";
import { LanguageSelector } from "@/components/language-selector";
import { Logo } from "@/components/logo";
import { clearBrowserAuthSession } from "@/lib/auth-session-cleanup";
import type { InterfaceLocale } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/client";
import type { Platform } from "@/lib/types";
import {
  persistInterfaceLocale,
  preferredInterfaceLocale,
} from "@/lib/use-interface-locale";
import {
  buildArtistFairQueue,
  countQueueArtists,
} from "@/lib/workspace-v2/artist-fair-queue";
import {
  dispatchWorkspaceV2PlaybackCommand,
  type WorkspaceV2Queue,
  type WorkspaceV2Song,
} from "@/lib/workspace-v2";

const SIMPLE_PREVIEW_PLAYER_CHANNEL = "first-listen-simple-preview";
const DISCOVERY_PROMPT_KEY = "first-listen-discovery-prompt-v1";
const DISCOVERY_NOT_FOR_ME_KEY = "first-listen-not-for-me-v1";
const NOT_FOR_ME_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

type DiscoveryPromptChoice = "yes" | "not-now" | "later";

function formatSessionTime(totalSeconds: number, spanish: boolean) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!minutes) return spanish ? `${seconds} seg` : `${seconds} sec`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function normalizedLabel(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function songStyle(song: WorkspaceV2Song, spanish: boolean) {
  return (
    normalizedLabel(song.genre) ||
    normalizedLabel(song.subcategory) ||
    normalizedLabel(song.category) ||
    (spanish ? "Descubrir" : "Discover")
  );
}

function matchesStyle(song: WorkspaceV2Song, style: string) {
  if (style === "all") return true;
  return [song.genre, song.subcategory, song.category]
    .map((value) => normalizedLabel(value).toLocaleLowerCase())
    .includes(style.toLocaleLowerCase());
}

function displayStyleLabel(style: string, spanish: boolean) {
  if (!spanish) return style;
  const normalizedStyle = style.toLocaleLowerCase();
  if (normalizedStyle === "other") return "Otro";
  if (normalizedStyle === "regional mexican") return "Regional mexicano";
  return style;
}

export function FirstListenSimplePreview({
  authenticated = false,
  canAccessAdmin = false,
  displayName = "",
  locale,
  queue,
}: {
  authenticated?: boolean;
  canAccessAdmin?: boolean;
  displayName?: string;
  locale: InterfaceLocale;
  queue: WorkspaceV2Queue;
}) {
  const [interfaceLocale, setInterfaceLocale] =
    useState<InterfaceLocale>(locale);
  const spanish = interfaceLocale === "es";
  const playableSongs = useMemo(() => {
    const internal = queue.songs.filter(
      (song) => song.playbackKind === "internal",
    );
    return internal.length ? internal : queue.songs;
  }, [queue.songs]);
  const styles = useMemo(
    () =>
      Array.from(
        new Set(
          playableSongs
            .map((song) => songStyle(song, spanish))
            .filter(Boolean),
        ),
      ).slice(0, 7),
    [playableSongs, spanish],
  );
  const [selectedStyle, setSelectedStyle] = useState("all");
  const [excludedSongIds, setExcludedSongIds] = useState<Set<string>>(
    () => new Set(),
  );
  const filteredSongs = useMemo(() => {
    const matching = playableSongs.filter(
      (song) =>
        matchesStyle(song, selectedStyle) && !excludedSongIds.has(song.id),
    );
    const available = matching.length
      ? matching
      : playableSongs.filter((song) => !excludedSongIds.has(song.id));
    return buildArtistFairQueue(available.length ? available : playableSongs);
  }, [excludedSongIds, playableSongs, selectedStyle]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [playerVersion, setPlayerVersion] = useState(0);
  const [started, setStarted] = useState(false);
  const [shouldAutoStart, setShouldAutoStart] = useState(false);
  const [continuousPlayback, setContinuousPlayback] = useState(true);
  const [pausedByUser, setPausedByUser] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);
  const [promptReady, setPromptReady] = useState(false);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [verifiedListens, setVerifiedListens] = useState(0);
  const [reportNotice, setReportNotice] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [playerDocked, setPlayerDocked] = useState(false);
  const [playerPlaceholderHeight, setPlayerPlaceholderHeight] = useState(0);
  const newTodayRowRef = useRef<HTMLDivElement>(null);
  const playerSlotRef = useRef<HTMLDivElement>(null);
  const playerCardRef = useRef<HTMLElement>(null);
  const playerFrameRef = useRef<HTMLDivElement>(null);
  const requestPlaybackRef = useRef<(() => void) | null>(null);
  const pendingPlaybackRef = useRef(false);
  const pausedByUserRef = useRef(false);
  const completedTrackRef = useRef("");
  const lastTelemetryRef = useRef<{
    songId: string;
    currentTime: number;
    sampledAt: number;
  } | null>(null);
  const sessionSecondsRef = useRef(0);
  const listenedSecondsBySongRef = useRef(new Map<string, number>());
  const verifiedSongIdsRef = useRef(new Set<string>());
  const activeSong =
    filteredSongs[activeIndex % Math.max(1, filteredSongs.length)] ??
    playableSongs[0];
  const nextSong = filteredSongs.length
    ? filteredSongs[(activeIndex + 1) % filteredSongs.length]
    : null;
  const newTodaySongs = filteredSongs.slice(0, 12);

  useEffect(() => {
    const nextLocale = preferredInterfaceLocale(locale);
    setInterfaceLocale(nextLocale);
    persistInterfaceLocale(nextLocale);
  }, [locale]);

  useEffect(() => {
    const now = Date.now();
    try {
      const storedPrompt = window.localStorage.getItem(DISCOVERY_PROMPT_KEY);
      const promptState = storedPrompt
        ? (JSON.parse(storedPrompt) as { snoozedUntil?: number })
        : null;
      setPromptVisible(
        !promptState?.snoozedUntil || promptState.snoozedUntil <= now,
      );

      const storedExclusions = window.localStorage.getItem(
        DISCOVERY_NOT_FOR_ME_KEY,
      );
      const exclusionState = storedExclusions
        ? (JSON.parse(storedExclusions) as Record<string, number>)
        : {};
      const activeExclusions = Object.entries(exclusionState).filter(
        ([, expiresAt]) => Number(expiresAt) > now,
      );
      setExcludedSongIds(new Set(activeExclusions.map(([songId]) => songId)));
      window.localStorage.setItem(
        DISCOVERY_NOT_FOR_ME_KEY,
        JSON.stringify(Object.fromEntries(activeExclusions)),
      );
    } catch {
      setPromptVisible(true);
    } finally {
      setPromptReady(true);
    }
  }, []);

  useEffect(() => {
    setActiveIndex(0);
    completedTrackRef.current = "";
    lastTelemetryRef.current = null;
  }, [excludedSongIds, selectedStyle]);

  useEffect(() => {
    const updateDockedPlayer = () => {
      const slot = playerSlotRef.current;
      const card = playerCardRef.current;
      if (!slot || !card || !started || document.fullscreenElement) {
        setPlayerDocked(false);
        return;
      }
      const bounds = slot.getBoundingClientRect();
      const visible = bounds.bottom > 72 && bounds.top < window.innerHeight - 72;
      const shouldDock = !visible;
      if (shouldDock) {
        setPlayerPlaceholderHeight((current) =>
          current || Math.ceil(card.getBoundingClientRect().height),
        );
      }
      setPlayerDocked(shouldDock);
    };

    updateDockedPlayer();
    window.addEventListener("scroll", updateDockedPlayer, { passive: true });
    window.addEventListener("resize", updateDockedPlayer);
    document.addEventListener("fullscreenchange", updateDockedPlayer);
    return () => {
      window.removeEventListener("scroll", updateDockedPlayer);
      window.removeEventListener("resize", updateDockedPlayer);
      document.removeEventListener("fullscreenchange", updateDockedPlayer);
    };
  }, [started]);

  const requestPlayback = useCallback(
    (continuous = continuousPlayback) => {
      pausedByUserRef.current = false;
      setStarted(true);
      setShouldAutoStart(true);
      setContinuousPlayback(continuous);
      setPausedByUser(false);
      pendingPlaybackRef.current = true;
      requestPlaybackRef.current?.();
      dispatchWorkspaceV2PlaybackCommand("play", {
        channel: SIMPLE_PREVIEW_PLAYER_CHANNEL,
        source: "user-click",
      });
    },
    [continuousPlayback],
  );

  const pausePlayback = useCallback(() => {
    pausedByUserRef.current = true;
    pendingPlaybackRef.current = false;
    setShouldAutoStart(false);
    setPausedByUser(true);
    dispatchWorkspaceV2PlaybackCommand("pause", {
      channel: SIMPLE_PREVIEW_PLAYER_CHANNEL,
      source: "user-click",
    });
  }, []);

  const handleSignOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    pausePlayback();
    try {
      const supabase = createClient();
      if (supabase) await supabase.auth.signOut({ scope: "global" });
    } catch {
      // Local cleanup below still guarantees that this browser leaves the account.
    } finally {
      clearBrowserAuthSession();
      window.location.replace("/login?next=/dashboard");
    }
  }, [pausePlayback, signingOut]);

  const playNext = useCallback(
    (playImmediately = true) => {
      if (!filteredSongs.length) return;
      dispatchWorkspaceV2PlaybackCommand("pause", {
        channel: SIMPLE_PREVIEW_PLAYER_CHANNEL,
        source: "user-click",
      });
      pendingPlaybackRef.current = playImmediately;
      pausedByUserRef.current = !playImmediately;
      completedTrackRef.current = "";
      lastTelemetryRef.current = null;
      setStarted(playImmediately);
      setShouldAutoStart(playImmediately);
      setPausedByUser(!playImmediately);
      setActiveIndex((current) => (current + 1) % filteredSongs.length);
      setPlayerVersion((current) => current + 1);
    },
    [filteredSongs.length],
  );

  const selectStyle = (style: string) => {
    pendingPlaybackRef.current = started && !pausedByUser;
    pausedByUserRef.current = pausedByUser;
    completedTrackRef.current = "";
    setSelectedStyle(style);
    setActiveIndex(0);
    setPlayerVersion((current) => current + 1);
  };

  const selectDiscoverySong = useCallback((index: number) => {
    dispatchWorkspaceV2PlaybackCommand("pause", {
      channel: SIMPLE_PREVIEW_PLAYER_CHANNEL,
      source: "user-click",
    });
    pendingPlaybackRef.current = true;
    pausedByUserRef.current = false;
    completedTrackRef.current = "";
    lastTelemetryRef.current = null;
    setStarted(true);
    setShouldAutoStart(true);
    setPausedByUser(false);
    setActiveIndex(index);
    setPlayerVersion((current) => current + 1);
    window.setTimeout(() => {
      document
        .getElementById("first-listen-player")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, []);

  const handleLocaleChange = useCallback(
    (nextLocale: InterfaceLocale) => {
      setInterfaceLocale(nextLocale);
      persistInterfaceLocale(nextLocale, true);
      if (!authenticated) return;
      const supabase = createClient();
      if (supabase) {
        void supabase.rpc("set_interface_language", {
          profile_interface_language: nextLocale,
        });
      }
    },
    [authenticated],
  );

  const scrollNewToday = useCallback((direction: -1 | 1) => {
    const row = newTodayRowRef.current;
    if (!row) return;
    row.scrollBy({
      behavior: "smooth",
      left: direction * Math.max(320, Math.floor(row.clientWidth * 0.78)),
    });
  }, []);

  const restorePlayer = useCallback(() => {
    playerSlotRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const openPlayerFullscreen = useCallback(async () => {
    const frame = playerFrameRef.current as
      | (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> | void })
      | null;
    if (!frame) return;
    try {
      if (frame.requestFullscreen) await frame.requestFullscreen();
      else if (frame.webkitRequestFullscreen) await frame.webkitRequestFullscreen();
      else restorePlayer();
    } catch {
      restorePlayer();
    }
  }, [restorePlayer]);

  const startFromHero = useCallback(() => {
    requestPlayback(false);
    window.setTimeout(() => {
      document
        .getElementById("first-listen-player")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, [requestPlayback]);

  const savePromptChoice = useCallback(
    (choice: DiscoveryPromptChoice, snoozeMs: number) => {
      try {
        window.localStorage.setItem(
          DISCOVERY_PROMPT_KEY,
          JSON.stringify({
            choice,
            chosenAt: Date.now(),
            snoozedUntil: Date.now() + snoozeMs,
          }),
        );
      } catch {
        // Playback remains available when browser storage is unavailable.
      }
      setPromptVisible(false);
    },
    [],
  );

  const acceptDiscovery = useCallback(() => {
    savePromptChoice("yes", 2 * 60 * 60 * 1000);
    requestPlayback(true);
  }, [requestPlayback, savePromptChoice]);

  const declineDiscovery = useCallback(() => {
    savePromptChoice("not-now", 24 * 60 * 60 * 1000);
    setContinuousPlayback(false);
  }, [savePromptChoice]);

  const snoozeDiscovery = useCallback(() => {
    savePromptChoice("later", 2 * 60 * 60 * 1000);
    setContinuousPlayback(false);
  }, [savePromptChoice]);

  const markNotForMe = useCallback(() => {
    if (!activeSong) return;
    const nextExclusions = new Set(excludedSongIds);
    nextExclusions.add(activeSong.id);
    try {
      const stored = window.localStorage.getItem(DISCOVERY_NOT_FOR_ME_KEY);
      const current = stored
        ? (JSON.parse(stored) as Record<string, number>)
        : {};
      current[activeSong.id] = Date.now() + NOT_FOR_ME_DURATION_MS;
      window.localStorage.setItem(
        DISCOVERY_NOT_FOR_ME_KEY,
        JSON.stringify(current),
      );
    } catch {
      // The session-only exclusion still works without browser storage.
    }
    dispatchWorkspaceV2PlaybackCommand("pause", {
      channel: SIMPLE_PREVIEW_PLAYER_CHANNEL,
      source: "user-click",
    });
    pendingPlaybackRef.current = started && !pausedByUser;
    pausedByUserRef.current = pausedByUser;
    completedTrackRef.current = "";
    lastTelemetryRef.current = null;
    setExcludedSongIds(nextExclusions);
    setActiveIndex(0);
    setPlayerVersion((current) => current + 1);
  }, [activeSong, excludedSongIds, pausedByUser, started]);

  const reportActiveSong = async () => {
    if (!activeSong) return;
    const supabase = createClient();
    if (!supabase) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      window.location.assign(
        `/login?next=${encodeURIComponent("/dashboard")}`,
      );
      return;
    }
    if (
      !window.confirm(
        spanish
          ? `¿Enviar “${activeSong.title}” a moderación por posible spam, enlace incorrecto o contenido no permitido?`
          : `Send “${activeSong.title}” to moderation for possible spam, a broken link, or disallowed content?`,
      )
    ) {
      return;
    }
    const { error } = await supabase.rpc("report_song", {
      reported_song_id: activeSong.id,
      report_reason: "spam",
      report_details: "Reported from the simplified First Listen player.",
    });
    setReportNotice(
      error
        ? error.message
        : spanish
          ? "Reporte enviado. El equipo de moderación lo revisará."
          : "Report sent. The moderation team will review it.",
    );
  };

  const toggleContinuousPlayback = useCallback(() => {
    if (continuousPlayback) {
      setContinuousPlayback(false);
      return;
    }
    setContinuousPlayback(true);
    if (!started || pausedByUser) requestPlayback(true);
  }, [continuousPlayback, pausedByUser, requestPlayback, started]);

  const handleTelemetry = useCallback(
    (snapshot: ProviderTelemetrySnapshot) => {
      if (pausedByUserRef.current && snapshot.playbackState === "playing") {
        pendingPlaybackRef.current = false;
        dispatchWorkspaceV2PlaybackCommand("pause", {
          channel: SIMPLE_PREVIEW_PLAYER_CHANNEL,
          source: "user-click",
        });
        return;
      }
      const sampledAt = Date.now();
      const previous = lastTelemetryRef.current;
      const audible =
        snapshot.playbackState === "playing" &&
        snapshot.pageVisible &&
        snapshot.pageFocused &&
        snapshot.muted !== true &&
        snapshot.volume !== 0;
      if (
        activeSong &&
        audible &&
        previous?.songId === activeSong.id &&
        snapshot.currentTime > previous.currentTime
      ) {
        const progressDelta = snapshot.currentTime - previous.currentTime;
        const wallClockDelta = (sampledAt - previous.sampledAt) / 1000;
        const verifiedDelta = Math.min(progressDelta, wallClockDelta + 1, 5);
        if (verifiedDelta > 0) {
          const nextSongSeconds =
            (listenedSecondsBySongRef.current.get(activeSong.id) ?? 0) +
            verifiedDelta;
          listenedSecondsBySongRef.current.set(activeSong.id, nextSongSeconds);
          sessionSecondsRef.current += verifiedDelta;
          setSessionSeconds(Math.floor(sessionSecondsRef.current));
          if (
            nextSongSeconds >= 30 &&
            !verifiedSongIdsRef.current.has(activeSong.id)
          ) {
            verifiedSongIdsRef.current.add(activeSong.id);
            setVerifiedListens((current) => current + 1);
          }
        }
      }
      if (activeSong) {
        lastTelemetryRef.current = {
          songId: activeSong.id,
          currentTime: snapshot.currentTime,
          sampledAt,
        };
      }
      if (
        !activeSong ||
        snapshot.playbackState !== "completed" ||
        pausedByUser ||
        completedTrackRef.current === activeSong.id
      ) {
        return;
      }
      completedTrackRef.current = activeSong.id;
      playNext(continuousPlayback);
    },
    [activeSong, continuousPlayback, pausedByUser, playNext],
  );

  if (!activeSong) return null;

  return (
    <main className="first-listen-simple-preview" id="top">
      <header className="first-listen-simple-header">
        <Logo />
        <div className="first-listen-simple-header-actions">
          <LanguageSelector
            compact
            locale={interfaceLocale}
            onChange={handleLocaleChange}
          />
          {authenticated ? (
            <>
              <Link href="/profile">
                <UserRound size={16} />
                {spanish ? "Mi cuenta" : "My account"}
              </Link>
              <button
                aria-label={spanish ? "Cerrar sesión" : "Sign out"}
                disabled={signingOut}
                onClick={() => void handleSignOut()}
                title={spanish ? "Cerrar sesión" : "Sign out"}
                type="button"
              >
                <LogOut size={17} />
              </button>
            </>
          ) : (
            <Link href="/login?next=/dashboard">
              <LogIn size={16} />
              {spanish ? "Entrar" : "Log in"}
            </Link>
          )}
        </div>
      </header>

      <section
        className="first-listen-simple-stage"
        style={
          {
            "--first-listen-active-cover": `url("${activeSong.coverUrl}")`,
          } as CSSProperties
        }
      >
        <div className="first-listen-simple-stage-copy">
          <span className="first-listen-simple-preview-badge">
            {authenticated
              ? spanish
                ? "Tu música empieza aquí"
                : "Your music starts here"
              : spanish
                ? "Gratis · sin registro"
                : "Free · no account required"}
          </span>
          <span className="eyebrow">
            <Sparkles size={14} />
            {spanish ? "Una canción nueva te espera" : "A new song is waiting"}
          </span>
          <h1>
            {spanish
              ? "Tu próxima canción favorita puede estar aquí."
              : "Your next favorite song could be here."}
          </h1>
          <p>
            {spanish
              ? "Artistas nuevos, decisiones reales y música que tú controlas."
              : "New artists, real choices, and music you control."}
          </p>
          <div className="first-listen-simple-stage-actions">
            <button className="primary" onClick={startFromHero} type="button">
              <Play size={18} fill="currentColor" />
              {spanish ? "Descubrir ahora" : "Discover now"}
            </button>
            <a href="#first-listen-new-today">
              <Compass size={18} />
              {spanish ? "Ver novedades" : "See what is new"}
            </a>
          </div>
        </div>

        <button
          aria-label={
            spanish
              ? `Reproducir ${activeSong.title}`
              : `Play ${activeSong.title}`
          }
          className="first-listen-simple-stage-cover"
          onClick={startFromHero}
          style={{ backgroundImage: `url("${activeSong.coverUrl}")` }}
          type="button"
        >
          <span className="first-listen-simple-stage-cover-play">
            <Play size={25} fill="currentColor" />
          </span>
          <span className="first-listen-simple-stage-cover-copy">
            <small>{spanish ? "LISTA PARA DESCUBRIR" : "READY TO DISCOVER"}</small>
            <strong>{activeSong.title}</strong>
            <span>{activeSong.artist}</span>
          </span>
        </button>

        <div
          className="first-listen-simple-proof"
          aria-label={spanish ? "Datos reales de First Listen" : "Real First Listen facts"}
        >
          <span>
            <strong>{countQueueArtists(playableSongs)}</strong>
            {spanish ? " artistas" : " artists"}
          </span>
          <span>
            <strong>{spanish ? "Tú eliges" : "Your choice"}</strong>
            {spanish ? " qué sigue" : " what is next"}
          </span>
          <span>
            <strong>{spanish ? "Apoyo real" : "Real support"}</strong>
            {spanish ? " sin comprar reproducciones" : " without buying plays"}
          </span>
        </div>
      </section>

      {!authenticated && (
        <section className="first-listen-simple-artist-link">
          <div>
            <span>{spanish ? "¿Eres artista?" : "Are you an artist?"}</span>
            <strong>
              {spanish ? "Publica tu música en FirstListen" : "Share your music on FirstListen"}
            </strong>
            <small>
              {spanish
                ? "Primera canción sin contraseña ni tarjeta"
                : "First song with no password or card"}
            </small>
          </div>
          <Link href="/first-publish">
            <Upload size={16} />
            {spanish ? "Publicar gratis" : "Publish free"}
          </Link>
        </section>
      )}

      <section
        className="first-listen-simple-new-today"
        id="first-listen-new-today"
      >
        <div className="first-listen-simple-section-heading">
          <div>
            <span className="eyebrow">
              <Radio size={13} />
              {spanish ? "NUEVO EN ROTACIÓN" : "NEW IN ROTATION"}
            </span>
            <h2>{spanish ? "Escucha algo distinto hoy" : "Hear something different today"}</h2>
          </div>
          <div className="first-listen-simple-carousel-navigation">
            <small>
              {spanish ? "Desliza o usa las flechas" : "Swipe or use the arrows"}
            </small>
            <button
              aria-label={spanish ? "Ver canciones anteriores" : "See previous songs"}
              onClick={() => scrollNewToday(-1)}
              type="button"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              aria-label={spanish ? "Ver más canciones" : "See more songs"}
              onClick={() => scrollNewToday(1)}
              type="button"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
        <div className="first-listen-simple-new-row" ref={newTodayRowRef}>
          {newTodaySongs.map((song, index) => (
            <button
              aria-current={song.id === activeSong.id ? "true" : undefined}
              className={song.id === activeSong.id ? "active" : ""}
              key={song.id}
              onClick={() => selectDiscoverySong(index)}
              type="button"
            >
              <span
                className="first-listen-simple-new-cover"
                style={{ backgroundImage: `url("${song.coverUrl}")` }}
              >
                <span><Play size={17} fill="currentColor" /></span>
              </span>
              <span className="first-listen-simple-new-copy">
                <small>{displayStyleLabel(songStyle(song, spanish), spanish)}</small>
                <strong>{song.title}</strong>
                <span>{song.artist}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {promptReady && promptVisible && (
        <section className="first-listen-simple-discovery-prompt">
          <div className="first-listen-simple-discovery-prompt-icon">
            <Radio size={22} />
          </div>
          <div>
            <span>{spanish ? "TÚ DECIDES" : "YOU DECIDE"}</span>
            <strong>
              {authenticated && displayName
                ? spanish
                  ? `¡Bienvenido, ${displayName}! ¿Quieres escuchar canciones nuevas?`
                  : `Welcome, ${displayName}! Want to hear new songs?`
                : spanish
                  ? "Hoy hay canciones nuevas. ¿Te gustaría descubrirlas?"
                  : "There are new songs today. Would you like to discover them?"}
            </strong>
            <small>
              {spanish
                ? "Solo comenzaremos si eliges Sí. Puedes pausar, saltar o desactivar la reproducción continua cuando quieras."
                : "We only start if you choose Yes. You can pause, skip, or turn continuous play off at any time."}
            </small>
          </div>
          <div className="first-listen-simple-discovery-prompt-actions">
            <button className="primary" onClick={acceptDiscovery} type="button">
              <Play size={16} fill="currentColor" />
              {spanish ? "Sí, reproducir" : "Yes, play"}
            </button>
            <button onClick={declineDiscovery} type="button">
              {spanish ? "Ahora no" : "Not now"}
            </button>
            <button onClick={snoozeDiscovery} type="button">
              {spanish ? "Tal vez después" : "Maybe later"}
            </button>
          </div>
        </section>
      )}

      {promptReady && !promptVisible && !started && (
        <button
          className="first-listen-simple-reopen-prompt"
          onClick={() => setPromptVisible(true)}
          type="button"
        >
          <MessageCircleQuestion size={16} />
          {spanish ? "Escuchar novedades" : "Listen to new music"}
        </button>
      )}

      <div
        className={`first-listen-simple-player-slot${playerDocked ? " is-docked" : ""}`}
        ref={playerSlotRef}
        style={
          playerDocked && playerPlaceholderHeight
            ? { minHeight: `${playerPlaceholderHeight}px` }
            : undefined
        }
      >
      <section
        className={`first-listen-simple-player-card${playerDocked ? " is-docked" : ""}`}
        id="first-listen-player"
        ref={playerCardRef}
      >
        <div className="first-listen-simple-player-header">
          <div className="first-listen-simple-song-heading">
            <span>{spanish ? "Ahora suena" : "Now playing"}</span>
            <strong>{activeSong.title}</strong>
            <small>{activeSong.artist}</small>
          </div>
          <div className="first-listen-simple-player-window-actions">
            {playerDocked && (
              <button
                aria-label={spanish ? "Abrir reproductor grande" : "Open large player"}
                onClick={restorePlayer}
                title={spanish ? "Abrir reproductor grande" : "Open large player"}
                type="button"
              >
                <PanelTopOpen size={17} />
              </button>
            )}
            <button
              aria-label={spanish ? "Pantalla completa" : "Full screen"}
              onClick={() => void openPlayerFullscreen()}
              title={spanish ? "Pantalla completa" : "Full screen"}
              type="button"
            >
              <Expand size={17} />
            </button>
          </div>
        </div>

        <div className="first-listen-simple-player-frame" ref={playerFrameRef}>
          <ProviderPlayer
            key={`${activeSong.id}:${playerVersion}`}
            artist={activeSong.artist}
            autoPlay={shouldAutoStart && !pausedByUser}
            controlChannel={SIMPLE_PREVIEW_PLAYER_CHANNEL}
            coverUrl={activeSong.coverUrl}
            link={activeSong.link}
            locale={interfaceLocale}
            onTelemetry={handleTelemetry}
            onTrustedPlaybackRequestReady={(request) => {
              requestPlaybackRef.current = request;
              if (
                request &&
                pendingPlaybackRef.current &&
                !pausedByUserRef.current
              ) {
                pendingPlaybackRef.current = false;
                request();
              }
            }}
            platform={activeSong.platform as Platform}
            songLoadedAt={new Date().toISOString()}
            title={activeSong.title}
          />
          {!started && (
            <button
              aria-label={spanish ? "Escuchar esta canción" : "Play this song"}
              className="first-listen-simple-cover-action"
              onClick={() => requestPlayback(false)}
              style={{ backgroundImage: `url("${activeSong.coverUrl}")` }}
              type="button"
            >
              <span>
                <Play size={28} fill="currentColor" />
              </span>
              <strong>{spanish ? "Escuchar esta canción" : "Play this song"}</strong>
            </button>
          )}
        </div>

        <div className="first-listen-simple-controls">
          <button
            className="primary"
            onClick={() => requestPlayback(continuousPlayback)}
            type="button"
          >
            <Play size={17} fill="currentColor" />
            {spanish ? "Reproducir" : "Play"}
          </button>
          <button
            aria-pressed={pausedByUser}
            className={pausedByUser ? "active" : ""}
            onClick={pausePlayback}
            type="button"
          >
            <Pause size={17} />
            {spanish ? "Pausa" : "Pause"}
          </button>
          <button onClick={() => playNext(true)} type="button">
            <SkipForward size={17} />
            {spanish ? "Siguiente" : "Next"}
          </button>
          <button onClick={markNotForMe} type="button">
            <ThumbsDown size={16} />
            {spanish ? "No es para mí" : "Not for me"}
          </button>
          <button onClick={() => void reportActiveSong()} type="button">
            <Flag size={16} />
            {spanish ? "Reportar" : "Report"}
          </button>
        </div>

        {reportNotice && (
          <p className="first-listen-simple-metrics-note" role="status">
            {reportNotice}
          </p>
        )}

        <div className="first-listen-simple-listening-options">
          <button
            aria-pressed={continuousPlayback}
            className={continuousPlayback ? "active" : ""}
            onClick={toggleContinuousPlayback}
            type="button"
          >
            <Repeat2 size={16} />
            <span>{spanish ? "Reproducción continua" : "Continuous play"}</span>
            <strong>
              {continuousPlayback
                ? spanish
                  ? "Activada"
                  : "On"
                : spanish
                  ? "Desactivada"
                  : "Off"}
            </strong>
          </button>
          <div>
            <Timer size={16} />
            <span>{spanish ? "Tiempo escuchado" : "Listening time"}</span>
            <strong>{formatSessionTime(sessionSeconds, spanish)}</strong>
          </div>
          <div>
            <BadgeCheck size={16} />
            <span>{spanish ? "Reproducciones verificadas" : "Verified listens"}</span>
            <strong>{verifiedListens}</strong>
          </div>
        </div>

        <p className="first-listen-simple-metrics-note">
          {spanish
            ? "Estas cifras miden actividad real. Escuchar no entrega tokens, pagos ni prioridad."
            : "These numbers measure real activity. Listening does not award tokens, payments, or priority."}
        </p>

        {nextSong && (
          <div className="first-listen-simple-next-song">
            <ListMusic size={16} />
            <span>
              {spanish ? "Después:" : "Next:"} <strong>{nextSong.title}</strong>
              {" · "}
              {nextSong.artist}
            </span>
          </div>
        )}
      </section>
      </div>

      <section className="first-listen-simple-styles">
        <div>
          <span className="eyebrow">
            <Compass size={13} />
            {spanish ? "Elige tu estilo" : "Choose your style"}
          </span>
          <p>
            {spanish
              ? "Opcional: la rotación da una oportunidad a cada artista antes de repetir otro tema suyo."
              : "Optional: rotation gives every artist a turn before repeating another song from the same artist."}
          </p>
        </div>
        <div className="first-listen-simple-style-row">
          <button
            className={selectedStyle === "all" ? "active" : ""}
            onClick={() => selectStyle("all")}
            type="button"
          >
            {spanish ? "Para mí" : "For me"}
          </button>
          {styles.map((style) => (
            <button
              className={selectedStyle === style ? "active" : ""}
              key={style}
              onClick={() => selectStyle(style)}
              type="button"
            >
              {displayStyleLabel(style, spanish)}
            </button>
          ))}
        </div>
      </section>

      {authenticated && (
        <section className="first-listen-simple-member-card">
          <div className="first-listen-simple-member-copy">
            <span>{spanish ? "TU ESPACIO" : "YOUR SPACE"}</span>
            <strong>
              {spanish ? `Hola${displayName ? `, ${displayName}` : ""}` : `Hello${displayName ? `, ${displayName}` : ""}`}
            </strong>
            <small>
              {spanish
                ? "Escucha y administra tu actividad. Tus estadísticas no se convierten en recompensas."
                : "Listen and manage your activity. Your statistics are not converted into rewards."}
            </small>
          </div>
          <div className="first-listen-simple-member-actions">
            <Link className="primary" href="/profile#submitted-songs">
              <Upload size={16} />
              {spanish ? "Administrar música" : "Manage music"}
            </Link>
            <Link href="/profile">
              <UserRound size={16} />
              {spanish ? "Mi actividad" : "My activity"}
            </Link>
            {canAccessAdmin && (
              <Link href="/owner">
                <ShieldCheck size={16} />
                Owner
              </Link>
            )}
            <button
              disabled={signingOut}
              onClick={() => void handleSignOut()}
              type="button"
            >
              <LogOut size={16} />
              {signingOut
                ? spanish
                  ? "Cerrando..."
                  : "Signing out..."
                : spanish
                  ? "Cerrar sesión"
                  : "Sign out"}
            </button>
          </div>
        </section>
      )}

      <footer className="first-listen-simple-footer">
        <div>
          <Headphones size={16} />
          <span>
            {spanish
              ? "Las reproducciones son decisiones reales de cada persona. FirstListen no vende ni intercambia reproducciones."
              : "Every listen is a real person’s choice. FirstListen does not sell or trade plays."}
          </span>
        </div>
        <nav aria-label={spanish ? "Enlaces legales" : "Legal links"}>
          <Link href="/privacy">{spanish ? "Privacidad" : "Privacy"}</Link>
          <Link href="/terms">{spanish ? "Términos" : "Terms"}</Link>
          <Link href="/guidelines">{spanish ? "Comunidad" : "Community"}</Link>
          <Link href="/delete-account">{spanish ? "Eliminar cuenta" : "Delete account"}</Link>
        </nav>
      </footer>

      <nav
        aria-label={spanish ? "Navegación principal" : "Main navigation"}
        className="first-listen-simple-mobile-nav"
      >
        <a href="#top">
          <Home size={19} />
          <span>{spanish ? "Inicio" : "Home"}</span>
        </a>
        <a href="#first-listen-new-today">
          <Compass size={19} />
          <span>{spanish ? "Explorar" : "Explore"}</span>
        </a>
        <Link className="primary" href="/first-publish">
          <Upload size={20} />
          <span>{spanish ? "Publicar" : "Publish"}</span>
        </Link>
        <Link href={authenticated ? "/profile" : "/login?next=/dashboard"}>
          <UserRound size={19} />
          <span>{spanish ? "Mi cuenta" : "My account"}</span>
        </Link>
      </nav>
    </main>
  );
}
