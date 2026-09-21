# GAS CLI

`@luna-estelar/gas-cli` provides the `gas` command for compiling GAS source into timeline JSON
locally, without credentials or network access.

## Install

The CLI is ESM-only and requires Node.js 22 or newer. Run it without a permanent installation:

```bash
npx @luna-estelar/gas-cli compile song.gas
```

Or install it in a project:

```bash
npm install @luna-estelar/gas-cli
```

The timeline prints to stdout; `--out timeline.json` writes it to a file instead. Diagnostics go
to stderr as `file:line:column: severity [category/code] message`, and a compile error exits
non-zero.

```
usage: gas compile <file> [--out <path>]

options:
  --out <path>      write JSON to a file instead of stdout
  -h, --help        show this help
  -v, --version     show the version
```

The package root also exports `run`, `execute`, and the `CliIo` interface, so the command can be
embedded and tested without touching the real filesystem — `execute` takes its I/O as an
argument and returns an exit code rather than setting one.

## Dependencies

The CLI handles file I/O and uses `@luna-estelar/gas-language` for compilation. Applications
that compile source directly can import the language package.
