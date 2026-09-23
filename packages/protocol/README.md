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
1-based. Arrangement `end` positions are exclusive. Events are ordered by musical position and
then `sequence`; timelines contain no seconds, timestamps, or derived durations. Levels are finite
numbers from 0 through 1, and each intent action must carry its matching value kind.

`@luna-estelar/gas-protocol/validation` exports `validateTimelinePayload`, sanitized validation
issues, and `PROTOCOL_SCHEMA_IDS`. The validator applies the canonical structural schema. Core's
`validateTimeline` uses it first and then checks cross-record rules: ID uniqueness, reference
resolution, event ranges, and contiguous arrangement spans. The API completes both gates before it
changes session or Renderer state.

Schema objects reject unknown fields. Configuration schemas are returned directly by connectors;
there is no versioned config descriptor or snapshot wrapper in v1.

## TypeScript-only contracts

V1 Renderer and connector sessions run in-process. Interfaces containing functions or callbacks,
`Error` instances, monotonic-clock tokens, and binary `Uint8Array` audio/notation payloads are
therefore canonical TypeScript contracts without JSON schemas. In particular, Protocol 1.0 does
not define a base64 audio envelope.

Remote Renderer sessions, detached binary transport, versioned wire envelopes, canonical
serialization, and cross-language compatibility policy remain deferred until a concrete transport
requires them.
