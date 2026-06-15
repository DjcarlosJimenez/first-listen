"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  WorkspaceV2ProviderEvent,
  WorkspaceV2ProviderSnapshot,
  WorkspaceV2Song,
  WorkspaceV2ValidationState,
} from "@/lib/workspace-v2";

export type WorkspaceV2EconomyMode = "sandbox" | "live";

export type WorkspaceV2EconomyBridgeState = {
  availableRewardCredits: number;
  bankSeconds: number;
  bridgeStatus:
    | "disabled"
    | "idle"
    | "starting"
    | "active"
    | "credited"
    | "claiming"
    | "error";
  credits: number;
  dailySecondsRemaining: number;
  lastClaimedCredits: number;
  lastSecondsCounted: number;
  lastUpdatedAt: number;
  minutesPerCredit: number;
  secondsToNextCredit: number;
  sessionId: string | null;
  sessionVerifiedSeconds: number;
  todayCompleteListens: number;
  todayListeningSeconds: number;
  todayValidListens: number;
  totalCompleteListens: number;
  totalCreditsEarned: number;
  totalValidListens: number;
  validListenRecorded: boolean;
  warning: string;
};

const initialEconomyBridgeState: WorkspaceV2EconomyBridgeState = {
  availableRewardCredits: 0,
  bankSeconds: 0,
  bridgeStatus: "idle",
  credits: 0,
  dailySecondsRemaining: 0,
  lastClaimedCredits: 0,
  lastSecondsCounted: 0,
  lastUpdatedAt: 0,
  minutesPerCredit: 40,
  secondsToNextCredit: 0,
  sessionId: null,
  sessionVerifiedSeconds: 0,
  todayCompleteListens: 0,
  todayListeningSeconds: 0,
  todayValidListens: 0,
  totalCompleteListens: 0,
  totalCreditsEarned: 0,
  totalValidListens: 0,
  validListenRecorded: false,
  warning: "",
};

function isCountingSnapshot(snapshot: WorkspaceV2ProviderSnapshot) {
  return (
    snapshot.supported &&
    (snapshot.playbackState === "playing" ||
      snapshot.playbackState === "completed") &&
    !snapshot.muted &&
    (snapshot.volume ?? 100) > 0 &&
    snapshot.duration > 0
  );
}

function heartbeatState(snapshot: WorkspaceV2ProviderSnapshot) {
  return snapshot.playbackState === "completed" ? "ended" : "playing";
}

function secondsToNextReward(bankSeconds: number, minutesPerCredit: number) {
  const exchangeSeconds = Math.max(1, minutesPerCredit * 60);
  const remainder = bankSeconds % exchangeSeconds;
  if (bankSeconds >= exchangeSeconds && remainder === 0) return 0;
  return exchangeSeconds - remainder;
}

type ListeningStatusRow = {
  available_reward_credits?: number | string | null;
  bank_seconds?: number | string | null;
  complete_listens?: number | string | null;
  community_points?: number | string | null;
  daily_cap_minutes?: number | string | null;
  minutes_per_credit?: number | string | null;
  seconds_to_next_credit?: number | string | null;
  today_complete_listens?: number | string | null;
  today_seconds?: number | string | null;
  today_valid_listens?: number | string | null;
  valid_listens?: number | string | null;
};

type ProfileCreditRow = {
  credits?: number | string | null;
  total_review_credits_earned?: number | string | null;
};

function firstRow<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function useWorkspaceV2EconomyBridge({
  mode,
  validation,
}: {
  mode: WorkspaceV2EconomyMode;
  validation: WorkspaceV2ValidationState;
}) {
  const [state, setState] = useState<WorkspaceV2EconomyBridgeState>(() => ({
    ...initialEconomyBridgeState,
    bridgeStatus: mode === "live" ? "idle" : "disabled",
  }));
  const currentSongIdRef = useRef<string | null>(null);
  const heartbeatInFlightRef = useRef(false);
  const heartbeatIntervalSecondsRef = useRef(15);
  const interactionGraceSecondsRef = useRef(300);
  const lastHeartbeatAtRef = useRef(0);
  const lastInteractionAtRef = useRef(Date.now());
  const sessionIdRef = useRef<string | null>(null);
  const startingSessionRef = useRef(false);

  const enabled = mode === "live";

  const refreshEconomyStatus = useCallback(async () => {
    if (!enabled) return;
    const supabase = createClient();
    if (!supabase) {
      setState((current) => ({
        ...current,
        bridgeStatus: "error",
        warning: "Supabase client is not configured.",
      }));
      return;
    }

    const [{ data: statusRows }, { data: userResult }] = await Promise.all([
      supabase.rpc("get_listening_bank_status_v2"),
      supabase.auth.getUser(),
    ]);
      const status = firstRow(statusRows as ListeningStatusRow[] | ListeningStatusRow | null);
    let profile: ProfileCreditRow | null = null;
    const userId = userResult.user?.id;
    if (userId) {
      const { data } = await supabase
        .from("profiles")
        .select("credits, total_review_credits_earned")
        .eq("id", userId)
        .maybeSingle();
      profile = data as ProfileCreditRow | null;
    }

    setState((current) => {
      const minutesPerCredit = Number(status?.minutes_per_credit ?? 40);
      const bankSeconds = Number(status?.bank_seconds ?? current.bankSeconds);
      return {
        ...current,
        availableRewardCredits: Number(
          status?.available_reward_credits ?? current.availableRewardCredits,
        ),
        bankSeconds,
        credits: Number(profile?.credits ?? current.credits),
        dailySecondsRemaining:
          Number(status?.daily_cap_minutes ?? 0) > 0
            ? Number(status?.daily_cap_minutes ?? 0) * 60
            : current.dailySecondsRemaining,
        lastUpdatedAt: Date.now(),
        minutesPerCredit,
        secondsToNextCredit: Number(
          status?.seconds_to_next_credit ??
            secondsToNextReward(bankSeconds, minutesPerCredit),
        ),
        todayCompleteListens: Number(
          status?.today_complete_listens ?? current.todayCompleteListens,
        ),
        todayListeningSeconds: Number(
          status?.today_seconds ?? current.todayListeningSeconds,
        ),
        todayValidListens: Number(
          status?.today_valid_listens ?? current.todayValidListens,
        ),
        totalCompleteListens: Number(
          status?.complete_listens ?? current.totalCompleteListens,
        ),
        totalCreditsEarned: Number(
          profile?.total_review_credits_earned ?? current.totalCreditsEarned,
        ),
        totalValidListens: Number(
          status?.valid_listens ?? current.totalValidListens,
        ),
      };
    });
  }, [enabled]);

  useEffect(() => {
    void refreshEconomyStatus();
  }, [refreshEconomyStatus]);

  const markInteraction = useCallback(() => {
    lastInteractionAtRef.current = Date.now();
  }, []);

  const resetForSong = useCallback(
    (song: WorkspaceV2Song | null) => {
      const nextSongId = song?.id ?? null;
      if (currentSongIdRef.current === nextSongId) return;
      currentSongIdRef.current = nextSongId;
      sessionIdRef.current = null;
      startingSessionRef.current = false;
      heartbeatInFlightRef.current = false;
      lastHeartbeatAtRef.current = 0;
      setState((current) => ({
        ...current,
        bridgeStatus: enabled ? "idle" : "disabled",
        lastSecondsCounted: 0,
        sessionId: null,
        sessionVerifiedSeconds: 0,
        validListenRecorded: false,
        warning: "",
      }));
    },
    [enabled],
  );

  const ensureSession = useCallback(
    async (song: WorkspaceV2Song) => {
      if (!enabled || song.playbackKind !== "internal") return null;
      if (sessionIdRef.current) return sessionIdRef.current;
      if (startingSessionRef.current) return null;

      const supabase = createClient();
      if (!supabase) {
        setState((current) => ({
          ...current,
          bridgeStatus: "error",
          warning: "Supabase client is not configured.",
        }));
        return null;
      }

      startingSessionRef.current = true;
      setState((current) => ({
        ...current,
        bridgeStatus: "starting",
        warning: "",
      }));
      const { data, error } = await supabase.rpc("start_listening_session", {
        target_song_id: song.id,
      });
      startingSessionRef.current = false;
      const row = firstRow(data as Record<string, unknown>[] | Record<string, unknown> | null);
      if (error || !row?.session_id) {
        setState((current) => ({
          ...current,
          bridgeStatus: "error",
          warning: error?.message ?? "Listening session could not start.",
        }));
        return null;
      }

      const sessionId = String(row.session_id);
      sessionIdRef.current = sessionId;
      heartbeatIntervalSecondsRef.current = Number(
        row.heartbeat_interval_seconds ?? 15,
      );
      interactionGraceSecondsRef.current = Number(
        row.interaction_grace_seconds ?? 300,
      );
      setState((current) => ({
        ...current,
        bridgeStatus: "active",
        dailySecondsRemaining: Number(row.daily_cap_seconds ?? 0),
        sessionId,
        warning: row.earning_eligible
          ? ""
          : "This provider cannot verify reward-eligible playback.",
      }));
      return sessionId;
    },
    [enabled],
  );

  const recordHeartbeat = useCallback(
    async (
      song: WorkspaceV2Song,
      snapshot: WorkspaceV2ProviderSnapshot,
      force = false,
    ) => {
      if (!enabled || song.playbackKind !== "internal") return;
      if (!isCountingSnapshot(snapshot)) return;
      const sessionId = await ensureSession(song);
      if (!sessionId || heartbeatInFlightRef.current) return;

      const now = Date.now();
      const heartbeatDue =
        force ||
        snapshot.playbackState === "completed" ||
        !lastHeartbeatAtRef.current ||
        now - lastHeartbeatAtRef.current >=
          heartbeatIntervalSecondsRef.current * 1000;
      if (!heartbeatDue) return;

      heartbeatInFlightRef.current = true;
      lastHeartbeatAtRef.current = now;
      const supabase = createClient();
      if (!supabase) {
        heartbeatInFlightRef.current = false;
        return;
      }

      const { data, error } = await supabase.rpc("record_listening_heartbeat", {
        target_session_id: sessionId,
        playback_position_seconds: snapshot.currentTime,
        playback_duration_seconds: snapshot.duration,
        playback_state: heartbeatState(snapshot),
        playback_muted: Boolean(snapshot.muted),
        playback_volume: snapshot.volume ?? 100,
        page_visible: snapshot.pageVisible ?? true,
        page_focused: snapshot.pageFocused ?? true,
        interaction_recent:
          now - lastInteractionAtRef.current <=
          interactionGraceSecondsRef.current * 1000,
      });
      heartbeatInFlightRef.current = false;

      const row = firstRow(data as Record<string, unknown>[] | Record<string, unknown> | null);
      if (error || !row) {
        setState((current) => ({
          ...current,
          bridgeStatus: "error",
          warning: error?.message ?? "Listening heartbeat failed.",
        }));
        return;
      }

      const secondsCounted = Number(row.seconds_counted ?? 0);
      const bankDelta = Math.max(0, secondsCounted);
      setState((current) => {
        const bankSeconds = current.bankSeconds + bankDelta;
        const exchangeSeconds = Math.max(1, current.minutesPerCredit * 60);
        return {
          ...current,
          availableRewardCredits: Math.floor(bankSeconds / exchangeSeconds),
          bankSeconds,
          bridgeStatus: bankDelta > 0 ? "credited" : "active",
          dailySecondsRemaining: Number(
            row.daily_seconds_remaining ?? current.dailySecondsRemaining,
          ),
          lastSecondsCounted: secondsCounted,
          lastUpdatedAt: Date.now(),
          secondsToNextCredit: secondsToNextReward(
            bankSeconds,
            current.minutesPerCredit,
          ),
          sessionVerifiedSeconds: Number(
            row.session_verified_seconds ?? current.sessionVerifiedSeconds,
          ),
          todayCompleteListens: current.todayCompleteListens,
          todayListeningSeconds: current.todayListeningSeconds + bankDelta,
          todayValidListens: current.todayValidListens,
          totalCompleteListens: current.totalCompleteListens,
          totalValidListens: current.totalValidListens,
          validListenRecorded: Boolean(
            row.valid_listen_recorded ?? current.validListenRecorded,
          ),
          warning: String(row.warning ?? ""),
        };
      });

      if (
        secondsCounted > 0 ||
        row.valid_listen_recorded ||
        row.complete_listen_recorded
      ) {
        void refreshEconomyStatus();
      }
    },
    [enabled, ensureSession, refreshEconomyStatus],
  );

  const handleProviderEvent = useCallback(
    (event: WorkspaceV2ProviderEvent, song: WorkspaceV2Song | null) => {
      if (!enabled || !song) return;
      resetForSong(song);
      if (
        event.type !== "playing" &&
        event.type !== "telemetry" &&
        event.type !== "completed"
      ) {
        return;
      }
      void recordHeartbeat(song, event.snapshot, event.type === "completed");
    },
    [enabled, recordHeartbeat, resetForSong],
  );

  const claimReward = useCallback(async () => {
    if (!enabled) return;
    const supabase = createClient();
    if (!supabase) return;
    setState((current) => ({ ...current, bridgeStatus: "claiming" }));
    const beforeCredits = state.credits;
    const { data, error } = await supabase.rpc("claim_listening_reward");
    const row = firstRow(data as Record<string, unknown>[] | Record<string, unknown> | null);
    if (error || !row) {
      setState((current) => ({
        ...current,
        bridgeStatus: "error",
        warning: error?.message ?? "Listening reward could not be claimed.",
      }));
      return;
    }
    setState((current) => {
      const bankSeconds = Number(row.bank_seconds ?? current.bankSeconds);
      const creditsAwarded = Number(row.credits_awarded ?? 1);
      return {
        ...current,
        availableRewardCredits: Number(row.available_reward_credits ?? 0),
        bankSeconds,
        bridgeStatus: "active",
        credits: Number(row.credits_balance ?? beforeCredits + creditsAwarded),
        lastClaimedCredits: creditsAwarded,
        lastUpdatedAt: Date.now(),
        secondsToNextCredit: secondsToNextReward(
          bankSeconds,
          current.minutesPerCredit,
        ),
        totalCreditsEarned: current.totalCreditsEarned + creditsAwarded,
        warning: "",
      };
    });
    void refreshEconomyStatus();
  }, [enabled, refreshEconomyStatus, state.credits]);

  return useMemo(
    () => ({
      claimReward,
      enabled,
      handleProviderEvent,
      markInteraction,
      refreshEconomyStatus,
      resetForSong,
      state: {
        ...state,
        validListenRecorded:
          state.validListenRecorded || validation.validListen,
      },
    }),
    [
      claimReward,
      enabled,
      handleProviderEvent,
      markInteraction,
      refreshEconomyStatus,
      resetForSong,
      state,
      validation.validListen,
    ],
  );
}
