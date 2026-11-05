"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  Compass,
  Flag,
  Headphones,
  ListMusic,
  LogIn,
  LogOut,
  MessageCircleQuestion,
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
import { Logo } from "@/components/logo";
import { clearBrowserAuthSession } from "@/lib/auth-session-cleanup";
import type { InterfaceLocale } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/client";
import type { Platform } from "@/lib/types";
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
  const spanish = locale === "es";
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
  const [continuousPlayback, setContinuousPlayback] = useState(false);
  const [pausedByUser, setPausedByUser] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);
  const [promptReady, setPromptReady] = useState(false);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [verifiedListens, setVerifiedListens] = useState(0);
  const [reportNotice, setReportNotice] = useState("");
  const [signingOut, setSigningOut] = useState(false);
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
    <main className="first-listen-simple-preview">
      <header className="first-listen-simple-header">
        <Logo />
        <div className="first-listen-simple-header-actions">
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

      <section className="first-listen-simple-intro">
        <span className="first-listen-simple-preview-badge">
          {authenticated
            ? spanish
              ? "Tu inicio · simple y actualizado"
              : "Your home · simple and up to date"
            : spanish
              ? "Escucha gratis · sin registro"
              : "Listen free · no account required"}
        </span>
        <span className="eyebrow">
          <Sparkles size={13} />
          {spanish ? "Música nueva, sin complicaciones" : "New music, made simple"}
        </span>
        <h1>
          {spanish
            ? "Descubre música nueva. Tú decides."
            : "Discover new music. You decide."}
        </h1>
        <p>
          {spanish
            ? "Escucha una canción o activa la reproducción continua. Siempre puedes pausar, saltar o decir que un tema no es para ti."
            : "Play one song or turn on continuous play. You can always pause, skip, or say a song is not for you."}
        </p>
        <div
          className="first-listen-simple-proof"
          aria-label={spanish ? "Datos reales de First Listen" : "Real First Listen facts"}
        >
          <span>
            <strong>{countQueueArtists(playableSongs)}</strong>
            {spanish ? " artistas en rotación justa" : " artists in fair rotation"}
          </span>
          <span>
            <strong>{spanish ? "Tú eliges" : "Your choice"}</strong>
            {spanish ? " si continúa" : " to keep playing"}
          </span>
          <span>
            <strong>{spanish ? "Apoyo real" : "Real support"}</strong>
            {spanish ? " sin comprar reproducciones" : " without buying plays"}
          </span>
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

      <section className="first-listen-simple-player-card">
        <div className="first-listen-simple-song-heading">
          <span>{spanish ? "Ahora suena" : "Now playing"}</span>
          <strong>{activeSong.title}</strong>
          <small>{activeSong.artist}</small>
        </div>

        <div className="first-listen-simple-player-frame">
          <ProviderPlayer
            key={`${activeSong.id}:${playerVersion}`}
            artist={activeSong.artist}
            autoPlay={shouldAutoStart && !pausedByUser}
            controlChannel={SIMPLE_PREVIEW_PLAYER_CHANNEL}
            coverUrl={activeSong.coverUrl}
            link={activeSong.link}
            locale={locale}
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

      {authenticated ? (
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
      ) : (
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
    </main>
  );
}
