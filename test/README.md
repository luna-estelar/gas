# Tests

Module tests live in `packages/gas/test/<module>/` and follow that module's import rules. Connector
tests live in each connector's `test/` directory, and `test/support/connector-conformance.ts` has
the lifecycle cases every connector runs. This directory holds tests that combine modules, plus
release checks on versions, package contents and README examples.

Run everything with `pnpm test`, or `pnpm exec vitest run` after a build for a quicker loop.

Tests use fake clocks and transports and never call a model. Checks against real providers are in
each connector's `manual/` guide.
