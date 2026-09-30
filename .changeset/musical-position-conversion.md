---
'@luna-estelar/gas-core': minor
'@luna-estelar/gas-renderer': minor
---

The conversion between a musical position and clock seconds now lives in Core, so a host can place
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
