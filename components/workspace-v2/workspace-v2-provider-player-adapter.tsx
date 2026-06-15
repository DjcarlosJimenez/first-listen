"use client";

import { useEffect, useMemo } from "react";
import {
  ProviderPlayer,
  type ProviderTelemetrySnapshot,
} from "@/components/provider-player";
import type { InterfaceLocale } from "@/lib/catalog";
import { allPlatforms } from "@/lib/content-economy";
import type {
  WorkspaceV2ProviderCommand,
  WorkspaceV2ProviderEvent,
  WorkspaceV2Song,
} from "@/lib/workspace-v2";
import type { Platform } from "@/lib/types";

const DEFAULT_CHANNEL = "workspace-v2";

export type WorkspaceV2ProviderDebugEvent = {
  at?: number;
  details?: string;
  error?: string | null;
  providerLoaded?: boolean;
  providerPlaying?: boolean;
  providerReady?: boolean;
  transition?:
    | "LOAD_SONG"
    | "PLAY_REQUEST"
    | "PLAY_STARTED"
    | "PLAY_FAILED"
    | "PROVIDER_READY";
};

function toProviderPlatform(platform: string): Platform {
  return allPlatforms.includes(platform as Platform)
    ? (platform as Platform)
    : "YouTube Music";
}

function toWorkspaceV2Event(
  snapshot: ProviderTelemetrySnapshot,
): WorkspaceV2ProviderEvent {
  const at = Date.now();
  const timedSnapshot = { ...snapshot, at };
  if (snapshot.playbackState === "completed") {
    return { at, snapshot: timedSnapshot, type: "completed" };
  }
  if (snapshot.playbackState === "paused") {
    return { at, snapshot: timedSnapshot, type: "paused" };
  }
  if (snapshot.playbackState === "playing") {
    return { at, snapshot: timedSnapshot, type: "playing" };
  }
  if (snapshot.playbackState === "error") {
    return { at, message: "Provider playback error", type: "error" };
  }
  return { at, snapshot: timedSnapshot, type: "telemetry" };
}

export function WorkspaceV2ProviderPlayerAdapter({
  command,
  locale,
  onDebug,
  onEvent,
  song,
}: {
  command: WorkspaceV2ProviderCommand;
  locale: InterfaceLocale;
  onDebug?: (event: WorkspaceV2ProviderDebugEvent) => void;
  onEvent: (event: WorkspaceV2ProviderEvent) => void;
  song: WorkspaceV2Song | null;
}) {
  const activeSong = command.command === "load" ? command.song : song;
  const commandChannel = DEFAULT_CHANNEL;

  useEffect(() => {
    onDebug?.({
      at: Date.now(),
      details: activeSong
        ? `${activeSong.id} / ${activeSong.title} / ${activeSong.platform}`
        : "No active song",
      providerLoaded: Boolean(activeSong),
      providerPlaying: false,
      providerReady: false,
      transition: "LOAD_SONG",
    });
  }, [activeSong, onDebug]);

  useEffect(() => {
    if (command.command !== "play" && command.command !== "pause") return;
    if (command.command === "play") {
      onDebug?.({
        at: Date.now(),
        details: activeSong
          ? `${activeSong.id} / ${activeSong.title}`
          : "Play requested without active song",
        transition: "PLAY_REQUEST",
      });
    }
    try {
      window.dispatchEvent(
        new CustomEvent("first-listen:playback-command", {
          detail: {
            channel: commandChannel,
            command: command.command,
          },
        }),
      );
    } catch (error) {
      onDebug?.({
        at: Date.now(),
        error: error instanceof Error ? error.message : String(error),
        transition: "PLAY_FAILED",
      });
      throw error;
    }
  }, [activeSong, command, commandChannel, onDebug]);

  const providerPlatform = useMemo(
    () => (activeSong ? toProviderPlatform(activeSong.platform) : "YouTube Music"),
    [activeSong],
  );

  if (!activeSong) return null;

  return (
    <ProviderPlayer
      artist={activeSong.artist}
      autoPlay={command.command === "load" ? command.autoPlay : false}
      controlChannel={commandChannel}
      coverUrl={activeSong.coverUrl}
      link={activeSong.link}
      locale={locale}
      onReady={() => {
        const at = Date.now();
        onDebug?.({
          at,
          details: `${activeSong.id} / ${activeSong.title}`,
          providerLoaded: true,
          providerReady: true,
          transition: "PROVIDER_READY",
        });
        onEvent({ at, type: "ready" });
      }}
      onTelemetry={(snapshot) => {
        if (snapshot.playbackState === "playing") {
          onDebug?.({
            at: Date.now(),
            details: `${activeSong.id} / ${Math.round(snapshot.currentTime)}s`,
            providerLoaded: true,
            providerPlaying: true,
            providerReady: true,
            transition: "PLAY_STARTED",
          });
        }
        if (snapshot.playbackState === "error") {
          onDebug?.({
            at: Date.now(),
            error: "Provider telemetry reported error",
            providerLoaded: true,
            providerPlaying: false,
            providerReady: true,
            transition: "PLAY_FAILED",
          });
        }
        onEvent(toWorkspaceV2Event(snapshot));
      }}
      platform={providerPlatform}
      songLoadedAt={new Date().toISOString()}
      title={activeSong.title}
    />
  );
}
