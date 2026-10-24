// Manual end-to-end run against a live mrt2-bridge: compiles a .gas file, plays
// it through the real session, renderer and connector, applies a live change
// part-way, and writes the audio plus a timing manifest. Excluded from CI.
// See the adjacent README.
//
//   pnpm --filter @luna-estelar/gas-magenta-rt2 manual:listen \
//     --fixture manual/fixtures/01-two-tracks.gas --duration 20 --out /tmp/mrt2-listen
//
// A bridge started with --token reads it from GAS_MAGENTA_RT2_TOKEN, never argv.

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const outIndex = path.join(here, '..', 'out', 'index.js');
if (!existsSync(outIndex)) {
  console.error('The connector is not built yet. Run `pnpm build` first, then retry.');
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    fixture: { type: 'string', default: path.join(here, 'fixtures', '01-two-tracks.gas') },
    endpoint: { type: 'string', default: 'ws://127.0.0.1:8765' },
    duration: { type: 'string', default: '20' },
    'change-at': { type: 'string', default: '10' },
    change: { type: 'string', default: 'lead.flavor "bright and airy"' },
    out: { type: 'string', default: 'mrt2-listening' }
  }
});

const durationSeconds = Number(values.duration);
const changeAt = Number(values['change-at']);
if (!(durationSeconds > 0) || !(changeAt >= 0)) {
  console.error('--duration must be positive and --change-at non-negative.');
  process.exit(1);
}

const { createRenderer, createSession } = await import('@luna-estelar/gas');
const { createMagentaRt2Connector } = await import('../out/index.js');

const started = performance.now();
const elapsed = () => (performance.now() - started) / 1000;
const clock = {
  now: () => performance.now() / 1000,
  schedule: (deadline, callback) => ({
    token: setTimeout(callback, Math.max(0, deadline * 1000 - performance.now()))
  }),
  cancel: (timer) => clearTimeout(timer.token)
};

const events = [];
const chunks = [];
let firstAudioAt;
const session = await createSession({
  createRenderer: () =>
    createRenderer({
      clock,
      connector: createMagentaRt2Connector(),
      settings: {
        endpoint: values.endpoint,
        ...(process.env.GAS_MAGENTA_RT2_TOKEN ? { token: process.env.GAS_MAGENTA_RT2_TOKEN } : {})
      },
      firstAudioTimeoutSeconds: 15
    })
});
session.on('audio', (chunk) => {
  firstAudioAt ??= elapsed();
  chunks.push(chunk);
});
session.on('warning', (warning) => events.push({ at: elapsed(), warning: warning.code }));
session.on('error', (error) => events.push({ at: elapsed(), error: error.code ?? error.kind }));
session.on('lifecycle', (event) =>
  events.push({ at: elapsed(), lifecycle: event.rendererPlayback, stream: event.stream })
);

await session.loadSource(readFileSync(values.fixture, 'utf8'));
const playCalledAt = elapsed();
await session.play();
const playResolvedAt = elapsed();

await new Promise((resolve) => setTimeout(resolve, changeAt * 1000));
const changeSentAt = elapsed();
const changeResult = await session.submitLiveCommands(values.change);
const changeAppliedAt = elapsed();
events.push({ at: changeSentAt, live: values.change, ok: changeResult.ok });

await new Promise((resolve) => setTimeout(resolve, Math.max(0, durationSeconds - changeAt) * 1000));
await session.stop();
await session.close();

const pcm = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.bytes)));
const audioSeconds = chunks.reduce((sum, chunk) => sum + chunk.durationSeconds, 0);
await mkdir(values.out, { recursive: true });
await writeFile(path.join(values.out, 'capture.wav'), wav(pcm, 48_000, 2));
const manifest = {
  fixture: path.basename(values.fixture),
  endpoint: new URL(values.endpoint).host,
  wallSeconds: Number(elapsed().toFixed(3)),
  playResolvedSeconds: Number((playResolvedAt - playCalledAt).toFixed(3)),
  firstAudioSeconds:
    firstAudioAt === undefined ? null : Number((firstAudioAt - playCalledAt).toFixed(3)),
  audioSeconds: Number(audioSeconds.toFixed(3)),
  chunks: chunks.length,
  liveChange: {
    statement: values.change,
    ok: changeResult.ok,
    applySeconds: Number((changeAppliedAt - changeSentAt).toFixed(3))
  },
  events
};
await writeFile(path.join(values.out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ ...manifest, events: manifest.events.length }, null, 2));

function wav(data, sampleRate, channels) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
