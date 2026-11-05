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

const apiKey = process.env.GAS_LYRIA_RT_API_KEY;
if (apiKey === undefined || apiKey.trim() === '') {
  console.error('Set GAS_LYRIA_RT_API_KEY for an authorized smoke.');
  process.exit(1);
}
const endpoint = process.env.GAS_LYRIA_RT_ENDPOINT;
const settings =
  endpoint === undefined || endpoint.trim() === '' ? { apiKey } : { apiKey, endpoint };

const { createSession, sourceText } = await import('@luna-estelar/gas');
const { createLyriaRtConnector } = await import(outIndex);

const document = `tempo 96
key "C major"
length bars 64
flavor "warm, spacious, and gently uplifting"
track pad "soft evolving synthesizer chords"
section a:
    length bars 64
    bar 1:
        pad.play
a()
`;

const chunks = [];
const errors = [];
let generatedSeconds = 0;
let playSeconds = 0;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// Plays, changes tempo and flavor, stops, plays again and closes, so each Play
// opens its own connection.
const session = await createSession({ connector: createLyriaRtConnector(settings) });
session.on('audio', (chunk) => {
  chunks.push(chunk.bytes);
  generatedSeconds += chunk.durationSeconds;
  playSeconds += chunk.durationSeconds;
});
session.on('warning', (warning) => console.log(`warning: ${warning.code}`));
session.on('error', (error) => errors.push(error));

const playsWithAudio = [];
try {
  await session.loadSource(sourceText(document, 'smoke.gas'));

  await session.play();
  await delay(6000);
  await session.apply([
    { kind: 'setTempo', bpm: 104 },
    { kind: 'setTrackFlavor', trackId: 'track.pad', value: 'a little brighter and more rhythmic' }
  ]);
  await delay(4000);
  await session.stop();
  playsWithAudio.push(playSeconds);

  playSeconds = 0;
  await session.play();
  await delay(5000);
  await session.stop();
  playsWithAudio.push(playSeconds);
} catch (error) {
  console.error(
    `The authorized Lyria RealTime smoke did not complete: ${error.kind} ${error.code ?? ''}`
  );
  await session.close();
  process.exit(1);
}
await session.close();

for (const error of errors) console.error(`error: ${error.kind} ${error.code ?? ''}`);
if (errors.length > 0 || playsWithAudio.some((seconds) => seconds === 0)) {
  console.error('The Lyria RealTime smoke ended without usable audio on every Play.');
  process.exit(1);
}

const outputPath = process.env.GAS_LYRIA_RT_SMOKE_OUTPUT;
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
  `Lyria RealTime smoke completed: ${chunks.length} chunks, ${generatedSeconds.toFixed(2)} generated seconds, ` +
    `${playsWithAudio.map((seconds) => seconds.toFixed(1)).join(' s and ')} s on the two Plays.`
);
