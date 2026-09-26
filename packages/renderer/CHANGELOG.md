# @luna-estelar/gas-renderer

## 0.1.1

### Patch Changes

- A session no longer compiles the connector's configuration schema at startup. The
  connector contract check it performed is now opt-in through `checkConnectorContract`,
  and the schema is compiled on the first `updateConnectorConfig` call.

## 0.1.0

### Minor Changes

- First public preview. The clock-driven scheduler, musical-to-clock conversion, and
  connector lifecycle. Package APIs may change in minor releases before 1.0.
