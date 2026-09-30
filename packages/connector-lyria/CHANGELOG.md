# @luna-estelar/gas-connector-lyria

## 0.2.0

### Minor Changes

- [`49e9774`](https://github.com/luna-estelar/gas/commit/49e977451a0f1aa0477b05e0d49e58edbbcc5776) Thanks [@sathira10](https://github.com/sathira10)! - Connector settings are now `{ apiKey, endpoint? }`. How an application obtains a key is the
  application's own concern, so the hosted arm of the old settings union leaves with its sentinel key
  and its private close-code table. An `endpoint` is any HTTPS origin that speaks the Lyria WebSocket
  protocol; it is reduced to its origin and refused if it carries userinfo, a query, a fragment or a
  path, so a credential cannot hide in one.

  Close-code classification covers the standard codes only, and every failure now carries the raw
  number through as `closeCode`. Google closes with 1007 for a malformed key and 1008 for a rejected
  one, both before setup completes, so both are authentication failures there and transport noise
  afterwards; 1002 and 1011 are provider failures. Everything else, including the application range
  4000-4999, is reported as a network failure with the number attached for the host to interpret. One
  consequence worth knowing: no close code maps to `reason: 'quota'` any more, so 4429 arrives as a
  retryable network failure carrying 4429 rather than as `lyria-quota-exhausted`.

  `validateConfig` implements the Protocol's optional connector-owned validation, so the Renderer can
  check a configuration edit without compiling a schema. It reports every problem at once rather than
  stopping at the first, since which one a caller hears should not depend on the order the members
  happen to be in, and names each by JSON Pointer with one of the codes `wrong-type`, `out-of-range`,
  `not-allowed` or `unknown-member`.

### Patch Changes

- [`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439) Thanks [@sathira10](https://github.com/sathira10)! - Internal dependency ranges widened to caret, so each package can be released on its own.
- Updated dependencies [[`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2)]:
  - @luna-estelar/gas-protocol@0.2.0

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
