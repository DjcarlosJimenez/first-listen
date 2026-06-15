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
  onEvent,
  song,
}: {
  command: WorkspaceV2ProviderCommand;
  locale: InterfaceLocale;
  onEvent: (event: WorkspaceV2ProviderEvent) => void;
  song: WorkspaceV2Song | null;
}) {
  const activeSong = command.command === "load" ? command.song : song;
  const commandChannel = DEFAULT_CHANNEL;

  useEffect(() => {
    if (command.command !== "play" && command.command !== "pause") return;
    window.dispatchEvent(
      new CustomEvent("first-listen:playback-command", {
        detail: {
          channel: commandChannel,
          command: command.command,
        },
      }),
    );
  }, [command, commandChannel]);

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
      onReady={() => onEvent({ at: Date.now(), type: "ready" })}
      onTelemetry={(snapshot) => onEvent(toWorkspaceV2Event(snapshot))}
      platform={providerPlatform}
      songLoadedAt={new Date().toISOString()}
      title={activeSong.title}
    />
  );
}
