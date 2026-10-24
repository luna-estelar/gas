# Tests

Module tests live under `packages/gas/test/<module>/` and follow that module's import
boundaries; each connector's tests live under its own `test/` directory, and
`test/support/connector-conformance.ts` holds the lifecycle cases every connector runs. Integration tests
that combine modules live in the root `test/` directory.

```bash
pnpm test
```

This runs formatting, the generated-file checks, the TypeScript build, the no-DOM typecheck,
schema validation, boundary and publication checks, then Vitest. For a shorter test loop after building, use
`pnpm exec vitest run`.

Integration suites cover compiled examples through Core, Renderer, browser helpers and
notation; protocol contracts; consumer command paths; and connector configuration.

Release checks verify versions, package metadata and entrypoints, what each entry point loads,
and that README examples compile. Corpus collectors fail when their input directory is empty, so an incomplete checkout
cannot pass with zero cases.

The automated tests use deterministic clocks and fake transports. Live listening and
transport checks are documented separately in the Lyria RealTime connector's manual guide.
