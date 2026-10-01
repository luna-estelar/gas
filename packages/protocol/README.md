# @luna-estelar/gas-protocol

The Protocol 1.0 contracts shared by every stage of `document → language → timeline → session →
renderer → connector → model`: timelines, commands, state, events, and the Renderer and
connector interfaces, with the JSON Schemas that define them. It depends on no other GAS package.

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas-protocol)](https://www.npmjs.com/package/@luna-estelar/gas-protocol)
[![license](https://img.shields.io/npm/l/@luna-estelar/gas-protocol)](https://github.com/luna-estelar/gas/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/luna-estelar/gas/release.yml?branch=main)](https://github.com/luna-estelar/gas/actions/workflows/release.yml)

## Install

```bash
npm install @luna-estelar/gas-protocol
```

Part of `@luna-estelar/gas`, which installs every package.

## Example

```ts
import { validateTimelinePayload } from '@luna-estelar/gas-protocol/validation';

const result = validateTimelinePayload(JSON.parse('{"formatVersion":{"major":1,"minor":0}}'));
if (!result.ok) console.log(result.issues);
```

## Exports

| Entry point    | Exports                                                                              | Purpose                                                         |
| -------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `.`            | `Timeline`, `TimelineEvent`, `MusicalPosition`, `BeatPosition`, …                    | Compiled timelines and musical positions (types only)           |
| `.`            | `Command` and the `Set…` / `Clear…` / `…Track` command types                         | The canonical command set (types only)                          |
| `.`            | `InputState`, `EffectiveState`, `SessionState`, `LifecycleEvent`, `CommandResult`, … | Session input, derived state and host-facing session payloads   |
| `.`            | `Renderer`, `Connector`, `MonotonicClock`, `AudioChunk`, `RendererFailure`, …        | Renderer, connector, clock and audio contracts                  |
| `.`            | `ConnectorConfigProblem`, `ConnectorConfigValidation`                                | Connector-owned configuration validation results                |
| `.`            | `ConnectorError`, `isCloseCode`                                                      | The connector failure class, and the one close-code range check |
| `.`            | `slugify`                                                                            | How a display name becomes a timeline id segment                |
| `.`            | `version`                                                                            | This package's version                                          |
| `./validation` | `validateTimelinePayload`, `PROTOCOL_SCHEMA_IDS`                                     | Structural timeline validation with a precompiled validator     |
| `./schemas/*`  | `schemas/1.0/*.schema.json`                                                          | Draft 2020-12 JSON Schemas for every JSON-compatible value      |

Importing types from the root is runtime-free. The `validation` subpath carries a validator
precompiled from the packaged JSON Schemas, so it generates no code at runtime and works under a
Content Security Policy without `'unsafe-eval'`.

## Contract families

The JSON-compatible value families have Draft 2020-12 schemas under `schemas/1.0/`:

- `timeline` and `resources`: compiler output accepted by `session.loadTimeline`.
- `commands` and `state`: canonical commands, input state, and derived effective state.
- `diagnostics`: Language diagnostics, Core validation problems and command outcomes, and Renderer
  warnings/failures.
- `capabilities`, `config`, and `renderer`: model support, direct connector configuration values,
  metadata, and event payloads.
- `session`: host-facing state, warnings, command results, lifecycle, and diagnostic events.

Consumers may resolve schemas through package subpaths such as
`@luna-estelar/gas-protocol/schemas/1.0/timeline.schema.json`. The canonical schema IDs use
`https://gas.luna-estelar.com/protocol/1.0/`.

## Timeline invariants and validation

Protocol 1.0 timelines use exactly `{ "major": 1, "minor": 0 }`. Bars and beat indexes are
1-based, and a bar is always a whole number. Arrangement `end` positions are exclusive. Events are
ordered by musical position and then `sequence`; timelines contain no seconds, timestamps, or
derived durations. Levels are finite numbers from 0 through 1, and each intent action must carry
its matching value kind.

`sequence` orders the events that share one position, and nothing more: it need not be unique
across the timeline, only among events at the same position, where it decides which one wins.

A beat offset is a fraction of one beat, so `numerator` is less than `denominator`, and a beat
index never exceeds the `beatsPerBar` of the declared meter. A section-scoped event lies inside
its own instance's `[start, end)` span, because outside it the value can never take effect.

`@luna-estelar/gas-protocol/validation` exports `validateTimelinePayload`, sanitized validation
issues, and `PROTOCOL_SCHEMA_IDS`. The validator applies the canonical structural schema. Core's
`validateTimeline` uses it first and then checks the cross-record rules above that JSON Schema
cannot express: ID uniqueness, reference resolution, event ranges, contiguous arrangement spans,
event ordering and sequence collisions, beat ranges, and section scope. The API completes both
gates before it changes session or Renderer state.

Schema objects reject unknown fields. Configuration schemas are returned directly by connectors;
there is no versioned config descriptor or snapshot wrapper in v1.

### Tempo, beats and bars

Tempo is beats per minute where a beat is the meter's `beatUnit` note. So `secondsPerBeat` is
`60 / tempo` and `secondsPerBar` is `beatsPerBar x 60 / tempo`, with no `4 / beatUnit` factor
anywhere: at 120 BPM an event on beat 3 lands 1.0 s into its bar in 6/8 exactly as it does in 4/4,
because a beat in 6/8 is an eighth note. A bar takes 2.0 s in 4/4 and 3.0 s in 6/8.

Timelines themselves hold no seconds. `@luna-estelar/gas-core` owns the one conversion between a
`MusicalPosition` and clock seconds — `positionToTime` and `timeToPosition` — so the Renderer and
a browser host agree on where a position falls in time without either owning the rule. A derived
position is always a legal one: a whole bar, and a beat offset in whole ticks over 960.

## Completion and the audible position

A finite run that reaches its declared end produces a `RendererStatusEvent` carrying its `runId`
and `completed: true`, and the API turns that into a `LifecycleEvent` with `completed: true`. A
stop requested by the host never carries the flag, so a host can tell a piece that finished from
one it stopped. `stream` describes only the provider's stream.

`Renderer.positionAtSeconds(seconds)` is optional. It gives the musical position `seconds` after
the current run's anchor, through the live tempo map, so a host can place a playhead against the
audio it has actually played.

## Failures and close codes

A connector reports a failure by throwing `ConnectorError`, whose message is fixed by its `reason`
so vendor text and credentials cannot leak into an event, log, or diagnostic. The Renderer turns
that into a `RendererFailure` carrying the connector's `code`, `reason` and `retryable` with the
Renderer's own message.

`ConnectorError` and `RendererFailure` carry an optional `closeCode`: the raw transport close code,
left unclassified for a host to interpret. `isCloseCode` accepts a whole number from 1000 through
4999; the error constructor, the structural guard, the failure schema and the API all enforce that
same range. A connector classifies the standard codes into a `reason`; the application range
4000-4999 means whatever the endpoint says it means. The Renderer copies `closeCode` into every
failure it emits, and the API puts it on `GasOperationError.closeCode`, so it reaches the host
unchanged.

## Connector obligations

A connector validates its own configuration through the optional `validateConfig`. It takes a
proposed `ConnectorConfig` and returns `ConnectorConfigValidation`, either `{ ok: true }` or
`{ ok: false, problems }` with a list of `ConnectorConfigProblem`s. The Renderer calls it for the
connector's own defaults, the initial configuration and every edit. It never compiles a schema
itself, which keeps it usable under a Content Security Policy
without `'unsafe-eval'`.

A `ConnectorConfigProblem` is a JSON Pointer `path` (the empty string for the root), a stable
machine `code` such as `unknown-member` or `out-of-range`, and a fixed safe `message` that never
embeds provider or caller input. It is deliberately not shaped like a schema compiler's output: a
hand-written validator should not have to invent a `schemaPath` and a `keyword` to say that a
number is too large.

`validateConfig` is optional because `Connector` is a published interface. A connector that does
not implement it has its configuration accepted unchecked, and the Renderer emits one
`connector-config-unvalidated` warning.

## TypeScript-only contracts

V1 Renderer and connector sessions run in-process. Interfaces containing functions or callbacks,
`Error` instances, monotonic-clock tokens, and binary `Uint8Array` audio/notation payloads are
therefore canonical TypeScript contracts without JSON schemas. In particular, Protocol 1.0 does
not define a base64 audio envelope.

Remote Renderer sessions, detached binary transport, versioned wire envelopes, canonical
serialization, and cross-language compatibility policy remain deferred until a concrete transport
requires them.

## Runtime support

- ESM-only.
- Node.js 20 or newer; runs in browsers.
- The root is types plus two small runtime values; `./validation` is precompiled and generates no
  code at runtime.

## Related packages

Depends on no GAS package; `./validation` uses `ajv`'s runtime helpers only. Every other GAS
package depends on it: `gas-language`, `gas-core`, `gas-api`, `gas-renderer`, `gas-notation`,
`gas-connector-lyria` and `gas-browser`.

## License

MIT
