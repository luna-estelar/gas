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

// The umbrella depends on every package, so its directory resolves each
// workspace specifier, and Node's self-reference resolves the umbrella's own
// name and subpaths from inside it.
const resolveFrom = path.join(root, 'packages', 'gas');

const ENTRYPOINTS = [
  '@luna-estelar/gas-protocol/validation',
  '@luna-estelar/gas-core',
  '@luna-estelar/gas-renderer',
  '@luna-estelar/gas-api',
  '@luna-estelar/gas-browser/session',
  '@luna-estelar/gas',
  '@luna-estelar/gas/browser/session'
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

// LE-87: importing cleanly is not enough if a later call compiles a schema. Every
// renderer config path runs here under a Function constructor that throws, as
// a strict CSP would. The connector validates its own configuration.
const CONFIG_PATHS_SCRIPT = `
  const { createRenderer } = await import('@luna-estelar/gas-renderer');
  globalThis.Function = new Proxy(Function, {
    construct() { throw new EvalError('Code generation from strings disallowed'); }
  });
  const validated = [];
  const connector = {
    async describe() {
      return {
        id: 'inline', displayName: 'Inline',
        capabilities: { intents: {} },
        model: {
          connectorId: 'inline', modelId: 'inline', displayName: 'Inline', codec: 'pcm',
          sampleFormat: 's16le', sampleRate: 48000, channels: 2, chunkDurationSeconds: 2
        },
        configSchema: { type: 'object', properties: { level: { type: 'number' } } },
        defaultConfig: { level: 1 },
        supportsFlowControl: false
      };
    },
    validateConfig(config) {
      validated.push(config);
      return typeof config.level === 'number'
        ? { ok: true }
        : { ok: false, problems: [{ path: '/level', code: 'wrong-type', message: 'Level is a number.' }] };
    },
    async open() {}, async prepare() {}, async start() {}, async update(_u, at) { return at; },
    async stop() {}, async close() {}
  };
  const clock = { now: () => 0, schedule: () => ({ token: 0 }), cancel() {} };
  const renderer = await createRenderer({
    clock, connector, connectorConfig: { level: 2 }
  });
  await renderer.updateConnectorConfig({ level: 3 });
  const rejected = await renderer.updateConnectorConfig({ level: 'loud' }).then(() => false, () => true);
  console.log(JSON.stringify({ validated: validated.length, rejected, level: renderer.getConnectorConfig().level }));
`;

describe('runtime code generation', () => {
  it.each(ENTRYPOINTS)('does not generate code when importing %s', async (specifier) => {
    expect(await countGeneratedFunctions(specifier)).toBe(0);
  });

  it('validates connector configuration on every renderer path without generating code', async () => {
    const { stdout } = await run(
      process.execPath,
      ['--input-type=module', '-e', CONFIG_PATHS_SCRIPT],
      { cwd: resolveFrom }
    );
    expect(JSON.parse(stdout.trim())).toEqual({ validated: 4, rejected: true, level: 3 });
  });
});
