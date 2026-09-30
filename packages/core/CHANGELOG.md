# @luna-estelar/gas-core

## 0.2.0

### Minor Changes

- [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2) Thanks [@sathira10](https://github.com/sathira10)! - The conversion between a musical position and clock seconds now lives in Core, so a host can place
  the audible playhead without depending on the Renderer. The Renderer still exports every one of
  these names, re-exported from Core.

  `positionToTime` and `timeToPosition` replace bar-only arithmetic and account for beats.
  `timeToPosition` always returns a position the protocol allows: a whole bar, and a beat offset in
  whole ticks over `TICKS_PER_BEAT` (960). Rounding to whole ticks carries a near-miss forward, so a
  value a hair under the next beat becomes that beat at offset 0 and one a hair under the next bar
  becomes the next bar — a position is never reported past the end of its own bar, and a fractional
  bar is never reported at all.

  `timeToBar` is renamed `timeToBarFraction`. It behaves exactly as before, returning the continuous
  bar coordinate; the name now says so, because that value is not a `MusicalPosition`. Use it for bar
  arithmetic, above all re-anchoring a tempo change at the exact current instant.

  Tempo is defined as beats per minute where a beat is the meter's `beatUnit` note, so `secondsPerBar`
  is `beatsPerBar x 60 / tempo` with no `4 / beatUnit` factor: at 120 BPM an event on beat 3 lands
  1.0 s into its bar in 6/8 exactly as in 4/4. `TempoSegment` gains `beatUnit` so a tempo map
  describes its own beat; `reanchorTempo` takes an optional `beatUnit` and otherwise keeps the meter
  already in force.

  `comparePositions` and `positionsEqual` are now exported from the package root.

- [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2) Thanks [@sathira10](https://github.com/sathira10)! - `validateTimeline` now checks four invariants JSON Schema cannot express, each with its own problem
  code. `events-unordered` catches an event list that is not in order of position and then
  `sequence`, which the cascade relies on to decide which of two events at one position wins.
  `sequence-collision` catches two events sharing both a position and a sequence, where that
  question has no answer. `beat-out-of-range` catches a beat index past the end of its bar and an
  offset of a whole beat or more. `event-outside-section` catches a section-scoped event placed
  outside its own instance, where the value can never take effect.

  Every timeline the compiler produces already satisfies all four; these reject hand-authored,
  persisted and foreign timelines that do not. The beat index is checked only against a meter the
  document declares, because a document that declares none is played at the host's renderer default,
  which a load-time gate cannot see.

### Patch Changes

- [`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439) Thanks [@sathira10](https://github.com/sathira10)! - Internal dependency ranges widened to caret, so each package can be released on its own.
- Updated dependencies [[`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2)]:
  - @luna-estelar/gas-protocol@0.2.0

## 0.1.1

### Patch Changes

- Released with the Protocol validator fix; no changes to this package.

## 0.1.0

### Minor Changes

- First public preview. Pure session semantics: input state, the canonical command set,
  the effective-state cascade, and the playback transition rules. Package APIs may change
  in minor releases before 1.0.
