---
'@luna-estelar/gas-core': minor
---

`validateTimeline` now checks four invariants JSON Schema cannot express, each with its own problem
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
