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

Browsers run these packages under a Content Security Policy without `'unsafe-eval'`, so no
package compiles a validator, or any other code, at runtime. Full stop. Schema validation is
precompiled at build time, and connector configuration is checked by hand-written connector code
(see [Writing a connector](#writing-a-connector)).

`packages/gas/generated/` holds the precompiled timeline validator; AJV would otherwise build
it with `new Function`. Run `pnpm build:validators`
after changing `packages/gas/schemas/1.0` or upgrading AJV, and commit the result.
`pnpm check:validators`, part of `pnpm test`, fails when the committed file is stale. Never
edit it by hand.

`test/no-runtime-codegen.test.ts` imports each browser-facing entrypoint in a child process
and fails if anything generates code at import.

`packages/gas/src/language/generated` and `packages/gas/syntaxes` are generated from
`src/language/gas.langium` by langium-cli and committed. Run `pnpm --filter @luna-estelar/gas
langium:generate` after editing the grammar and commit the result, and never edit them by hand.
`pnpm check:language-generated`, part of `pnpm test`, regenerates into a scratch directory and
compares the committed bytes, so a grammar edit cannot ship a parser that does not match it. It
writes nothing into the checkout, and staging state does not change its verdict. `langium` and
`langium-cli` stay on the same minor, pinned in `.github/dependabot.yml`, because the CLI
generates the parser the runtime executes.

`pnpm format` and `pnpm format:check` use tracked and nonignored untracked files. They
respect Git's local excludes and `.prettierignore`; deleted files and unsupported file
formats are skipped. These commands require a Git checkout, including linked worktrees.

## Module boundaries

`@luna-estelar/gas` is one package made of modules, the directories under `packages/gas/src`.
The map in `scripts/check-boundaries.mjs` says which module may import which, and a module's
tests in `packages/gas/test/<module>` follow the same rules. Tests that combine modules beyond
those rules belong in the root `test/` directory. See [test/README.md](./test/README.md).

The top-level files in `src/` are the package's entry points. They only re-export, each from the
modules its export-map subpath needs. Only the browser session and the root reach the renderer.
Shared test helpers live in `test/support/` and depend only on the protocol module, and the Lyria
connector imports only `@luna-estelar/gas/protocol`.

Two checks keep browser globals out of code that runs in Node. `pnpm check:no-dom` typechecks
every module except `browser/` without DOM types. Node's own typings declare `localStorage`,
`sessionStorage` and `navigator`, so that typecheck accepts them; the DOM boundary test in
`packages/gas/test/browser/` scans every module and rejects those, directly or through
`globalThis`. Inside `browser/` it rejects every browser global except `document` in the audio
clock.

## Writing a connector

A connector implements the Protocol `Connector` interface, imports its types and `ConnectorError`
from `@luna-estelar/gas/protocol`, and declares `@luna-estelar/gas` as a peer dependency so the host
and the connector share one copy. Beyond transport, it owns two contracts that the Renderer and
the host rely on:

- **Configuration validation.** Implement `validateConfig(config)`, returning `{ ok: true }` or
  `{ ok: false, problems }` with a `ConnectorConfigProblem` per fault: a JSON Pointer `path`, a
  stable `code` such as `out-of-range` or `unknown-member`, and a fixed `message` that never
  echoes the offending value. Write it by hand, reporting every problem at once; never compile
  the connector's JSON Schema at runtime. The Renderer calls it for the connector's own defaults,
  the initial configuration and every edit. A connector without it has its configuration accepted
  unchecked, with a `connector-config-unvalidated` warning.
  `packages/lyria/src/config.ts` is the reference implementation, and
  `test/lyria-config.test.ts` checks that it agrees with an AJV compile of its schema.
- **Failures.** Throw `ConnectorError` with a `reason` and a stable `code`; its message is fixed
  by the reason, so provider text and credentials never leak. When a connection closes, pass the
  raw number as `closeCode`. Classify the standard codes into a reason, and never give an
  application code (4000-4999) a meaning of your own: it belongs to whoever serves the endpoint,
  and the host maps it.

Settings carry what the transport needs and nothing more. Key provisioning is the host's concern.

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

GAS publishes two packages, `@luna-estelar/gas` and `@luna-estelar/gas-lyria`, each versioned on
its own with [Changesets](https://github.com/changesets/changesets). Every PR that changes a
published package adds a changeset:

```bash
pnpm changeset
```

Choose the affected packages and a bump for each, and write the summary for someone reading that
package's changelog. Changes that only touch tests, CI or the private root need no changeset.
There are no fixed or linked release groups.

Lyria peers on GAS with a written-out range, `>=0.3.0 <1.0.0`, and develops against the workspace
copy through `workspace:^`. The range is not a caret range because on 0.x `^0.3.0` means `<0.4.0`,
which would force a Lyria release for every GAS minor.

The CI workflow runs on pull requests only. Pushes to `main` go to the Release workflow,
which runs the same `pnpm test` before it publishes anything, so `main` is verified once
rather than by two workflows racing each other.

Pending changesets on `main` keep a Version Packages PR open. It runs `pnpm
version-packages`, which bumps manifests, writes each package's `CHANGELOG.md`, and copies the
new versions into the two version literals, `packages/gas/src/version.ts` and
`packages/lyria/src/index.ts` (`scripts/sync-versions.mjs`). The `gas` command and the compiler
read GAS's literal, so `gas --version` and every timeline's `compilerVersion` match the package.
Tests check their agreement.

Merging the Version Packages PR runs `pnpm check:security` and `pnpm test`, then publishes
with provenance every package whose version is not yet on npm. Each package gets its own tag and
GitHub release, for example `@luna-estelar/gas@0.3.0`. A package marked `private` is never
published. Publication is not transactional. If it is interrupted, rerun the release workflow;
versions already on npm are skipped.
