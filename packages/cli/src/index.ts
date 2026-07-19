// CLI file I/O and command dispatch. The language package handles compilation.

import { readFileSync, writeFileSync } from 'node:fs';
import { compileSource, type GasDiagnostic } from '@luna-estelar/gas-language';

export const packageName = '@luna-estelar/gas-cli';
export const version = '0.1.0';

export interface CliIo {
  readonly readFile: (path: string) => string;
  readonly writeFile: (path: string, contents: string) => void;
  readonly stdout: (contents: string) => void;
  readonly stderr: (contents: string) => void;
}

const HELP = `usage: gas compile <file> [--out <path>]

commands:
  compile <file>    compile GAS source to timeline JSON

options:
  --out <path>      write JSON to a file instead of stdout
  -h, --help        show this help
  -v, --version     show the version
`;

const defaultIo: CliIo = {
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, contents) => writeFileSync(path, contents, 'utf8'),
  stdout: (contents) => {
    process.stdout.write(contents);
  },
  stderr: (contents) => {
    process.stderr.write(contents);
  }
};

/**
 * Run the GAS CLI and update process.exitCode for embedding-friendly command
 * dispatch. The bin wrapper intentionally remains a one-line call to this
 * function.
 */
export function run(argv: readonly string[] = process.argv.slice(2)): void {
  process.exitCode = execute(argv, defaultIo);
}

/** Internal command executor exported for deterministic tests and embedders. */
export function execute(argv: readonly string[], io: CliIo): number {
  if (argv.length === 1 && (argv[0] === '-h' || argv[0] === '--help')) {
    io.stdout(HELP);
    return 0;
  }
  if (argv.length === 1 && (argv[0] === '-v' || argv[0] === '--version')) {
    io.stdout(`${version}\n`);
    return 0;
  }
  if (argv.length === 0) {
    io.stderr(`gas: missing command\n${HELP}`);
    return 1;
  }
  if (argv[0] !== 'compile') {
    const kind = argv[0]?.startsWith('-') ? 'option' : 'command';
    io.stderr(`gas: unknown ${kind} '${argv[0]}'\n${HELP}`);
    return 1;
  }
  if (argv.length === 2 && (argv[1] === '-h' || argv[1] === '--help')) {
    io.stdout(HELP);
    return 0;
  }

  const parsed = parseCompileArguments(argv.slice(1));
  if (!parsed.ok) {
    io.stderr(`gas: ${parsed.message}\n${HELP}`);
    return 1;
  }

  let source: string;
  try {
    source = io.readFile(parsed.file);
  } catch (error) {
    io.stderr(`gas: cannot read '${parsed.file}': ${errorMessage(error)}\n`);
    return 1;
  }

  const result = compileSource(source, { name: parsed.file });
  for (const diagnostic of result.diagnostics) {
    io.stderr(`${formatDiagnostic(parsed.file, diagnostic)}\n`);
  }
  if (!result.ok) {
    return 1;
  }

  const json = `${JSON.stringify(result.timeline, null, 2)}\n`;
  if (parsed.out === undefined) {
    io.stdout(json);
    return 0;
  }
  try {
    io.writeFile(parsed.out, json);
    return 0;
  } catch (error) {
    io.stderr(`gas: cannot write '${parsed.out}': ${errorMessage(error)}\n`);
    return 1;
  }
}

type CompileArguments =
  | { readonly ok: true; readonly file: string; readonly out?: string }
  | { readonly ok: false; readonly message: string };

function parseCompileArguments(argv: readonly string[]): CompileArguments {
  if (argv.length === 0) {
    return { ok: false, message: 'compile requires a source file' };
  }
  const file = argv[0];
  if (file === undefined || file.startsWith('-')) {
    return {
      ok: false,
      message: file === undefined ? 'compile requires a source file' : `unknown option '${file}'`
    };
  }
  if (argv.length === 1) {
    return { ok: true, file };
  }
  if (argv[1] !== '--out') {
    return { ok: false, message: `unknown option '${argv[1]}'` };
  }
  if (argv[2] === undefined || argv[2].startsWith('-')) {
    return { ok: false, message: '--out requires a path' };
  }
  if (argv.length > 3) {
    return { ok: false, message: `unexpected argument '${argv[3]}'` };
  }
  return { ok: true, file, out: argv[2] };
}

function formatDiagnostic(file: string, diagnostic: GasDiagnostic): string {
  const line = (diagnostic.range?.start.line ?? 0) + 1;
  const column = (diagnostic.range?.start.character ?? 0) + 1;
  return `${file}:${line}:${column}: ${diagnostic.severity} [${diagnostic.category}/${diagnostic.code}] ${diagnostic.message}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
