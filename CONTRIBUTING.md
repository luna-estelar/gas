# Contributing to GAS

Use Node.js 22.13 or newer and pnpm 11.

```bash
git clone https://github.com/luna-estelar/gas.git
cd gas
pnpm install --frozen-lockfile
pnpm test
```

`pnpm test` runs every check CI runs, apart from the npm advisory audit (`pnpm check:security`).
For a quicker loop after a build, use `pnpm exec vitest run`.

## Generated files

Some files are generated and committed. Regenerate them after editing their source, commit the
result, and never edit them by hand. `pnpm test` fails if they are stale.

| After changing                               | Run                                                |
| -------------------------------------------- | -------------------------------------------------- |
| `packages/gas/src/language/gas.langium`      | `pnpm --filter @luna-estelar/gas langium:generate` |
| `packages/gas/schemas/1.0`, or upgrading AJV | `pnpm build:validators`                            |

Nothing may generate code at runtime (no `new Function`), because browsers load GAS under a
Content Security Policy without `'unsafe-eval'`.

## Module boundaries

`scripts/check-boundaries.mjs` says which module under `packages/gas/src` may import which, and
module tests in `packages/gas/test/<module>` follow the same rules. Tests that combine modules go
in the root `test/` directory.

## Writing a connector

A connector implements the `Connector` interface from `@luna-estelar/gas/protocol` and declares
`@luna-estelar/gas` as a peer dependency. It should also:

- Implement `validateConfig` by hand, reporting every problem at once with a JSON Pointer `path`,
  a stable `code` and a fixed message that never echoes the value. Don't compile a schema at
  runtime. `packages/lyria-rt/src/config.ts` is the reference.
- Throw `ConnectorError` with a `reason` and a stable `code`, and pass a closed connection's raw
  number as `closeCode`. Leave application codes (4000-4999) to the host.

## READMEs

Tests compile every `gas` fence, parse every `gas-live` fence and typecheck every `ts` fence in
the READMEs. Mark excerpts that aren't complete programs as `gas-fragment` or `ts-fragment`.

## Releases

If a PR changes a published package, add a changeset with `pnpm changeset` and write it for
someone reading that package's changelog. Changes to tests, CI or the root need none.

To release:

1. Run `pnpm version-packages` in a release PR, review the changes and merge it.
2. Run `gh workflow run release.yml --ref main`, or **Release → Run workflow** in GitHub Actions.

The workflow publishes missing versions with provenance and pushes tags like
`@luna-estelar/gas@0.3.0`. If it fails partway, rerun the same workflow run. Already published
versions are skipped. Never unpublish.

Connectors peer on GAS with `>=0.3.0 <1.0.0`, not `^0.3.0`, which on 0.x would mean `<0.4.0`.
Before a connector's first publish, check that the npm token can create packages in the scope.
