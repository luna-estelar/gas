---
'@luna-estelar/gas': minor
---

Stop and Close no longer wait behind a slow connector. They overtake in-flight connector work and
wait for its stop or close only up to a cleanup timeout, measured in wall time so a suspended
AudioContext cannot stall it. A second Stop shares the first one's outcome.

A Play that settles after Stop, Close or `retryRenderer()` is ignored instead of reviving the
session. A connector can prepare again after a Stop that landed during prepare. Connectors now get
the run's default tempo in `ConnectorTiming`, not an override that happened to be active at start.
