# Workspace V2 Architecture

Workspace V2 is being built beside the current Workspace so production behavior can remain stable until the new pipeline passes authenticated browser verification.

Architecture lock: use `docs/workspace-v2-architecture-contract.md` as the source of truth before adding any Workspace V2 feature work.

## Ownership Rules

- Playback Machine owns only playback state: `loading`, `ready`, `playing`, `paused`, `completed`, `error`.
- Queue Machine owns only queue state, current song, consumed songs, queue refill, and song advancement.
- Validation Machine consumes provider playback samples and decides valid listen, fair skip, completion, and rejection reason.
- Telemetry Machine consumes validation output and exposes UI-safe counters.
- Provider Interface is the only boundary between real providers and Workspace state.

## Explicit Non-Goals In Phase 1

- No database changes.
- No token economy changes.
- No Time Bank schema changes.
- No Discovery Hub changes.
- No Platform Presence Manager changes.
- No production switch yet.

## Verification Gate Before Production Switch

Workspace V2 can replace the current Workspace only after:

- `npm run workspace-v2:verify` passes.
- `npm run lint` passes.
- `npm run build` passes.
- Authenticated Founder browser validation confirms:
  - Play respects pause.
  - Next song advances through the Queue Machine only.
  - Autoplay advances internal songs without extra taps.
  - Time Live and Current Progress update from Telemetry Machine.
  - Valid listen and fair skip come from Validation Machine.
  - Long sessions do not leak timers, listeners, or provider instances.

## Current Status

Phase 1 has added the V2 machines and controller hook in parallel. The current production Workspace is not wired to V2 yet.

## Founder-Only Preview

- Route: `/workspace-v2-preview`
- Access: Founder #1 only.
- Mode: sandbox.
- Sandbox behavior: no token consumption, no Time Bank writes, and no production statistics updates.
- Instrumentation: playback state transitions, queue transitions, validation transitions, telemetry transitions, browser visibility changes, and memory snapshots.
- Required manual validation before production switch:
  - 20-song autoplay test.
  - 60-minute continuous playback test.
  - Chrome vs Edge parity test.
  - Validation tab-switch test.
  - 50-song long-session memory test.
