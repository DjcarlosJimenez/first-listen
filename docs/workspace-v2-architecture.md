# Workspace V2 Architecture

Workspace V2 is being built beside the current Workspace so production behavior can remain stable until the new pipeline passes authenticated browser verification.

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
