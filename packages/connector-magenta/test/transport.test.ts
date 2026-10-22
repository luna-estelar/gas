import { describe, expect, it } from 'vitest';
import type {
  AudioSink,
  Connector,
  ConnectorAudioChunk,
  ConnectorTiming,
  EffectiveState,
  RendererFailure,
  RendererWarning
} from '@luna-estelar/gas-protocol';
import { ConnectorError } from '@luna-estelar/gas-protocol';
import { createMagentaConnectorWithDependencies, type MagentaSocket } from '../src/connector.js';
import { DEFAULT_MAGENTA_CONFIG } from '../src/config.js';
import { MAGENTA_DEFAULT_ENDPOINT } from '../src/constants.js';
import { VirtualClock } from '../../../test/support/virtual-clock.js';

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}

const INITIAL_STATE: EffectiveState = {
  globals: { flavor: { kind: 'text', text: 'warm lo-fi' }, tempo: 96, key: 'C major' },
  tracks: [
    {
      trackId: 'piano',
      name: 'piano',
      description: 'soft felt piano',
      active: true,
      notes: { kind: 'alda', source: 'o4 c e g' },
      level: { kind: 'level', value: 0.5 }
    }
  ]
};

const SILENT_STATE: EffectiveState = { globals: { tempo: 96 }, tracks: [] };

const TIMING: ConnectorTiming = {
  tempo: 96,
  timeSignature: { beatsPerBar: 4, beatUnit: 4 },
  key: 'C major',
  secondsPerBar: 2.5
};

const READY = JSON.stringify({
  type: 'ready',
  protocol: 1,
  model: 'mrt2_small',
  sampleRate: 48000,
  channels: 2,
  frameRate: 25,
  chunkFrames: 10
});

class FakeSocket implements MagentaSocket {
  binaryType = 'blob';
  onopen: MagentaSocket['onopen'] = null;
  onmessage: MagentaSocket['onmessage'] = null;
  onerror: MagentaSocket['onerror'] = null;
  onclose: MagentaSocket['onclose'] = null;
  readonly sent: Array<Record<string, unknown>> = [];
  closedWith: number | undefined;
  sendFailure: unknown;

  constructor(readonly url: string) {}

  send(data: string): void {
    if (this.sendFailure !== undefined) throw this.sendFailure;
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code?: number): void {
    this.closedWith = code;
  }

  types(): unknown[] {
    return this.sent.map((message) => message.type);
  }

  receive(data: unknown): void {
    this.onmessage?.({ data });
  }

  serverClose(code: number): void {
    this.onclose?.({ code });
  }
}

function recordingSink() {
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
  return { sink, chunks, warnings, failures, statuses };
}

function setup() {
  const clock = new VirtualClock();
  const sockets: FakeSocket[] = [];
  const connector = createMagentaConnectorWithDependencies({
    clock,
    setupTimeoutSeconds: 15,
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    }
  });
  return { clock, sockets, connector, ...recordingSink() };
}

async function begin(
  connector: Connector,
  sink: AudioSink,
  sockets: FakeSocket[],
  { settings = {}, state = INITIAL_STATE, runId = 'run-1' } = {}
): Promise<{ readonly started: Promise<void>; readonly socket: FakeSocket }> {
  await connector.open(settings);
  await connector.prepare(state, DEFAULT_MAGENTA_CONFIG);
  const started = connector.start(sink, TIMING, runId);
  await flushAsync();
  return { started, socket: sockets.at(-1)! };
}

async function running(
  connector: Connector,
  sink: AudioSink,
  sockets: FakeSocket[],
  options: Parameters<typeof begin>[3] = {}
): Promise<FakeSocket> {
  const { started, socket } = await begin(connector, sink, sockets, options);
  socket.onopen?.();
  socket.receive(READY);
  await started;
  return socket;
}

function pcm(frames: number): ArrayBuffer {
  return new Uint8Array(frames * 4).fill(1).buffer;
}

describe('Magenta connector description and settings', () => {
  it('describes the stream it delivers and what it renders', async () => {
    const { connector, sockets } = setup();
    const description = await connector.describe();
    expect(description.id).toBe('magenta');
    expect(description.model).toMatchObject({ sampleRate: 48000, channels: 2, codec: 'pcm' });
    expect(description.capabilities.intents).toMatchObject({
      flavor: 'supported',
      timbre: 'supported',
      notes: 'approximated',
      motif: 'approximated',
      tempo: 'approximated',
      time_signature: 'unsupported'
    });
    expect(description.supportsFlowControl).toBe(true);
    expect(Object.isFrozen(description.capabilities.intents)).toBe(true);
    expect(sockets).toHaveLength(0);
  });

  it('connects to the loopback bridge by default', async () => {
    const { connector, sink, sockets } = setup();
    await begin(connector, sink, sockets);
    expect(sockets[0]!.url).toBe(MAGENTA_DEFAULT_ENDPOINT);
    expect(sockets[0]!.binaryType).toBe('arraybuffer');
  });

  it.each([
    ['ws://localhost:9000', 'ws://localhost:9000'],
    ['ws://[::1]:9000/', 'ws://[::1]:9000'],
    ['wss://bridge.example', 'wss://bridge.example']
  ])('reduces %s to its origin', async (endpoint, expected) => {
    const { connector, sink, sockets } = setup();
    await begin(connector, sink, sockets, { settings: { endpoint } });
    expect(sockets[0]!.url).toBe(expected);
  });

  it.each([
    [{ endpoint: 'ws://192.168.1.4:8765' }],
    [{ endpoint: 'http://localhost:8765' }],
    [{ endpoint: 'wss://user:pass@bridge.example' }],
    [{ endpoint: 'wss://bridge.example/path' }],
    [{ endpoint: 'wss://bridge.example?token=x' }],
    [{ token: '' }],
    [{ token: 3 }],
    [{ apiKey: 'unexpected' }]
  ])('rejects settings %j without echoing them', async (settings) => {
    const { connector } = setup();
    const opened = connector.open(settings as never);
    await expect(opened).rejects.toMatchObject({
      code: 'magenta-invalid-settings',
      reason: 'internal',
      retryable: false
    });
    await expect(opened).rejects.not.toThrow(JSON.stringify(settings));
  });
});

describe('Magenta connector handshake', () => {
  it('says hello with its token, waits for ready, then sends controls and plays', async () => {
    const { connector, sink, sockets, statuses } = setup();
    const { started, socket } = await begin(connector, sink, sockets, {
      settings: { token: 'shared-secret' }
    });
    socket.onopen?.();
    expect(socket.sent).toEqual([{ type: 'hello', protocol: 1, token: 'shared-secret' }]);
    socket.receive(READY);
    await started;

    expect(socket.types()).toEqual(['hello', 'control', 'play']);
    expect(socket.sent[1]).toEqual({
      type: 'control',
      prompts: [
        { text: 'warm lo-fi. 96 bpm, in C major.', weight: 0.8 },
        { text: 'soft felt piano.', weight: 0.5 }
      ],
      pitches: [60, 64, 67],
      drums: 'auto',
      temperature: 1,
      topK: 100,
      styleGuidance: 3,
      notesGuidance: 5,
      reset: true
    });
    expect(statuses).toEqual(['streaming']);
  });

  it('holds the model when there is nothing to play', async () => {
    const { connector, sink, sockets } = setup();
    const socket = await running(connector, sink, sockets, { state: SILENT_STATE });
    expect(socket.types()).toEqual(['hello', 'control']);
    expect(socket.sent[1]).toMatchObject({ prompts: [], pitches: null });
  });

  it('times out when the bridge never becomes ready', async () => {
    const { connector, sink, sockets, clock } = setup();
    const { started, socket } = await begin(connector, sink, sockets);
    socket.onopen?.();
    clock.advanceTo(15);
    await expect(started).rejects.toMatchObject({
      code: 'magenta-setup-timeout',
      reason: 'network',
      retryable: true
    });
    expect(socket.closedWith).toBe(1000);
  });

  it('reports a bridge that is not running as unreachable', async () => {
    const { connector, sink, sockets } = setup();
    const { started, socket } = await begin(connector, sink, sockets);
    socket.onerror?.();
    socket.serverClose(1006);
    await expect(started).rejects.toMatchObject({
      code: 'magenta-bridge-unreachable',
      reason: 'network',
      retryable: true,
      closeCode: 1006
    });
  });

  it('classifies a rejected hello as an authentication failure', async () => {
    const { connector, sink, sockets } = setup();
    const { started, socket } = await begin(connector, sink, sockets);
    socket.onopen?.();
    socket.serverClose(1008);
    await expect(started).rejects.toMatchObject({
      code: 'magenta-auth-rejected',
      reason: 'auth',
      retryable: false,
      closeCode: 1008
    });
  });

  it('refuses a bridge that streams another format', async () => {
    const { connector, sink, sockets } = setup();
    const { started, socket } = await begin(connector, sink, sockets);
    socket.onopen?.();
    socket.receive(JSON.stringify({ ...JSON.parse(READY), sampleRate: 44100 }));
    await expect(started).rejects.toMatchObject({
      code: 'magenta-unsupported-bridge',
      reason: 'provider',
      retryable: false
    });
  });

  it('can start again after a failed start', async () => {
    const { connector, sink, sockets } = setup();
    const { started, socket } = await begin(connector, sink, sockets);
    socket.serverClose(1006);
    await expect(started).rejects.toBeInstanceOf(ConnectorError);
    await connector.prepare(INITIAL_STATE, DEFAULT_MAGENTA_CONFIG);
    const again = connector.start(sink, TIMING, 'run-2');
    await flushAsync();
    sockets[1]!.onopen?.();
    sockets[1]!.receive(READY);
    await expect(again).resolves.toBeUndefined();
  });
});

describe('Magenta connector streaming', () => {
  it('pushes PCM chunks with their duration', async () => {
    const { connector, sink, sockets, chunks } = setup();
    const socket = await running(connector, sink, sockets);
    socket.receive(pcm(19_200));
    socket.receive(new Uint8Array(pcm(4_800)));
    expect(chunks.map((chunk) => chunk.durationSeconds)).toEqual([0.4, 0.1]);
    expect(chunks[0]).toMatchObject({
      runId: 'run-1',
      codec: 'pcm',
      sampleFormat: 's16le',
      sampleRate: 48000,
      channels: 2
    });
  });

  it('fails on audio that is not whole stereo frames', async () => {
    const { connector, sink, sockets, failures } = setup();
    const socket = await running(connector, sink, sockets);
    socket.receive(new Uint8Array(6).buffer);
    expect(failures).toEqual([
      expect.objectContaining({ code: 'magenta-malformed-audio', reason: 'provider' })
    ]);
    expect(socket.closedWith).toBe(1000);
  });

  it('sends the new state as one control and never resets context on update', async () => {
    const { connector, sink, sockets } = setup();
    const socket = await running(connector, sink, sockets);
    const next: EffectiveState = {
      ...INITIAL_STATE,
      globals: { ...INITIAL_STATE.globals, tempo: 120 },
      tracks: [{ ...INITIAL_STATE.tracks[0]!, notes: { kind: 'alda', source: 'o3 a > c e' } }]
    };
    await expect(connector.update({ state: next }, { bar: 3 })).resolves.toEqual({ bar: 3 });
    expect(socket.sent.at(-1)).toMatchObject({
      type: 'control',
      prompts: [
        { text: 'warm lo-fi. 120 bpm, in C major.', weight: 0.8 },
        { text: 'soft felt piano.', weight: 0.5 }
      ],
      pitches: [57, 60, 64],
      reset: false
    });
  });

  it('pauses when every track goes silent and plays when one returns', async () => {
    const { connector, sink, sockets } = setup();
    const socket = await running(connector, sink, sockets);
    await connector.update({ state: SILENT_STATE }, { bar: 2 });
    await connector.update({ state: INITIAL_STATE }, { bar: 3 });
    expect(socket.types().slice(2)).toEqual(['play', 'control', 'pause', 'control', 'play']);
  });

  it('follows renderer flow control and reports throttling', async () => {
    const { connector, sink, sockets, statuses } = setup();
    const socket = await running(connector, sink, sockets);
    await connector.setGenerationPaused!(true);
    await connector.setGenerationPaused!(true);
    await connector.setGenerationPaused!(false);
    expect(socket.types().slice(3)).toEqual(['pause', 'play']);
    expect(statuses).toEqual(['streaming', 'throttled', 'streaming']);
  });

  it('warns once when notation cannot be read and keeps the readable pitches', async () => {
    const { connector, sink, sockets, warnings } = setup();
    const state: EffectiveState = {
      ...INITIAL_STATE,
      tracks: [
        ...INITIAL_STATE.tracks,
        {
          trackId: 'bass',
          name: 'bass',
          active: true,
          motif: { kind: 'alda', source: 'c r d' }
        }
      ]
    };
    const socket = await running(connector, sink, sockets, { state });
    await connector.update({ state }, { bar: 2 });
    expect(socket.sent[1]).toMatchObject({ pitches: [60, 64, 67] });
    expect(warnings.map((warning) => warning.code)).toEqual(['magenta-notation-skipped']);
  });

  it('warns once when the bridge falls behind real time', async () => {
    const { connector, sink, sockets, warnings } = setup();
    const socket = await running(connector, sink, sockets);
    socket.receive(JSON.stringify({ type: 'warning', code: 'behind-real-time' }));
    socket.receive(JSON.stringify({ type: 'warning', code: 'behind-real-time' }));
    socket.receive(JSON.stringify({ type: 'warning', code: 'something-new' }));
    socket.receive('not json');
    expect(warnings.map((warning) => warning.code)).toEqual([
      'magenta-behind-real-time',
      'magenta-bridge-warning'
    ]);
    expect(warnings.every((warning) => !warning.message.includes('something-new'))).toBe(true);
  });

  it('reports a model failure from the bridge with its close code', async () => {
    const { connector, sink, sockets, failures } = setup();
    const socket = await running(connector, sink, sockets);
    socket.receive(JSON.stringify({ type: 'error', code: 'generation-failed' }));
    socket.serverClose(1011);
    socket.serverClose(1011);
    expect(failures).toEqual([
      {
        code: 'magenta-generation-failed',
        message: 'The Magenta connector stopped audio generation.',
        reason: 'provider',
        runId: 'run-1',
        retryable: true,
        closeCode: 1011
      }
    ]);
    await expect(connector.update({ state: INITIAL_STATE }, { bar: 2 })).rejects.toMatchObject({
      code: 'magenta-state-conflict'
    });
  });

  it.each([
    [1002, 'magenta-protocol-rejected', 'internal', false],
    [1011, 'magenta-provider-failure', 'provider', true],
    [1008, 'magenta-network-failure', 'network', true],
    [4001, 'magenta-network-failure', 'network', true]
  ])('classifies close %i after ready as %s', async (code, failureCode, reason, retryable) => {
    const { connector, sink, sockets, failures } = setup();
    const socket = await running(connector, sink, sockets);
    socket.serverClose(code);
    expect(failures).toEqual([
      expect.objectContaining({ code: failureCode, reason, retryable, closeCode: code })
    ]);
  });

  it('maps a failed send to a network failure', async () => {
    const { connector, sink, sockets } = setup();
    const socket = await running(connector, sink, sockets);
    socket.sendFailure = new Error('socket detail');
    await expect(connector.update({ state: INITIAL_STATE }, { bar: 2 })).rejects.toMatchObject({
      code: 'magenta-network-failure',
      message: 'The connector reported a network failure.'
    });
  });

  it('stops quietly, ignores late messages and closes once', async () => {
    const { connector, sink, sockets, chunks, failures } = setup();
    const socket = await running(connector, sink, sockets);
    await connector.stop('another-run');
    expect(socket.closedWith).toBeUndefined();
    await connector.stop('run-1');
    expect(socket.closedWith).toBe(1000);
    socket.receive(pcm(10));
    socket.serverClose(1006);
    expect(chunks).toHaveLength(0);
    expect(failures).toHaveLength(0);
    await connector.close();
    await connector.close();
    await expect(connector.prepare(INITIAL_STATE, DEFAULT_MAGENTA_CONFIG)).rejects.toMatchObject({
      code: 'magenta-state-conflict'
    });
  });

  it('rejects an invalid configuration at prepare', async () => {
    const { connector } = setup();
    await connector.open({});
    await expect(
      connector.prepare(INITIAL_STATE, { generation: { drums: 'loud' } })
    ).rejects.toMatchObject({ code: 'magenta-invalid-configuration' });
  });
});
