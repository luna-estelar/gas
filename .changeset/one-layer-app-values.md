---
'@luna-estelar/gas': minor
---

App values now sit above the score however and whenever they were set, and they last until the
app clears them. Stop, completion and a failure keep them. A value set before Play sounds
the same as one set during Play.

`submitLiveCommands` applies a submission fully or not at all. A failing statement rejects, and
`LiveCommandFailureResult` is gone.

New session methods: `apply(commands)` applies a group fully or not at all, `clearAppValues()`
removes every app track and value, and `clearTrackNotes`, `clearTrackMotif`, `clearTrackPlay` and
`removeTrack` cover the new commands. `getState().appValues` lists the app tracks and values as
commands you can pass back to `apply`.

`loadSource` and `loadTimeline` take `{ appValues: 'keep' | 'clear' | Command[] }`, default
`'keep'`. A kept value whose track is gone is dropped with an `app-value-dropped` warning. A
`'keep'` load fails with `duplicate-track` when the new document declares an app track's id.
Commands and a second load reject while a document is loading.

Defining an app track again with the same name and description does nothing, so a saved
`getState().appValues` can be applied to the session that produced it.

`InputState` is now `{ timeline, appTracks, appValues }`, `HostTrack` is `AppTrack`, and
`applyCommand` no longer takes a `phase`. `applyStop`, `applyCompletion` and `applyRetry` are
removed. `applyCommands` and `applyNewTimeline` are new.
