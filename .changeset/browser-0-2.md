---
'@luna-estelar/gas-browser': minor
---

Rewritten as generic browser infrastructure for any site: a session, a playback engine and
helpers, with no connector dependency and no key handling.

- `./session`: `createBrowserSession({ connector, settings, context?, prebufferSeconds?, capture?, engine?, renderer? })`
  composes the api, the renderer and the audio engine around any connector the host passes in.
  `audiblePosition()` reports the bar and beat the listener is hearing, through the renderer's
  `positionAtSeconds`. The session flushes audio on a host stop or renderer failure and plays out
  the tail of a completed piece. It exports `version`.
- `./audio`: `PlaybackEngine` and `ChainedSourceEngine`, which chains `AudioBufferSourceNode`s on
  exact output frames behind a prebuffer (one chunk duration by default) and counts underruns.
  This fixes the dropout on every chunk boundary (LE-89). Also `AudioClock`, `openAudioContext`
  and `detectSupport`.
- `./capture`: `PcmCapture`, `decodeS16lePcm` and `encodeWave`, moved from `./audio`.
- `./timeline`: `positionSeconds` delegates to Core's `positionToTime`. A beat is the meter's
  `beatUnit` note, so 6/8 positions no longer scale by `4 / beatUnit`.

Removed: `./wiring` (use `./session`), `./access` and `./config` (the host builds connector
settings itself; a key the visitor pastes and one the site fetches arrive the same way),
`./playback` (use `./audio`), and `./bitsy/*`. The Bitsy integration moves to the website and
remains in git history at `packages/browser/src/bitsy` in commit `e85f15e`.
