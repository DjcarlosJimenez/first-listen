"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<YouTubeApi> | null = null;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube IFrame API loaded without Player support."));
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    if (existing) {
      existing.addEventListener(
        "error",
        () => reject(new Error("YouTube IFrame API failed to load.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.onerror = () => reject(new Error("YouTube IFrame API failed to load."));
    script.src = "https://www.youtube.com/iframe_api";
    document.head.append(script);
  });

  return youtubeApiPromise;
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

export function ProviderPlayer({
  artist,
  coverUrl,
  link,
  locale,
  platform,
  title,
}: {
  artist: string;
  coverUrl: string;
  link: string;
  locale: InterfaceLocale;
  platform: Platform;
  title: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [origin, setOrigin] = useState<string>();
  const embed = useMemo(
    () => getProviderEmbed(link, platform, origin),
    [link, origin, platform],
  );
  const [status, setStatus] = useState<PlayerStatus>(embed ? "loading" : "error");
  const [playbackState, setPlaybackState] = useState<PlaybackState>("unknown");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState<boolean | null>(null);
  const [volume, setVolume] = useState<number | null>(null);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const spanish = locale === "es";

  useEffect(() => {
    setOrigin(window.location.origin);
    setDebugEnabled(new URLSearchParams(window.location.search).get("debug") === "1");
  }, []);

  useEffect(() => {
    setStatus(embed ? "loading" : "error");
    setPlaybackState("unknown");
    setCurrentTime(0);
    setDuration(0);
    setMuted(null);
    setVolume(null);
    if (!embed) {
      console.error("[First Listen player] Unsupported or invalid provider URL", {
        link,
        platform,
        title,
      });
      return;
    }

    console.info("[First Listen player] Generated provider embed", {
      embedUrl: embed.src,
      link,
      platform,
      telemetry: embed.telemetry,
      title,
    });

    const timeout = window.setTimeout(() => {
      setStatus((current) => {
        if (current === "loading") {
          console.error("[First Listen player] Provider iframe timed out", {
            embedUrl: embed.src,
            link,
            platform,
            title,
          });
          return "error";
        }
        return current;
      });
    }, 15000);

    return () => window.clearTimeout(timeout);
  }, [embed, link, platform, title]);

  useEffect(() => {
    if (!embed || embed.telemetry !== "youtube_iframe_api" || !iframeRef.current) {
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
              setStatus("error");
              console.error("[First Listen player] YouTube API error", {
                code: event.data,
                embedUrl: embed.src,
                link,
                platform,
                title,
              });
            },
            onReady: (event) => {
              setStatus("ready");
              refreshTelemetry(event.target);
              console.info("[First Listen player] YouTube API ready", {
                embedUrl: embed.src,
                link,
                platform,
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
        console.error("[First Listen player] YouTube telemetry unavailable", {
          embedUrl: embed.src,
          error,
          link,
          platform,
          title,
        });
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
  }, [embed, link, platform, title]);

  const playerLoaded = () => {
    if (embed?.telemetry !== "youtube_iframe_api") setStatus("ready");
    console.info("[First Listen player] Provider iframe loaded", {
      embedUrl: embed?.src,
      platform,
      title,
    });
  };

  const playerFailed = () => {
    setStatus("error");
    console.error("[First Listen player] Provider iframe failed", {
      embedUrl: embed?.src,
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
          <div><dt>Provider</dt><dd>{platform}</dd></div>
          <div><dt>Embed URL</dt><dd>{embed?.src ?? "unavailable"}</dd></div>
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
