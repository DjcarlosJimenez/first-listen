# First Listen Provider Playback Capability Audit

Audited June 9, 2026. This matrix distinguishes provider API capability from
what can be trusted for First Listen reward accounting.

| Capability | YouTube / YouTube Music | Spotify Embed | SoundCloud | Apple Music Embed |
| --- | --- | --- | --- | --- |
| Play state | Yes | Yes | Yes | No |
| Pause state | Yes | Yes | Yes | No |
| Current position | Yes | Yes | Yes | No |
| Duration | Yes | Yes | Yes | No |
| Completion percentage | Derived | Derived | Derived | No |
| Playback completion | Yes | Derived | Yes | No |
| Seeking | Detectable | Yes | Yes | No |
| Volume | Yes | No | Yes | No |
| Mute state | Yes | No | Derived from volume | No |
| Eligible for verified rewards | Yes | No | Yes | No |

## Reward decision

First Listen requires active playback, audible volume, a visible and focused
tab, recent user interaction, forward progress, and non-replayed provider
positions. A provider remains playable when it cannot expose every signal, but
it does not earn verified Listening Bank time.

Spotify exposes position, duration, pause state, buffering state, and seeking
through `playback_update`, but its Embed IFrame API does not expose volume or
mute state. Apple Music's unauthenticated embed does not provide a documented
parent-page playback telemetry API. MusicKit on the Web is a different,
authorized integration and is not used by First Listen.

## Valid Listen rule

The required duration is:

```text
min(120 seconds, max(30 seconds, 25% of content duration))
```

Examples:

| Content duration | Valid Listen requirement |
| --- | --- |
| 2:00 | 0:30 |
| 3:00 | 0:45 |
| 4:00 | 1:00 |
| 5:00 | 1:15 |
| 8:00 | 2:00 |
| 10:00 | 2:00 |
| 15:00 | 2:00 |

Verified time is stored as whole seconds and always rounded down. It is never
rounded upward.

## Primary documentation

- YouTube IFrame Player API:
  https://developers.google.com/youtube/iframe_api_reference
- Spotify Embed IFrame API:
  https://developer.spotify.com/documentation/embeds/references/iframe-api
- SoundCloud Widget API:
  https://developers.soundcloud.com/docs/api/html5-widget
- Apple MusicKit:
  https://developer.apple.com/musickit/
