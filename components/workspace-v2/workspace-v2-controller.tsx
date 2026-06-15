"use client";

import { useCallback, useMemo, useReducer } from "react";
import {
  activeWorkspaceV2Song,
  initialWorkspaceV2PlaybackState,
  initialWorkspaceV2QueueState,
  initialWorkspaceV2TelemetryState,
  initialWorkspaceV2ValidationState,
  reduceWorkspaceV2Playback,
  reduceWorkspaceV2Queue,
  reduceWorkspaceV2Telemetry,
  reduceWorkspaceV2Validation,
  workspaceV2CanAdvance,
  workspaceV2QueuePosition,
  workspaceV2RemainingSongs,
  type WorkspaceV2PlaybackMachineEvent,
  type WorkspaceV2PlaybackMachineState,
  type WorkspaceV2ProviderEvent,
  type WorkspaceV2Queue,
  type WorkspaceV2QueueMachineEvent,
  type WorkspaceV2QueueMachineState,
  type WorkspaceV2TelemetryEvent,
  type WorkspaceV2TelemetryState,
  type WorkspaceV2ValidationEvent,
  type WorkspaceV2ValidationState,
} from "@/lib/workspace-v2";

type WorkspaceV2ControllerState = {
  playback: WorkspaceV2PlaybackMachineState;
  queue: WorkspaceV2QueueMachineState;
  telemetry: WorkspaceV2TelemetryState;
  validation: WorkspaceV2ValidationState;
};

type WorkspaceV2ControllerAction =
  | { type: "playback"; event: WorkspaceV2PlaybackMachineEvent }
  | { type: "queue"; event: WorkspaceV2QueueMachineEvent }
  | { type: "validation"; event: WorkspaceV2ValidationEvent }
  | { type: "telemetry"; event: WorkspaceV2TelemetryEvent }
  | { type: "load_queue"; at: number; autoPlay: boolean; queue: WorkspaceV2Queue; startIndex?: number }
  | { type: "provider_event"; event: WorkspaceV2ProviderEvent }
  | { type: "next"; at: number; reason: "ended" | "next" | "skip" | "error" };

const initialWorkspaceV2ControllerState: WorkspaceV2ControllerState = {
  playback: initialWorkspaceV2PlaybackState,
  queue: initialWorkspaceV2QueueState,
  telemetry: initialWorkspaceV2TelemetryState,
  validation: initialWorkspaceV2ValidationState,
};

function reduceWorkspaceV2Controller(
  state: WorkspaceV2ControllerState,
  action: WorkspaceV2ControllerAction,
): WorkspaceV2ControllerState {
  switch (action.type) {
    case "playback":
      return {
        ...state,
        playback: reduceWorkspaceV2Playback(state.playback, action.event),
      };

    case "queue":
      return {
        ...state,
        queue: reduceWorkspaceV2Queue(state.queue, action.event),
      };

    case "validation":
      return {
        ...state,
        validation: reduceWorkspaceV2Validation(
          state.validation,
          action.event,
        ),
      };

    case "telemetry":
      return {
        ...state,
        telemetry: reduceWorkspaceV2Telemetry(state.telemetry, action.event),
      };

    case "load_queue": {
      const queue = reduceWorkspaceV2Queue(state.queue, {
        at: action.at,
        queue: action.queue,
        startIndex: action.startIndex,
        type: "load_queue",
      });
      const song = activeWorkspaceV2Song(queue);
      if (!song) return { ...state, queue };
      const validation = reduceWorkspaceV2Validation(state.validation, {
        at: action.at,
        song,
        type: "start",
      });
      return {
        playback: reduceWorkspaceV2Playback(state.playback, {
          at: action.at,
          autoPlay: action.autoPlay,
          song,
          type: "load",
        }),
        queue,
        telemetry: reduceWorkspaceV2Telemetry(state.telemetry, {
          at: action.at,
          type: "reset",
        }),
        validation,
      };
    }

    case "provider_event": {
      const event = action.event;
      if (event.type === "ready") {
        return {
          ...state,
          playback: reduceWorkspaceV2Playback(state.playback, {
            at: event.at,
            type: "provider_ready",
          }),
        };
      }
      if (event.type === "error") {
        return {
          ...state,
          playback: reduceWorkspaceV2Playback(state.playback, {
            at: event.at,
            message: event.message,
            type: "provider_error",
          }),
        };
      }
      const playback =
        event.type === "completed"
          ? reduceWorkspaceV2Playback(state.playback, {
              at: event.at,
              snapshot: event.snapshot,
              type: "provider_completed",
            })
          : reduceWorkspaceV2Playback(state.playback, {
              at: event.at,
              snapshot: event.snapshot,
              type: "provider_snapshot",
            });
      const validation = reduceWorkspaceV2Validation(state.validation, {
        at: event.at,
        snapshot: event.snapshot,
        type: "sample",
      });
      const telemetry = reduceWorkspaceV2Telemetry(state.telemetry, {
        at: event.at,
        snapshot: event.snapshot,
        type: "validated_sample",
        validation,
      });
      return {
        ...state,
        playback,
        telemetry,
        validation,
      };
    }

    case "next": {
      const queue = reduceWorkspaceV2Queue(state.queue, {
        at: action.at,
        reason: action.reason,
        type: "advance",
      });
      const song = activeWorkspaceV2Song(queue);
      if (!song) {
        return {
          ...state,
          playback: reduceWorkspaceV2Playback(state.playback, {
            at: action.at,
            type: "stop",
          }),
          queue,
        };
      }
      return {
        playback: reduceWorkspaceV2Playback(state.playback, {
          at: action.at,
          autoPlay: true,
          song,
          type: "load",
        }),
        queue,
        telemetry: reduceWorkspaceV2Telemetry(state.telemetry, {
          at: action.at,
          type: "reset",
        }),
        validation: reduceWorkspaceV2Validation(state.validation, {
          at: action.at,
          song,
          type: "start",
        }),
      };
    }

    default:
      return state;
  }
}

export function useWorkspaceV2Controller() {
  const [state, dispatch] = useReducer(
    reduceWorkspaceV2Controller,
    initialWorkspaceV2ControllerState,
  );

  const loadQueue = useCallback(
    (queue: WorkspaceV2Queue, options: { autoPlay?: boolean; startIndex?: number } = {}) => {
      dispatch({
        at: Date.now(),
        autoPlay: options.autoPlay ?? false,
        queue,
        startIndex: options.startIndex,
        type: "load_queue",
      });
    },
    [],
  );

  const play = useCallback(() => {
    dispatch({ event: { at: Date.now(), type: "user_play" }, type: "playback" });
  }, []);

  const pause = useCallback(() => {
    dispatch({ event: { at: Date.now(), type: "user_pause" }, type: "playback" });
  }, []);

  const next = useCallback((reason: "ended" | "next" | "skip" | "error" = "next") => {
    dispatch({ at: Date.now(), reason, type: "next" });
  }, []);

  const handleProviderEvent = useCallback((event: WorkspaceV2ProviderEvent) => {
    dispatch({ event, type: "provider_event" });
    if (event.type === "completed") {
      dispatch({ at: event.at, reason: "ended", type: "next" });
    }
  }, []);

  return useMemo(
    () => ({
      activeSong: activeWorkspaceV2Song(state.queue),
      canAdvance: workspaceV2CanAdvance(state.queue),
      handleProviderEvent,
      loadQueue,
      next,
      pause,
      play,
      playback: state.playback,
      position: workspaceV2QueuePosition(state.queue),
      queue: state.queue,
      remainingSongs: workspaceV2RemainingSongs(state.queue),
      telemetry: state.telemetry,
      validation: state.validation,
    }),
    [handleProviderEvent, loadQueue, next, pause, play, state],
  );
}
