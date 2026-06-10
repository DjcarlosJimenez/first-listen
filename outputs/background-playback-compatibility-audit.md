# First Listen Background Playback Compatibility Audit

Date: June 10, 2026

## Product Decision

First Listen must not award listening time while the page is hidden, unfocused,
paused, muted, or otherwise unable to produce trustworthy live telemetry.
This remains true even when a provider continues audio after the screen turns
off. A PWA can improve installation and media controls, but it cannot bypass
provider iframe rules, browser autoplay policy, OS suspension, or timer
throttling.

## Provider Matrix

| Provider | Foreground telemetry | Background or screen-off confidence | First Listen classification |
| --- | --- | --- | --- |
| YouTube / YouTube Music | Strong: player state, time, duration, mute, volume, play and pause | Not reliable across mobile browsers; YouTube Music playlist links also need a resolvable video or playlist ID | Supported for visible, focused listening only |
| Spotify | Strong in supported embeds: paused/buffering state, position and duration | Autoplay and continued iframe execution vary by browser and user; do not credit background time | Supported for visible, focused listening only |
| SoundCloud | Strong: play/pause/finish/progress, position, duration and volume | Audio may continue in some environments, but parent-page telemetry and timers are not guaranteed | Supported for visible, focused listening only |
| Apple Music | Current First Listen integration is external/discovery-oriented; no trusted embedded telemetry path is implemented | Do not infer playback after opening Apple Music | Discovery only for listening rewards |
| TikTok | Official embed player exposes state, current time, duration, mute and volume through `postMessage` | Autoplay can fail due to browser policy and background execution is not guaranteed | Future foreground telemetry support; no listening rewards yet |

## Browser Matrix

| Browser | Screen off | Background tab | Autoplay continuation | Media Session / PWA |
| --- | --- | --- | --- | --- |
| Android Chrome | Provider-dependent and not guaranteed | Timers and iframe work may be throttled or suspended | Requires browser policy and often prior user interaction | Media Session can expose controls, but does not guarantee iframe telemetry |
| Samsung Internet | Chromium-based behavior is broadly similar, but provider embeds still control playback | Not trustworthy for reward accounting | User interaction should be assumed | PWA installation does not override provider or OS restrictions |
| iOS Safari | Audible autoplay requires user interaction; WebKit can pause media based on visibility and policy | Background execution is constrained | Muted autoplay is treated differently from audible playback | Home-screen installation does not create native background-audio guarantees |
| Chrome Mobile on iOS | Uses WebKit and therefore inherits iOS media restrictions | Not trustworthy for reward accounting | User interaction should be assumed | Same practical limitation as Safari for embedded providers |

## Implementation Consequences

1. Continue to require `document.visibilityState === "visible"` and window
   focus before adding verified listening seconds.
2. Treat provider-reported `playing` as necessary but not sufficient.
3. Do not use Media Session events as proof that audio was actually heard.
4. Do not award time from elapsed wall-clock time after a suspended tab wakes.
5. Keep Apple Music and current TikTok links out of listening rewards until
   end-to-end foreground telemetry is implemented and tested.
6. Test physical devices before changing any provider from foreground-only.

## Official References

- YouTube IFrame Player API:
  https://developers.google.com/youtube/iframe_api_reference
- Spotify iFrame API:
  https://developer.spotify.com/documentation/embeds/references/iframe-api
- SoundCloud Widget API:
  https://developers.soundcloud.com/docs/api/html5-widget
- Apple MusicKit JS:
  https://js-cdn.music.apple.com/musickit/v3/docs/index.html
- TikTok Embed Player:
  https://developers.tiktok.com/doc/embed-player
- Chrome autoplay policy:
  https://developer.chrome.com/blog/autoplay
- WebKit video policies:
  https://webkit.org/blog/6784/new-video-policies-for-ios/
- Media Session API compatibility:
  https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API
