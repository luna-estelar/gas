# @luna-estelar/gas-browser

## 0.2.0

### Minor Changes

- [`7187051`](https://github.com/luna-estelar/gas/commit/7187051bbee674c36d9ca492cdc54e8d6e386866) Thanks [@sathira10](https://github.com/sathira10)! - Rewritten as generic browser infrastructure for any site: a session, a playback engine and
  helpers, with no connector dependency and no key handling.

  - `./session`: `createBrowserSession({ connector, settings, context?, prebufferSeconds?, capture?, engine?, renderer? })`
    composes the api, the renderer and the audio engine around any connector the host passes in.
    `audiblePosition()` reports the bar and beat the listener is hearing, through the renderer's
    `positionAtSeconds`. The session flushes audio on a host stop or renderer failure and plays out
    the tail of a completed piece. It exports `version`.
  - `./audio`: `PlaybackEngine` and `ChainedSourceEngine`, which chains `AudioBufferSourceNode`s on
    exact, drift-free start times behind a prebuffer (one chunk duration by default) and counts underruns.
    This fixes the dropout on every chunk boundary (LE-89). Also `AudioClock`, `openAudioContext`
    and `detectSupport`.
  - `./capture`: `PcmCapture`, `decodeS16lePcm` and `encodeWave`, moved from `./audio`.
  - `./timeline`: `positionSeconds` delegates to Core's `positionToTime`. A beat is the meter's
    `beatUnit` note, so 6/8 positions no longer scale by `4 / beatUnit`.

  Removed: `./wiring` (use `./session`), `./access` and `./config` (the host builds connector
  settings itself; a key the visitor pastes and one the site fetches arrive the same way),
  `./playback` (use `./audio`), and `./bitsy/*`. The Bitsy integration moves to the website and
  remains in git history at `packages/browser/src/bitsy` in commit `e85f15e`.

### Patch Changes

- [`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439) Thanks [@sathira10](https://github.com/sathira10)! - Internal dependency ranges widened to caret, so each package can be released on its own.
- Updated dependencies [[`49e9774`](https://github.com/luna-estelar/gas/commit/49e977451a0f1aa0477b05e0d49e58edbbcc5776), [`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2), [`b98522b`](https://github.com/luna-estelar/gas/commit/b98522bb8a61fb00b5cbb2f4ca7e8f4557d07c7b), [`864382a`](https://github.com/luna-estelar/gas/commit/864382a00805593b954301351f3938e6e503fd74), [`49e9774`](https://github.com/luna-estelar/gas/commit/49e977451a0f1aa0477b05e0d49e58edbbcc5776), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2)]:
  - @luna-estelar/gas-api@0.2.0
  - @luna-estelar/gas-core@0.2.0
  - @luna-estelar/gas-language@0.1.2
  - @luna-estelar/gas-protocol@0.2.0
  - @luna-estelar/gas-renderer@0.2.0

## 0.1.1

### Patch Changes

- Released with the Protocol validator fix; no changes to this package.

## 0.1.0

### Minor Changes

- First public preview. The framework-free browser host, as explicit subpaths with no root
  barrel. Package APIs may change in minor releases before 1.0.
