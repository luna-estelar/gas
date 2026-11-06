// Magenta RT2 behaviour the conformance suite doesn't cover: the bridge
// protocol, when generation starts, keepalives and the close-code table.
import { describe, expect, it } from 'vitest';
import type {
  ConnectorAudioChunk,
  ConnectorTiming,
  ConnectorWarning,
  EffectiveState
} from '@luna-estelar/gas/protocol';
import { createMagentaRt2ConnectorWithDependencies } from '../src/connector.js';
import { KEEPALIVE_SECONDS, type MagentaRt2Translate } from '../src/connection.js';
import { classifyClose } from '../src/transport.js';
import { flushAsync } from '../../../test/support/deferred.js';
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
  quarterNoteTempo: 90,
  timeSignature: { beatsPerBar: 4, beatUnit: 4 },
  secondsPerBar: 4 / 1.5
};

function setup(options: { token?: string; translate?: MagentaRt2Translate } = {}) {
  const clock = new VirtualClock();
  const bridge = new FakeBridge();
  const connector = createMagentaRt2ConnectorWithDependencies(
    { endpoint: 'ws://127.0.0.1:8765', ...options },
    { clock, createSocket: bridge.createSocket }
  );
  const chunks: ConnectorAudioChunk[] = [];
  const warnings: ConnectorWarning[] = [];
  const errors: unknown[] = [];
  const controller = new AbortController();
  const connect = (state: EffectiveState = STATE) => {
    const connecting = connector.connect({
      config: {},
      state,
      timing: TIMING,
      signal: controller.signal,
      onAudio: (chunk) => chunks.push(chunk),
      onWarning: (warning) => warnings.push(warning),
      onError: (error) => errors.push(error)
    });
    connecting.catch(() => undefined);
    return connecting;
  };
  return { clock, bridge, connector, connect, controller, chunks, warnings, errors };
}

type Harness = ReturnType<typeof setup>;

async function running(harness: Harness, state: EffectiveState = STATE) {
  harness.bridge.autoAnswer = true;
  return harness.connect(state);
}

const types = (harness: Harness) => harness.bridge.last.commands().map((command) => command.type);

describe('Magenta RT2 description', () => {
  it('describes 160 ms s16le packets without connecting', () => {
    const { connector, bridge } = setup();
    expect(connector.description.model).toMatchObject({
      sampleFormat: 's16le',
      sampleRate: 48_000,
      channels: 2,
      chunkDurationSeconds: 0.16
    });
    expect(connector.description.capabilities.intents).toMatchObject({
      flavor: 'supported',
      tempo: 'approximated',
      notes: 'unsupported'
    });
    expect(bridge.sockets).toEqual([]);
  });

  it('refuses bad options when the connector is made', () => {
    expect(() =>
      createMagentaRt2ConnectorWithDependencies(
        { endpoint: 'ws://192.168.1.4:8765' },
        { clock: new VirtualClock(), createSocket: new FakeBridge().createSocket }
      )
    ).toThrow(expect.objectContaining({ code: 'magenta-rt2-invalid-settings' }));
  });
});

describe('Magenta RT2 startup', () => {
  it('greets with the token, then starts with translated prompts', async () => {
    const harness = setup({ token: 'sesame' });
    harness.bridge.token = 'sesame';
    const connecting = harness.connect();
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
    await connecting;
    expect(harness.warnings).toEqual([]);
  });

  it.each([
    { protocol: 2 },
    { encoding: 'f32le' },
    { sampleRate: 44_100 },
    { channels: 1 },
    { maxPrompts: 5 }
  ])('refuses a bridge that speaks another protocol or format: %j', async (change) => {
    const harness = setup();
    const connecting = harness.connect();
    await flushAsync();
    harness.bridge.last.open();
    const { protocol = 1, maxPrompts = 6, ...audio } = change;
    harness.bridge.last.receiveRaw({
      type: 'hello',
      protocol,
      audio: { encoding: 'pcm_s16le', sampleRate: 48_000, channels: 2, ...audio },
      maxPrompts
    });
    await expect(connecting).rejects.toMatchObject({ code: 'magenta-rt2-protocol-violation' });
    expect(harness.bridge.last.released).toBe(true);
  });

  it('classifies a refused token as auth', async () => {
    const harness = setup({ token: 'wrong' });
    harness.bridge.token = 'sesame';
    const connecting = harness.connect();
    await flushAsync();
    harness.bridge.last.open();
    harness.bridge.last.reply();
    await expect(connecting).rejects.toMatchObject({
      code: 'magenta-rt2-auth-rejected',
      reason: 'auth',
      retryable: false
    });
  });

  it('retries while the bridge is still releasing a previous session', async () => {
    const harness = setup();
    harness.bridge.busy = true;
    const connecting = harness.connect();
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
    await connecting;
  });

  it('ignores the close of a refused socket that lands after the retry connects', async () => {
    const harness = setup();
    harness.bridge.busy = true;
    harness.bridge.slowCloses = true;
    const connecting = harness.connect();
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
    await connecting;
    expect(harness.errors).toEqual([]);
  });

  it('reports a bridge busy past the deadline as a retryable provider failure', async () => {
    const harness = setup();
    harness.bridge.busy = true;
    harness.bridge.autoAnswer = true;
    const connecting = harness.connect();
    for (let step = 0; step < 110; step++) {
      await flushAsync();
      harness.clock.advanceBy(0.1);
    }
    await expect(connecting).rejects.toMatchObject({
      code: 'magenta-rt2-busy',
      reason: 'provider',
      retryable: true
    });
  });

  it('leaves no retry timer behind when aborted while the bridge is busy', async () => {
    const harness = setup();
    harness.bridge.busy = true;
    const connecting = harness.connect();
    await flushAsync();
    harness.bridge.last.open();
    harness.bridge.last.reply();
    await flushAsync();

    harness.controller.abort();
    await expect(connecting).rejects.toMatchObject({ code: 'magenta-rt2-start-cancelled' });
    expect(harness.clock.pendingDeadlines()).toEqual([]);
  });

  it('rejects connect(), with nothing reported, when the bridge drops before acknowledging start', async () => {
    const harness = setup();
    const connecting = harness.connect();
    await flushAsync();
    harness.bridge.last.open();
    harness.bridge.last.reply();
    await flushAsync();
    harness.bridge.last.drop();
    await expect(connecting).rejects.toMatchObject({
      code: 'magenta-rt2-network-failure',
      closeCode: 1006
    });
    await flushAsync();
    expect(harness.errors).toEqual([]);
  });

  it('times out a bridge that never answers', async () => {
    const harness = setup();
    const connecting = harness.connect();
    await flushAsync();
    harness.clock.advanceBy(10);
    await expect(connecting).rejects.toMatchObject({
      code: 'magenta-rt2-connect-timeout',
      reason: 'network'
    });
    expect(harness.bridge.last.released).toBe(true);
    expect(harness.clock.pendingDeadlines()).toEqual([]);
  });

  it('rejects connect() when the translate hook throws, and closes the socket', async () => {
    const harness = setup({
      translate: () => {
        throw new Error('secret detail');
      }
    });
    await expect(running(harness)).rejects.toMatchObject({
      code: 'magenta-rt2-translate-failed'
    });
    expect(harness.bridge.last.released).toBe(true);
  });
});

describe('Magenta RT2 starts generation lazily', () => {
  it('sends nothing while a piece opens with a rest, and starts with the first entry', async () => {
    const harness = setup();
    const connection = await running(harness, SILENT);
    expect(harness.bridge.last.commands()).toEqual([]);

    await connection.update({ state: STATE }, { bar: 2 });
    expect(types(harness)).toEqual(['start']);
  });

  it('holds the start while paused, and sends it on resume', async () => {
    const harness = setup();
    const connection = await running(harness, SILENT);
    await connection.pause();
    await connection.update({ state: STATE }, { bar: 2 });
    expect(harness.bridge.last.commands()).toEqual([]);

    await connection.resume();
    expect(types(harness)).toEqual(['start']);
  });

  it('sends a keepalive every 10 s until generation starts', async () => {
    const harness = setup();
    const connection = await running(harness, SILENT);
    for (let index = 0; index < 3; index++) {
      harness.clock.advanceBy(KEEPALIVE_SECONDS);
      await flushAsync();
    }
    expect(types(harness)).toEqual(['keepalive', 'keepalive', 'keepalive']);

    await connection.update({ state: STATE }, { bar: 2 });
    harness.clock.advanceBy(KEEPALIVE_SECONDS * 3);
    await flushAsync();
    expect(types(harness)).toEqual(['keepalive', 'keepalive', 'keepalive', 'start']);
  });

  it('plays through a 60 s opening rest without the bridge closing it idle', async () => {
    const harness = setup();
    harness.bridge.idleWatch = { clock: harness.clock, seconds: 30 };
    const connection = await running(harness, SILENT);
    for (let second = 0; second < 60; second++) {
      harness.clock.advanceBy(1);
      await flushAsync();
    }
    expect(harness.errors).toEqual([]);
    await connection.update({ state: STATE }, { bar: 20 });
    expect(types(harness).at(-1)).toBe('start');
  });

  it('is closed idle by a bridge without keepalive, after one warning', async () => {
    const harness = setup();
    harness.bridge.controls = ['style', 'pause'];
    harness.bridge.idleWatch = { clock: harness.clock, seconds: 30 };
    await running(harness, SILENT);
    expect(harness.warnings.map((warning) => warning.code)).toEqual(['magenta-rt2-no-keepalive']);
    harness.clock.advanceBy(30);
    await flushAsync();
    expect(harness.bridge.last.commands()).toEqual([]);
    expect(harness.errors).toEqual([
      expect.objectContaining({ code: 'magenta-rt2-idle-timeout', closeCode: 4408 })
    ]);
  });

  it('sends no keepalive after close', async () => {
    const harness = setup();
    const connection = await running(harness, SILENT);
    await connection.close();
    harness.clock.advanceBy(KEEPALIVE_SECONDS * 3);
    await flushAsync();
    expect(harness.bridge.last.commands()).toEqual([]);
    expect(harness.clock.pendingDeadlines()).toEqual([]);
  });
});

describe('Magenta RT2 live control', () => {
  it('sends style only when the prompts change', async () => {
    const harness = setup();
    const connection = await running(harness);
    await connection.update({ state: STATE }, { bar: 2 });
    const quieter: EffectiveState = {
      ...STATE,
      tracks: [STATE.tracks[0]!, { ...STATE.tracks[1]!, level: { kind: 'level', value: 0.5 } }]
    };
    const applied = await connection.update({ state: quieter }, { bar: 3 });

    expect(applied).toEqual({ bar: 3 });
    expect(types(harness)).toEqual(['start', 'style']);
    expect(harness.bridge.last.commands()[1]!.prompts).toContainEqual({
      text: 'brushed drums.',
      weight: 0.5
    });
  });

  it('pauses when every track leaves, and resumes when one returns', async () => {
    const harness = setup();
    const connection = await running(harness);
    await connection.update({ state: SILENT }, { bar: 2 });
    await connection.update({ state: STATE }, { bar: 3 });
    expect(harness.bridge.last.commands()).toEqual([
      expect.objectContaining({ type: 'start' }),
      { type: 'pause', paused: true },
      { type: 'pause', paused: false }
    ]);
  });

  it('maps pause() and resume() onto the bridge, and sends new prompts before resuming', async () => {
    const harness = setup();
    const connection = await running(harness);
    await connection.pause();
    const update = connection.update(
      { state: { ...STATE, tracks: [STATE.tracks[0]!] } },
      {
        bar: 4
      }
    );
    const resume = connection.resume();
    await Promise.all([update, resume]);
    expect(types(harness)).toEqual(['start', 'pause', 'style', 'pause']);
    expect(harness.bridge.last.commands().at(-1)).toEqual({ type: 'pause', paused: false });
  });

  it('fails a command the bridge never answers, and reports it once', async () => {
    const harness = setup();
    const connection = await running(harness);
    harness.bridge.autoAnswer = false;
    const update = connection.update({ state: SILENT }, { bar: 2 });
    await flushAsync();
    harness.clock.advanceBy(20);
    await expect(update).rejects.toMatchObject({ code: 'magenta-rt2-command-timeout' });
    await flushAsync();
    expect(harness.errors).toEqual([
      expect.objectContaining({ code: 'magenta-rt2-command-timeout', reason: 'network' })
    ]);
  });

  it('rejects the update a bridge refuses, and keeps playing', async () => {
    const harness = setup();
    const connection = await running(harness);
    harness.bridge.autoAnswer = false;
    const update = connection.update(
      { state: { ...STATE, tracks: [STATE.tracks[0]!] } },
      {
        bar: 2
      }
    );
    await flushAsync();
    harness.bridge.last.failEncoding();
    await expect(update).rejects.toMatchObject({ code: 'magenta-rt2-prompt-encode-failed' });
    expect(harness.errors).toEqual([]);
  });

  it('warns once when more tracks are active than prompt slots', async () => {
    const harness = setup();
    const connection = await running(harness);
    const crowded: EffectiveState = {
      ...STATE,
      tracks: Array.from({ length: 8 }, (_, index) => ({
        trackId: `t${index}`,
        name: `t${index}`,
        description: `instrument ${index}`,
        active: true
      }))
    };
    await connection.update({ state: crowded }, { bar: 2 });
    await connection.update({ state: crowded }, { bar: 3 });
    expect(harness.warnings.map((warning) => warning.code)).toEqual([
      'magenta-rt2-prompt-overflow'
    ]);
  });

  it('warns once when a prompt is cut to the bridge limit', async () => {
    const harness = setup();
    const connection = await running(harness);
    const wordy: EffectiveState = {
      ...STATE,
      tracks: [{ ...STATE.tracks[0]!, description: 'very warm pads '.repeat(40) }]
    };
    await connection.update({ state: wordy }, { bar: 2 });
    await connection.update({ state: wordy }, { bar: 3 });
    expect(harness.warnings.map((warning) => warning.code)).toEqual([
      'magenta-rt2-prompt-truncated'
    ]);
  });

  it('sends what the translate hook returns', async () => {
    const harness = setup({
      translate: (state, config, timing) => [
        { text: `${state.tracks.length} tracks at ${timing.quarterNoteTempo}`, weight: 1 }
      ]
    });
    await running(harness);
    expect(harness.bridge.last.commands()).toEqual([
      { type: 'start', prompts: [{ text: '2 tracks at 90', weight: 1 }] }
    ]);
  });

  it.each([
    ['too many prompts', Array.from({ length: 7 }, () => ({ text: 'x', weight: 1 }))],
    ['empty text', [{ text: '', weight: 1 }]],
    ['a negative weight', [{ text: 'x', weight: -1 }]],
    ['only zero weights', [{ text: 'x', weight: 0 }]]
  ])('refuses a translate hook that returns %s', async (_, prompts) => {
    const harness = setup({ translate: () => prompts });
    await expect(running(harness)).rejects.toMatchObject({
      code: 'magenta-rt2-translate-failed'
    });
  });
});

describe('Magenta RT2 audio and failures', () => {
  it('delivers packets as s16le chunks with their real duration', async () => {
    const harness = setup();
    await running(harness);
    harness.bridge.last.audio();
    harness.bridge.last.audio(3840);
    expect(harness.chunks).toMatchObject([
      { sampleFormat: 's16le', sampleRate: 48_000, durationSeconds: 0.16 },
      { durationSeconds: 0.08 }
    ]);
    expect(harness.chunks[0]!.bytes.byteLength).toBe(7680 * 4);
  });

  it('delivers no audio after close', async () => {
    const harness = setup();
    harness.bridge.slowCloses = true;
    const connection = await running(harness);
    const socket = harness.bridge.last;
    void connection.close();
    socket.onmessage?.({ data: new ArrayBuffer(16 + 4) });
    expect(harness.chunks).toEqual([]);
  });

  it('reports an engine failure the bridge announces, once', async () => {
    const harness = setup();
    await running(harness);
    harness.bridge.last.engineFailure();
    await flushAsync();
    expect(harness.errors).toEqual([
      expect.objectContaining({
        code: 'magenta-rt2-engine-failure',
        reason: 'provider',
        retryable: true
      })
    ]);
  });

  it('reports a dropped connection as a network failure with its close code', async () => {
    const harness = setup();
    await running(harness);
    harness.bridge.last.drop();
    await flushAsync();
    expect(harness.errors).toEqual([
      expect.objectContaining({ code: 'magenta-rt2-network-failure', closeCode: 1006 })
    ]);
  });

  it.each([
    [4401, 'magenta-rt2-auth-rejected', 'auth', false],
    [4403, 'magenta-rt2-auth-rejected', 'auth', false],
    [4400, 'magenta-rt2-protocol-violation', 'provider', false],
    [4409, 'magenta-rt2-busy', 'provider', true],
    [4500, 'magenta-rt2-engine-failure', 'provider', true],
    [4408, 'magenta-rt2-idle-timeout', 'network', true],
    [1006, 'magenta-rt2-network-failure', 'network', true],
    [1001, 'magenta-rt2-network-failure', 'network', true]
  ] as const)('classifies close %i as %s', (closeCode, code, reason, retryable) => {
    expect(classifyClose(closeCode)).toMatchObject({ code, reason, retryable, closeCode });
  });
});
