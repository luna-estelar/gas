# Contributing to GAS

Use Node.js 22.13 or newer and pnpm 11.

```bash
git clone https://github.com/luna-estelar/gas.git
cd gas
pnpm install --frozen-lockfile
pnpm test
```

## Development checks

`pnpm test` checks formatting, builds packages, validates schemas and dependency boundaries,
checks publication metadata and types, and runs the tests. CI runs the live npm advisory
check separately with `pnpm check:security`.

## Generated validators

`packages/protocol/generated/` holds the precompiled timeline validator. Browsers run these
packages under a Content Security Policy without `'unsafe-eval'`, so no validator may be
compiled at runtime: AJV builds its validators with `new Function`. Run `pnpm build:validators`
after changing `packages/protocol/schemas/1.0` or upgrading AJV, and commit the result.
`pnpm check:validators`, part of `pnpm test`, fails when the committed file is stale. Never
edit it by hand.

`pnpm format` and `pnpm format:check` use tracked and nonignored untracked files. They
respect Git's local excludes and `.prettierignore`; deleted files and unsupported file
formats are skipped. These commands require a Git checkout, including linked worktrees.

## Package boundaries

The dependency map in `scripts/check-boundaries.mjs` defines permitted package imports.
Package tests follow the same boundaries as package source. Tests that combine packages
beyond those dependencies belong in the root `test/` directory. See
[test/README.md](./test/README.md).

The renderer and connector keep separate virtual-clock test helpers because package test
boundaries prohibit sharing them. The browser package confines concrete runtime composition
to its wiring module and exports explicit subpaths to control parser loading.

## Package contents and examples

Packages ship compiled output and source. Declaration and source maps refer to the source
files, so both are needed for editor navigation and stack traces. Keep each package's
README, license and exported entrypoints in its published file set.

README fences are checked against the built packages: `gas` documents compile, `gas-live`
commands parse, and `ts` examples typecheck. Use `gas-fragment` or `ts-fragment` for excerpts
that are not complete programs.

Website documentation is maintained in the website repository. Package READMEs are
maintained here and included in npm tarballs.

## Releases

All ten packages and the private root share one version. Update package manifests, exported
version literals and the language compiler's `COMPILER_VERSION` together. Version literals
support browser consumers without loading package metadata. Tests check their agreement.

Update `CHANGELOG.md`, then run `pnpm test` and `pnpm check:security`. Tag only a verified
commit with its matching `v*` version. The release workflow repeats validation and publishes
packages with provenance.

pnpm publishes dependencies before dependants and converts `workspace:*` references to
exact versions when packing. Publication is not transactional. If interrupted, rerun the
same tag workflow; pnpm skips versions already published. Verify all ten package versions
before creating the matching GitHub release.
