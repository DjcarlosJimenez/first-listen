# Workspace V2 Architecture Contract

Status: Architecture lock active.

This document is the contract for Workspace V2. No new Workspace V2 feature work should begin until changes are checked against this contract.

## North Star

Workspace V2 must become:

```mermaid
flowchart LR
  InternalDestination["Internal playback destination<br/>YouTube / YouTube Music today"]
  DiscoveryDestination["Discovery destination<br/>Spotify / Apple / TikTok / Bandcamp / Audiomack / external"]
  Shell["One Workspace Shell"]
  Queue["One Internal Queue Engine"]
  Playback["One Internal Playback Engine"]
  ProviderHost["One Internal Player Host"]
  Adapter["Internal Provider Adapter"]
  Validation["One Validation Machine"]
  Telemetry["One Telemetry Machine"]
  Rewards["Reward / Time Bank / Tokens"]
  Discovery["Discovery Actions<br/>follow / save / platform links"]

  InternalDestination -->|play internally| Shell
  Shell --> Queue
  Queue --> Playback
  Playback --> ProviderHost
  ProviderHost --> Adapter
  Adapter -->|normalized provider events| Playback
  Adapter -->|normalized snapshots| Validation
  Validation --> Telemetry
  Telemetry --> Shell
  Validation --> Rewards
  DiscoveryDestination -->|open/save/follow only| Discovery
  Discovery --> Shell
```

The product rule is simple:

One Shell. One Internal Player. One Queue Engine. Many Destinations.

Internal Playback and Discovery are separate concepts.

Internal Playback includes:

- Queue Engine.
- Playback Engine.
- Validation Engine.
- Telemetry Engine.
- Reward Engine.
- Time Bank.
- Submission Tokens.

Internal Playback applies only to internally playable content. Current internal providers:

- YouTube.
- YouTube Music.

Future internal providers may be added only if First Listen can still validate playback progress reliably enough for Time Bank and rewards.

Discovery includes:

- Follow Artist.
- Save Artist.
- Platform Presence Manager.
- Open External Destination.

Discovery destinations do not participate in:

- Queue Engine.
- Validation.
- Rewards.
- Time Bank.
- Submission Tokens.

External platforms such as Spotify, Apple Music, TikTok, Bandcamp, Audiomack, and other off-platform destinations are Discovery only unless they later provide reliable internal playback telemetry and are explicitly promoted to Internal Playback providers.

## Hard Rules

1. There is one Workspace Shell.
2. There is one Internal Queue Engine.
3. There is one Internal Playback Engine.
4. Internal provider-specific logic belongs only in internal provider adapters.
5. Discovery destinations cannot enter the Queue Engine.
6. Destination views cannot own playback, validation, provider lifecycle, or queue advancement.
7. The destination model must support future music, video, podcast, audiobook, and livestream content.

## Ownership Boundaries

### Workspace Shell

Owns:

- App-level workspace composition.
- Rendering the persistent player host.
- Rendering destination panels.
- Passing user intents to the controller.

Must not own:

- Provider-specific code.
- Queue advancement rules.
- Playback state transitions.
- Validation rules.
- Time Bank or token writes.

### Queue Engine

Authoritative file today:

- `lib/workspace-v2/queue-machine.ts`

Owns:

- Active internal queue.
- Current internal item.
- Next internal item.
- Internal queue position.
- Consumed internal item IDs.
- Internal queue refill policy.
- Internal queue advancement.

Forbidden elsewhere:

- Local `currentIndex` state.
- Local `remainingSongs` mutation.
- Destination-level `next song` logic.
- Provider-level queue advancement.
- External discovery links in queue state.

Queue input rule:

- The Queue Engine must accept only internally playable items.
- The Queue Engine must reject or filter Discovery-only items.
- Internal replay is preferable to falling back into external-only discovery.

### Playback Engine

Authoritative file today:

- `lib/workspace-v2/playback-machine.ts`

Owns:

- `loading`
- `ready`
- `playing`
- `paused`
- `completed`
- `error`
- Manual pause state.
- Provider command emission.

Forbidden elsewhere:

- Components creating their own playback state machine.
- Destination views deciding autoplay continuation.
- Provider adapters advancing the queue.

### Internal Provider Adapters

Own:

- Provider API loading.
- Provider iframe/player lifecycle.
- Provider-specific play/pause commands.
- Provider-specific cleanup.
- Provider-specific telemetry translation.

Must emit only normalized Workspace V2 events:

- `ready`
- `playing`
- `paused`
- `completed`
- `telemetry`
- `error`

Must not own:

- Queue decisions.
- Time Bank decisions.
- Reward decisions.
- Valid-listen decisions.
- Destination routing.
- Discovery destination opening.

### Validation Machine

Authoritative file today:

- `lib/workspace-v2/validation-machine.ts`

Owns:

- Whether playback is progressing.
- Whether playback is eligible.
- Fair Skip.
- Valid listen.
- Rejection reason.

Must consume only normalized provider snapshots. It must not import YouTube, Spotify, SoundCloud, Apple Music, TikTok, or any provider SDK type.

### Telemetry Machine

Authoritative file today:

- `lib/workspace-v2/telemetry-machine.ts`

Owns:

- UI-safe playback counters.
- Current progress.
- Live time.
- Reward-eligible seconds.
- Valid-listen display state.

Must consume validation output and normalized snapshots only.

## Internal Playback vs Discovery Contract

### Internal Playback

Internal Playback is the only path allowed to produce:

- Queue participation.
- Playback validation.
- Fair Skip.
- Time Bank progress.
- Reward eligibility.
- Submission token progress.

Internal Playback currently means:

- YouTube.
- YouTube Music.

SoundCloud is not guaranteed to be an Internal Playback provider unless its telemetry path is explicitly verified and promoted. Spotify, Apple Music, TikTok, Bandcamp, Audiomack, Instagram, Facebook Video, Amazon Music, Deezer, and generic external links are Discovery-only by default.

### Discovery

Discovery is the path for artist growth and off-platform traffic.

Discovery may:

- Display platform presence.
- Open an external platform link.
- Follow an artist.
- Save an artist or song.
- Share artist/song links.

Discovery must not:

- Enter the internal queue.
- Drive validation.
- Earn rewards.
- Increase Time Bank.
- Increase Submission Tokens.
- Trigger Fair Skip.
- Pretend external playback is internally verified.

## Destination Model Contract

The current type is still song-centered:

- `WorkspaceV2Song`
- `WorkspaceV2Queue`

This is acceptable only for the current preview. The production contract should migrate toward a generic playable item shape before Workspace V2 becomes the permanent shell.

Required future shape:

```ts
type WorkspaceDestinationKind =
  | "music"
  | "video"
  | "podcast"
  | "audiobook"
  | "livestream";

type WorkspaceDestinationRole = "internal_playback" | "discovery";

type WorkspacePlayableItem = {
  id: string;
  destinationKind: WorkspaceDestinationKind;
  destinationRole: WorkspaceDestinationRole;
  title: string;
  creatorName: string;
  creatorId?: string;
  artworkUrl?: string;
  durationSeconds?: number | null;
  canonicalUrl: string;
  primaryProvider: string;
  providerLinks: Array<{
    provider: string;
    url: string;
    playbackRole: "primary" | "destination";
  }>;
  discovery: {
    exposureScore?: number | null;
    lastConsumedAt?: number | null;
    source?: string;
  };
};
```

Queue logic must operate only on `WorkspacePlayableItem` records where `destinationRole === "internal_playback"`. Discovery records must stay outside the queue.

## Current Audit Findings

### Good

- `lib/workspace-v2/playback-machine.ts` is provider-agnostic and owns playback states.
- `lib/workspace-v2/queue-machine.ts` is separated from the UI and owns current internal item and advancement.
- `lib/workspace-v2/validation-machine.ts` consumes normalized snapshots rather than provider SDK objects.
- `lib/workspace-v2/telemetry-machine.ts` consumes validation output and normalized snapshots.
- `components/workspace-v2/workspace-v2-controller.tsx` is the current reducer bridge between machines.
- `/workspace-v2-preview` is Founder-only and sandboxed.

### Architecture Debt

1. `components/provider-player.tsx` is still a monolithic legacy player.

   It contains YouTube, Spotify, and SoundCloud API loading, iframe handling, telemetry, autoplay retries, active-playback events, cleanup, and provider-specific state in one component. This violates the final Internal Provider Adapter rule and is allowed only as a temporary bridge. Spotify behavior must not be treated as Internal Playback just because the legacy component contains Spotify code.

2. `components/workspace-v2/workspace-v2-provider-player-adapter.tsx` still wraps the legacy `ProviderPlayer`.

   It normalizes telemetry, which is good, but it also depends on platform display names and falls back to `YouTube Music`. That fallback is music-specific and should move into provider resolution, not the Workspace adapter.

3. `components/workspace-v2/workspace-v2-shell.tsx` is currently a preview shell, not the final shell.

   It includes diagnostics, memory timers, instrumentation logs, debug counters, and preview-only controls. These must be extracted into a preview diagnostics panel before production Workspace V2 switch.

4. `app/workspace-v2-preview/page.tsx` filters provider platforms directly.

   The preview currently filters `youtube_music`, `youtube`, and `soundcloud`, then filters by `playbackKind === "internal"`. This must be tightened so only explicitly verified Internal Playback providers enter V2 queues.

5. `lib/workspace-v2/types.ts` is song-centered.

   `WorkspaceV2Song` and music-specific queue sources are acceptable for Phase 1 preview only. The permanent architecture must support generic playable content.

6. `lib/workspace-v2/provider-interface.ts` defines a provider bus but is not yet the actual enforced boundary.

   The adapter currently uses `ProviderPlayer` props and browser `CustomEvent` commands. The final boundary should route provider commands and events through the provider interface or an equivalent typed controller boundary.

## Provider-Specific Code Audit

Provider-specific code currently exists in:

- `components/provider-player.tsx`
- `components/workspace-v2/workspace-v2-provider-player-adapter.tsx`
- `app/workspace-v2-preview/page.tsx`

Internal provider-specific code should eventually exist only in:

- `components/workspace-v2/providers/*`
- or `lib/workspace-v2/providers/*`

Allowed internal provider adapter responsibilities:

- Load provider SDK.
- Create provider player.
- Translate provider events to Workspace V2 events.
- Translate provider telemetry to Workspace V2 snapshots.
- Cleanup provider resources.

Forbidden internal provider adapter responsibilities:

- Queue refill.
- Queue advancement.
- Reward state.
- Valid listen.
- Time Bank.
- Destination navigation.
- External discovery link opening.

## Queue Duplication Audit

Current duplicated or risky queue-related code:

- Preview shell renders queue state and calls `controller.next()`.
- Controller dispatches `next`.
- Queue machine performs the actual advancement.

This is acceptable only because the shell is invoking an intent. The permanent rule is:

Destination and shell components may request `next`, but only the Queue Machine may change the queue.

No destination card, song card, provider component, or review component may mutate queue position.

No external discovery card may request queue entry. External cards may request only discovery actions such as follow, save, share, or open external destination.

## Playback Duplication Audit

Current duplicated or risky playback-related code:

- Playback Machine owns logical playback state.
- Legacy `ProviderPlayer` owns internal provider playback state for UI and provider mechanics.
- Workspace shell tracks debug state, last transition, and pipeline counters.

This is acceptable only in preview. The production rule is:

The Playback Machine owns application playback state. Provider components may keep private mechanical state only when needed to operate a provider SDK, but that state must be translated immediately into normalized events.

## Forbidden Imports

Destination views must not import:

- `components/provider-player`
- Provider SDK loaders.
- `reduceWorkspaceV2Queue`
- `reduceWorkspaceV2Playback`
- Provider-specific adapter files.

Provider adapters must not import:

- Queue machine reducers.
- Validation machine reducers.
- Telemetry machine reducers.
- Time Bank logic.
- Token economy logic.

Queue, playback, validation, and telemetry machines must not import:

- React.
- Supabase.
- Provider SDK types.
- UI components.

## Acceptance Gates Before Production Switch

Workspace V2 cannot replace production until:

- The final shell uses one persistent player host.
- Internal provider-specific code is isolated behind adapter boundaries.
- Queue advancement is only possible through the Queue Machine.
- Playback state is only owned by the Playback Machine.
- Validation receives only normalized provider snapshots.
- Queue input is limited to explicitly internal playable content.
- External Discovery is independent from Queue, Validation, Rewards, Time Bank, and Submission Tokens.
- Destination data supports `music`, `video`, `podcast`, `audiobook`, and `livestream`.
- `npm run workspace-v2:verify` passes.
- `npm run lint` passes.
- `npm run build` passes.
- Founder Preview confirms continuous playback without remount loops, stuck telemetry, duplicate players, or memory growth.

## Architecture Lock Decision

Workspace V2 may continue only with stabilization or contract-compliance work until these boundaries are respected.

Allowed next work:

- Split provider-specific code into provider adapters.
- Replace song-only types with generic playable destination types.
- Move preview diagnostics out of the production shell path.
- Route provider commands through a typed provider interface instead of global browser events.
- Add tests that enforce the import boundaries above.
- Add tests that reject Discovery-only items from Queue Engine input.

Blocked next work:

- New discovery features.
- New queue behaviors.
- New reward behaviors.
- New provider features.
- New UI surfaces unrelated to Workspace V2 stabilization.
