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
import { safeCoverUrl } from "@/lib/media";
import { getProviderEmbed } from "@/lib/player";
import type { Platform } from "@/lib/types";
import {
  WORKSPACE_V2_PLAYBACK_COMMAND_EVENT,
  type WorkspaceV2PlaybackCommandDetail,
} from "@/lib/workspace-v2";

type PlayerStatus = "loading" | "ready" | "error";
type PlaybackState =
  | "loading"
  | "ready"
  | "completed"
  | "playing"
  | "paused"
  | "error";

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

export type ProviderLifecycleDebugEvent = {
  currentIframeSrc?: string | null;
  details?: string;
  iframeLoadCount?: number;
  mountCount?: number;
  renderCount?: number;
  transition:
    | "PLAYER_RENDER_SAMPLE"
    | "PLAYER_MOUNT"
    | "PLAYER_UNMOUNT"
    | "IFRAME_LOADED"
    | "YOUTUBE_CLEANUP";
  unmountCount?: number;
  youtubeCleanupCount?: number;
};

type ProviderProgressSample = {
  currentTime: number;
  duration: number;
  playbackState: PlaybackState;
  sampledAt: number;
  targetKey: string;
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
const USER_CLICK_PLAY_DEDUPE_MS = 850;
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
  if (state === -1) return "ready";
  if (state === 0) return "completed";
  if (state === 1) return "playing";
  if (state === 2) return "paused";
  if (state === 3) return "loading";
  if (state === 5) return "ready";
  return "loading";
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
  onLifecycleDebug,
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
  onLifecycleDebug?: (event: ProviderLifecycleDebugEvent) => void;
  autoPlay?: boolean;
  controlChannel?: string;
  skipExternalRedirectWarning?: boolean;
  onExternalRedirectPreferenceChange?: (disabled: boolean) => void;
}) {
  const playbackInstanceId = useId();
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
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
  const [playbackState, setPlaybackState] = useState<PlaybackState>("loading");
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
  const manualPauseRef = useRef(false);
  const debugEnabledRef = useRef(false);
  const autoplayRetryTimersRef = useRef<number[]>([]);
  const autoplayRetryTokenRef = useRef(0);
  const lastActivePlaybackLogRef = useRef({ at: 0, target: "" });
  const lastInteractionAtRef = useRef(Date.now());
  const lastTrustedPlayCommandAtRef = useRef(0);
  const previousPlaybackStateRef = useRef<PlaybackState>("loading");
  const mountCountRef = useRef(0);
  const unmountCountRef = useRef(0);
  const iframeLoadCountRef = useRef(0);
  const youtubeCleanupCountRef = useRef(0);
  const initialMountLogRef = useRef({ songLoadedAt, title });
  const previousPlaybackTargetRef = useRef<{
    link: string;
    platform: Platform;
  } | null>(null);
  const providerProgressRef = useRef<ProviderProgressSample>({
    currentTime: 0,
    duration: 0,
    playbackState: "loading",
    sampledAt: 0,
    targetKey: "",
  });
  const mutedRef = useRef<boolean | null>(null);
  const volumeRef = useRef<number | null>(null);
  const providerTelemetryTargetRef = useRef("");
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
    if (!onLifecycleDebug) return;
    const interval = window.setInterval(() => {
      onLifecycleDebug({
        currentIframeSrc: iframeRef.current?.src ?? null,
        iframeLoadCount: iframeLoadCountRef.current,
        mountCount: mountCountRef.current,
        renderCount: renderCountRef.current,
        transition: "PLAYER_RENDER_SAMPLE",
        unmountCount: unmountCountRef.current,
        youtubeCleanupCount: youtubeCleanupCountRef.current,
      });
    }, 2000);
    return () => window.clearInterval(interval);
  }, [onLifecycleDebug]);

  useEffect(() => {
    autoPlayRef.current = autoPlay;
  }, [autoPlay]);

  useEffect(() => {
    debugEnabledRef.current = debugEnabled;
  }, [debugEnabled]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    latestYouTubeTargetRef.current = youtubeTargetKey;
  }, [youtubeTargetKey]);

  useEffect(() => {
    providerTelemetryTargetRef.current =
      youtubeTargetKey ?? `${platform}:${link}`;
  }, [link, platform, youtubeTargetKey]);

  const clearAutoplayRetryTimers = useCallback(() => {
    autoplayRetryTokenRef.current += 1;
    autoplayRetryTimersRef.current.forEach((timer) =>
      window.clearTimeout(timer),
    );
    autoplayRetryTimersRef.current = [];
  }, []);

  const scheduleYouTubeAutoplayRetries = useCallback(
    (player: YouTubePlayer, targetKey: string | null) => {
      if (!targetKey) return;
      clearAutoplayRetryTimers();
      const token = autoplayRetryTokenRef.current;
      const retryDelays = [0, 250, 750, 1500, 2500, 4000, 6000];
      autoplayRetryTimersRef.current = retryDelays.map((delay) =>
        window.setTimeout(() => {
          if (
            manualPauseRef.current ||
            token !== autoplayRetryTokenRef.current ||
            latestYouTubeTargetRef.current !== targetKey ||
            youtubePlaybackTargetRef.current !== targetKey
          ) {
            return;
          }
          try {
            const state = mapYouTubeState(player.getPlayerState());
            if (state === "playing" || state === "completed") return;
            setShowAutoplayFallback(false);
            player.playVideo();
          } catch (error) {
            if (debugEnabledRef.current) {
              console.info("[First Listen player] YouTube autoplay retry deferred", {
                error,
                targetKey,
              });
            }
          }
        }, delay),
      );
    },
    [clearAutoplayRetryTimers],
  );

  useEffect(
    () => () => {
      clearAutoplayRetryTimers();
    },
    [clearAutoplayRetryTimers],
  );

  useEffect(() => {
    if (!autoPlay) clearAutoplayRetryTimers();
  }, [autoPlay, clearAutoplayRetryTimers]);

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

  const normalizeTelemetrySnapshot = useCallback(
    (
      nextState: PlaybackState,
      rawCurrentTime: number,
      rawDuration: number,
    ) => {
      const now = Date.now();
      const targetKey = providerTelemetryTargetRef.current;
      const previous = providerProgressRef.current;
      const targetChanged = previous.targetKey !== targetKey;
      const currentTime = Number.isFinite(rawCurrentTime)
        ? Math.max(0, rawCurrentTime)
        : 0;
      const duration = Number.isFinite(rawDuration)
        ? Math.max(0, rawDuration)
        : 0;

      const baseSample: ProviderProgressSample = targetChanged
        ? {
            currentTime: 0,
            duration: 0,
            playbackState: "loading",
            sampledAt: now,
            targetKey,
          }
        : previous;

      let normalizedState = nextState;
      const normalizedDuration =
        duration > 0 ? duration : baseSample.duration;
      let normalizedCurrentTime = currentTime;

      if (
        !targetChanged &&
        currentTime <= 0 &&
        baseSample.currentTime > 0 &&
        nextState !== "loading"
      ) {
        normalizedCurrentTime = baseSample.currentTime;
      }

      if (nextState === "playing") {
        const elapsedSeconds =
          baseSample.sampledAt > 0
            ? Math.max(0, Math.min(5, (now - baseSample.sampledAt) / 1000))
            : 0;
        const providerProgressed =
          currentTime > baseSample.currentTime + 0.05;

        if (!providerProgressed && elapsedSeconds > 0) {
          normalizedCurrentTime = Math.max(
            normalizedCurrentTime,
            baseSample.currentTime + elapsedSeconds,
          );
        }
      }

      if (nextState === "completed") {
        normalizedCurrentTime =
          normalizedDuration > 0
            ? normalizedDuration
            : Math.max(normalizedCurrentTime, baseSample.currentTime);
      }

      if (
        normalizedState === "playing" &&
        normalizedDuration > 0 &&
        normalizedCurrentTime >= Math.max(0, normalizedDuration - 0.75)
      ) {
        normalizedState = "completed";
        normalizedCurrentTime = normalizedDuration;
      }

      if (normalizedDuration > 0) {
        normalizedCurrentTime = Math.min(
          normalizedCurrentTime,
          normalizedDuration,
        );
      }

      providerProgressRef.current = {
        currentTime: normalizedCurrentTime,
        duration: normalizedDuration,
        playbackState: normalizedState,
        sampledAt: now,
        targetKey,
      };

      return {
        currentTime: normalizedCurrentTime,
        duration: normalizedDuration,
        playbackState: normalizedState,
      };
    },
    [],
  );

  const emitTelemetry = useCallback(
    (
      nextState: PlaybackState,
      nextCurrentTime: number,
      nextDuration: number,
      nextMuted: boolean | null,
      nextVolume: number | null,
      supported: boolean,
    ) => {
      if (manualPauseRef.current && nextState === "playing") {
        try {
          youtubePlayerRef.current?.pauseVideo();
          spotifyControllerRef.current?.pause();
          soundCloudWidgetRef.current?.pause();
        } catch {
          // The provider may already be pausing; the telemetry state below is authoritative for First Listen.
        }
        nextState = "paused";
        setPlaybackState("paused");
      }
      const normalized = normalizeTelemetrySnapshot(
        nextState,
        nextCurrentTime,
        nextDuration,
      );
      nextState = normalized.playbackState;
      nextCurrentTime = normalized.currentTime;
      nextDuration = normalized.duration;
      setPlaybackState(nextState);
      setCurrentTime(nextCurrentTime);
      setDuration(nextDuration);
      if (nextState === "playing" || nextState === "completed") {
        clearAutoplayRetryTimers();
      }
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
    [clearAutoplayRetryTimers, normalizeTelemetrySnapshot, playbackInstanceId],
  );

  const readYouTubeTelemetry = useCallback(
    (target: YouTubePlayer | null = youtubePlayerRef.current) => {
      if (!target) return false;
      try {
        const nextState = mapYouTubeState(target.getPlayerState());
        const nextCurrentTime = target.getCurrentTime();
        const nextDuration = target.getDuration();
        const nextMuted = target.isMuted();
        const nextVolume = target.getVolume();

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

        const logKey = `${providerLogRef.current.platform}:${latestYouTubeTargetRef.current ?? iframeSrc ?? ""}`;
        const now = Date.now();
        if (
          nextState === "playing" &&
          debugEnabledRef.current &&
          (lastActivePlaybackLogRef.current.target !== logKey ||
            now - lastActivePlaybackLogRef.current.at > 30000)
        ) {
          lastActivePlaybackLogRef.current = { at: now, target: logKey };
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
        return true;
      } catch (error) {
        console.warn("[First Listen player] Could not read YouTube telemetry", error);
        return false;
      }
    },
    [emitTelemetry, iframeSrc],
  );

  useEffect(() => {
    const mountedAt = timestamp();
    mountCountRef.current += 1;
    onLifecycleDebug?.({
      currentIframeSrc: iframeRef.current?.src ?? null,
      iframeLoadCount: iframeLoadCountRef.current,
      mountCount: mountCountRef.current,
      renderCount: renderCountRef.current,
      transition: "PLAYER_MOUNT",
      unmountCount: unmountCountRef.current,
      youtubeCleanupCount: youtubeCleanupCountRef.current,
    });
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
      songLoadedAt: initialMountLogRef.current.songLoadedAt,
      title: initialMountLogRef.current.title,
    });
    const mountedIframe = iframeRef.current;
    return () => {
      unmountCountRef.current += 1;
      onLifecycleDebug?.({
        currentIframeSrc: mountedIframe?.src ?? null,
        iframeLoadCount: iframeLoadCountRef.current,
        mountCount: mountCountRef.current,
        renderCount: renderCountRef.current,
        transition: "PLAYER_UNMOUNT",
        unmountCount: unmountCountRef.current,
        youtubeCleanupCount: youtubeCleanupCountRef.current,
      });
    };
  }, [onLifecycleDebug]);

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
      setPlaybackState("loading");
      setCurrentTime(0);
      setDuration(0);
      setShowAutoplayFallback(false);
      return;
    }

    setStatus("loading");
    setPlaybackState("loading");
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
    if (
      manualPauseRef.current ||
      !autoPlay ||
      status !== "ready" ||
      playbackState === "playing"
    ) {
      setShowAutoplayFallback(false);
      return;
    }
    if (embed?.telemetry === "youtube_iframe_api" && youtubePlayerRef.current) {
      const timeout = window.setTimeout(() => {
        if (!youtubePlayerRef.current) return;
        const targetKey = latestYouTubeTargetRef.current;
        try {
          const state = mapYouTubeState(youtubePlayerRef.current.getPlayerState());
          if (state !== "playing" && state !== "completed") {
            scheduleYouTubeAutoplayRetries(
              youtubePlayerRef.current,
              targetKey,
            );
          }
        } catch {
          // If YouTube cannot expose state yet, keep retrying without showing a tap prompt.
          scheduleYouTubeAutoplayRetries(youtubePlayerRef.current, targetKey);
        }
        setShowAutoplayFallback(false);
      }, 2500);
      return () => window.clearTimeout(timeout);
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
  }, [
    autoPlay,
    embed?.telemetry,
    playbackState,
    scheduleYouTubeAutoplayRetries,
    status,
  ]);

  const requestPlayback = useCallback(() => {
    manualPauseRef.current = false;
    setShowAutoplayFallback(false);
    lastInteractionAtRef.current = Date.now();
    try {
      if (youtubePlayerRef.current) {
        const state = mapYouTubeState(youtubePlayerRef.current.getPlayerState());
        if (state !== "playing") {
          youtubePlayerRef.current.playVideo();
        }
        scheduleYouTubeAutoplayRetries(
          youtubePlayerRef.current,
          latestYouTubeTargetRef.current,
        );
      }
      spotifyControllerRef.current?.play();
      soundCloudWidgetRef.current?.play();
    } catch (error) {
      console.info("[First Listen player] Playback request was deferred", error);
    }
  }, [scheduleYouTubeAutoplayRetries]);

  const pausePlayback = useCallback(() => {
    manualPauseRef.current = true;
    clearAutoplayRetryTimers();
    setShowAutoplayFallback(false);
    const progress = providerProgressRef.current;
    try {
      youtubePlayerRef.current?.pauseVideo();
      spotifyControllerRef.current?.pause();
      soundCloudWidgetRef.current?.pause();
      setPlaybackState((current) =>
        current === "playing" ? "paused" : current,
      );
      emitTelemetry(
        "paused",
        progress.currentTime,
        progress.duration,
        mutedRef.current,
        volumeRef.current,
        Boolean(embed && !externalContent && embed.telemetry !== "spotify_iframe_api"),
      );
    } catch (error) {
      console.info("[First Listen player] Pause request was deferred", error);
    }
  }, [
    clearAutoplayRetryTimers,
    embed,
    emitTelemetry,
    externalContent,
  ]);

  useEffect(() => {
    if (!controlChannel) return;
    const handleCommand = (event: Event) => {
      const detail = (
        event as CustomEvent<WorkspaceV2PlaybackCommandDetail>
      ).detail;
      if (detail?.channel !== controlChannel) return;
      if (detail.command === "play") {
        if (detail.source === "user-click") {
          lastTrustedPlayCommandAtRef.current = detail.issuedAt ?? Date.now();
          requestPlayback();
          return;
        }
        const recentlyHandledTrustedPlay =
          lastTrustedPlayCommandAtRef.current > 0 &&
          Date.now() - lastTrustedPlayCommandAtRef.current <
            USER_CLICK_PLAY_DEDUPE_MS;
        if (detail.source === "state-machine" && recentlyHandledTrustedPlay) {
          return;
        }
        requestPlayback();
      }
      if (detail.command === "pause") pausePlayback();
    };

    window.addEventListener(WORKSPACE_V2_PLAYBACK_COMMAND_EVENT, handleCommand);
    return () =>
      window.removeEventListener(
        WORKSPACE_V2_PLAYBACK_COMMAND_EVENT,
        handleCommand,
      );
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

  const markProviderError = useCallback(
    (supported = false) => {
      clearAutoplayRetryTimers();
      const progress = providerProgressRef.current;
      setStatus("error");
      setPlaybackState("error");
      setShowAutoplayFallback(false);
      emitTelemetry(
        "error",
        progress.currentTime,
        progress.duration,
        mutedRef.current,
        volumeRef.current,
        supported,
      );
    },
    [clearAutoplayRetryTimers, emitTelemetry],
  );

  useEffect(() => {
    if (!clientOrigin) return;
    if (!embed) {
      if (externalContent) {
        setStatus("ready");
        setPlaybackState("paused");
        setCurrentTime(0);
        setDuration(0);
        setMuted(null);
        setVolume(null);
        setShowAutoplayFallback(false);
        emitTelemetry("paused", 0, 0, null, null, false);
        console.info("[First Listen player] External provider uses outbound playback", {
          link,
          platform,
          songLoadedAt,
          title,
        });
        return;
      }
      markProviderError(false);
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
    emitTelemetry,
    markProviderError,
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
      markProviderError(false);
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
              emitTelemetry("ready", 0, 0, null, null, false);
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
                ? "completed"
                : event.data.isBuffering
                  ? "loading"
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
        markProviderError(false);
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
  }, [autoPlay, embed, emitTelemetry, link, markProviderError, title]);

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

      markProviderError(Boolean(embed && !externalContent));
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
    externalContent,
    initializationAttempt,
    link,
    loadedEmbedSrc,
    markProviderError,
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

    loadYouTubeApi()
      .then((api) => {
        if (disposed || !iframeRef.current) return;
        new api.Player(iframeRef.current, {
          events: {
            onError: (event) => {
              if (disposed) return;
              markProviderError(true);
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
              player = event.target;
              youtubePlayerRef.current = event.target;
              youtubePlaybackTargetRef.current =
                latestYouTubeTargetRef.current;
              const readyAt = timestamp();
              setProviderReadyAt(readyAt);
              setStatus("ready");
              onReadyRef.current?.();
              readYouTubeTelemetry(event.target);
              if (autoPlayRef.current) {
                scheduleYouTubeAutoplayRetries(
                  event.target,
                  latestYouTubeTargetRef.current,
                );
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
            },
            onStateChange: (event) => readYouTubeTelemetry(event.target),
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
          markProviderError(true);
        }
      });

    const cleanupIframe = iframeRef.current;
    return () => {
      disposed = true;
      clearAutoplayRetryTimers();
      youtubeCleanupCountRef.current += 1;
      onLifecycleDebug?.({
        currentIframeSrc: cleanupIframe?.src ?? null,
        details: iframeSrc,
        iframeLoadCount: iframeLoadCountRef.current,
        mountCount: mountCountRef.current,
        renderCount: renderCountRef.current,
        transition: "YOUTUBE_CLEANUP",
        unmountCount: unmountCountRef.current,
        youtubeCleanupCount: youtubeCleanupCountRef.current,
      });
      const playerToDestroy = player ?? youtubePlayerRef.current;
      if (youtubePlayerRef.current === playerToDestroy) {
        youtubePlayerRef.current = null;
      }
      youtubePlaybackTargetRef.current = null;
      window.setTimeout(() => {
        try {
          playerToDestroy?.destroy();
        } catch {
          // React may already have removed the iframe. The important part is
          // releasing the YouTube API wrapper after React has reconciled.
        }
      }, 0);
    };
  }, [
    clearAutoplayRetryTimers,
    iframeSrc,
    iframeLoadedAt,
    initializationAttempt,
    loadedEmbedSrc,
    markProviderError,
    onLifecycleDebug,
    playerMountedAt,
    readYouTubeTelemetry,
    scheduleYouTubeAutoplayRetries,
    youtubeTelemetryActive,
  ]);

  useEffect(() => {
    if (
      !youtubeTelemetryActive ||
      status !== "ready" ||
      !youtubePlayerRef.current
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      readYouTubeTelemetry();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [
    readYouTubeTelemetry,
    status,
    youtubeTelemetryActive,
    youtubeTargetKey,
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
    setPlaybackState("loading");
    setCurrentTime(0);
    setDuration(0);
    emitTelemetry("loading", 0, 0, muted, volume, true);

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
        scheduleYouTubeAutoplayRetries(player, youtubeTargetKey);
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
      if (autoPlay) setShowAutoplayFallback(false);
    }
  }, [
    autoPlay,
    embed,
    emitTelemetry,
    muted,
    platform,
    scheduleYouTubeAutoplayRetries,
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
              setPlaybackState("completed");
              setDuration(nextDuration);
              setCurrentTime(nextDuration);
              setMuted(nextMuted);
              setVolume(nextVolume);
              emitTelemetry(
                "completed",
                nextDuration,
                nextDuration,
                nextMuted,
                nextVolume,
                true,
              );
            });
          });
        };
        const failed = () => markProviderError(true);

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
        markProviderError(true);
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
  }, [
    autoPlay,
    embed,
    emitTelemetry,
    loadedEmbedSrc,
    markProviderError,
    platform,
    title,
  ]);

  const playerLoaded = () => {
    if (!embed || !iframeSrc) return;
    const loadedAt = timestamp();
    iframeLoadCountRef.current += 1;
    setLoadedEmbedSrc(iframeSrc);
    setIframeLoadedAt(loadedAt);
    onLifecycleDebug?.({
      currentIframeSrc: iframeSrc,
      iframeLoadCount: iframeLoadCountRef.current,
      mountCount: mountCountRef.current,
      renderCount: renderCountRef.current,
      transition: "IFRAME_LOADED",
      unmountCount: unmountCountRef.current,
      youtubeCleanupCount: youtubeCleanupCountRef.current,
    });
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
        "ready",
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
    markProviderError(Boolean(embed && !externalContent));
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
    emitTelemetry("ready", 0, 0, null, null, false);
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
          src={safeCoverUrl(coverUrl)}
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
          src={safeCoverUrl(coverUrl)}
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
          allowFullScreen
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
