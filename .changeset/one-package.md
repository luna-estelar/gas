---
'@luna-estelar/gas': minor
---

GAS is now one package. The ten `@luna-estelar/gas-*` packages it used to depend on are folded
in, and the export map is smaller:

- `@luna-estelar/gas` exports what `./api` did, plus `createRenderer` and `version`.
- `@luna-estelar/gas/browser` replaces `./browser/session`, `./browser/audio`, `./browser/capture`,
  `./browser/timeline` and `./browser/inspect`.
- `@luna-estelar/gas/language` also has the editor helpers from `./browser/compile`.
- `./core` and `./notation` are internal now. `./renderer` is gone; use `createRenderer` from the
  root.
- `./lyria` is gone. The connector is a separate package, `@luna-estelar/gas-lyria-rt`.

`./protocol`, `./protocol/validation` and `./highlight` are unchanged.
