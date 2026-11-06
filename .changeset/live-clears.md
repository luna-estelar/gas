---
'@luna-estelar/gas': minor
---

Live text can clear what it sets, so an app can hand a value back to the score.

- `strings.level clear`, and the same for `flavor`, `timbre`, `notes` and `motif`.
- `strings.release` hands the track's play state back to the score.
- `track strings clear` removes an app track.
- `tempo clear`, `flavor clear` and `level clear` for the globals.
- Live text now accepts global `flavor "..."` and `level 0.5`, which it used to reject with
  `live-global-not-allowed`. `key`, `time_signature` and `length` are still rejected.

`clear` and `release` only work in live text. In a document they give `clear-not-allowed`. Both
can still name a track.
