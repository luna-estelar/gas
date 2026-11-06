# @luna-estelar/gas-connector-test

## 0.4.0

### Minor Changes

- New package. `describeConnector(name, createHarness)` checks a connector against the 0.4 connector
  contract in your vitest suite: aborts, late connections, nothing after `close()`, `ConnectorError`
  classification, one `onError` per failure, `pause()` and independent connections.

### Patch Changes

- Updated dependencies [`1c4be9d`, `a6fb12e`, `83a2040`, `aeb5384`, `5f7a291`]:
  - @luna-estelar/gas@0.4.0
