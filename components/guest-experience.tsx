"use client";

import {
  ArrowRight,
  CheckCircle2,
  Copy,
  Headphones,
  KeyRound,
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
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LanguageSelector } from "@/components/language-selector";
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

function persistGuest(guest: GuestSession) {
  window.localStorage.setItem("first-listen-guest-token", guest.token);
  window.localStorage.setItem(
    "first-listen-guest-recovery-code",
    guest.recoveryCode,
  );
  window.localStorage.setItem("first-listen-locale", guest.locale);
  document.cookie = `first-listen-guest-token=${guest.token}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`;
}

export function GuestExperience() {
  const [locale, setLocale] = useState<InterfaceLocale>("en");
  const [guest, setGuest] = useState<GuestSession | null>(null);
  const [nickname, setNickname] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoverMode, setRecoverMode] = useState(false);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityMessage, setIdentityMessage] = useState("");
  const [showCredentials, setShowCredentials] = useState(false);
  const [songs, setSongs] = useState<Song[]>([]);
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
        await loadQueue(token);
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
  }, [loadQueue]);

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
      await loadQueue(nextGuest.token);
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
              ? "Elige un nombre para participar en la comunidad."
              : "Choose a nickname to join the community."}
          </h1>
          <p>
            {spanish
              ? "Tu nombre será visible cuando des like, comentes, sigas artistas o guardes canciones."
              : "Your nickname appears when you like, comment, follow artists, or save songs."}
          </p>

          {!recoverMode ? (
            <form onSubmit={(event) => void completeIdentity(event, "create")}>
              <label htmlFor="guest-nickname">
                {spanish ? "Nickname" : "Nickname"}
              </label>
              <input
                autoComplete="nickname"
                id="guest-nickname"
                maxLength={30}
                minLength={2}
                onChange={(event) => setNickname(event.target.value)}
                placeholder={spanish ? "Tu nombre en la comunidad" : "Your community name"}
                required
                value={nickname}
              />
              <button disabled={identityBusy || nickname.trim().length < 2} type="submit">
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
    <main className="guest-page">
      <header className="guest-header">
        <Link href="/"><Logo /></Link>
        <div>
          <LanguageSelector compact locale={locale} onChange={changeLocale} />
          <span className="guest-listener-pill">
            <Headphones size={14} />
            <strong>{guest.nickname}</strong>
            <small>{guest.listenerId}</small>
          </span>
          <Link className="guest-login-link" href="/login">
            {spanish ? "Iniciar sesión" : "Log In"}
          </Link>
          <Link className="guest-join-link" href="/signup">
            {spanish ? "Convertir en cuenta gratis" : "Convert to Free Account"}
          </Link>
        </div>
      </header>

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

      <section className="guest-welcome">
        <span className="eyebrow"><Sparkles size={13} /> {spanish ? "Oyente invitado" : "Guest Listener"}</span>
        <h1>
          {spanish
            ? `Bienvenido, ${guest.nickname}.`
            : `Welcome, ${guest.nickname}.`}
        </h1>
        <p>
          {spanish
            ? "Escucha música, descubre artistas y participa en la comunidad. Tu acceso siempre es gratis y nunca vence."
            : "Listen to music, discover artists, and join the community. Guest access is always free and never expires."}
        </p>
        <div>
          <span><CheckCircle2 size={14} /> {guest.validListens} {spanish ? "escuchas válidas" : "valid listens"}</span>
          <span><ShieldCheck size={14} /> {spanish ? "Sin recompensas ni ranking" : "No rewards or ranking"}</span>
          <span><Headphones size={14} /> {spanish ? "Acceso permanente" : "Permanent guest access"}</span>
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

          <aside className="guest-side">
            <section>
              <span className="eyebrow"><Users size={13} /> {spanish ? "Comunidad real" : "Real community"}</span>
              <h2>{spanish ? "Participa sin crear una cuenta" : "Participate without signing up"}</h2>
              <p>
                {spanish
                  ? "Tu nickname aparece cuando apoyas artistas. Las escuchas válidas siguen protegidas: máximo una por canción cada 24 horas."
                  : "Your nickname appears when you support artists. Valid listens remain protected: one per song every 24 hours."}
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
              <h2>{spanish ? "¿También creas música?" : "Do you create music too?"}</h2>
              <p>
                {spanish
                  ? "Convierte este perfil en una cuenta gratuita. Conservaremos tu actividad, likes, comentarios, artistas seguidos y canciones guardadas."
                  : "Convert this profile into a free account. We will preserve your activity, likes, comments, follows, and saved songs."}
              </p>
              <Link href="/signup">
                {spanish ? "Convertir en cuenta gratis" : "Convert to Free Account"} <ArrowRight size={14} />
              </Link>
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
    </main>
  );
}
