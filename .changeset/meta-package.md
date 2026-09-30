---
'@luna-estelar/gas': minor
---

First release of `@luna-estelar/gas`, one install for the language, the session runtime, the
renderer and the Lyria connector.

- The root re-exports `@luna-estelar/gas-api` (sessions, source helpers, `GasOperationError` and
  the protocol types a host handles), plus this package's own `packageName` and `version`.
- Every package is available at a subpath that mirrors it: `/protocol`, `/protocol/validation`,
  `/language`, `/core`, `/api`, `/renderer`, `/notation`, `/highlight`, `/lyria`, and
  `/browser/{session,audio,capture,compile,timeline,inspect}`. Only `/lyria` loads the Google
  GenAI SDK.
- The `gas` command runs `@luna-estelar/gas-cli`; use it as `npx @luna-estelar/gas`.

Dependencies are pinned to exact versions, so use this package or the individual packages, not
both at different versions.
