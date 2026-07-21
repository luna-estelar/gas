// Manual listening comparison using GEMINI_API_KEY from the environment.
// Makes provider calls and writes audio plus a manifest; excluded from CI.
// See the adjacent README for options and listening results.

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const outIndex = path.join(packageRoot, 'out', 'index.js');

if (!existsSync(outIndex)) {
  console.error('The connector is not built yet. Run `pnpm build` first, then retry.');
  process.exit(1);
}

const apiKey = process.env.GEMINI_API_KEY;
if (apiKey === undefined || apiKey.trim() === '') {
  console.error(
    'Set GEMINI_API_KEY to your own Gemini API key before running the listening harness.\n' +
      'The harness uses direct BYOK access only and never routes through the hosted proxy.'
  );
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    fixture: { type: 'string' },
    strategy: { type: 'string', default: 'per-track' },
    seed: { type: 'string' },
    duration: { type: 'string', default: '30' },
    out: { type: 'string', default: 'listening' }
  },
  allowPositionals: true
});

if (values.fixture === undefined) {
  console.error('Pass --fixture <path to .gas>.');
  process.exit(1);
}
if (values.strategy !== 'per-track' && values.strategy !== 'global-plus-tracks') {
  console.error("--strategy must be 'per-track' or 'global-plus-tracks'.");
  process.exit(1);
}

const durationSeconds = Number(values.duration);
if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
  console.error('--duration must be a positive number of seconds.');
  process.exit(1);
}
const seed = values.seed !== undefined ? Number(values.seed) : undefined;
if (seed !== undefined && !Number.isInteger(seed)) {
  console.error('--seed must be an integer.');
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
const { GoogleGenAI } = await import('@google/genai');
const {
  DEFAULT_LYRIA_CONFIG,
  classifyKey,
  createPromptTransition,
  resolveLyriaConfig,
  translatePrompts
} = await import('@luna-estelar/gas-connector-lyria');

const MODEL = 'models/lyria-realtime-exp';
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const PCM_BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE; // 192_000

const fixturePath = path.resolve(process.cwd(), values.fixture);
const source = readFileSync(fixturePath, 'utf8');
const fixtureName = path.basename(fixturePath);

const compiled = compileSource(source, { name: fixtureName });
if (!compiled.ok) {
  console.error(`Could not compile ${fixtureName}:`);
  for (const diagnostic of compiled.diagnostics) console.error(`  ${diagnostic.message}`);
  process.exit(1);
}
const timeline = compiled.timeline;
const validation = validateTimeline(timeline);
if (!validation.ok) {
  console.error(`Timeline for ${fixtureName} did not validate.`);
  process.exit(1);
}

const tempo = timeline.musicalContext?.tempo ?? 120;
const timeSignature = timeline.musicalContext?.timeSignature ?? { beatsPerBar: 4, beatUnit: 4 };
const secondsPerBar = (timeSignature.beatsPerBar * 60) / tempo;
const bpm = Math.min(200, Math.max(60, Math.round(tempo)));

const key = timeline.musicalContext?.key;
const classification =
  key !== undefined ? classifyKey(key) : { nativeScale: 'none', promptText: '' };

const config = resolveLyriaConfig(DEFAULT_LYRIA_CONFIG);
const musicGenerationConfig = {
  temperature: config.generation.temperature,
  guidance: config.generation.guidance,
  topK: config.generation.topK,
  musicGenerationMode: config.generation.mode === 'diversity' ? 'DIVERSITY' : 'QUALITY',
  muteBass: config.generation.muteBass,
  muteDrums: config.generation.muteDrums,
  onlyBassAndDrums: config.generation.onlyBassAndDrums,
  bpm,
  ...(classification.nativeScale !== 'none' ? { scale: classification.nativeScale } : {}),
  ...(seed !== undefined ? { seed } : {})
};

const promptOptions = { ...config.prompt, strategy: values.strategy };
const inputState = createInputState(timeline);

// A monotonic clock backed by wall time; the transition machine schedules
// against absolute seconds, matching the renderer contract.
const clock = {
  now: () => process.hrtime.bigint(),
  timers: new Set(),
  schedule(deadlineSeconds, callback) {
    const delayMs = Math.max(
      0,
      deadlineSeconds * 1000 - Number(process.hrtime.bigint() / 1_000_000n)
    );
    const timer = setTimeout(callback, delayMs);
    this.timers.add(timer);
    return { token: timer };
  },
  cancel(timer) {
    clearTimeout(timer.token);
    this.timers.delete(timer.token);
  }
};
// The clock's `now()` must return seconds; wrap hrtime for that.
const startNs = process.hrtime.bigint();
clock.now = () => Number(process.hrtime.bigint() - startNs) / 1e9;

const pcmChunks = [];
const emittedPrompts = [];
let sessionError;
let resolveSetup;
let rejectSetup;
let setupSettled = false;
const setupReady = new Promise((resolve, reject) => {
  resolveSetup = resolve;
  rejectSetup = reject;
});
const setupTimeout = setTimeout(() => {
  if (setupSettled) return;
  setupSettled = true;
  rejectSetup(new Error('Lyria setup did not complete in time.'));
}, 15_000);

const session = await new GoogleGenAI({ apiKey, apiVersion: 'v1alpha' }).live.music.connect({
  model: MODEL,
  callbacks: {
    onmessage: (message) => {
      if (!setupSettled && message.setupComplete !== undefined) {
        setupSettled = true;
        resolveSetup();
      }
      const chunks = message.serverContent?.audioChunks ?? [];
      for (const chunk of chunks) {
        if (typeof chunk.data === 'string') pcmChunks.push(Buffer.from(chunk.data, 'base64'));
      }
    },
    onerror: (event) => {
      sessionError = event;
      if (!setupSettled) {
        setupSettled = true;
        rejectSetup(new Error('The Lyria session failed during setup.'));
      }
    },
    onclose: () => {
      if (!setupSettled) {
        setupSettled = true;
        rejectSetup(new Error('The Lyria session closed during setup.'));
      }
    }
  }
});

try {
  await setupReady;
} catch {
  session.close();
  console.error('The Lyria session did not complete setup; no capture was written.');
  process.exit(1);
} finally {
  clearTimeout(setupTimeout);
}

const sender = {
  async send(prompts) {
    emittedPrompts.push({ atMs: Math.round(clock.now() * 1000), prompts });
    await session.setWeightedPrompts({
      weightedPrompts: prompts.map((prompt) => ({ text: prompt.text, weight: prompt.weight }))
    });
  },
  async requestPlay() {
    session.play();
  },
  async requestPause() {
    session.pause();
  }
};

const machine = createPromptTransition({
  clock,
  sender,
  onFailure: (failure) => {
    sessionError = failure;
  },
  transitionDurationMs: config.prompt.transitionDurationMs,
  transitionSteps: config.prompt.transitionSteps
});

const runId = 'listen';
machine.beginRun(runId);
await session.setMusicGenerationConfig({ musicGenerationConfig });

function delay(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

console.log(
  `Listening to ${fixtureName} with strategy ${values.strategy} for ${durationSeconds}s.`
);
console.log(
  `tempo ${tempo}, key ${key ?? '(none)'}, scale ${musicGenerationConfig.scale ?? '(prompt)'}.`
);

const schedule = authoredEventSchedule(timeline);
const startTime = clock.now();
let lastBar = 0;

for (const position of schedule) {
  const bar = position.bar;
  const targetTime = startTime + (bar - 1) * secondsPerBar;
  const wait = targetTime - clock.now();
  if (wait > 0) await delay(wait);
  if (clock.now() - startTime >= durationSeconds) break;

  const activeSection = sectionInstanceAt(timeline, position);
  const state = effectiveStateAt(inputState, position, { loopIteration: 0, activeSection });
  await machine.update(translatePrompts(state, promptOptions));
  lastBar = bar;
}

const remaining = durationSeconds - (clock.now() - startTime);
if (remaining > 0) await delay(remaining);

machine.endRun(runId);
session.stop();
session.close();

if (sessionError !== undefined) {
  console.error('The Lyria session reported an error during capture; the take may be incomplete.');
}

const pcm = Buffer.concat(pcmChunks);
const outDir = path.resolve(process.cwd(), values.out);
await mkdir(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const base = `${fixtureName.replace(/\.gas$/, '')}--${values.strategy}--${stamp}`;
const wavPath = path.join(outDir, `${base}.wav`);
const manifestPath = path.join(outDir, `${base}.json`);

await writeFile(wavPath, wavFile(pcm));
await writeFile(
  manifestPath,
  JSON.stringify(
    {
      fixture: fixtureName,
      strategy: values.strategy,
      ...(seed !== undefined ? { seed } : {}),
      timestamp: new Date().toISOString(),
      model: MODEL,
      musicGenerationConfig,
      tempo,
      key: key ?? null,
      scale: musicGenerationConfig.scale ?? null,
      lastBar,
      emittedPrompts,
      audio: {
        format: 's16le',
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        bytes: pcm.length,
        seconds: pcm.length / PCM_BYTES_PER_SECOND
      }
    },
    null,
    2
  )
);

console.log(
  `Wrote ${path.relative(process.cwd(), wavPath)} (${(pcm.length / PCM_BYTES_PER_SECOND).toFixed(1)}s).`
);
console.log(`Wrote ${path.relative(process.cwd(), manifestPath)}.`);

/** Wrap raw signed 16-bit little-endian stereo PCM in a 44-byte RIFF/WAVE header. */
function wavFile(pcm) {
  const header = Buffer.alloc(44);
  const byteRate = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
  const blockAlign = CHANNELS * BYTES_PER_SAMPLE;
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
