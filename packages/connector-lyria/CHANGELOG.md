# @luna-estelar/gas-connector-lyria

## 0.1.1

### Patch Changes

- Released with the Protocol validator fix; no changes to this package.

## 0.1.0

### Minor Changes

- First public preview. The Lyria RealTime boundary: prompt translation, transport, and
  capability reporting. Package APIs may change in minor releases before 1.0.

### Known limitations

- Lyria is the only connector.
- Lyria supports `flavor`, `tempo` and `timbre`, and approximates `key` and `level`.
- `time_signature`, `notes` and `motif` compile and remain in session state, but Lyria
  cannot render them. GAS reports a capability warning rather than dropping them.
