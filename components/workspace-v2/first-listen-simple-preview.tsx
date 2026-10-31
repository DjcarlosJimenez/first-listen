"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Compass,
  Headphones,
  ListMusic,
  LogIn,
  Pause,
  Play,
  SkipForward,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  ProviderPlayer,
  type ProviderTelemetrySnapshot,
} from "@/components/provider-player";
import { Logo } from "@/components/logo";
import type { InterfaceLocale } from "@/lib/catalog";
import type { Platform } from "@/lib/types";
import {
  dispatchWorkspaceV2PlaybackCommand,
  type WorkspaceV2Queue,
  type WorkspaceV2Song,
} from "@/lib/workspace-v2";

const SIMPLE_PREVIEW_PLAYER_CHANNEL = "first-listen-simple-preview";

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
  locale,
  queue,
}: {
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
  const filteredSongs = useMemo(() => {
    const matching = playableSongs.filter((song) =>
      matchesStyle(song, selectedStyle),
    );
    return matching.length ? matching : playableSongs;
  }, [playableSongs, selectedStyle]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [playerVersion, setPlayerVersion] = useState(0);
  const [started, setStarted] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [pausedByUser, setPausedByUser] = useState(false);
  const requestPlaybackRef = useRef<(() => void) | null>(null);
  const pendingPlaybackRef = useRef(false);
  const completedTrackRef = useRef("");
  const activeSong =
    filteredSongs[activeIndex % Math.max(1, filteredSongs.length)] ??
    playableSongs[0];
  const nextSong = filteredSongs.length
    ? filteredSongs[(activeIndex + 1) % filteredSongs.length]
    : null;

  const requestPlayback = useCallback(() => {
    setStarted(true);
    setAutoPlay(true);
    setPausedByUser(false);
    pendingPlaybackRef.current = true;
    requestPlaybackRef.current?.();
    dispatchWorkspaceV2PlaybackCommand("play", {
      channel: SIMPLE_PREVIEW_PLAYER_CHANNEL,
      source: "user-click",
    });
  }, []);

  const pausePlayback = useCallback(() => {
    pendingPlaybackRef.current = false;
    setAutoPlay(false);
    setPausedByUser(true);
    dispatchWorkspaceV2PlaybackCommand("pause", {
      channel: SIMPLE_PREVIEW_PLAYER_CHANNEL,
      source: "user-click",
    });
  }, []);

  const playNext = useCallback(() => {
    if (!filteredSongs.length) return;
    pendingPlaybackRef.current = true;
    completedTrackRef.current = "";
    setStarted(true);
    setAutoPlay(true);
    setPausedByUser(false);
    setActiveIndex((current) => (current + 1) % filteredSongs.length);
    setPlayerVersion((current) => current + 1);
  }, [filteredSongs.length]);

  const selectStyle = (style: string) => {
    pendingPlaybackRef.current = started && autoPlay;
    completedTrackRef.current = "";
    setSelectedStyle(style);
    setActiveIndex(0);
    setPlayerVersion((current) => current + 1);
  };

  const handleTelemetry = useCallback(
    (snapshot: ProviderTelemetrySnapshot) => {
      if (
        !activeSong ||
        snapshot.playbackState !== "completed" ||
        pausedByUser ||
        completedTrackRef.current === activeSong.id
      ) {
        return;
      }
      completedTrackRef.current = activeSong.id;
      playNext();
    },
    [activeSong, pausedByUser, playNext],
  );

  if (!activeSong) return null;

  return (
    <main className="first-listen-simple-preview">
      <header className="first-listen-simple-header">
        <Logo />
        <Link href="/login?next=/dashboard">
          <LogIn size={16} />
          {spanish ? "Entrar" : "Log in"}
        </Link>
      </header>

      <section className="first-listen-simple-intro">
        <span className="first-listen-simple-preview-badge">
          {spanish ? "Escucha gratis · sin registro" : "Listen free · no account required"}
        </span>
        <span className="eyebrow">
          <Sparkles size={13} />
          {spanish ? "Música nueva, sin complicaciones" : "New music, made simple"}
        </span>
        <h1>
          {spanish
            ? "Descubre música nueva. Escucha gratis."
            : "Discover new music. Listen free."}
        </h1>
        <p>
          {spanish
            ? "No necesitas registrarte. Presiona reproducir y nosotros continuamos con la siguiente canción."
            : "No account required. Press play and we will continue with the next song."}
        </p>
        <div className="first-listen-simple-proof" aria-label={spanish ? "Datos reales de First Listen" : "Real First Listen facts"}>
          <span><strong>{playableSongs.length}</strong>{spanish ? " canciones listas ahora" : " songs ready now"}</span>
          <span><strong>1 toque</strong>{spanish ? " para comenzar" : " to start"}</span>
          <span><strong>0 registro</strong>{spanish ? " para escuchar" : " to listen"}</span>
        </div>
      </section>

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
            autoPlay={autoPlay && !pausedByUser}
            controlChannel={SIMPLE_PREVIEW_PLAYER_CHANNEL}
            coverUrl={activeSong.coverUrl}
            link={activeSong.link}
            locale={locale}
            onTelemetry={handleTelemetry}
            onTrustedPlaybackRequestReady={(request) => {
              requestPlaybackRef.current = request;
              if (request && pendingPlaybackRef.current) {
                pendingPlaybackRef.current = false;
                request();
              }
            }}
            platform={activeSong.platform as Platform}
            preserveAutoPlayOnProviderPause
            songLoadedAt={new Date().toISOString()}
            title={activeSong.title}
          />
          {!started && (
            <button
              aria-label={spanish ? "Escuchar ahora" : "Listen now"}
              className="first-listen-simple-cover-action"
              onClick={requestPlayback}
              style={{ backgroundImage: `url("${activeSong.coverUrl}")` }}
              type="button"
            >
              <span>
                <Play size={28} fill="currentColor" />
              </span>
              <strong>{spanish ? "Escuchar ahora" : "Listen now"}</strong>
            </button>
          )}
        </div>

        <div className="first-listen-simple-controls">
          <button className="primary" onClick={requestPlayback} type="button">
            <Play size={17} fill="currentColor" />
            {spanish ? "Reproducir" : "Play"}
          </button>
          <button onClick={pausePlayback} type="button">
            <Pause size={17} />
            {spanish ? "Pausa" : "Pause"}
          </button>
          <button onClick={playNext} type="button">
            <SkipForward size={17} />
            {spanish ? "Siguiente" : "Next"}
          </button>
        </div>

        {nextSong && (
          <div className="first-listen-simple-next-song">
            <ListMusic size={16} />
            <span>
              {spanish ? "Después:" : "Next:"} <strong>{nextSong.title}</strong>
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
              ? "Opcional: también puedes dejar que FirstListen elija por ti."
              : "Optional: you can also let FirstListen choose for you."}
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

      <footer className="first-listen-simple-footer">
        <Headphones size={16} />
        <span>
          {spanish
            ? "Primero escucha. Las herramientas avanzadas aparecen solo cuando las necesitas."
            : "Listen first. Advanced tools appear only when you need them."}
        </span>
      </footer>
    </main>
  );
}
