---
'@luna-estelar/gas-lyria-rt': minor
---

The Lyria RealTime connector is on the 0.4 `connect()` interface, and each Play opens its own
socket.

- `createLyriaRtConnector({ apiKey, endpoint?, translate?, transition? })` takes what
  `createRenderer({ settings })` used to. It throws `lyria-rt-invalid-settings` for a bad option.
  `LyriaRtConnectorSettings` is now `LyriaRtConnectorOptions`.
- `apiKey` may be a function. It is called once per Play, so it can fetch a short-lived token. If
  it fails, Play rejects with `lyria-rt-api-key-unavailable`.
- `translate` replaces the prompt translation, and `transition` makes each connection's crossfade.
  If `translate` throws or returns a bad prompt, the change fails with `lyria-rt-translate-failed`.
- New exports: `LYRIA_RT_DESCRIPTION` and `openLyriaRtSession`, for building your own connector.
- `PromptTransition` loses `beginRun` and `endRun`, and gains `cancel()`.
- The connector reads `quarterNoteTempo` instead of converting the tempo itself.
- The description reports Lyria's measured warm `startupDelaySeconds` (1.2 s) and cold
  `initialStartupDelaySeconds` (5.4 s), covering the measured first-play maximum of 5.3 s.
