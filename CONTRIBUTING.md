# Contributing to GAS

Use Node.js 22.13 or newer and pnpm 11.

```bash
git clone https://github.com/luna-estelar/gas.git
cd gas
pnpm install --frozen-lockfile
pnpm test
```

## Development checks

`pnpm test` checks formatting and the committed generated files, builds packages, validates
schemas and dependency boundaries, checks publication metadata and types, and runs the tests.
CI runs the live npm advisory check separately with `pnpm check:security`.

## Generated files

`packages/protocol/generated/` holds the precompiled timeline validator. Browsers run these
packages under a Content Security Policy without `'unsafe-eval'`, so no validator may be
compiled at runtime: AJV builds its validators with `new Function`. Run `pnpm build:validators`
after changing `packages/protocol/schemas/1.0` or upgrading AJV, and commit the result.
`pnpm check:validators`, part of `pnpm test`, fails when the committed file is stale. Never
edit it by hand.

`test/no-runtime-codegen.test.ts` imports each browser-facing entrypoint in a child process
and fails if anything generates code at import.

`packages/language/src/generated` and `packages/language/syntaxes` are generated from
`src/gas.langium` by langium-cli and committed. Run `pnpm --filter @luna-estelar/gas-language
langium:generate` after editing the grammar and commit the result, and never edit them by hand.
`pnpm check:language-generated`, part of `pnpm test`, regenerates into a scratch directory and
compares the committed bytes, so a grammar edit cannot ship a parser that does not match it. It
writes nothing into the checkout, and staging state does not change its verdict. `langium` and
`langium-cli` stay on the same minor, pinned in `.github/dependabot.yml`, because the CLI
generates the parser the runtime executes.

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
to its session module and exports explicit subpaths to control parser loading.

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

Packages are versioned independently with [Changesets](https://github.com/changesets/changesets).
Every PR that changes a published package adds a changeset:

```bash
pnpm changeset
```

Choose the affected packages and a bump for each, and write the summary for someone
reading that package's changelog. Changes that only touch tests, CI or the private root
need no changeset.

The umbrella `@luna-estelar/gas` pins every package exactly, and Changesets releases it as a
patch whenever one of them changes. A breaking change would then reach its users as a patch, so
a `minor` or `major` on any package also needs the same bump for `@luna-estelar/gas`.
`test/meta-package.test.ts` enforces this.

Pending changesets on `main` keep a Version Packages PR open. It runs `pnpm
version-packages`, which bumps manifests and internal ranges, writes each package's
`CHANGELOG.md`, and copies the new versions into the exported `version` literals and the
language compiler's `COMPILER_VERSION` (`scripts/sync-versions.mjs`). Version literals
support browser consumers without loading package metadata. Tests check their agreement.

Merging the Version Packages PR runs `pnpm check:security` and `pnpm test`, then publishes
with provenance every package whose version is not yet on npm, in dependency order. Each
package gets its own tag and GitHub release, for example `@luna-estelar/gas-core@0.1.2`.

Internal dependencies use `workspace:^`, which pnpm converts to a caret range such as
`^0.1.2` when packing. The umbrella is the exception: it uses `workspace:*`, which becomes the
exact version, so it always ships the set it was tested with. Publication is not transactional. If it is interrupted, rerun the
release workflow; versions already on npm are skipped.
