// Render a .gas document through a running Magenta bridge to a WAV file.
// Changes are applied by audio time rather than wall time, so the result is the
// same arrangement on a machine that generates slower than real time. Excluded
// from CI; see the adjacent README.

import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const outIndex = path.resolve(here, '..', 'out', 'index.js');
if (!existsSync(outIndex)) {
  console.error('The connector is not built. Run `pnpm build` first.');
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    fixture: { type: 'string' },
    duration: { type: 'string', default: '30' },
    out: { type: 'string', default: 'magenta-render.wav' },
    endpoint: { type: 'string' },
    config: { type: 'string' }
  }
});

if (values.fixture === undefined) {
  console.error('Pass --fixture <path to .gas>.');
  process.exit(1);
}
const durationSeconds = Number(values.duration);
if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
  console.error('--duration must be a positive number of seconds.');
  process.exit(1);
}

const { compileSource } = await import('@luna-estelar/gas-language');
const {
  authoredEventSchedule,
  createInputState,
  effectiveStateAt,
  sectionInstanceAt,
  validateTimeline
} = await import('@luna-estelar/gas-core');
const { createMagentaConnector, DEFAULT_MAGENTA_CONFIG } = await import(outIndex);

const fixturePath = path.resolve(process.cwd(), values.fixture);
const fixtureName = path.basename(fixturePath);
const compiled = compileSource(readFileSync(fixturePath, 'utf8'), { name: fixtureName });
if (!compiled.ok) {
  console.error(`Could not compile ${fixtureName}:`);
  for (const diagnostic of compiled.diagnostics) console.error(`  ${diagnostic.message}`);
  process.exit(1);
}
const timeline = compiled.timeline;
if (!validateTimeline(timeline).ok) {
  console.error(`Timeline for ${fixtureName} did not validate.`);
  process.exit(1);
}

const tempo = timeline.musicalContext?.tempo ?? 120;
const timeSignature = timeline.musicalContext?.timeSignature ?? { beatsPerBar: 4, beatUnit: 4 };
const key = timeline.musicalContext?.key;
const secondsPerBar = (timeSignature.beatsPerBar * 60) / tempo;
const timing = { tempo, timeSignature, secondsPerBar, ...(key !== undefined ? { key } : {}) };

const inputState = createInputState(timeline);
const stateAt = (position) =>
  effectiveStateAt(inputState, position, {
    loopIteration: 0,
    activeSection: sectionInstanceAt(timeline, position)
  });
const schedule = authoredEventSchedule(timeline).filter(
  (position) => (position.bar - 1) * secondsPerBar < durationSeconds
);

const config =
  values.config !== undefined
    ? JSON.parse(readFileSync(path.resolve(values.config), 'utf8'))
    : DEFAULT_MAGENTA_CONFIG;
const token = process.env.GAS_MAGENTA_TOKEN;
const settings = {
  ...(values.endpoint !== undefined ? { endpoint: values.endpoint } : {}),
  ...(token !== undefined && token !== '' ? { token } : {})
};

const chunks = [];
let receivedSeconds = 0;
let failure;
let wake = () => {};
const sink = {
  push(chunk) {
    chunks.push(chunk.bytes);
    receivedSeconds += chunk.durationSeconds;
    wake();
  },
  status() {},
  warning(warning) {
    console.log(`warning: ${warning.code}`);
  },
  failure(value) {
    failure = value;
    wake();
  }
};
const audioReaches = (seconds) =>
  new Promise((resolve) => {
    wake = () => {
      if (receivedSeconds >= seconds || failure !== undefined) resolve();
    };
    wake();
  });

const connector = createMagentaConnector();
const runId = 'manual-render';
const started = Date.now();
try {
  await connector.open(settings);
  const first = schedule[0] ?? { bar: 1, beat: 1 };
  await connector.prepare(stateAt(first), config);
  await connector.start(sink, timing, runId);
  for (const position of schedule.slice(1)) {
    await audioReaches((position.bar - 1) * secondsPerBar);
    if (failure !== undefined) break;
    await connector.update({ state: stateAt(position) }, position);
    console.log(`bar ${position.bar}: applied at ${receivedSeconds.toFixed(2)} s of audio`);
  }
  await audioReaches(durationSeconds);
  await connector.stop(runId);
} finally {
  await connector.close();
}

if (failure !== undefined || chunks.length === 0) {
  console.error(`The render ended without usable audio${failure ? ` (${failure.code})` : ''}.`);
  process.exit(1);
}

const pcm = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).subarray(
  0,
  Math.round(durationSeconds * 48_000) * 4
);
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(48_000, 24);
header.writeUInt32LE(192_000, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);
const outputPath = path.resolve(values.out);
await writeFile(outputPath, Buffer.concat([header, pcm]));

const wallSeconds = (Date.now() - started) / 1000;
console.log(
  `Wrote ${(pcm.length / 192_000).toFixed(2)} s of audio to ${outputPath} ` +
    `in ${wallSeconds.toFixed(1)} s (${(pcm.length / 192_000 / wallSeconds).toFixed(2)}x real time).`
);
