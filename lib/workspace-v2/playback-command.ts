export const WORKSPACE_V2_PLAYBACK_COMMAND_EVENT =
  "first-listen:playback-command";

export const WORKSPACE_V2_PLAYBACK_COMMAND_CHANNEL = "workspace-v2";

export type WorkspaceV2PlaybackDomCommand = "pause" | "play" | "seek";

export type WorkspaceV2PlaybackCommandDetail = {
  autoPlay?: boolean;
  channel?: string;
  command?: WorkspaceV2PlaybackDomCommand;
  issuedAt?: number;
  seconds?: number;
  source?: "state-machine" | "user-click";
};

export function dispatchWorkspaceV2PlaybackCommand(
  command: WorkspaceV2PlaybackDomCommand,
  {
    autoPlay,
    channel = WORKSPACE_V2_PLAYBACK_COMMAND_CHANNEL,
    seconds,
    source = "state-machine",
  }: {
    autoPlay?: boolean;
    channel?: string;
    seconds?: number;
    source?: WorkspaceV2PlaybackCommandDetail["source"];
  } = {},
) {
  if (typeof window === "undefined") return false;
  window.dispatchEvent(
    new CustomEvent<WorkspaceV2PlaybackCommandDetail>(
      WORKSPACE_V2_PLAYBACK_COMMAND_EVENT,
      {
        detail: {
          channel,
          command,
          issuedAt: Date.now(),
          autoPlay,
          seconds,
          source,
        },
      },
    ),
  );
  return true;
}
