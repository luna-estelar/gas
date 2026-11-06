// Manual start-up delay measurement against a real mrt2-bridge. Connection
// settings come from the environment; excluded from CI. GAS 0.4 step 10 sets
// the connector's `startupDelaySeconds` from these numbers.

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

const endpoint = process.env.GAS_MAGENTA_RT2_ENDPOINT ?? 'ws://127.0.0.1:8765';
const token = process.env.GAS_MAGENTA_RT2_TOKEN;
const runs = Number(process.env.GAS_MAGENTA_RT2_STARTUP_RUNS ?? 10);
if (!Number.isInteger(runs) || runs < 1) {
  console.error('GAS_MAGENTA_RT2_STARTUP_RUNS must be a whole number of at least 1.');
  process.exit(1);
}

const { openMagentaRt2Session } = await import(outIndex);

const REST_SECONDS = [2, 4, 8];
const PLAY_SECONDS = 6;
const AFTER_RESUME_SECONDS = 4;
// Below this a chunk counts as silence: the model can start with a quiet fade-in.
const SOUND_DBFS = -50;
const WAIT_LIMIT_SECONDS = 20;

const FIRST_PROMPTS = [{ text: 'soft evolving synthesizer chords, warm and spacious', weight: 1 }];
const ENTRY_PROMPTS = [{ text: 'bright plucked guitar arpeggios over a steady beat', weight: 1 }];

const now = () => performance.now() / 1000;
const delay = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

function chunkDbfs(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sum = 0;
  const samples = bytes.byteLength / 2;
  for (let index = 0; index < samples; index++) {
    const sample = view.getInt16(index * 2, true) / 32768;
    sum += sample * sample;
  }
  const rms = Math.sqrt(sum / Math.max(1, samples));
  return rms === 0 ? -Infinity : 20 * Math.log10(rms);
}

/** Records audio arrivals, and resolves waits for the first chunk and first sound after a mark. */
function createListener() {
  const arrivals = [];
  let waiters = [];
  return {
    arrivals,
    onAudio(chunk) {
      const arrival = { at: now(), seconds: chunk.durationSeconds, dbfs: chunkDbfs(chunk.bytes) };
      arrivals.push(arrival);
      waiters = waiters.filter((waiter) => !waiter(arrival));
    },
    /** Times from `from` to the first chunk and the first loud chunk that arrive after it. */
    timeFrom(from) {
      return new Promise((resolve, reject) => {
        const result = { audio: undefined, sound: undefined };
        const timer = setTimeout(
          () => reject(new Error('No audio arrived in time.')),
          WAIT_LIMIT_SECONDS * 1000
        );
        waiters.push((arrival) => {
          if (arrival.at < from) return false;
          result.audio ??= arrival.at - from;
          if (arrival.dbfs > SOUND_DBFS) result.sound ??= arrival.at - from;
          if (result.sound === undefined) return false;
          clearTimeout(timer);
          resolve(result);
          return true;
        });
      });
    },
    secondsBetween(from, to) {
      return arrivals
        .filter((arrival) => arrival.at >= from && arrival.at < to)
        .reduce((total, arrival) => total + arrival.seconds, 0);
    }
  };
}

async function measureRun() {
  const listener = createListener();
  const errors = [];
  const openedAt = now();
  const session = await openMagentaRt2Session({
    endpoint,
    ...(token !== undefined && token !== '' ? { token } : {}),
    connectTimeoutSeconds: 60,
    onAudio: (chunk) => listener.onAudio(chunk),
    onClose: (error) => errors.push(error.code)
  });
  const setupSeconds = now() - openedAt;
  const first = listener.timeFrom(openedAt);
  await session.start(FIRST_PROMPTS);
  const connect = await first;

  const resumes = [];
  try {
    await delay(PLAY_SECONDS);
    for (const restSeconds of REST_SECONDS) {
      const pausedAt = now();
      await session.pause(true);
      await delay(restSeconds);
      const inFlightSeconds = listener.secondsBetween(pausedAt, now());
      await session.style(restSeconds === 4 ? FIRST_PROMPTS : ENTRY_PROMPTS);
      const resumedAt = now();
      const next = listener.timeFrom(resumedAt);
      await session.pause(false);
      const timing = await next;
      resumes.push({ restSeconds, inFlightSeconds, ...timing });
      await delay(AFTER_RESUME_SECONDS);
    }
  } finally {
    await session.close();
  }
  if (errors.length > 0) throw new Error(`The session closed early: ${errors.join(', ')}`);
  return { setupSeconds, connect, resumes };
}

function summarize(values) {
  const sorted = values.filter((value) => value !== undefined).sort((a, b) => a - b);
  const at = (fraction) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
  const round = (value) => Math.round(value * 1000) / 1000;
  return {
    samples: sorted.length,
    min: round(sorted[0]),
    median: round(at(0.5)),
    p90: round(at(0.9)),
    p95: round(at(0.95)),
    max: round(sorted.at(-1))
  };
}

const results = [];
for (let run = 1; run <= runs; run++) {
  try {
    results.push(await measureRun());
    console.error(`run ${run}/${runs} done`);
  } catch (error) {
    console.error(`run ${run}/${runs} failed: ${error.code ?? error.message}`);
  }
}
if (results.length === 0) {
  console.error('No run completed.');
  process.exit(1);
}

const resumes = results.flatMap((result) => result.resumes);
const summary = {
  runs: results.length,
  setup: summarize(results.map((result) => result.setupSeconds)),
  connectToFirstAudio: summarize(results.map((result) => result.connect.audio)),
  connectToFirstSound: summarize(results.map((result) => result.connect.sound)),
  resumeToFirstAudio: summarize(resumes.map((resume) => resume.audio)),
  resumeToFirstSound: summarize(resumes.map((resume) => resume.sound)),
  audioAfterPause: summarize(resumes.map((resume) => resume.inFlightSeconds)),
  resumeToFirstAudioByRest: Object.fromEntries(
    REST_SECONDS.map((rest) => [
      `${rest}s`,
      summarize(resumes.filter((resume) => resume.restSeconds === rest).map((r) => r.audio))
    ])
  )
};
console.log(JSON.stringify(summary, null, 2));

const outputPath = process.env.GAS_MAGENTA_RT2_STARTUP_OUTPUT;
if (outputPath !== undefined && outputPath.trim() !== '') {
  await writeFile(path.resolve(outputPath), JSON.stringify({ summary, results }, null, 2));
  console.error('Wrote the raw samples.');
}
