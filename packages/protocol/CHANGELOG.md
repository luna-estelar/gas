# @luna-estelar/gas-protocol

## 0.1.1

### Patch Changes

- The canonical timeline validator is precompiled at build time instead of being built
  with AJV when the module is imported. Importing the protocol validator, Core, the
  Renderer or a browser session generated code at runtime, which a Content Security Policy
  without `'unsafe-eval'` blocks, so no deployed page could start a session. Validation
  behaviour and reported problems are unchanged.

## 0.1.0

### Minor Changes

- First public preview. The transport-neutral contracts every other package shares, with
  Draft 2020-12 JSON Schemas for the Protocol 1.0 value families. Package APIs may change
  in minor releases before 1.0.
