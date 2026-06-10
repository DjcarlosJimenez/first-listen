"use client";

import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Headphones,
  LockKeyhole,
  Music2,
  Pause,
  Play,
  ShieldCheck,
  SkipForward,
  Sparkles,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LanguageSelector } from "@/components/language-selector";
import { Logo } from "@/components/logo";
import {
  ProviderPlayer,
  type ProviderTelemetrySnapshot,
} from "@/components/provider-player";
import type { InterfaceLocale } from "@/lib/catalog";
import { displayPlatform } from "@/lib/content-economy";
import { safeCoverUrl } from "@/lib/media";
import { createClient } from "@/lib/supabase/client";
import type { Song } from "@/lib/types";

type GuestSession = {
  token: string;
  expiresAt: string;
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

function formatRemaining(milliseconds: number) {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
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

export function GuestExperience() {
  const [locale, setLocale] = useState<InterfaceLocale>("en");
  const [guest, setGuest] = useState<GuestSession | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [songIndex, setSongIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState("");
  const [now, setNow] = useState(Date.now());
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
  const expiresIn = guest
    ? new Date(guest.expiresAt).getTime() - now
    : 24 * 60 * 60 * 1000;
  const expired = expiresIn <= 0;

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
    const storedLocale = window.localStorage.getItem("first-listen-locale");
    if (storedLocale === "en" || storedLocale === "es") {
      setLocale(storedLocale);
      document.documentElement.lang = storedLocale;
    }

    let active = true;
    const initialize = async () => {
      const supabase = createClient();
      if (!supabase) {
        setFatalError("First Listen is not configured.");
        setLoading(false);
        return;
      }
      const storedToken = window.localStorage.getItem(
        "first-listen-guest-token",
      );
      let result = await supabase.rpc("start_guest_session", {
        existing_access_token: storedToken || null,
      });
      if (result.error && storedToken) {
        window.localStorage.removeItem("first-listen-guest-token");
        result = await supabase.rpc("start_guest_session", {
          existing_access_token: null,
        });
      }
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!active) return;
      if (result.error || !row?.guest_access_token) {
        setFatalError(result.error?.message ?? "Guest access is unavailable.");
        setLoading(false);
        return;
      }
      const nextGuest = {
        token: String(row.guest_access_token),
        expiresAt: String(row.expires_at),
        validListens: Number(row.valid_listens ?? 0),
      };
      window.localStorage.setItem("first-listen-guest-token", nextGuest.token);
      setGuest(nextGuest);
      try {
        await loadQueue(nextGuest.token);
      } catch (error) {
        setFatalError(
          error instanceof Error ? error.message : "Music could not be loaded.",
        );
      } finally {
        setLoading(false);
      }
    };
    void initialize();
    const clock = window.setInterval(() => setNow(Date.now()), 30000);
    return () => {
      active = false;
      window.clearInterval(clock);
    };
  }, [loadQueue]);

  useEffect(() => {
    listeningSessionRef.current = null;
    lastHeartbeatAtRef.current = 0;
    lastLiveSampleRef.current = null;
    liveSecondsRef.current = 0;
    autoAdvanceStartedRef.current = false;
    setCountdown(null);
    setListening(emptyListeningState);
  }, [currentSong?.id]);

  useEffect(() => {
    if (!playing) return;
    const frame = window.requestAnimationFrame(() => {
      playerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentSong?.id, playing]);

  const startCurrentSong = useCallback(async () => {
    if (!guest || !currentSong || expired) return;
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
  }, [currentSong, expired, guest]);

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
      }
    },
    [autoPlay, guest, listening.validListenRecorded],
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
  };

  const reminder = useMemo(() => {
    if (expiresIn <= 60 * 60 * 1000) {
      return spanish
        ? "Tu acceso de invitado termina en menos de una hora. Crea una cuenta para seguir explorando."
        : "Guest access expires in under one hour. Create an account to keep exploring.";
    }
    if ((guest?.validListens ?? 0) >= 2) {
      return spanish
        ? "Ya ayudaste a varios artistas. Unete para empezar a construir tu propia audiencia."
        : "You have already helped several artists. Join to start building your own audience.";
    }
    return spanish
      ? "Estás explorando como invitado. Escucha música real y descubre cómo funciona la comunidad."
      : "You are exploring as a guest. Listen to real music and see how the community works.";
  }, [expiresIn, guest?.validListens, spanish]);

  if (loading) {
    return (
      <main className="guest-page guest-loading">
        <Logo />
        <span><Headphones size={22} /> Preparing your guest session...</span>
      </main>
    );
  }

  return (
    <main className="guest-page">
      <header className="guest-header">
        <Link href="/"><Logo /></Link>
        <div>
          <LanguageSelector compact locale={locale} onChange={changeLocale} />
          <span className="guest-time-pill">
            <Clock3 size={14} />
            {expired ? "Expired" : formatRemaining(expiresIn)}
          </span>
          <Link className="guest-login-link" href="/login">
            {spanish ? "Iniciar sesión" : "Log In"}
          </Link>
          <Link className="guest-join-link" href="/signup">
            {spanish ? "Crear cuenta gratis" : "Create Free Account"}
          </Link>
        </div>
      </header>

      <section className="guest-welcome">
        <span className="eyebrow"><Sparkles size={13} /> Guest Experience</span>
        <h1>
          {spanish
            ? "Descubre artistas reales antes de unirte."
            : "Discover real artists before you join."}
        </h1>
        <p>{reminder}</p>
        <div>
          <span><CheckCircle2 size={14} /> {guest?.validListens ?? 0} {spanish ? "artistas apoyados" : "artists supported"}</span>
          <span><ShieldCheck size={14} /> {spanish ? "Sin recompensas ni ranking" : "No rewards or ranking"}</span>
          <span><Clock3 size={14} /> {spanish ? "Acceso por 24 horas" : "24-hour access"}</span>
        </div>
      </section>

      {fatalError && (
        <section className="guest-message" role="alert">
          <LockKeyhole size={20} />
          <div>
            <strong>{fatalError}</strong>
            <Link href="/signup">
              {spanish ? "Crear una cuenta" : "Create an account"} <ArrowRight size={14} />
            </Link>
          </div>
        </section>
      )}

      {!fatalError && !expired && currentSong && (
        <section className="guest-listening-layout">
          <div className="guest-player-column">
            <div className="guest-now-playing">
              <span className="eyebrow"><Headphones size={13} /> {spanish ? "Descubrimiento invitado" : "Guest discovery"}</span>
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
                <span><Headphones size={14} /> {spanish ? "Tiempo en vivo" : "Listening Time (Live)"}</span>
                <strong>{formatClock(listening.liveSeconds)}</strong>
              </div>
              <div>
                <span><CheckCircle2 size={14} /> {spanish ? "Escucha valida" : "Valid Listen"}</span>
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

          <aside className="guest-side">
            <section>
              <span className="eyebrow"><Users size={13} /> {spanish ? "Comunidad real" : "Real community"}</span>
              <h2>{spanish ? "Apoya sin crear una cuenta" : "Support before signing up"}</h2>
              <p>
                {spanish
                  ? "Una escucha válida avisa al artista como Anonymous Listener. No recibes tokens ni ventajas de ranking."
                  : "A valid listen notifies the artist as Anonymous Listener. You receive no tokens or ranking advantage."}
              </p>
            </section>
            <section>
              <span className="eyebrow"><Music2 size={13} /> {spanish ? "Siguiente" : "Up next"}</span>
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
              <h2>{spanish ? "Listo para unirte?" : "Ready to join?"}</h2>
              <p>
                {spanish
                  ? "Los Artistas Fundadores reciben tres envios de canciones gratis, ademas de sus beneficios actuales."
                  : "Founding Artists receive three free song submissions, plus their current founder benefits."}
              </p>
              <Link href="/signup">
                {spanish ? "Crear cuenta gratis" : "Create Free Account"} <ArrowRight size={14} />
              </Link>
            </section>
          </aside>
        </section>
      )}

      {!fatalError && !expired && songs.length === 0 && (
        <section className="guest-message">
          <CheckCircle2 size={22} />
          <div>
            <strong>{spanish ? "Estás al día" : "You are all caught up"}</strong>
            <p>{spanish ? "Explora perfiles mientras llegan nuevas canciones." : "Explore artist profiles while new songs arrive."}</p>
            <Link href="/signup">{spanish ? "Unirme a la comunidad" : "Join the community"}</Link>
          </div>
        </section>
      )}

      {expired && (
        <section className="guest-expired">
          <Clock3 size={30} />
          <span className="eyebrow">24-hour guest access</span>
          <h1>{spanish ? "Tu experiencia de invitado termino." : "Your guest experience has ended."}</h1>
          <p>
            {spanish
              ? "Crea una cuenta gratuita para seguir descubriendo artistas y desbloquear herramientas para creadores."
              : "Create a free account to keep discovering artists and unlock creator tools."}
          </p>
          <Link href="/signup">
            {spanish ? "Crear cuenta gratis" : "Create Free Account"} <ArrowRight size={15} />
          </Link>
        </section>
      )}
    </main>
  );
}
