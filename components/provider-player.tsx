"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AlertTriangle, ExternalLink, LoaderCircle } from "lucide-react";
import type { InterfaceLocale } from "@/lib/catalog";
import { getProviderEmbed } from "@/lib/player";
import type { Platform } from "@/lib/types";

type PlayerStatus = "loading" | "ready" | "error";
type PlaybackState =
  | "unstarted"
  | "ended"
  | "playing"
  | "paused"
  | "buffering"
  | "cued"
  | "unknown";

export type ProviderTelemetrySnapshot = {
  supported: boolean;
  playbackState: PlaybackState;
  currentTime: number;
  duration: number;
  muted: boolean | null;
  volume: number | null;
  pageVisible: boolean;
  pageFocused: boolean;
  lastInteractionAt: number;
};

type YouTubePlayer = {
  destroy: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  getVolume: () => number;
  isMuted: () => boolean;
};

type YouTubePlayerEvent = {
  data: number;
  target: YouTubePlayer;
};

type YouTubeApi = {
  Player: new (
    element: HTMLIFrameElement,
    options: {
      events: {
        onError: (event: YouTubePlayerEvent) => void;
        onReady: (event: YouTubePlayerEvent) => void;
        onStateChange: (event: YouTubePlayerEvent) => void;
      };
    },
  ) => YouTubePlayer;
};

type SoundCloudWidget = {
  bind: (event: string, listener: () => void) => void;
  unbind: (event: string) => void;
  getDuration: (callback: (duration: number) => void) => void;
  getPosition: (callback: (position: number) => void) => void;
  getVolume: (callback: (volume: number) => void) => void;
  isPaused: (callback: (paused: boolean) => void) => void;
};

type SoundCloudApi = {
  Widget: ((iframe: HTMLIFrameElement) => SoundCloudWidget) & {
    Events: {
      READY: string;
      PLAY: string;
      PAUSE: string;
      FINISH: string;
      ERROR: string;
    };
  };
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
    SC?: SoundCloudApi;
  }
}

const YOUTUBE_API_SRC = "https://www.youtube.com/iframe_api";
const SOUNDCLOUD_API_SRC = "https://w.soundcloud.com/player/api.js";
const MAX_INITIALIZATION_ATTEMPTS = 3;
let youtubeApiPromise: Promise<YouTubeApi> | null = null;
let soundCloudApiPromise: Promise<SoundCloudApi> | null = null;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    let settled = false;
    const finish = (api?: YouTubeApi) => {
      if (settled) return;
      if (!api?.Player) return;
      settled = true;
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      resolve(api);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      reject(new Error(message));
    };

    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        previousReady?.();
      } catch (error) {
        console.warn("[First Listen player] Previous YouTube callback failed", error);
      }
      finish(window.YT);
    };

    const poll = window.setInterval(() => finish(window.YT), 50);
    const timeout = window.setTimeout(
      () => fail("YouTube IFrame API did not become ready."),
      15000,
    );
    let script = document.querySelector<HTMLScriptElement>(
      `script[src="${YOUTUBE_API_SRC}"]`,
    );
    if (!script) {
      script = document.createElement("script");
      script.async = true;
      script.src = YOUTUBE_API_SRC;
      document.head.append(script);
    }
    script.addEventListener(
      "error",
      () => fail("YouTube IFrame API failed to load."),
      { once: true },
    );
  }).catch((error) => {
    youtubeApiPromise = null;
    throw error;
  });

  return youtubeApiPromise;
}

function loadSoundCloudApi() {
  if (window.SC?.Widget) return Promise.resolve(window.SC);
  if (soundCloudApiPromise) return soundCloudApiPromise;

  soundCloudApiPromise = new Promise<SoundCloudApi>((resolve, reject) => {
    let settled = false;
    const finish = (api?: SoundCloudApi) => {
      if (settled || !api?.Widget) return;
      settled = true;
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      resolve(api);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      reject(new Error("SoundCloud Widget API did not become ready."));
    };
    const poll = window.setInterval(() => finish(window.SC), 50);
    const timeout = window.setTimeout(fail, 15000);
    let script = document.querySelector<HTMLScriptElement>(
      `script[src="${SOUNDCLOUD_API_SRC}"]`,
    );
    if (!script) {
      script = document.createElement("script");
      script.async = true;
      script.src = SOUNDCLOUD_API_SRC;
      document.head.append(script);
    }
    script.addEventListener("error", fail, { once: true });
  }).catch((error) => {
    soundCloudApiPromise = null;
    throw error;
  });

  return soundCloudApiPromise;
}

function mapYouTubeState(state: number): PlaybackState {
  if (state === -1) return "unstarted";
  if (state === 0) return "ended";
  if (state === 1) return "playing";
  if (state === 2) return "paused";
  if (state === 3) return "buffering";
  if (state === 5) return "cued";
  return "unknown";
}

function timestamp() {
  return new Date().toISOString();
}

export function ProviderPlayer({
  artist,
  coverUrl,
  link,
  locale,
  platform,
  songLoadedAt,
  title,
  onTelemetry,
}: {
  artist: string;
  coverUrl: string;
  link: string;
  locale: InterfaceLocale;
  platform: Platform;
  songLoadedAt: string | null;
  title: string;
  onTelemetry?: (snapshot: ProviderTelemetrySnapshot) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [clientOrigin, setClientOrigin] = useState<string | null>(null);
  const [playerMountedAt, setPlayerMountedAt] = useState<string | null>(null);
  const embedResult = useMemo(() => {
    if (!clientOrigin) return { embed: null, generatedAt: null };
    return {
      embed: getProviderEmbed(link, platform, clientOrigin),
      generatedAt: timestamp(),
    };
  }, [clientOrigin, link, platform]);
  const embed = embedResult.embed;
  const [loadedEmbedSrc, setLoadedEmbedSrc] = useState<string | null>(null);
  const [iframeLoadedAt, setIframeLoadedAt] = useState<string | null>(null);
  const [providerReadyAt, setProviderReadyAt] = useState<string | null>(null);
  const [initializationAttempt, setInitializationAttempt] = useState(1);
  const [status, setStatus] = useState<PlayerStatus>("loading");
  const [playbackState, setPlaybackState] = useState<PlaybackState>("unknown");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState<boolean | null>(null);
  const [volume, setVolume] = useState<number | null>(null);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const onTelemetryRef = useRef(onTelemetry);
  const lastInteractionAtRef = useRef(Date.now());
  const previousPlaybackStateRef = useRef<PlaybackState>("unknown");
  const spanish = locale === "es";

  useEffect(() => {
    onTelemetryRef.current = onTelemetry;
  }, [onTelemetry]);

  useEffect(() => {
    const markInteraction = () => {
      lastInteractionAtRef.current = Date.now();
    };
    const events: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "touchstart",
      "wheel",
    ];
    events.forEach((event) =>
      window.addEventListener(event, markInteraction, { passive: true }),
    );
    return () => {
      events.forEach((event) =>
        window.removeEventListener(event, markInteraction),
      );
    };
  }, []);

  const emitTelemetry = useCallback(
    (
      nextState: PlaybackState,
      nextCurrentTime: number,
      nextDuration: number,
      nextMuted: boolean | null,
      nextVolume: number | null,
      supported: boolean,
    ) => {
      if (
        nextState === "playing" &&
        previousPlaybackStateRef.current !== "playing"
      ) {
        lastInteractionAtRef.current = Date.now();
      }
      previousPlaybackStateRef.current = nextState;
      onTelemetryRef.current?.({
        supported,
        playbackState: nextState,
        currentTime: nextCurrentTime,
        duration: nextDuration,
        muted: nextMuted,
        volume: nextVolume,
        pageVisible: document.visibilityState === "visible",
        pageFocused: document.hasFocus(),
        lastInteractionAt: lastInteractionAtRef.current,
      });
    },
    [],
  );

  useEffect(() => {
    const mountedAt = timestamp();
    const queryDebug =
      new URLSearchParams(window.location.search).get("debug") === "1";
    if (queryDebug) {
      window.sessionStorage.setItem("first-listen-player-debug", "1");
    }
    setClientOrigin(window.location.origin);
    setDebugEnabled(
      queryDebug ||
        window.sessionStorage.getItem("first-listen-player-debug") === "1",
    );
    setPlayerMountedAt(mountedAt);
    console.info("[First Listen player] Player mounted", {
      playerMountedAt: mountedAt,
      songLoadedAt,
      title,
    });
  }, [songLoadedAt, title]);

  useEffect(() => {
    setStatus("loading");
    setPlaybackState("unknown");
    setCurrentTime(0);
    setDuration(0);
    setMuted(null);
    setVolume(null);
    setLoadedEmbedSrc(null);
    setIframeLoadedAt(null);
    setProviderReadyAt(null);
    setInitializationAttempt(1);
  }, [link, platform]);

  useEffect(() => {
    if (!clientOrigin) return;
    if (!embed) {
      setStatus("error");
      console.error("[First Listen player] Unsupported or invalid provider URL", {
        link,
        platform,
        songLoadedAt,
        title,
      });
      return;
    }

    console.info("[First Listen player] Generated provider embed", {
      embedGeneratedAt: embedResult.generatedAt,
      embedUrl: embed.src,
      initializationAttempt,
      link,
      platform,
      playerMountedAt,
      songLoadedAt,
      telemetry: embed.telemetry,
      title,
    });
  }, [
    clientOrigin,
    embed,
    embedResult.generatedAt,
    initializationAttempt,
    link,
    platform,
    playerMountedAt,
    songLoadedAt,
    title,
  ]);

  useEffect(() => {
    if (!embed || status !== "loading") return;
    const timeout = window.setTimeout(() => {
      if (initializationAttempt < MAX_INITIALIZATION_ATTEMPTS) {
        console.warn("[First Listen player] Initialization timed out; retrying", {
          embedUrl: embed.src,
          initializationAttempt,
          loadedEmbedSrc,
          platform,
          title,
        });
        setLoadedEmbedSrc(null);
        setIframeLoadedAt(null);
        setInitializationAttempt((current) => current + 1);
        return;
      }

      setStatus("error");
      console.error("[First Listen player] Provider initialization failed", {
        embedUrl: embed.src,
        initializationAttempt,
        link,
        platform,
        title,
      });
    }, 12000);

    return () => window.clearTimeout(timeout);
  }, [
    embed,
    initializationAttempt,
    link,
    loadedEmbedSrc,
    platform,
    status,
    title,
  ]);

  useEffect(() => {
    if (
      !embed ||
      embed.telemetry !== "youtube_iframe_api" ||
      loadedEmbedSrc !== embed.src ||
      !iframeRef.current
    ) {
      return;
    }

    let disposed = false;
    let player: YouTubePlayer | null = null;
    let telemetryInterval: number | null = null;

    const refreshTelemetry = (target: YouTubePlayer) => {
      try {
        const nextState = mapYouTubeState(target.getPlayerState());
        const nextCurrentTime = target.getCurrentTime();
        const nextDuration = target.getDuration();
        const nextMuted = target.isMuted();
        const nextVolume = target.getVolume();
        setPlaybackState(nextState);
        setCurrentTime(nextCurrentTime);
        setDuration(nextDuration);
        setMuted(nextMuted);
        setVolume(nextVolume);
        emitTelemetry(
          nextState,
          nextCurrentTime,
          nextDuration,
          nextMuted,
          nextVolume,
          true,
        );

        if (nextState === "playing") {
          console.info("[First Listen player] Provider reports active playback", {
            audioOutputVerified: false,
            currentTime: nextCurrentTime,
            duration: nextDuration,
            embedUrl: embed.src,
            muted: nextMuted,
            platform,
            title,
            volume: nextVolume,
          });
        }
      } catch (error) {
        console.warn("[First Listen player] Could not read YouTube telemetry", error);
      }
    };

    loadYouTubeApi()
      .then((api) => {
        if (disposed || !iframeRef.current) return;
        player = new api.Player(iframeRef.current, {
          events: {
            onError: (event) => {
              if (disposed) return;
              setStatus("error");
              console.error("[First Listen player] YouTube API error", {
                code: event.data,
                embedUrl: embed.src,
                initializationAttempt,
                link,
                platform,
                title,
              });
            },
            onReady: (event) => {
              if (disposed) return;
              const readyAt = timestamp();
              setProviderReadyAt(readyAt);
              setStatus("ready");
              refreshTelemetry(event.target);
              console.info("[First Listen player] Provider ready", {
                embedGeneratedAt: embedResult.generatedAt,
                embedUrl: embed.src,
                iframeLoadedAt,
                initializationAttempt,
                playerMountedAt,
                providerReadyAt: readyAt,
                songLoadedAt,
                title,
              });
              telemetryInterval = window.setInterval(
                () => refreshTelemetry(event.target),
                1000,
              );
            },
            onStateChange: (event) => refreshTelemetry(event.target),
          },
        });
      })
      .catch((error) => {
        if (disposed) return;
        console.error("[First Listen player] YouTube telemetry unavailable", {
          embedUrl: embed.src,
          error,
          initializationAttempt,
          link,
          platform,
          title,
        });
        if (initializationAttempt < MAX_INITIALIZATION_ATTEMPTS) {
          setLoadedEmbedSrc(null);
          setIframeLoadedAt(null);
          setInitializationAttempt((current) => current + 1);
        } else {
          setStatus("error");
        }
      });

    return () => {
      disposed = true;
      if (telemetryInterval !== null) window.clearInterval(telemetryInterval);
      try {
        player?.destroy();
      } catch {
        // The provider can remove the iframe before React cleanup completes.
      }
    };
  }, [
    embed,
    embedResult.generatedAt,
    emitTelemetry,
    iframeLoadedAt,
    initializationAttempt,
    link,
    loadedEmbedSrc,
    platform,
    playerMountedAt,
    songLoadedAt,
    title,
  ]);

  useEffect(() => {
    if (
      !embed ||
      embed.telemetry !== "soundcloud_widget_api" ||
      loadedEmbedSrc !== embed.src ||
      !iframeRef.current
    ) {
      return;
    }

    let disposed = false;
    let widget: SoundCloudWidget | null = null;
    let telemetryInterval: number | null = null;

    loadSoundCloudApi()
      .then((api) => {
        if (disposed || !iframeRef.current) return;
        widget = api.Widget(iframeRef.current);
        const refreshTelemetry = () => {
          widget?.getDuration((durationMs) => {
            widget?.getPosition((positionMs) => {
              widget?.getVolume((nextVolume) => {
                widget?.isPaused((paused) => {
                  if (disposed) return;
                  const nextState: PlaybackState = paused ? "paused" : "playing";
                  const nextDuration = Math.max(0, durationMs / 1000);
                  const nextPosition = Math.max(0, positionMs / 1000);
                  const nextMuted = nextVolume <= 0;
                  setPlaybackState(nextState);
                  setDuration(nextDuration);
                  setCurrentTime(nextPosition);
                  setMuted(nextMuted);
                  setVolume(nextVolume);
                  emitTelemetry(
                    nextState,
                    nextPosition,
                    nextDuration,
                    nextMuted,
                    nextVolume,
                    true,
                  );
                });
              });
            });
          });
        };
        const ready = () => {
          if (disposed) return;
          const readyAt = timestamp();
          setProviderReadyAt(readyAt);
          setStatus("ready");
          refreshTelemetry();
          telemetryInterval = window.setInterval(refreshTelemetry, 1000);
        };
        const playing = () => {
          lastInteractionAtRef.current = Date.now();
          refreshTelemetry();
        };
        const paused = () => {
          setPlaybackState("paused");
          refreshTelemetry();
        };
        const finished = () => {
          setPlaybackState("ended");
          refreshTelemetry();
        };
        const failed = () => setStatus("error");

        widget.bind(api.Widget.Events.READY, ready);
        widget.bind(api.Widget.Events.PLAY, playing);
        widget.bind(api.Widget.Events.PAUSE, paused);
        widget.bind(api.Widget.Events.FINISH, finished);
        widget.bind(api.Widget.Events.ERROR, failed);
      })
      .catch((error) => {
        if (disposed) return;
        console.error("[First Listen player] SoundCloud telemetry unavailable", {
          embedUrl: embed.src,
          error,
          platform,
          title,
        });
        setStatus("error");
      });

    return () => {
      disposed = true;
      if (telemetryInterval !== null) window.clearInterval(telemetryInterval);
      if (widget && window.SC?.Widget.Events) {
        Object.values(window.SC.Widget.Events).forEach((event) =>
          widget?.unbind(event),
        );
      }
    };
  }, [embed, emitTelemetry, loadedEmbedSrc, platform, title]);

  const playerLoaded = () => {
    if (!embed) return;
    const loadedAt = timestamp();
    setLoadedEmbedSrc(embed.src);
    setIframeLoadedAt(loadedAt);
    console.info("[First Listen player] Provider iframe loaded", {
      embedUrl: embed.src,
      iframeLoadedAt: loadedAt,
      initializationAttempt,
      platform,
      title,
    });
    if (
      embed.telemetry !== "youtube_iframe_api" &&
      embed.telemetry !== "soundcloud_widget_api"
    ) {
      setProviderReadyAt(loadedAt);
      setStatus("ready");
      emitTelemetry(
        "unknown",
        0,
        0,
        null,
        null,
        false,
      );
    }
  };

  const playerFailed = () => {
    if (initializationAttempt < MAX_INITIALIZATION_ATTEMPTS) {
      setLoadedEmbedSrc(null);
      setIframeLoadedAt(null);
      setInitializationAttempt((current) => current + 1);
      return;
    }
    setStatus("error");
    console.error("[First Listen player] Provider iframe failed", {
      embedUrl: embed?.src,
      initializationAttempt,
      link,
      platform,
      title,
    });
  };

  return (
    <div className={`provider-player provider-${platform.toLowerCase().replaceAll(" ", "-")}`}>
      {status !== "ready" && (
        <Image
          alt={`${title} by ${artist} cover`}
          className="provider-player-cover"
          fill
          priority
          sizes="(max-width: 760px) 100vw, 420px"
          src={coverUrl}
          unoptimized
        />
      )}

      {embed && (
        <iframe
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          className={status === "ready" ? "ready" : ""}
          key={`${embed.src}:${initializationAttempt}`}
          onError={playerFailed}
          onLoad={playerLoaded}
          ref={iframeRef}
          referrerPolicy="strict-origin-when-cross-origin"
          src={embed.src}
          title={`${title} by ${artist} - ${embed.title}`}
        />
      )}

      {status === "loading" && (
        <div className="provider-player-status" role="status">
          <LoaderCircle className="provider-player-spinner" size={22} />
          <strong>
            {spanish ? `Cargando reproductor de ${platform}...` : `Loading ${platform} player...`}
          </strong>
        </div>
      )}

      {status === "error" && (
        <div className="provider-player-status provider-player-error" role="alert">
          <AlertTriangle size={22} />
          <strong>{spanish ? "Reproductor no disponible" : "Player unavailable"}</strong>
          <span>
            {spanish
              ? "La plataforma puede haber bloqueado la reproduccion integrada para esta cancion."
              : "This provider may have blocked embedding for this song."}
          </span>
          <a href={link} rel="noreferrer" target="_blank">
            {spanish ? `Abrir en ${platform}` : `Open on ${platform}`} <ExternalLink size={13} />
          </a>
        </div>
      )}

      {debugEnabled && (
        <dl className="provider-player-debug" data-testid="provider-player-debug">
          <div><dt>Song loaded</dt><dd>{songLoadedAt ?? "not recorded"}</dd></div>
          <div><dt>Player mounted</dt><dd>{playerMountedAt ?? "pending"}</dd></div>
          <div><dt>Embed generated</dt><dd>{embedResult.generatedAt ?? "pending"}</dd></div>
          <div><dt>Iframe loaded</dt><dd>{iframeLoadedAt ?? "pending"}</dd></div>
          <div><dt>Provider ready</dt><dd>{providerReadyAt ?? "pending"}</dd></div>
          <div><dt>Attempt</dt><dd>{initializationAttempt} / {MAX_INITIALIZATION_ATTEMPTS}</dd></div>
          <div><dt>Provider</dt><dd>{platform}</dd></div>
          <div><dt>Embed URL</dt><dd>{embed?.src ?? "pending"}</dd></div>
          <div><dt>Iframe</dt><dd>{status}</dd></div>
          <div><dt>Play state</dt><dd>{playbackState}</dd></div>
          <div><dt>Current time</dt><dd>{currentTime.toFixed(1)}s</dd></div>
          <div><dt>Duration</dt><dd>{duration.toFixed(1)}s</dd></div>
          <div><dt>Muted</dt><dd>{muted === null ? "not exposed" : String(muted)}</dd></div>
          <div><dt>Volume</dt><dd>{volume === null ? "not exposed" : `${volume}%`}</dd></div>
          <div>
            <dt>Audio output</dt>
            <dd>
              {playbackState === "playing" && muted === false && (volume ?? 0) > 0
                ? "provider playing and unmuted; hardware output cannot be verified"
                : "not verified"}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
