# @luna-estelar/gas-cli

The `gas` command: compiles GAS source into timeline JSON locally, without credentials or network
access. It runs the language stage of `document → language → timeline → session → renderer →
connector → model` from a terminal.

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas-cli)](https://www.npmjs.com/package/@luna-estelar/gas-cli)
[![license](https://img.shields.io/npm/l/@luna-estelar/gas-cli)](https://github.com/luna-estelar/gas/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/luna-estelar/gas/release.yml?branch=main)](https://github.com/luna-estelar/gas/actions/workflows/release.yml)

## Install

```bash
npm install @luna-estelar/gas-cli
```

Part of `@luna-estelar/gas`, which installs every package and the same `gas` command. Either runs
without a permanent installation:

```bash
npx @luna-estelar/gas-cli compile song.gas
npx @luna-estelar/gas compile song.gas
```

Always use a scoped name: `npx gas` on its own fetches an unrelated npm package.

## Example

The command embeds: `execute` takes its I/O as an argument and returns an exit code rather than
setting one, so it can run without touching the real filesystem.

```ts
import { execute, type CliIo } from '@luna-estelar/gas-cli';

const files = new Map([['song.gas', 'tempo 88\nlength bars 4\n']]);
const io: CliIo = {
  readFile: (path) => files.get(path) ?? '',
  writeFile: (path, contents) => files.set(path, contents),
  stdout: (contents) => console.log(contents),
  stderr: (contents) => console.error(contents)
};

const exitCode = execute(['compile', 'song.gas', '--out', 'song.json'], io);
console.log(exitCode, files.get('song.json'));
```

## Exports

| Export    | Purpose                                                    |
| --------- | ---------------------------------------------------------- |
| `run`     | Run the command with `process.argv` and set the exit code  |
| `execute` | Run the command against supplied I/O; returns an exit code |
| `CliIo`   | The I/O interface `execute` takes                          |
| `version` | This package's version                                     |

## Usage

```
usage: gas compile <file> [--out <path>]

options:
  --out <path>      write JSON to a file instead of stdout
  -h, --help        show this help
  -v, --version     show the version
```

The timeline prints to stdout; `--out timeline.json` writes it to a file instead. Diagnostics go to
stderr as `file:line:column: severity [category/code] message`, and a compile error exits non-zero.

## Runtime support

- ESM-only.
- Node.js 22 or newer. Node only: it reads and writes files.

## Related packages

Depends on `@luna-estelar/gas-language` for compilation; applications that compile source directly
can import that package instead. `@luna-estelar/gas` depends on this package for its `gas` command.

## License

MIT
