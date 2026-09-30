# GAS Protocol 1.0

`@luna-estelar/gas-protocol` is the canonical owner of the plain values shared by GAS Language,
Core, API, Renderer, and connectors. It depends on no other GAS package.

## Install

```bash
npm install @luna-estelar/gas-protocol
```

The package is ESM-only and requires Node.js 20 or newer when used in Node. Importing types from the
root is runtime-free. The `validation` subpath carries a validator precompiled from the packaged
JSON Schemas, so it generates no code at runtime and works under a Content Security Policy without
`'unsafe-eval'`.

```ts
import { validateTimelinePayload } from '@luna-estelar/gas-protocol/validation';

const result = validateTimelinePayload(JSON.parse('{"formatVersion":{"major":1,"minor":0}}'));
if (!result.ok) console.log(result.issues);
```

## Contract families

The package root exports the TypeScript contracts for timelines and musical positions, commands,
session input and effective state, diagnostics and command outcomes, API session payloads,
capabilities, Renderer/connector interfaces, configuration, and audio delivery.

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

## Failures and close codes

A connector reports a failure by throwing `ConnectorError`, whose message is fixed by its `reason`
so vendor text and credentials cannot leak into an event, log, or diagnostic. The Renderer turns
that into a `RendererFailure` carrying the connector's `code`, `reason` and `retryable` with the
Renderer's own message.

`closeCode` is the raw transport close code, passed through unclassified from `ConnectorError` to
`RendererFailure` and on to the host. `isCloseCode` is the one gate on it — a whole number from
1000 through 4999 — and every guard and schema range uses it, so a value that reaches a host is
always in range or absent. A connector classifies the standard codes into a `reason`; the
application range 4000-4999 means whatever the endpoint says it means, so the number travels
intact and the host maps it.

## Connector obligations

Beyond the `Connector` methods, a connector owns validating its own configuration. `validateConfig`
takes a proposed `ConnectorConfig` and returns `ConnectorConfigValidation` — either `{ ok: true }`
or the `ConnectorConfigProblem` list — without compiling a schema, so a Renderer never has to
compile `configSchema` and a session stays usable under a Content Security Policy without
`'unsafe-eval'`.

A `ConnectorConfigProblem` is a JSON Pointer `path` (the empty string for the root), a stable
machine `code` such as `unknown-member` or `out-of-range`, and a fixed safe `message` that never
embeds provider or caller input. It is deliberately not shaped like a schema compiler's output: a
hand-written validator should not have to invent a `schemaPath` and a `keyword` to say that a
number is too large.

`validateConfig` is optional because `Connector` is a published interface. A connector that omits
it gets no configuration validation at all.

## TypeScript-only contracts

V1 Renderer and connector sessions run in-process. Interfaces containing functions or callbacks,
`Error` instances, monotonic-clock tokens, and binary `Uint8Array` audio/notation payloads are
therefore canonical TypeScript contracts without JSON schemas. In particular, Protocol 1.0 does
not define a base64 audio envelope.

Remote Renderer sessions, detached binary transport, versioned wire envelopes, canonical
serialization, and cross-language compatibility policy remain deferred until a concrete transport
requires them.
