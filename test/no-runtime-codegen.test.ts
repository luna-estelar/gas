// The website ships a Content Security Policy without 'unsafe-eval', so nothing
// a browser session imports may build code at runtime: `new Function` and `eval`
// are blocked, and a throw during module evaluation takes the whole chunk with
// it. LE-86 was exactly that — the protocol's canonical validator compiled its
// schemas at import, so importing the renderer cost 33 generated functions
// before any session code ran.
//
// Each entrypoint is imported in its own child process: only the first
// evaluation of a module graph can be observed, and Vitest shares module caches
// across the tests in a file.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The browser package depends on every entrypoint below, so its directory
// resolves each workspace specifier.
const resolveFrom = path.join(root, 'packages', 'browser');

const ENTRYPOINTS = [
  '@luna-estelar/gas-protocol/validation',
  '@luna-estelar/gas-core',
  '@luna-estelar/gas-renderer',
  '@luna-estelar/gas-api',
  '@luna-estelar/gas-browser/wiring'
];

async function countGeneratedFunctions(specifier: string): Promise<number> {
  const script = `
    let constructed = 0;
    globalThis.Function = new Proxy(Function, {
      construct(target, args, newTarget) {
        constructed++;
        return Reflect.construct(target, args, newTarget);
      }
    });
    await import(${JSON.stringify(specifier)});
    console.log(constructed);
  `;
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], {
    cwd: resolveFrom
  });
  return Number(stdout.trim());
}

describe('runtime code generation', () => {
  it.each(ENTRYPOINTS)('does not generate code when importing %s', async (specifier) => {
    expect(await countGeneratedFunctions(specifier)).toBe(0);
  });
});
