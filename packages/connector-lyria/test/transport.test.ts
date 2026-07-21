import { describe, expect, it, vi } from 'vitest';
import type {
  AudioSink,
  Connector,
  ConnectorAudioChunk,
  ConnectorConfig,
  ConnectorTiming,
  EffectiveState,
  RendererFailure,
  RendererWarning
} from '@luna-estelar/gas-protocol';
import { ConnectorError } from '@luna-estelar/gas-protocol';
import {
  createLyriaConnectorWithDependencies,
  type LyriaConnectorDependencies,
  type LyriaMusicSession,
  type LyriaSdkClient
} from '../src/connector.js';
import { DEFAULT_LYRIA_CONFIG } from '../src/config.js';
import { HOSTED_SENTINEL, LYRIA_MODEL_ID } from '../src/constants.js';
import { VirtualClock } from './support/virtual-clock.js';

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}

const INITIAL_STATE: EffectiveState = {
  globals: { flavor: { kind: 'text', text: 'warm and spacious' }, tempo: 96, key: 'C major' },
  tracks: [
    {
      trackId: 'pad',
      name: 'pad',
      description: 'soft synthesizer chords',
      active: true,
      timbre: { kind: 'text', text: 'rounded analog tone' },
      level: { kind: 'level', value: 0.75 }
    }
  ]
};

const EMPTY_STATE: EffectiveState = {
  globals: { tempo: 96 },
  tracks: []
};

const TIMING: ConnectorTiming = {
  tempo: 96,
  timeSignature: { beatsPerBar: 4, beatUnit: 4 },
  key: 'C major',
  secondsPerBar: 2.5
};

const IMMEDIATE_CONFIG: ConnectorConfig = {
  prompt: {
    ...DEFAULT_LYRIA_CONFIG.prompt,
    transitionDurationMs: 0,
    transitionSteps: 1
  },
  generation: DEFAULT_LYRIA_CONFIG.generation
};

class FakeSession implements LyriaMusicSession {
  readonly calls: Array<{ readonly kind: string; readonly value?: unknown }> = [];
  promptFailure: unknown;
  configFailure: unknown;

  async setWeightedPrompts(
    params: Parameters<LyriaMusicSession['setWeightedPrompts']>[0]
  ): Promise<void> {
    this.calls.push({ kind: 'prompts', value: params.weightedPrompts });
    if (this.promptFailure !== undefined) throw this.promptFailure;
  }

  async setMusicGenerationConfig(
    params: Parameters<LyriaMusicSession['setMusicGenerationConfig']>[0]
  ): Promise<void> {
    this.calls.push({ kind: 'config', value: params.musicGenerationConfig });
    if (this.configFailure !== undefined) throw this.configFailure;
  }

  play(): void {
    this.calls.push({ kind: 'play' });
  }

  pause(): void {
    this.calls.push({ kind: 'pause' });
  }

  stop(): void {
    this.calls.push({ kind: 'stop' });
  }

  resetContext(): void {
    this.calls.push({ kind: 'reset' });
  }

  close(): void {
    this.calls.push({ kind: 'close' });
  }
}

type ClientOptions = Parameters<LyriaConnectorDependencies['createClient']>[0];
type ConnectCallbacks = Parameters<LyriaSdkClient['connect']>[0]['callbacks'];

class SdkHarness {
  readonly options: ClientOptions[] = [];
  readonly sessions: FakeSession[] = [];
  readonly callbacks: ConnectCallbacks[] = [];
  connectCount = 0;

  readonly createClient: LyriaConnectorDependencies['createClient'] = (options) => {
    this.options.push(options);
    const session = new FakeSession();
    this.sessions.push(session);
    return {
      connect: async ({ model, callbacks }) => {
        expect(model).toBe(LYRIA_MODEL_ID);
        this.connectCount++;
        this.callbacks.push(callbacks);
        return session;
      }
    };
  };
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
  const sdk = new SdkHarness();
  const connector = createLyriaConnectorWithDependencies({
    clock,
    setupTimeoutSeconds: 15,
    createClient: sdk.createClient
  });
  const recorded = recordingSink();
  return { clock, sdk, connector, ...recorded };
}

async function prepare(
  connector: Connector,
  settings: Parameters<Connector['open']>[0] = { accessMode: 'byok', apiKey: 'test-key' },
  state: EffectiveState = INITIAL_STATE,
  config: ConnectorConfig = IMMEDIATE_CONFIG
): Promise<void> {
  await connector.open(settings);
  await connector.prepare(state, config);
}

async function beginStart(
  connector: Connector,
  sink: AudioSink,
  sdk: SdkHarness,
  runId = 'run-1'
): Promise<{ readonly started: Promise<void> }> {
  const expectedCallbacks = sdk.callbacks.length + 1;
  const started = connector.start(sink, TIMING, runId);
  await flushAsync();
  expect(sdk.callbacks).toHaveLength(expectedCallbacks);
  return { started };
}

async function completeStart(
  connector: Connector,
  sink: AudioSink,
  sdk: SdkHarness,
  runId = 'run-1'
): Promise<void> {
  const { started } = await beginStart(connector, sink, sdk, runId);
  sdk.callbacks.at(-1)!.onmessage({ setupComplete: {} });
  await started;
}

describe('Lyria connector description and settings', () => {
  it('describes immutable model facts without constructing a client', async () => {
    const { connector, sdk } = setup();
    const description = await connector.describe();
    expect(description.id).toBe('lyria');
    expect(description.model).toMatchObject({
      modelId: LYRIA_MODEL_ID,
      codec: 'pcm',
      sampleFormat: 's16le',
      sampleRate: 48_000,
      channels: 2,
      chunkDurationSeconds: 2
    });
    expect(description.capabilities.intents).toEqual({
      flavor: 'supported',
      key: 'approximated',
      tempo: 'supported',
      time_signature: 'unsupported',
      timbre: 'supported',
      level: 'approximated',
      notes: 'unsupported',
      motif: 'unsupported'
    });
    expect(Object.isFrozen(description)).toBe(true);
    expect(Object.isFrozen(description.capabilities.intents)).toBe(true);
    expect(sdk.connectCount).toBe(0);
  });

  it.each([
    {},
    { accessMode: 'byok', apiKey: '' },
    { accessMode: 'byok', apiKey: 'x', extra: true },
    { accessMode: 'hosted', proxyBaseUrl: 'http://proxy.example' },
    { accessMode: 'hosted', proxyBaseUrl: 'https://user:pass@proxy.example' },
    { accessMode: 'hosted', proxyBaseUrl: 'https://proxy.example/path' },
    { accessMode: 'hosted', proxyBaseUrl: 'https://proxy.example?key=secret' },
    { accessMode: 'hosted', proxyBaseUrl: 'https://proxy.example#fragment' }
  ])('rejects invalid settings before connection: %j', async (settings) => {
    const { connector, sdk } = setup();
    await expect(connector.open(settings)).rejects.toMatchObject({
      code: 'lyria-invalid-settings',
      reason: 'internal',
      retryable: false
    });
    expect(sdk.connectCount).toBe(0);
  });

  it('constructs BYOK and hosted clients only at start', async () => {
    const direct = setup();
    await prepare(direct.connector);
    expect(direct.sdk.options).toEqual([]);
    const { started: directStart } = await beginStart(direct.connector, direct.sink, direct.sdk);
    expect(direct.sdk.options).toEqual([{ apiKey: 'test-key', apiVersion: 'v1alpha' }]);
    direct.sdk.callbacks[0].onmessage({ setupComplete: {} });
    await directStart;

    const hosted = setup();
    await prepare(hosted.connector, {
      accessMode: 'hosted',
      proxyBaseUrl: 'https://proxy.example/'
    });
    const { started: hostedStart } = await beginStart(hosted.connector, hosted.sink, hosted.sdk);
    expect(hosted.sdk.options).toEqual([
      {
        apiKey: HOSTED_SENTINEL,
        apiVersion: 'v1alpha',
        httpOptions: { baseUrl: 'https://proxy.example' }
      }
    ]);
    hosted.sdk.callbacks[0].onmessage({ setupComplete: {} });
    await hostedStart;
  });
});

describe('Lyria connector startup and model configuration', () => {
  it('waits for setup complete before config, prompts, and play', async () => {
    const { connector, sdk, sink } = setup();
    await prepare(connector);
    const { started } = await beginStart(connector, sink, sdk);
    expect(sdk.sessions[0].calls).toEqual([]);

    sdk.callbacks[0].onmessage({ setupComplete: {} });
    await started;
    expect(sdk.sessions[0].calls.map((call) => call.kind)).toEqual(['config', 'prompts', 'play']);
    expect(sdk.sessions[0].calls[0].value).toMatchObject({
      bpm: 96,
      scale: 'C_MAJOR_A_MINOR',
      temperature: 1.1,
      guidance: 4,
      topK: 40,
      musicGenerationMode: 'QUALITY'
    });
  });

  it('times out startup safely and closes the session', async () => {
    const { connector, sdk, sink, clock } = setup();
    await prepare(connector);
    const { started } = await beginStart(connector, sink, sdk);
    clock.advanceBy(15);
    await expect(started).rejects.toMatchObject({
      code: 'lyria-setup-timeout',
      reason: 'network',
      retryable: true
    });
    expect(sdk.sessions[0].calls).toContainEqual({ kind: 'close' });
  });

  it('resends the complete config then resets context before prompt updates', async () => {
    const { connector, sdk, sink } = setup();
    await prepare(connector);
    await completeStart(connector, sink, sdk);
    sdk.sessions[0].calls.length = 0;

    const boundary = await connector.update(
      {
        state: {
          ...INITIAL_STATE,
          globals: { ...INITIAL_STATE.globals, tempo: 140, key: 'D major' },
          tracks: [
            {
              ...INITIAL_STATE.tracks[0],
              flavor: { kind: 'text', text: 'brighter and more rhythmic' }
            }
          ]
        }
      },
      { bar: 3 }
    );
    expect(boundary).toEqual({ bar: 3 });
    expect(sdk.sessions[0].calls.map((call) => call.kind)).toEqual(['config', 'reset', 'prompts']);
    expect(sdk.sessions[0].calls[0].value).toMatchObject({
      bpm: 140,
      scale: 'D_MAJOR_B_MINOR',
      temperature: 1.1,
      guidance: 4,
      topK: 40
    });
  });

  it('clamps tempo and warns once for each distinct out-of-range value', async () => {
    const { connector, sdk, sink, warnings } = setup();
    const state = { ...INITIAL_STATE, globals: { ...INITIAL_STATE.globals, tempo: 240 } };
    await prepare(connector, { accessMode: 'byok', apiKey: 'test-key' }, state);
    await completeStart(connector, sink, sdk);
    expect(sdk.sessions[0].calls[0].value).toMatchObject({ bpm: 200 });
    expect(warnings.map((warning) => warning.code)).toEqual(['lyria-tempo-clamped']);

    await connector.update({ state }, { bar: 2 });
    await connector.update(
      { state: { ...state, globals: { ...state.globals, tempo: 250 } } },
      { bar: 3 }
    );
    expect(warnings.map((warning) => warning.code)).toEqual([
      'lyria-tempo-clamped',
      'lyria-tempo-clamped'
    ]);
  });

  it('rejects invalid direct-call configuration without constructing a client', async () => {
    const { connector, sdk } = setup();
    await connector.open({ accessMode: 'byok', apiKey: 'test-key' });
    await expect(
      connector.prepare(INITIAL_STATE, { generation: { topK: 0, vendorSecret: 'hidden' } })
    ).rejects.toMatchObject({ code: 'lyria-invalid-configuration' });
    expect(sdk.connectCount).toBe(0);
  });
});

describe('Lyria connector prompts, flow control, and audio', () => {
  it('starts empty without play, resumes for prompts, and never sends an empty SDK prompt set', async () => {
    const { connector, sdk, sink } = setup();
    await prepare(connector, { accessMode: 'byok', apiKey: 'test-key' }, EMPTY_STATE);
    await completeStart(connector, sink, sdk);
    expect(sdk.sessions[0].calls.map((call) => call.kind)).toEqual(['config']);

    await connector.update({ state: INITIAL_STATE }, { bar: 2 });
    await connector.update({ state: EMPTY_STATE }, { bar: 3 });
    const promptCalls = sdk.sessions[0].calls.filter((call) => call.kind === 'prompts');
    expect(promptCalls).toHaveLength(1);
    expect(promptCalls[0].value).not.toEqual([]);
    expect(sdk.sessions[0].calls.map((call) => call.kind)).toEqual([
      'config',
      'prompts',
      'play',
      'pause'
    ]);
  });

  it('gives flow pause precedence and suppresses duplicate controls', async () => {
    const { connector, sdk, sink } = setup();
    await prepare(connector);
    await completeStart(connector, sink, sdk);
    sdk.sessions[0].calls.length = 0;

    await connector.setGenerationPaused?.(true);
    await connector.setGenerationPaused?.(true);
    await connector.setGenerationPaused?.(false);
    await connector.setGenerationPaused?.(false);
    expect(sdk.sessions[0].calls.map((call) => call.kind)).toEqual(['pause', 'play']);
  });

  it('decodes and emits every audio chunk with exact metadata and duration', async () => {
    const { connector, sdk, sink, chunks } = setup();
    await prepare(connector);
    await completeStart(connector, sink, sdk);
    sdk.callbacks[0].onmessage({
      serverContent: {
        audioChunks: [
          { data: Buffer.from([1, 2, 3, 4]).toString('base64') },
          { data: Buffer.from([5, 6, 7, 8, 9, 10, 11, 12]).toString('base64') }
        ]
      }
    });

    expect(chunks).toHaveLength(2);
    expect([...chunks[0].bytes]).toEqual([1, 2, 3, 4]);
    expect(chunks[0]).toMatchObject({
      runId: 'run-1',
      codec: 'pcm',
      sampleFormat: 's16le',
      sampleRate: 48_000,
      channels: 2,
      durationSeconds: 4 / 192_000
    });
    expect(chunks[1].durationSeconds).toBe(8 / 192_000);
  });

  it('sanitizes filtered prompts, provider warnings, and malformed audio', async () => {
    const { connector, sdk, sink, warnings, failures } = setup();
    await prepare(connector);
    await completeStart(connector, sink, sdk);
    sdk.callbacks[0].onmessage({
      filteredPrompt: { text: 'private prompt', filteredReason: 'vendor detail' },
      warning: 'vendor warning with secret',
      serverContent: { audioChunks: [{ data: 'not-base64' }] }
    });

    expect(warnings.map((warning) => warning.code)).toEqual([
      'lyria-prompt-filtered',
      'lyria-provider-warning'
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      code: 'lyria-malformed-audio',
      reason: 'provider',
      retryable: true,
      runId: 'run-1'
    });
    expect(JSON.stringify({ warnings, failures })).not.toMatch(
      /private prompt|vendor detail|secret/
    );
  });
});

describe('Lyria connector failure and lifecycle guards', () => {
  it.each([
    [4401, 'auth', false],
    [4429, 'quota', true],
    [4500, 'provider', true],
    [1002, 'provider', true],
    [1006, 'network', true]
  ] as const)('maps runtime close %i to %s', async (code, reason, retryable) => {
    const { connector, sdk, sink, failures } = setup();
    await prepare(connector, { accessMode: 'hosted', proxyBaseUrl: 'https://proxy.example' });
    await completeStart(connector, sink, sdk);
    sdk.callbacks[0].onclose({ code });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ reason, retryable, runId: 'run-1' });
  });

  it('maps direct pre-setup policy close to auth without leaking close detail', async () => {
    const { connector, sdk, sink } = setup();
    await prepare(connector);
    const { started } = await beginStart(connector, sink, sdk);
    sdk.callbacks[0].onclose({ code: 1008 });
    await expect(started).rejects.toMatchObject({ reason: 'auth', retryable: false });
  });

  it('stops and closes idempotently, supports a later explicit run, and ignores stale callbacks', async () => {
    const { connector, sdk, sink, chunks } = setup();
    await prepare(connector);
    await completeStart(connector, sink, sdk);
    const staleCallbacks = sdk.callbacks[0];
    await connector.stop('run-1');
    await connector.stop('run-1');
    expect(sdk.sessions[0].calls.filter((call) => call.kind === 'stop')).toHaveLength(1);
    expect(sdk.sessions[0].calls.filter((call) => call.kind === 'close')).toHaveLength(1);
    staleCallbacks.onmessage({
      serverContent: { audioChunks: [{ data: Buffer.from([1, 2, 3, 4]).toString('base64') }] }
    });
    expect(chunks).toEqual([]);

    await connector.prepare(INITIAL_STATE, IMMEDIATE_CONFIG);
    await completeStart(connector, sink, sdk, 'run-2');
    expect(sdk.connectCount).toBe(2);
    await connector.close();
    await connector.close();
    await expect(connector.open({ accessMode: 'byok', apiKey: 'new-key' })).rejects.toBeInstanceOf(
      ConnectorError
    );
  });

  it('maps arbitrary SDK send errors without carrying vendor text', async () => {
    const { connector, sdk, sink } = setup();
    await prepare(connector);
    const { started } = await beginStart(connector, sink, sdk);
    sdk.sessions[0].configFailure = new Error('api-key=secret vendor prompt');
    sdk.callbacks[0].onmessage({ setupComplete: {} });
    const failure = await started.catch((error: unknown) => error);
    expect(failure).toMatchObject({ reason: 'network', retryable: true });
    expect(JSON.stringify(failure)).not.toMatch(/api-key|secret|vendor prompt/);
  });

  it('reports a scheduled transition failure only once', async () => {
    const clock = new VirtualClock();
    const sdk = new SdkHarness();
    const connector = createLyriaConnectorWithDependencies({
      clock,
      setupTimeoutSeconds: 15,
      createClient: sdk.createClient
    });
    const { sink, failures } = recordingSink();
    await connector.open({ accessMode: 'byok', apiKey: 'test-key' });
    await connector.prepare(INITIAL_STATE, DEFAULT_LYRIA_CONFIG);
    await completeStart(connector, sink, sdk);
    sdk.sessions[0].promptFailure = new Error('vendor detail');
    clock.advanceBy(0.75);
    await flushAsync();
    clock.advanceBy(1);
    await flushAsync();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ reason: 'network', retryable: true });
  });
});
