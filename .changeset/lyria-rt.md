---
'@luna-estelar/gas-lyria-rt': minor
---

The Lyria RealTime connector is now `@luna-estelar/gas-lyria-rt`. Its connector id is `lyria-rt`,
its error and warning codes start with `lyria-rt-`, its exports are named `LyriaRt*` and
`LYRIA_RT_*`, and the manual scripts read `GAS_LYRIA_RT_*` variables. It peers on
`@luna-estelar/gas` `>=0.3.0 <1.0.0`.

Each start is tracked on its own, so Stop or Close settles a pending start with
`lyria-rt-start-cancelled` and closes a session that connects afterwards. The close that follows a
provider error decides how a failure is reported, and exceptions thrown by a host sink no longer
fail the run.
