# Tests

Package tests live under `packages/*/test/` and follow the dependency boundaries of their
own package. Cross-package integration tests live in the root `test/` directory.

```bash
pnpm test
```

This runs formatting, the TypeScript build, schema validation, boundary and publication
checks, then Vitest. For a shorter test loop after building, use `pnpm exec vitest run`.

Integration suites cover compiled examples through Core, Renderer, browser helpers and
notation; protocol contracts; consumer command paths; and connector configuration.

Release checks verify versions, package metadata and entrypoints, README snippets and
formatting behavior. Corpus collectors must fail when their input directory is empty or
missing so an incomplete checkout cannot pass with zero cases.

The automated tests use deterministic clocks and fake transports. Live listening and
transport checks are documented separately in the Lyria connector's manual guide.
