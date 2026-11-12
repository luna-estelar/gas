// Manual measurement of how late a prompt change lands in Lyria RealTime's audio.
// Uses the Google SDK directly, because the connector's transport drops the
// per-chunk source metadata this reads. Settings come from the environment;
// excluded from CI.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const apiKey = process.env.GAS_LYRIA_RT_API_KEY;
if (apiKey === undefined || apiKey.trim() === '') {
  console.error('Set GAS_LYRIA_RT_API_KEY for an authorized measurement.');
  process.exit(1);
}
const runs = Number(process.env.GAS_LYRIA_RT_REACTION_RUNS ?? 5);
if (!Number.isInteger(runs) || runs < 1) {
  console.error('GAS_LYRIA_RT_REACTION_RUNS must be a whole number of at least 1.');
  process.exit(1);
}

const { GoogleGenAI } = await import('@google/genai');

const MODEL = 'models/lyria-realtime-exp';
const PCM_BYTES_PER_SECOND = 48_000 * 2 * 2;
const BEFORE_SECONDS = 16;
const AFTER_SECONDS = 16;
const SETUP_LIMIT_SECONDS = 15;

const musicGenerationConfig = {
  temperature: 1.1,
  guidance: 4,
  topK: 40,
  musicGenerationMode: 'QUALITY',
  bpm: 96
};
const FIRST = 'soft evolving synthesizer chords, warm and spacious';
const SECOND = 'bright plucked guitar arpeggios over a steady beat';

const now = () => performance.now() / 1000;
const delay = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const round = (value) => (value === undefined ? undefined : Math.round(value * 1000) / 1000);

async function measureRun() {
  // One row per chunk: when it arrived, where it starts in the audio, and its prompt texts.
  const chunks = [];
  let audioSeconds = 0;
  let closed = false;
  let setupDone;
  const setup = new Promise((resolve, reject) => {
    setupDone = resolve;
    setTimeout(
      () => reject(new Error('Setup did not complete in time.')),
      SETUP_LIMIT_SECONDS * 1000
    );
  });

  const session = await new GoogleGenAI({ apiKey, apiVersion: 'v1alpha' }).live.music.connect({
    model: MODEL,
    callbacks: {
      onmessage: (message) => {
        if (message.setupComplete !== undefined) setupDone();
        for (const chunk of message.serverContent?.audioChunks ?? []) {
          if (typeof chunk.data !== 'string') continue;
          const seconds = Buffer.from(chunk.data, 'base64').length / PCM_BYTES_PER_SECOND;
          const prompts = chunk.sourceMetadata?.clientContent?.weightedPrompts;
          chunks.push({
            at: now(),
            startsAt: audioSeconds,
            seconds,
            prompts: prompts?.map((prompt) => prompt.text)
          });
          audioSeconds += seconds;
        }
      },
      onerror: () => {
        closed = true;
      },
      onclose: () => {
        closed = true;
      }
    }
  });

  try {
    await setup;
    await session.setMusicGenerationConfig({ musicGenerationConfig });
    await session.setWeightedPrompts({ weightedPrompts: [{ text: FIRST, weight: 1 }] });
    session.play();
    await delay(BEFORE_SECONDS);

    const sentAt = now();
    const audioAtSend = audioSeconds;
    await session.setWeightedPrompts({ weightedPrompts: [{ text: SECOND, weight: 1 }] });
    await delay(AFTER_SECONDS);
    if (closed) throw new Error('The session closed early.');

    const firstAt = chunks[0]?.at;
    if (firstAt === undefined) throw new Error('No audio arrived.');
    // Lead: audio received so far, minus the real time since the first chunk.
    const leads = chunks.map((chunk) => chunk.startsAt + chunk.seconds - (chunk.at - firstAt));
    const changed = chunks.find((chunk) => chunk.prompts?.includes(SECOND) === true);
    return {
      hasSourceMetadata: chunks.some((chunk) => chunk.prompts !== undefined),
      chunkSeconds: round(chunks[0].seconds),
      // Audio the model had already sent when the first chunk made from the new prompts begins.
      reactionAudioSeconds: round(
        changed === undefined ? undefined : changed.startsAt - audioAtSend
      ),
      reactionWallSeconds: round(changed === undefined ? undefined : changed.at - sentAt),
      leadAtSendSeconds: round(audioAtSend - (sentAt - firstAt)),
      leadMaxSeconds: round(Math.max(...leads)),
      leadEndSeconds: round(leads.at(-1)),
      chunks
    };
  } finally {
    session.close();
  }
}

function summarize(values) {
  const sorted = values.filter((value) => value !== undefined).sort((a, b) => a - b);
  if (sorted.length === 0) return { samples: 0 };
  return {
    samples: sorted.length,
    min: sorted[0],
    median: sorted[Math.ceil(sorted.length / 2) - 1],
    max: sorted.at(-1)
  };
}

const results = [];
for (let run = 1; run <= runs; run++) {
  try {
    results.push(await measureRun());
    console.error(`run ${run}/${runs} done`);
  } catch (error) {
    console.error(`run ${run}/${runs} failed: ${error.message}`);
  }
}
if (results.length === 0) {
  console.error('No run completed.');
  process.exit(1);
}

const hasSourceMetadata = results.every((result) => result.hasSourceMetadata);
if (!hasSourceMetadata) {
  console.error('Lyria RealTime sent no source metadata, so only the lead is measured.');
}
const summary = {
  runs: results.length,
  hasSourceMetadata,
  chunkSeconds: summarize(results.map((result) => result.chunkSeconds)),
  reactionAudioSeconds: summarize(results.map((result) => result.reactionAudioSeconds)),
  reactionWallSeconds: summarize(results.map((result) => result.reactionWallSeconds)),
  leadSeconds: {
    atSend: summarize(results.map((result) => result.leadAtSendSeconds)),
    max: summarize(results.map((result) => result.leadMaxSeconds)),
    end: summarize(results.map((result) => result.leadEndSeconds))
  }
};
console.log(JSON.stringify(summary, null, 2));

const outputPath = process.env.GAS_LYRIA_RT_REACTION_OUTPUT;
if (outputPath !== undefined && outputPath.trim() !== '') {
  await writeFile(path.resolve(outputPath), JSON.stringify({ summary, results }, null, 2));
  console.error('Wrote the raw samples.');
}
