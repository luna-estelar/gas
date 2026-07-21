// Manual transport smoke. Connection settings come from the environment; excluded from CI.

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outIndex = path.resolve(here, '..', 'out', 'index.js');
if (!existsSync(outIndex)) {
  console.error('The connector is not built. Run `pnpm build` first.');
  process.exit(1);
}

const accessMode = process.env.GAS_LYRIA_ACCESS_MODE;
let settings;
if (accessMode === 'byok') {
  const apiKey = process.env.GAS_LYRIA_API_KEY;
  if (apiKey === undefined || apiKey.trim() === '') {
    console.error('Set GAS_LYRIA_API_KEY for an authorized BYOK smoke.');
    process.exit(1);
  }
  settings = { accessMode: 'byok', apiKey };
} else if (accessMode === 'hosted') {
  const proxyBaseUrl = process.env.GAS_LYRIA_PROXY_BASE_URL;
  if (proxyBaseUrl === undefined || proxyBaseUrl.trim() === '') {
    console.error('Set GAS_LYRIA_PROXY_BASE_URL for an authorized hosted smoke.');
    process.exit(1);
  }
  settings = { accessMode: 'hosted', proxyBaseUrl };
} else {
  console.error("Set GAS_LYRIA_ACCESS_MODE to either 'byok' or 'hosted'.");
  process.exit(1);
}

const { createLyriaConnector, DEFAULT_LYRIA_CONFIG } = await import(outIndex);
const connector = createLyriaConnector();
const chunks = [];
let generatedSeconds = 0;
let failure;
const runId = 'manual-smoke';

const initialState = {
  globals: { flavor: { kind: 'text', text: 'warm, spacious, and gently uplifting' }, tempo: 96 },
  tracks: [
    {
      trackId: 'smoke-pad',
      name: 'soft synthesizer',
      description: 'soft evolving synthesizer chords',
      active: true,
      timbre: { kind: 'text', text: 'rounded analog tone' },
      level: { kind: 'level', value: 0.8 }
    }
  ]
};
const updatedState = {
  ...initialState,
  globals: { ...initialState.globals, tempo: 104 },
  tracks: [
    {
      ...initialState.tracks[0],
      flavor: { kind: 'text', text: 'a little brighter and more rhythmic' }
    }
  ]
};
const timing = {
  tempo: 96,
  timeSignature: { beatsPerBar: 4, beatUnit: 4 },
  key: 'C major',
  secondsPerBar: 2.5
};

const sink = {
  push(chunk) {
    chunks.push(chunk.bytes);
    generatedSeconds += chunk.durationSeconds;
  },
  status() {},
  warning(warning) {
    console.log(`warning: ${warning.code}`);
  },
  failure(value) {
    failure = value;
  }
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

try {
  await connector.describe();
  await connector.open(settings);
  await connector.prepare(initialState, DEFAULT_LYRIA_CONFIG);
  await connector.start(sink, timing, runId);
  await delay(6000);
  await connector.update({ state: updatedState }, { bar: 2 });
  await delay(3000);
  await connector.setGenerationPaused?.(true);
  await delay(1000);
  await connector.setGenerationPaused?.(false);
  await delay(3000);
  await connector.stop(runId);
  await connector.close();
} catch {
  await connector.close();
  console.error('The authorized Lyria smoke did not complete.');
  process.exit(1);
}

if (failure !== undefined || chunks.length === 0) {
  console.error('The Lyria smoke ended without usable audio.');
  process.exit(1);
}

const outputPath = process.env.GAS_LYRIA_SMOKE_OUTPUT;
if (outputPath !== undefined && outputPath.trim() !== '') {
  const pcmBytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBytes.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(48_000, 24);
  header.writeUInt32LE(192_000, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBytes.length, 40);
  await writeFile(path.resolve(outputPath), Buffer.concat([header, pcmBytes]));
  console.log('Wrote the requested local WAV capture.');
}

console.log(
  `Lyria smoke completed with ${chunks.length} chunks and ${generatedSeconds.toFixed(2)} generated seconds.`
);
