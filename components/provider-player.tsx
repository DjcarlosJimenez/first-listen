"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import {
  AlertTriangle,
  ExternalLink,
  Link2,
  LoaderCircle,
  Play,
  X,
} from "lucide-react";
import type { InterfaceLocale } from "@/lib/catalog";
import { isExternalPlatform } from "@/lib/content-economy";
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
  loadPlaylist: (options: {
    index?: number;
    list: string;
    listType?: "playlist";
    startSeconds?: number;
  }) => void;
  loadVideoById: (videoId: string) => void;
  pauseVideo: () => void;
  playVideo: () => void;
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
  pause: () => void;
  play: () => void;
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

type SpotifyPlaybackEvent = {
  data: {
    isPaused: boolean;
    isBuffering: boolean;
    duration: number;
    position: number;
  };
};

type SpotifyController = {
  addListener: (
    event: "ready" | "playback_started" | "playback_update",
    listener: (event: SpotifyPlaybackEvent) => void,
  ) => void;
  destroy: () => void;
  pause: () => void;
  play: () => void;
};

type SpotifyIframeApi = {
  createController: (
    element: HTMLElement,
    options: { uri: string; width: string; height: string },
    callback: (controller: SpotifyController) => void,
  ) => void;
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
    SC?: SoundCloudApi;
    onSpotifyIframeApiReady?: (api: SpotifyIframeApi) => void;
  }
}

const YOUTUBE_API_SRC = "https://www.youtube.com/iframe_api";
const SOUNDCLOUD_API_SRC = "https://w.soundcloud.com/player/api.js";
const SPOTIFY_API_SRC = "https://open.spotify.com/embed/iframe-api/v1";
const MAX_INITIALIZATION_ATTEMPTS = 3;
const ACTIVE_PLAYBACK_EVENT = "first-listen:active-playback";
const PLAYBACK_COMMAND_EVENT = "first-listen:playback-command";
let youtubeApiPromise: Promise<YouTubeApi> | null = null;
let soundCloudApiPromise: Promise<SoundCloudApi> | null = null;
let spotifyApiPromise: Promise<SpotifyIframeApi> | null = null;

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

function loadSpotifyApi() {
  if (spotifyApiPromise) return spotifyApiPromise;

  spotifyApiPromise = new Promise<SpotifyIframeApi>((resolve, reject) => {
    let settled = false;
    const finish = (api: SpotifyIframeApi) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(api);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(new Error("Spotify IFrame API did not become ready."));
    };
    const previousReady = window.onSpotifyIframeApiReady;
    window.onSpotifyIframeApiReady = (api) => {
      try {
        previousReady?.(api);
      } catch (error) {
        console.warn("[First Listen player] Previous Spotify callback failed", error);
      }
      finish(api);
    };
    const timeout = window.setTimeout(fail, 15000);
    let script = document.querySelector<HTMLScriptElement>(
      `script[src="${SPOTIFY_API_SRC}"]`,
    );
    if (!script) {
      script = document.createElement("script");
      script.async = true;
      script.src = SPOTIFY_API_SRC;
      document.body.append(script);
    }
    script.addEventListener("error", fail, { once: true });
  }).catch((error) => {
    spotifyApiPromise = null;
    throw error;
  });

  return spotifyApiPromise;
}

function spotifyTrackUri(rawUrl: string) {
  try {
    const parts = new URL(rawUrl).pathname.split("/").filter(Boolean);
    const trackIndex = parts.findIndex((part) => part === "track");
    const trackId = trackIndex >= 0 ? parts[trackIndex + 1] : null;
    return trackId ? `spotify:track:${trackId}` : null;
  } catch {
    return null;
  }
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

function isYouTubePlaybackPlatform(platform: Platform) {
  return platform === "YouTube" || platform === "YouTube Music";
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
  onReady,
  autoPlay = false,
  controlChannel,
  skipExternalRedirectWarning = false,
  onExternalRedirectPreferenceChange,
}: {
  artist: string;
  coverUrl: string;
  link: string;
  locale: InterfaceLocale;
  platform: Platform;
  songLoadedAt: string | null;
  title: string;
  onTelemetry?: (snapshot: ProviderTelemetrySnapshot) => void;
  onReady?: () => void;
  autoPlay?: boolean;
  controlChannel?: string;
  skipExternalRedirectWarning?: boolean;
  onExternalRedirectPreferenceChange?: (disabled: boolean) => void;
}) {
  const playbackInstanceId = useId();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const spotifyContainerRef = useRef<HTMLDivElement>(null);
  const youtubePlayerRef = useRef<YouTubePlayer | null>(null);
  const spotifyControllerRef = useRef<SpotifyController | null>(null);
  const soundCloudWidgetRef = useRef<SoundCloudWidget | null>(null);
  const [clientOrigin, setClientOrigin] = useState<string | null>(null);
  const [playerMountedAt, setPlayerMountedAt] = useState<string | null>(null);
  const embedResult = useMemo(() => {
    if (!clientOrigin) return { embed: null, generatedAt: null };
    return {
      embed: getProviderEmbed(link, platform, clientOrigin, autoPlay),
      generatedAt: timestamp(),
    };
  }, [autoPlay, clientOrigin, link, platform]);
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
  const [youtubeFrameSrc, setYoutubeFrameSrc] = useState<string | null>(null);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [showAutoplayFallback, setShowAutoplayFallback] = useState(false);
  const [showExternalConfirmation, setShowExternalConfirmation] =
    useState(false);
  const [disableFutureWarnings, setDisableFutureWarnings] = useState(false);
  const onTelemetryRef = useRef(onTelemetry);
  const onReadyRef = useRef(onReady);
  const autoPlayRef = useRef(autoPlay);
  const lastInteractionAtRef = useRef(Date.now());
  const previousPlaybackStateRef = useRef<PlaybackState>("unknown");
  const previousPlaybackTargetRef = useRef<{
    link: string;
    platform: Platform;
  } | null>(null);
  const youtubePlaybackTargetRef = useRef<string | null>(null);
  const latestYouTubeTargetRef = useRef<string | null>(null);
  const providerLogRef = useRef({
    embedGeneratedAt: null as string | null,
    link,
    platform,
    songLoadedAt,
    title,
  });
  const spanish = locale === "es";
  const externalContent = isExternalPlatform(platform);
  const youtubeTelemetryActive = embed?.telemetry === "youtube_iframe_api";
  const iframeSrc =
    youtubeTelemetryActive
      ? youtubeFrameSrc ?? embed.src
      : embed?.src ?? null;
  const youtubeTargetKey =
    youtubeTelemetryActive
      ? embed.youtubeVideoId
        ? `video:${embed.youtubeVideoId}`
        : embed.youtubePlaylistId
          ? `playlist:${embed.youtubePlaylistId}`
          : null
      : null;

  useEffect(() => {
    onTelemetryRef.current = onTelemetry;
  }, [onTelemetry]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    autoPlayRef.current = autoPlay;
  }, [autoPlay]);

  useEffect(() => {
    latestYouTubeTargetRef.current = youtubeTargetKey;
  }, [youtubeTargetKey]);

  useEffect(() => {
    providerLogRef.current = {
      embedGeneratedAt: embedResult.generatedAt,
      link,
      platform,
      songLoadedAt,
      title,
    };
  }, [embedResult.generatedAt, link, platform, songLoadedAt, title]);

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
        window.dispatchEvent(
          new CustomEvent(ACTIVE_PLAYBACK_EVENT, {
            detail: { playerId: playbackInstanceId },
          }),
        );
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
    [playbackInstanceId],
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
    const previous = previousPlaybackTargetRef.current;
    const keepExistingYouTubePlayer =
      Boolean(youtubePlayerRef.current) &&
      previous !== null &&
      isYouTubePlaybackPlatform(previous.platform) &&
      isYouTubePlaybackPlatform(platform);

    previousPlaybackTargetRef.current = { link, platform };

    if (keepExistingYouTubePlayer) {
      setStatus("ready");
      setPlaybackState("buffering");
      setCurrentTime(0);
      setDuration(0);
      setShowAutoplayFallback(false);
      return;
    }

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
    setShowAutoplayFallback(false);
    setYoutubeFrameSrc(null);
  }, [link, platform]);

  useEffect(() => {
    if (!embed || embed.telemetry !== "youtube_iframe_api") {
      setYoutubeFrameSrc(null);
      youtubePlaybackTargetRef.current = null;
      return;
    }
    setYoutubeFrameSrc((current) => current ?? embed.src);
  }, [embed]);

  useEffect(() => {
    if (!autoPlay || status !== "ready" || playbackState === "playing") {
      setShowAutoplayFallback(false);
      return;
    }
    if (
      embed?.telemetry !== "youtube_iframe_api" &&
      embed?.telemetry !== "spotify_iframe_api" &&
      embed?.telemetry !== "soundcloud_widget_api"
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setShowAutoplayFallback(true);
    }, 2500);
    return () => window.clearTimeout(timeout);
  }, [autoPlay, embed?.telemetry, playbackState, status]);

  const requestPlayback = useCallback(() => {
    setShowAutoplayFallback(false);
    lastInteractionAtRef.current = Date.now();
    try {
      youtubePlayerRef.current?.playVideo();
      spotifyControllerRef.current?.play();
      soundCloudWidgetRef.current?.play();
    } catch (error) {
      console.info("[First Listen player] Playback request was deferred", error);
    }
  }, []);

  const pausePlayback = useCallback(() => {
    try {
      youtubePlayerRef.current?.pauseVideo();
      spotifyControllerRef.current?.pause();
      soundCloudWidgetRef.current?.pause();
      setPlaybackState((current) =>
        current === "playing" ? "paused" : current,
      );
    } catch (error) {
      console.info("[First Listen player] Pause request was deferred", error);
    }
  }, []);

  useEffect(() => {
    if (!controlChannel) return;
    const handleCommand = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          channel?: string;
          command?: "pause" | "play";
        }>
      ).detail;
      if (detail?.channel !== controlChannel) return;
      if (detail.command === "play") requestPlayback();
      if (detail.command === "pause") pausePlayback();
    };

    window.addEventListener(PLAYBACK_COMMAND_EVENT, handleCommand);
    return () =>
      window.removeEventListener(PLAYBACK_COMMAND_EVENT, handleCommand);
  }, [controlChannel, pausePlayback, requestPlayback]);

  useEffect(() => {
    const pauseForAnotherPlayer = (event: Event) => {
      const playerId = (event as CustomEvent<{ playerId?: string }>).detail
        ?.playerId;
      if (!playerId || playerId === playbackInstanceId) return;
      try {
        youtubePlayerRef.current?.pauseVideo();
        spotifyControllerRef.current?.pause();
        soundCloudWidgetRef.current?.pause();
        setPlaybackState((current) =>
          current === "playing" ? "paused" : current,
        );
      } catch (error) {
        console.info(
          "[First Listen player] Another player became active",
          error,
        );
      }
    };

    window.addEventListener(ACTIVE_PLAYBACK_EVENT, pauseForAnotherPlayer);
    return () =>
      window.removeEventListener(
        ACTIVE_PLAYBACK_EVENT,
        pauseForAnotherPlayer,
      );
  }, [playbackInstanceId]);

  useEffect(() => {
    if (!clientOrigin) return;
    if (!embed) {
      if (externalContent) return;
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
    externalContent,
  ]);

  useEffect(() => {
    if (
      !embed ||
      embed.telemetry !== "spotify_iframe_api" ||
      !spotifyContainerRef.current
    ) {
      return;
    }

    const uri = spotifyTrackUri(link);
    if (!uri) {
      setStatus("error");
      return;
    }

    let disposed = false;
    let controller: SpotifyController | null = null;

    loadSpotifyApi()
      .then((api) => {
        if (disposed || !spotifyContainerRef.current) return;
        api.createController(
          spotifyContainerRef.current,
          { uri, width: "100%", height: "352" },
          (nextController) => {
            if (disposed) {
              nextController.destroy();
              return;
            }
            controller = nextController;
            spotifyControllerRef.current = nextController;
            nextController.addListener("ready", () => {
              if (disposed) return;
              const readyAt = timestamp();
              setLoadedEmbedSrc(embed.src);
              setIframeLoadedAt(readyAt);
              setProviderReadyAt(readyAt);
              setStatus("ready");
              onReadyRef.current?.();
              emitTelemetry("cued", 0, 0, null, null, false);
              if (autoPlay) {
                try {
                  nextController.play();
                } catch (error) {
                  console.info(
                    "[First Listen player] Browser deferred Spotify autoplay",
                    error,
                  );
                }
              }
            });
            nextController.addListener("playback_started", () => {
              lastInteractionAtRef.current = Date.now();
            });
            nextController.addListener("playback_update", (event) => {
              if (disposed) return;
              const nextDuration = Math.max(0, event.data.duration / 1000);
              const nextPosition = Math.max(0, event.data.position / 1000);
              const ended =
                nextDuration > 0 &&
                nextPosition >= Math.max(0, nextDuration - 0.75) &&
                event.data.isPaused;
              const nextState: PlaybackState = ended
                ? "ended"
                : event.data.isBuffering
                  ? "buffering"
                  : event.data.isPaused
                    ? "paused"
                    : "playing";
              setPlaybackState(nextState);
              setDuration(nextDuration);
              setCurrentTime(nextPosition);
              setMuted(null);
              setVolume(null);
              emitTelemetry(
                nextState,
                nextPosition,
                nextDuration,
                null,
                null,
                false,
              );
            });
          },
        );
      })
      .catch((error) => {
        if (disposed) return;
        console.error("[First Listen player] Spotify telemetry unavailable", {
          error,
          link,
          title,
        });
        setStatus("error");
      });

    return () => {
      disposed = true;
      spotifyControllerRef.current = null;
      try {
        controller?.destroy();
      } catch {
        // Spotify may remove its iframe before React cleanup completes.
      }
    };
  }, [autoPlay, embed, emitTelemetry, link, title]);

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
      !youtubeTelemetryActive ||
      !iframeSrc ||
      loadedEmbedSrc !== iframeSrc ||
      !iframeRef.current
    ) {
      return;
    }

    const initialLog = providerLogRef.current;
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
            embedUrl: iframeSrc,
            muted: nextMuted,
            platform: providerLogRef.current.platform,
            title: providerLogRef.current.title,
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
                embedUrl: iframeSrc,
                initializationAttempt,
                link: providerLogRef.current.link,
                platform: providerLogRef.current.platform,
                title: providerLogRef.current.title,
              });
            },
            onReady: (event) => {
              if (disposed) return;
              youtubePlayerRef.current = event.target;
              youtubePlaybackTargetRef.current =
                latestYouTubeTargetRef.current;
              const readyAt = timestamp();
              setProviderReadyAt(readyAt);
              setStatus("ready");
              onReadyRef.current?.();
              refreshTelemetry(event.target);
              if (autoPlayRef.current) {
                try {
                  event.target.playVideo();
                } catch (error) {
                  console.info(
                    "[First Listen player] Browser deferred autoplay",
                    error,
                  );
                }
              }
              console.info("[First Listen player] Provider ready", {
                embedGeneratedAt: initialLog.embedGeneratedAt,
                embedUrl: iframeSrc,
                iframeLoadedAt,
                initializationAttempt,
                playerMountedAt,
                providerReadyAt: readyAt,
                songLoadedAt: initialLog.songLoadedAt,
                title: initialLog.title,
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
          embedUrl: iframeSrc,
          error,
          initializationAttempt,
          link: providerLogRef.current.link,
          platform: providerLogRef.current.platform,
          title: providerLogRef.current.title,
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
      youtubePlayerRef.current = null;
      if (telemetryInterval !== null) window.clearInterval(telemetryInterval);
      try {
        player?.destroy();
      } catch {
        // The provider can remove the iframe before React cleanup completes.
      }
    };
  }, [
    emitTelemetry,
    iframeSrc,
    iframeLoadedAt,
    initializationAttempt,
    loadedEmbedSrc,
    playerMountedAt,
    youtubeTelemetryActive,
  ]);

  useEffect(() => {
    if (
      !embed ||
      embed.telemetry !== "youtube_iframe_api" ||
      status !== "ready" ||
      !youtubePlayerRef.current ||
      !youtubeTargetKey
    ) {
      return;
    }

    if (youtubePlaybackTargetRef.current === youtubeTargetKey) return;

    const player = youtubePlayerRef.current;
    youtubePlaybackTargetRef.current = youtubeTargetKey;
    setShowAutoplayFallback(false);
    setPlaybackState("buffering");
    setCurrentTime(0);
    setDuration(0);
    emitTelemetry("buffering", 0, 0, muted, volume, true);

    try {
      if (embed.youtubeVideoId) {
        player.loadVideoById(embed.youtubeVideoId);
      } else if (embed.youtubePlaylistId) {
        player.loadPlaylist({
          index: 0,
          list: embed.youtubePlaylistId,
          listType: "playlist",
          startSeconds: 0,
        });
      }

      if (autoPlay) {
        player.playVideo();
        window.setTimeout(() => youtubePlayerRef.current?.playVideo(), 350);
      }

      console.info("[First Listen player] Loaded next YouTube item in-place", {
        autoPlay,
        platform,
        title,
        youtubeTargetKey,
      });
    } catch (error) {
      console.info("[First Listen player] YouTube in-place handoff deferred", {
        error,
        platform,
        title,
        youtubeTargetKey,
      });
      if (autoPlay) setShowAutoplayFallback(true);
    }
  }, [
    autoPlay,
    embed,
    emitTelemetry,
    muted,
    platform,
    status,
    title,
    volume,
    youtubeTargetKey,
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
        soundCloudWidgetRef.current = widget;
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
          onReadyRef.current?.();
          refreshTelemetry();
          if (autoPlay) widget?.play();
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
          widget?.getDuration((durationMs) => {
            widget?.getVolume((nextVolume) => {
              if (disposed) return;
              const nextDuration = Math.max(0, durationMs / 1000);
              const nextMuted = nextVolume <= 0;
              setPlaybackState("ended");
              setDuration(nextDuration);
              setCurrentTime(nextDuration);
              setMuted(nextMuted);
              setVolume(nextVolume);
              emitTelemetry(
                "ended",
                nextDuration,
                nextDuration,
                nextMuted,
                nextVolume,
                true,
              );
            });
          });
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
      soundCloudWidgetRef.current = null;
      if (telemetryInterval !== null) window.clearInterval(telemetryInterval);
      if (widget && window.SC?.Widget.Events) {
        Object.values(window.SC.Widget.Events).forEach((event) =>
          widget?.unbind(event),
        );
      }
    };
  }, [autoPlay, embed, emitTelemetry, loadedEmbedSrc, platform, title]);

  const playerLoaded = () => {
    if (!embed || !iframeSrc) return;
    const loadedAt = timestamp();
    setLoadedEmbedSrc(iframeSrc);
    setIframeLoadedAt(loadedAt);
    console.info("[First Listen player] Provider iframe loaded", {
      embedUrl: iframeSrc,
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
      onReadyRef.current?.();
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

  const openExternalPlatform = useCallback(() => {
    const opened = window.open(link, "_blank", "noopener,noreferrer");
    if (opened) opened.opener = null;
    setShowExternalConfirmation(false);
    emitTelemetry("unknown", 0, 0, null, null, false);
  }, [emitTelemetry, link]);

  const requestExternalPlayback = () => {
    if (skipExternalRedirectWarning) {
      openExternalPlatform();
      return;
    }
    setDisableFutureWarnings(false);
    setShowExternalConfirmation(true);
  };

  const continueToExternalPlatform = () => {
    if (disableFutureWarnings) {
      onExternalRedirectPreferenceChange?.(true);
    }
    openExternalPlatform();
  };

  if (externalContent) {
    return (
      <div
        className={`provider-player provider-external provider-${platform.toLowerCase().replaceAll(" ", "-")}`}
      >
        <Image
          alt={`${title} by ${artist} cover`}
          className="provider-player-cover"
          fill
          priority
          sizes="(max-width: 760px) 100vw, 420px"
          src={coverUrl}
          unoptimized
        />
        <div className="external-player-action">
          <span><Link2 size={15} /> {spanish ? "Abre fuera de First Listen" : "Opens outside First Listen"}</span>
          <strong>{title}</strong>
          <small>
            {spanish
              ? `Este contenido se reproduce en ${platform}.`
              : `This content plays on ${platform}.`}
          </small>
          <button onClick={requestExternalPlayback} type="button">
            <Play fill="currentColor" size={16} />
            {spanish ? `Abrir ${platform}` : `Play on ${platform}`}
          </button>
        </div>
        {showExternalConfirmation && (
          <div
            aria-labelledby="external-content-dialog-title"
            aria-modal="true"
            className="external-redirect-dialog"
            role="dialog"
          >
            <div>
              <button
                aria-label={spanish ? "Cerrar" : "Close"}
                className="external-dialog-close"
                onClick={() => setShowExternalConfirmation(false)}
                type="button"
              >
                <X size={17} />
              </button>
              <span className="eyebrow"><Link2 size={13} /> {spanish ? "Abre fuera de First Listen" : "Opens outside First Listen"}</span>
              <h3 id="external-content-dialog-title">
                {spanish
                  ? `Este contenido esta alojado en ${platform}.`
                  : `This content is hosted on ${platform}.`}
              </h3>
              <p>
                {spanish
                  ? `Este contenido abrirá ${platform} en una nueva pestaña y saldrá temporalmente de First Listen. La actividad externa no suma tiempo ni tokens dentro de First Listen.`
                  : `This content will open ${platform} in a new tab and temporarily leave First Listen. External activity does not earn time or tokens inside First Listen.`}
              </p>
              <label>
                <input
                  checked={disableFutureWarnings}
                  onChange={(event) =>
                    setDisableFutureWarnings(event.target.checked)
                  }
                  type="checkbox"
                />
                {spanish ? "No volver a mostrar" : "Don't show again"}
              </label>
              <div>
                <button
                  className="primary-button"
                  onClick={continueToExternalPlatform}
                  type="button"
                >
                  {spanish
                    ? `Continuar a ${platform}`
                    : `Continue to ${platform}`}
                  <ExternalLink size={14} />
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setShowExternalConfirmation(false)}
                  type="button"
                >
                  {spanish ? "Permanecer en First Listen" : "Stay on First Listen"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

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

      {embed?.telemetry === "spotify_iframe_api" && (
        <div
          className={status === "ready" ? "spotify-controller ready" : "spotify-controller"}
        >
          <div ref={spotifyContainerRef} />
        </div>
      )}

      {embed && iframeSrc && embed.telemetry !== "spotify_iframe_api" && (
        <iframe
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          className={status === "ready" ? "ready" : ""}
          key={`${iframeSrc}:${initializationAttempt}`}
          onError={playerFailed}
          onLoad={playerLoaded}
          ref={iframeRef}
          referrerPolicy="strict-origin-when-cross-origin"
          src={iframeSrc}
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
              ? "La plataforma puede haber bloqueado la reproducción integrada para esta canción."
              : "This provider may have blocked embedding for this song."}
          </span>
          <a href={link} rel="noreferrer" target="_blank">
            {spanish ? `Abrir en ${platform}` : `Open on ${platform}`} <ExternalLink size={13} />
          </a>
        </div>
      )}

      {showAutoplayFallback && (
        <div className="provider-autoplay-fallback" role="status">
          <strong>
            {spanish ? "La reproducción necesita un toque" : "Playback needs one tap"}
          </strong>
          <button onClick={requestPlayback} type="button">
            {spanish ? "▶ Toca para empezar a escuchar" : "▶ Tap To Start Listening"}
          </button>
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
