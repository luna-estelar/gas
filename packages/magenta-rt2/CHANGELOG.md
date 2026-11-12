# @luna-estelar/gas-magenta-rt2

## 0.4.0

### Minor Changes

- The Magenta RT2 connector is on the 0.4 `connect()` interface.

  - `createMagentaRt2Connector({ endpoint, token?, translate? })` takes what `createRenderer({ settings })`
    used to. It throws `magenta-rt2-invalid-settings` for a bad option. `MagentaRt2ConnectorSettings`
    is now `MagentaRt2ConnectorOptions`.
  - The bridge session starts with the first prompts to play. Until then the connector sends a
    keepalive every 10 s, so a piece that opens with a long rest doesn't hit the bridge's 30 s idle
    close (4408). This needs mrt2-bridge `ff7ea0c` or later. With an older bridge the connector warns
    `magenta-rt2-no-keepalive`.
  - `pause()` and `resume()` pause the bridge's generation.
  - Close codes are classified: 4401 and 4403 are `auth`, 4400 is a protocol violation, 4409 is
    `magenta-rt2-busy`, 4500 is an engine failure and 4408 is `magenta-rt2-idle-timeout`.
  - `translate` replaces the prompt translation. If it throws or returns a prompt the bridge would
    refuse, the change fails with `magenta-rt2-translate-failed`.
  - New exports: `MAGENTA_RT2_DESCRIPTION`, `openMagentaRt2Session` and `classifyClose`, for
    building your own connector.

### Patch Changes

- Updated dependencies [`1c4be9d`, `a6fb12e`, `83a2040`, `aeb5384`, `5f7a291`]:
  - @luna-estelar/gas@0.4.0
