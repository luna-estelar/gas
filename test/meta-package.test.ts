// The @luna-estelar/gas package: its export map, its entry files, and what
// importing each entry point loads.
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gasRoot = path.join(root, 'packages', 'gas');
const lyriaRoot = path.join(root, 'packages', 'lyria');
const GAS = '@luna-estelar/gas';

type ExportTarget = string | { readonly types: string; readonly default: string };

interface Manifest {
  readonly version: string;
  readonly exports: Readonly<Record<string, ExportTarget>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

const manifest = JSON.parse(readFileSync(path.join(gasRoot, 'package.json'), 'utf8')) as Manifest;

/** The asset wildcard; every other key loads code through an entry file. */
const SCHEMA_EXPORT = './protocol/schemas/1.0/*';

const CODE_SUBPATHS = [
  '.',
  './language',
  './browser',
  './protocol',
  './protocol/validation',
  './highlight'
];

/** The entry files: top-level sources other than the version leaf. */
const FACADES = readdirSync(path.join(gasRoot, 'src'), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && entry.name !== 'version.ts')
  .map((entry) => entry.name)
  .sort();

function dependencyNames(...fields: (Readonly<Record<string, string>> | undefined)[]): string[] {
  return fields.flatMap((field) => Object.keys(field ?? {}));
}

describe('gas manifest', () => {
  it('exports the six code subpaths and the schema assets, and nothing else', () => {
    expect(Object.keys(manifest.exports).sort()).toEqual([...CODE_SUBPATHS, SCHEMA_EXPORT].sort());
    expect(manifest.exports[SCHEMA_EXPORT]).toBe('./schemas/1.0/*');
  });

  it('never installs the Google GenAI SDK', () => {
    const names = dependencyNames(
      manifest.dependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies
    );
    expect(names).not.toContain('@google/genai');
  });

  it('depends on no other @luna-estelar package', () => {
    const names = dependencyNames(
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies
    );
    expect(names.filter((name) => name.startsWith('@luna-estelar/'))).toEqual([]);
  });
});

describe('gas entry files', () => {
  it('maps each code subpath to its own entry file, and each entry file to one subpath', () => {
    const loaded = CODE_SUBPATHS.map((subpath) => {
      const target = manifest.exports[subpath];
      if (typeof target === 'string' || target === undefined) {
        throw new Error(`${subpath} should map types and default`);
      }
      const name = /^\.\/out\/([^/]+)\.js$/.exec(target.default)?.[1];
      expect(name, `${subpath} default`).toBeDefined();
      expect(target.types, `${subpath} types`).toBe(`./out/${name}.d.ts`);
      return `${name}.ts`;
    });
    expect(loaded.sort()).toEqual(FACADES);
  });

  // Facades only re-export, so a subpath exposes exactly what its modules do and
  // the boundary rules on those modules hold for the subpath too.
  it.each(FACADES)('src/%s only re-exports', (file) => {
    const source = ts.createSourceFile(
      file,
      readFileSync(path.join(gasRoot, 'src', file), 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    for (const statement of source.statements) {
      const reExport = ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined;
      expect(reExport, statement.getText()).toBe(true);
    }
  });

  it('the root reports the package version', async () => {
    const entry = manifest.exports['.'] as Exclude<ExportTarget, string>;
    const rootModule = (await import(pathToFileURL(path.join(gasRoot, entry.default)).href)) as {
      version: string;
    };
    expect(rootModule.version).toBe(manifest.version);
  });
});

// What an entry point loads, checked by loading it. Each import runs in its own
// process under a resolve hook that throws on the modules in question, because
// only a module graph's first evaluation can be observed. This catches a
// transitive import that no source scan would see.
const DENY_HOOK = path.join(root, 'test', 'support', 'deny-modules.mjs');

async function importUnderHook(
  specifier: string,
  denied: readonly string[],
  cwd = gasRoot
): Promise<void> {
  await run(
    process.execPath,
    [
      '--import',
      pathToFileURL(DENY_HOOK).href,
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(specifier)});`
    ],
    { cwd, env: { ...process.env, DENY_MODULES: denied.join(',') } }
  );
}

const SPECIFIERS = CODE_SUBPATHS.map((subpath) =>
  subpath === '.' ? GAS : `${GAS}/${subpath.slice(2)}`
);

describe('the Google GenAI SDK', () => {
  const DENIED = ['@google/genai'];

  it.concurrent.each(SPECIFIERS)('is not loaded by %s', async (specifier) => {
    await expect(importUnderHook(specifier, DENIED)).resolves.toBeUndefined();
  });

  // Without this the hook could be broken and every case above would still pass.
  it('is loaded by @luna-estelar/gas-lyria, which the hook catches', async () => {
    await expect(importUnderHook('@luna-estelar/gas-lyria', DENIED, lyriaRoot)).rejects.toThrow(
      '@google/genai was loaded'
    );
  });
});

// The compiler carries Langium and Chevrotain, which dwarf everything else here.
// A host that drives a session without compiling source must not pay for them,
// so every entry point but ./language is parser-free, including the root, whose
// session loads the compiler through a dynamic import only when it compiles.
describe('the GAS compiler', () => {
  const DENIED = ['langium', 'chevrotain'];
  const COMPILING = `${GAS}/language`;

  it.concurrent.each(SPECIFIERS.filter((specifier) => specifier !== COMPILING))(
    'is not loaded by %s',
    async (specifier) => {
      await expect(importUnderHook(specifier, DENIED)).resolves.toBeUndefined();
    }
  );

  // The control: without it the hook could be broken and every case above
  // would still pass.
  it(`is loaded by ${COMPILING}, which the hook catches`, async () => {
    await expect(importUnderHook(COMPILING, DENIED)).rejects.toThrow(
      /(langium|chevrotain) was loaded/
    );
  });
});
