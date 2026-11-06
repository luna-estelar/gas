---
'@luna-estelar/gas-connector-test': minor
---

New package. `describeConnector(name, createHarness)` checks a connector against the 0.4 connector
contract in your vitest suite: aborts, late connections, nothing after `close()`, `ConnectorError`
classification, one `onError` per failure, `pause()` and independent connections.
