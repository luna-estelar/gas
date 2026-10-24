import { describe, expect, it } from 'vitest';
import type {
  AudioSink,
  ConnectorAudioChunk,
  ConnectorTiming,
  EffectiveState,
  RendererFailure,
  RendererWarning
} from '@luna-estelar/gas/protocol';
import { createMagentaRt2ConnectorWithDependencies } from '../src/connector.js';
import { VirtualClock } from '../../../test/support/virtual-clock.js';
import { FakeBridge } from './support/fake-bridge.js';

const STATE: EffectiveState = {
  globals: { flavor: { kind: 'text', text: 'late night' }, tempo: 90, key: 'A minor' },
  tracks: [
    { trackId: 'pad', name: 'pad', description: 'warm pads', active: true },
    { trackId: 'drums', name: 'drums', description: 'brushed drums', active: true }
  ]
};

const SILENT: EffectiveState = {
  globals: STATE.globals,
  tracks: STATE.tracks.map((track) => ({ ...track, active: false }))
};

const TIMING: ConnectorTiming = {
  tempo: 90,
  timeSignature: { beatsPerBar: 4, beatUnit: 4 },
  secondsPerBar: 4 / 1.5
};

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}

function setup() {
  const clock = new VirtualClock();
  const bridge = new FakeBridge();
  const connector = createMagentaRt2ConnectorWithDependencies({
    clock,
    createSocket: bridge.createSocket
  });
  const chunks: ConnectorAudioChunk[] = [];
  const warnings: RendererWarning[] = [];
  const failures: RendererFailure[] = [];
  const statuses: string[] = [];
  const sink: AudioSink = {
    push: (chunk) => chunks.push(chunk),
    status: (status) => statuses.push(status),
    warning: (warning) => warnings.push(warning),
    failure: (failure) => failures.push(failure)
  };
  return { clock, bridge, connector, sink, chunks, warnings, failures, statuses };
}

async function opened(harness: ReturnType<typeof setup>, settings: Record<string, string> = {}) {
  await harness.connector.open({ endpoint: 'ws://127.0.0.1:8765', ...settings });
  await harness.connector.prepare(STATE, {});
}

async function running(harness: ReturnType<typeof setup>) {
  harness.bridge.autoAnswer = true;
  await opened(harness);
  await harness.connector.start(harness.sink, TIMING, 'run-1');
}

describe('Magenta RT2 connector description', () => {
  it('describes 160 ms s16le packets and flow control without connecting', async () => {
    const { connector, bridge } = setup();
    const description = await connector.describe();
    expect(description.model).toMatchObject({
      sampleFormat: 's16le',
      sampleRate: 48_000,
      channels: 2,
      chunkDurationSeconds: 0.16
    });
    expect(description.supportsFlowControl).toBe(true);
    expect(description.capabilities.intents).toMatchObject({
      flavor: 'supported',
      tempo: 'approximated',
      notes: 'unsupported'
    });
    expect(bridge.sockets).toEqual([]);
  });
});

describe('Magenta RT2 startup', () => {
  it('greets with the token, then starts with translated prompts', async () => {
    const harness = setup();
    harness.bridge.token = 'sesame';
    await opened(harness, { token: 'sesame' });
    const started = harness.connector.start(harness.sink, TIMING, 'run-1');
    await flushAsync();

    const socket = harness.bridge.last;
    expect(socket.url).toBe('ws://127.0.0.1:8765/');
    expect(socket.binaryType).toBe('arraybuffer');
    socket.open();
    expect(socket.sent).toEqual([{ type: 'hello', protocol: 1, token: 'sesame' }]);
    socket.reply();
    await flushAsync();

    expect(socket.commands()).toEqual([
      {
        type: 'start',
        prompts: [
          { text: 'late night. In A minor. 90 BPM.', weight: 1 },
          { text: 'warm pads.', weight: 1 },
          { text: 'brushed drums.', weight: 1 }
        ]
      }
    ]);
    socket.reply();
    await started;
    expect(harness.statuses).toEqual(['streaming']);
  });

  it.each([
    { protocol: 2 },
    { encoding: 'f32le' },
    { sampleRate: 44_100 },
    { channels: 1 },
    { maxPrompts: 5 }
  ])('refuses a bridge that speaks another protocol or format: %j', async (change) => {
    const harness = setup();
    await opened(harness);
    const started = harness.connector.start(harness.sink, TIMING, 'run-1');
    await flushAsync();
    harness.bridge.last.open();
    const { protocol = 1, maxPrompts = 6, ...audio } = change;
    harness.bridge.last.receiveRaw({
      type: 'hello',
      protocol,
      audio: {
        encoding: 'pcm_s16le',
        sampleRate: 48_000,
        channels: 2,
        framesPerPacket: 7680,
        ...audio
      },
      maxPrompts
    });
    await expect(started).rejects.toMatchObject({ code: 'magenta-rt2-protocol-violation' });
    expect(harness.bridge.last.released).toBe(true);
  });

  it('settles a start stopped while connecting as cancelled', async () => {
    const harness = setup();
    await opened(harness);
    const started = harness.connector.start(harness.sink, TIMING, 'run-1');
    await flushAsync();
    await harness.connector.stop('run-1');
    await expect(started).rejects.toMatchObject({ code: 'magenta-rt2-start-cancelled' });
  });

  it('classifies a refused token as auth', async () => {
    const harness = setup();
    harness.bridge.token = 'sesame';
    await opened(harness, { token: 'wrong' });
    const started = harness.connector.start(harness.sink, TIMING, 'run-1');
    await flushAsync();
    harness.bridge.last.open();
    harness.bridge.last.reply();
    await expect(started).rejects.toMatchObject({
      code: 'magenta-rt2-auth-rejected',
      reason: 'auth',
      retryable: false
    });
  });

  it('retries while the bridge is still releasing a previous session', async () => {
    const harness = setup();
    harness.bridge.busy = true;
    await opened(harness);
    const started = harness.connector.start(harness.sink, TIMING, 'run-1');
    await flushAsync();
    harness.bridge.last.open();
    harness.bridge.last.reply();
    await flushAsync();
    expect(harness.bridge.sockets).toHaveLength(1);

    harness.bridge.busy = false;
    harness.clock.advanceBy(0.1);
    await flushAsync();
    expect(harness.bridge.sockets).toHaveLength(2);
    const second = harness.bridge.last;
    second.open();
    second.reply();
    await flushAsync();
    second.reply();
    await started;
  });

  it('ignores the close of a refused socket that lands after the retry connects', async () => {
    const harness = setup();
    harness.bridge.busy = true;
    harness.bridge.slowCloses = true;
    await opened(harness);
    const started = harness.connector.start(harness.sink, TIMING, 'run-1');
    await flushAsync();
    const refused = harness.bridge.last;
    refused.open();
    refused.reply();
    await flushAsync();

    harness.bridge.busy = false;
    harness.clock.advanceBy(0.1);
    await flushAsync();
    const second = harness.bridge.last;
    second.open();
    second.reply();
    await flushAsync();
    refused.finishClose();
    second.reply();
    await started;
    expect(harness.failures).toEqual([]);
  });

  it('leaves no retry timer behind when stopped while the bridge is busy', async () => {
    const harness = setup();
    harness.bridge.busy = true;
    await opened(harness);
    const started = harness.connector.start(harness.sink, TIMING, 'run-1');
    await flushAsync();
    harness.bridge.last.open();
    harness.bridge.last.reply();
    await flushAsync();

    await harness.connector.stop('run-1');
    await expect(started).rejects.toMatchObject({ code: 'magenta-rt2-start-cancelled' });
    expect(harness.clock.pendingDeadlines()).toEqual([]);
  });

  it('fails the start, not the run, when the bridge drops before acknowledging start', async () => {
    const harness = setup();
    await opened(harness);
    const started = harness.connector.start(harness.sink, TIMING, 'run-1');
    await flushAsync();
    harness.bridge.last.open();
    harness.bridge.last.reply();
    await flushAsync();
    harness.bridge.last.drop();
    await expect(started).rejects.toMatchObject({
      code: 'magenta-rt2-network-failure',
      closeCode: 1006
    });
    expect(harness.failures).toEqual([]);
  });

  it('times out a bridge that never answers', async () => {
    const harness = setup();
    await opened(harness);
    const started = harness.connector.start(harness.sink, TIMING, 'run-1');
    await flushAsync();
    harness.clock.advanceBy(10);
    await expect(started).rejects.toMatchObject({
      code: 'magenta-rt2-connect-timeout',
      reason: 'network'
    });
    expect(harness.bridge.last.released).toBe(true);
    expect(harness.clock.pendingDeadlines()).toEqual([]);
  });

  it('sends start only once a track becomes active', async () => {
    const harness = setup();
    harness.bridge.autoAnswer = true;
    await harness.connector.open({ endpoint: 'ws://localhost:8765' });
    await harness.connector.prepare(SILENT, {});
    await harness.connector.start(harness.sink, TIMING, 'run-1');
    expect(harness.bridge.last.commands()).toEqual([]);

    await harness.connector.update({ state: STATE }, { bar: 2 });
    expect(harness.bridge.last.commands().map((command) => command.type)).toEqual(['start']);
  });
});

describe('Magenta RT2 live control', () => {
  it('keeps running past the connect deadline', async () => {
    const harness = setup();
    await running(harness);
    harness.clock.advanceBy(10);
    await harness.connector.update({ state: SILENT }, { bar: 2 });
    expect(harness.bridge.last.commands().at(-1)).toEqual({ type: 'pause', paused: true });
  });

  it('fails a command the bridge never answers, and only that one', async () => {
    const harness = setup();
    await running(harness);
    await harness.connector.update({ state: SILENT }, { bar: 2 });
    harness.clock.advanceBy(20);
    expect(harness.failures).toEqual([]);

    // The network stalls: nothing answers and nothing closes.
    harness.bridge.autoAnswer = false;
    const update = harness.connector.update({ state: STATE }, { bar: 3 });
    harness.clock.advanceBy(20);
    await expect(update).rejects.toBeDefined();
    expect(harness.failures).toEqual([
      expect.objectContaining({ code: 'magenta-rt2-command-timeout', reason: 'network' })
    ]);
  });

  it('ignores a Stop for another run', async () => {
    const harness = setup();
    await running(harness);
    await harness.connector.stop('run-0');
    expect(harness.bridge.last.released).toBe(false);
    await harness.connector.update({ state: SILENT }, { bar: 2 });
  });

  it('sends style only when the prompts change', async () => {
    const harness = setup();
    await running(harness);
    await harness.connector.update({ state: STATE }, { bar: 2 });
    const quieter: EffectiveState = {
      ...STATE,
      tracks: [STATE.tracks[0]!, { ...STATE.tracks[1]!, level: { kind: 'level', value: 0.5 } }]
    };
    const applied = await harness.connector.update({ state: quieter }, { bar: 3 });

    expect(applied).toEqual({ bar: 3 });
    expect(harness.bridge.last.commands().map((command) => command.type)).toEqual([
      'start',
      'style'
    ]);
    expect(harness.bridge.last.commands()[1]!.prompts).toContainEqual({
      text: 'brushed drums.',
      weight: 0.5
    });
  });

  it('pauses when every track leaves, and resumes when one returns', async () => {
    const harness = setup();
    await running(harness);
    await harness.connector.update({ state: SILENT }, { bar: 2 });
    await harness.connector.update({ state: STATE }, { bar: 3 });
    expect(harness.bridge.last.commands()).toEqual([
      expect.objectContaining({ type: 'start' }),
      { type: 'pause', paused: true },
      { type: 'pause', paused: false }
    ]);
  });

  it('maps renderer flow control onto bridge pause', async () => {
    const harness = setup();
    await running(harness);
    await harness.connector.setGenerationPaused!(true);
    await harness.connector.setGenerationPaused!(false);
    expect(harness.bridge.last.commands().slice(1)).toEqual([
      { type: 'pause', paused: true },
      { type: 'pause', paused: false }
    ]);
    expect(harness.statuses).toEqual(['streaming', 'throttled', 'streaming']);
  });

  it('warns once when more tracks are active than prompt slots', async () => {
    const harness = setup();
    await running(harness);
    const crowded: EffectiveState = {
      ...STATE,
      tracks: Array.from({ length: 8 }, (_, index) => ({
        trackId: `t${index}`,
        name: `t${index}`,
        description: `instrument ${index}`,
        active: true
      }))
    };
    await harness.connector.update({ state: crowded }, { bar: 2 });
    await harness.connector.update({ state: crowded }, { bar: 3 });
    expect(harness.warnings.map((warning) => warning.code)).toEqual([
      'magenta-rt2-prompt-overflow'
    ]);
  });

  it('warns once when a prompt is cut to the bridge limit', async () => {
    const harness = setup();
    await running(harness);
    const wordy: EffectiveState = {
      ...STATE,
      tracks: [{ ...STATE.tracks[0]!, description: 'very warm pads '.repeat(40) }]
    };
    await harness.connector.update({ state: wordy }, { bar: 2 });
    await harness.connector.update({ state: wordy }, { bar: 3 });
    expect(harness.warnings.map((warning) => warning.code)).toEqual([
      'magenta-rt2-prompt-truncated'
    ]);
  });
});

describe('Magenta RT2 audio and failures', () => {
  it('pushes packets as s16le chunks with their real duration', async () => {
    const harness = setup();
    await running(harness);
    harness.bridge.last.audio();
    harness.bridge.last.audio(3840);
    expect(harness.chunks).toMatchObject([
      { runId: 'run-1', sampleFormat: 's16le', sampleRate: 48_000, durationSeconds: 0.16 },
      { runId: 'run-1', durationSeconds: 0.08 }
    ]);
    expect(harness.chunks[0]!.bytes.byteLength).toBe(7680 * 4);
    expect(harness.warnings).toEqual([]);
  });

  it('reports an engine failure the bridge announces', async () => {
    const harness = setup();
    await running(harness);
    harness.bridge.last.engineFailure();
    await flushAsync();
    expect(harness.failures).toEqual([
      expect.objectContaining({
        code: 'magenta-rt2-engine-failure',
        reason: 'provider',
        retryable: true,
        runId: 'run-1'
      })
    ]);
  });

  it('reports a dropped connection as a network failure with its close code', async () => {
    const harness = setup();
    await running(harness);
    harness.bridge.last.drop();
    await flushAsync();
    expect(harness.failures).toEqual([
      expect.objectContaining({ code: 'magenta-rt2-network-failure', closeCode: 1006 })
    ]);
  });

  it('fails a run the bridge closes for never starting generation', async () => {
    const harness = setup();
    harness.bridge.autoAnswer = true;
    await harness.connector.open({ endpoint: 'ws://localhost:8765' });
    await harness.connector.prepare(SILENT, {});
    await harness.connector.start(harness.sink, TIMING, 'run-1');
    harness.bridge.last.idle();
    await flushAsync();
    expect(harness.failures).toEqual([
      expect.objectContaining({ code: 'magenta-rt2-network-failure', closeCode: 4408 })
    ]);
  });

  it('fails a command the bridge rejects', async () => {
    const harness = setup();
    await running(harness);
    harness.bridge.autoAnswer = false;
    const changed: EffectiveState = { ...STATE, tracks: [STATE.tracks[0]!] };
    const update = harness.connector.update({ state: changed }, { bar: 2 });
    await flushAsync();
    harness.bridge.last.failEncoding();
    await expect(update).rejects.toMatchObject({ code: 'magenta-rt2-prompt-encode-failed' });
  });
});
