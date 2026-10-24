import { describe, expect, it } from 'vitest';
import type {
  AudioSink,
  Connector,
  ConnectorAudioChunk,
  ConnectorConfig,
  ConnectorTiming,
  EffectiveState,
  RendererFailure,
  RendererWarning
} from '@luna-estelar/gas/protocol';
import { ConnectorError } from '@luna-estelar/gas/protocol';
import { createLyriaRtConnectorWithDependencies } from '../src/connector.js';
import { DEFAULT_LYRIA_RT_CONFIG } from '../src/config.js';
import { LYRIA_RT_MODEL_ID } from '../src/constants.js';
import { VirtualClock } from '../../../test/support/virtual-clock.js';
import { FakeLiveMusic } from './support/fake-sdk.js';

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
    ...DEFAULT_LYRIA_RT_CONFIG.prompt,
    transitionDurationMs: 0,
    transitionSteps: 1
  },
  generation: DEFAULT_LYRIA_RT_CONFIG.generation
};

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
  const sdk = new FakeLiveMusic();
  const connector = createLyriaRtConnectorWithDependencies({
    clock,
    setupTimeoutSeconds: 15,
    createClient: sdk.createClient
  });
  const recorded = recordingSink();
  return { clock, sdk, connector, ...recorded };
}

async function prepare(
  connector: Connector,
  settings: Parameters<Connector['open']>[0] = { apiKey: 'test-key' },
  state: EffectiveState = INITIAL_STATE,
  config: ConnectorConfig = IMMEDIATE_CONFIG
): Promise<void> {
  await connector.open(settings);
  await connector.prepare(state, config);
}

async function beginStart(
  connector: Connector,
  sink: AudioSink,
  sdk: FakeLiveMusic,
  runId = 'run-1',
  timing: ConnectorTiming = TIMING
): Promise<{ readonly started: Promise<void> }> {
  const expectedConnections = sdk.connections.length + 1;
  const started = connector.start(sink, timing, runId);
  await flushAsync();
  expect(sdk.connections).toHaveLength(expectedConnections);
  expect(sdk.last.model).toBe(LYRIA_RT_MODEL_ID);
  sdk.last.open();
  await flushAsync();
  return { started };
}

async function completeStart(
  connector: Connector,
  sink: AudioSink,
  sdk: FakeLiveMusic,
  runId = 'run-1',
  timing: ConnectorTiming = TIMING
): Promise<void> {
  const { started } = await beginStart(connector, sink, sdk, runId, timing);
  sdk.last.setupComplete();
  await started;
}

/** `TIMING` in another meter, at a tempo counted in that meter's beat unit. */
function timingIn(beatsPerBar: number, beatUnit: number, tempo: number): ConnectorTiming {
  return {
    ...TIMING,
    tempo,
    timeSignature: { beatsPerBar, beatUnit },
    secondsPerBar: (60 / tempo) * beatsPerBar
  };
}

describe('Lyria RealTime connector description and settings', () => {
  it('describes immutable model facts without constructing a client', async () => {
    const { connector, sdk } = setup();
    const description = await connector.describe();
    expect(description.id).toBe('lyria-rt');
    expect(description.model).toMatchObject({
      modelId: LYRIA_RT_MODEL_ID,
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
    expect(sdk.connections.length).toBe(0);
  });

  it.each([
    {},
    { apiKey: '' },
    { apiKey: '   ' },
    { apiKey: 'x', extra: true },
    { apiKey: 'x', accessMode: 'byok' },
    { endpoint: 'https://proxy.example' },
    { apiKey: 'x', endpoint: '' },
    { apiKey: 'x', endpoint: 'not-a-url' },
    { apiKey: 'x', endpoint: 'http://proxy.example' },
    { apiKey: 'x', endpoint: 'wss://proxy.example' },
    { apiKey: 'x', endpoint: 'https://user:pass@proxy.example' },
    { apiKey: 'x', endpoint: 'https://proxy.example/path' },
    { apiKey: 'x', endpoint: 'https://proxy.example?key=secret' },
    { apiKey: 'x', endpoint: 'https://proxy.example#fragment' }
  ])('rejects invalid settings before connection: %j', async (settings) => {
    const { connector, sdk } = setup();
    await expect(connector.open(settings)).rejects.toMatchObject({
      code: 'lyria-rt-invalid-settings',
      reason: 'internal',
      retryable: false
    });
    expect(sdk.connections.length).toBe(0);
  });

  it('constructs the client only at start, with an endpoint only when one was given', async () => {
    const direct = setup();
    await prepare(direct.connector);
    expect(direct.sdk.options).toEqual([]);
    const { started: directStart } = await beginStart(direct.connector, direct.sink, direct.sdk);
    expect(direct.sdk.options).toEqual([{ apiKey: 'test-key', apiVersion: 'v1alpha' }]);
    direct.sdk.last.setupComplete();
    await directStart;

    // A trailing slash is a path the origin does not need; the endpoint is
    // normalised so two spellings of one origin cannot behave differently.
    const routed = setup();
    await prepare(routed.connector, { apiKey: 'test-key', endpoint: 'https://proxy.example/' });
    const { started: routedStart } = await beginStart(routed.connector, routed.sink, routed.sdk);
    expect(routed.sdk.options).toEqual([
      {
        apiKey: 'test-key',
        apiVersion: 'v1alpha',
        httpOptions: { baseUrl: 'https://proxy.example' }
      }
    ]);
    routed.sdk.last.setupComplete();
    await routedStart;
  });

  it('reports every configuration problem at once, by JSON Pointer', async () => {
    const { connector } = setup();
    expect(connector.validateConfig?.(DEFAULT_LYRIA_RT_CONFIG)).toEqual({ ok: true });
    expect(connector.validateConfig?.({})).toEqual({ ok: true });

    expect(connector.validateConfig?.({ generation: { temperature: 5 } })).toEqual({
      ok: false,
      problems: [
        { path: '/generation/temperature', code: 'out-of-range', message: expect.any(String) }
      ]
    });
    expect(connector.validateConfig?.({ tempo: 120 })).toMatchObject({
      ok: false,
      problems: [{ path: '/tempo', code: 'unknown-member' }]
    });

    const twoFaults = connector.validateConfig?.({
      prompt: { transitionSteps: 0 },
      generation: { mode: 'loud' }
    });
    expect(twoFaults).toMatchObject({
      ok: false,
      problems: [
        { path: '/prompt/transitionSteps', code: 'out-of-range' },
        { path: '/generation/mode', code: 'not-allowed' }
      ]
    });
  });
});

describe('Lyria RealTime connector startup and model configuration', () => {
  it('waits for setup complete before config, prompts, and play', async () => {
    const { clock, connector, sdk, sink } = setup();
    await prepare(connector);
    const { started } = await beginStart(connector, sink, sdk);
    expect(sdk.last.calls).toEqual([]);

    sdk.last.setupComplete();
    await started;
    expect(clock.pendingDeadlines()).toEqual([]);
    expect(sdk.last.calls.map((call) => call.kind)).toEqual(['config', 'prompts', 'play']);
    expect(sdk.last.calls[0].value).toMatchObject({
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
      code: 'lyria-rt-setup-timeout',
      reason: 'network',
      retryable: true
    });
    expect(sdk.last.calls).toContainEqual({ kind: 'close' });
  });

  it('resends the complete config then resets context before prompt updates', async () => {
    const { connector, sdk, sink } = setup();
    await prepare(connector);
    await completeStart(connector, sink, sdk);
    sdk.last.calls.length = 0;

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
    expect(sdk.last.calls.map((call) => call.kind)).toEqual(['config', 'reset', 'prompts']);
    expect(sdk.last.calls[0].value).toMatchObject({
      bpm: 140,
      scale: 'D_MAJOR_B_MINOR',
      temperature: 1.1,
      guidance: 4,
      topK: 40
    });
  });

  // A GAS tempo counts the meter's beat unit; Lyria RealTime's bpm counts quarter notes.
  // Without the conversion every non-quarter meter would be generated at the
  // wrong tempo, and clamping would be decided against the wrong number.
  it.each([
    { meter: '4/4', beatsPerBar: 4, beatUnit: 4, tempo: 120, bpm: 120, clamped: false },
    { meter: '6/8', beatsPerBar: 6, beatUnit: 8, tempo: 120, bpm: 60, clamped: false },
    { meter: '6/8', beatsPerBar: 6, beatUnit: 8, tempo: 90, bpm: 60, clamped: true },
    { meter: '2/2', beatsPerBar: 2, beatUnit: 2, tempo: 120, bpm: 200, clamped: true }
  ])(
    'sends $tempo bpm in $meter as $bpm quarter-note bpm',
    async ({ beatsPerBar, beatUnit, tempo, bpm, clamped }) => {
      const { connector, sdk, sink, warnings } = setup();
      const state = { ...INITIAL_STATE, globals: { ...INITIAL_STATE.globals, tempo } };
      await prepare(connector, { apiKey: 'test-key' }, state);
      await completeStart(connector, sink, sdk, 'run-1', timingIn(beatsPerBar, beatUnit, tempo));

      expect(sdk.last.calls[0].value).toMatchObject({ bpm });
      expect(warnings.map((warning) => warning.code)).toEqual(
        clamped ? ['lyria-rt-tempo-clamped'] : []
      );
    }
  );

  it('converts a live tempo change in a non-quarter meter and resets context', async () => {
    const { connector, sdk, sink } = setup();
    const state = { ...INITIAL_STATE, globals: { ...INITIAL_STATE.globals, tempo: 120 } };
    await prepare(connector, { apiKey: 'test-key' }, state);
    await completeStart(connector, sink, sdk, 'run-1', timingIn(6, 8, 120));
    expect(sdk.last.calls[0].value).toMatchObject({ bpm: 60 });
    sdk.last.calls.length = 0;

    await connector.update(
      { state: { ...state, globals: { ...state.globals, tempo: 160 } } },
      { bar: 3 }
    );
    // Config and reset, but no prompt send: a tempo change alters the model
    // context without altering a single prompt.
    expect(sdk.last.calls.map((call) => call.kind)).toEqual(['config', 'reset']);
    expect(sdk.last.calls[0].value).toMatchObject({ bpm: 80 });
  });

  it('clamps tempo and warns once for each distinct out-of-range value', async () => {
    const { connector, sdk, sink, warnings } = setup();
    const state = { ...INITIAL_STATE, globals: { ...INITIAL_STATE.globals, tempo: 240 } };
    await prepare(connector, { apiKey: 'test-key' }, state);
    await completeStart(connector, sink, sdk);
    expect(sdk.last.calls[0].value).toMatchObject({ bpm: 200 });
    expect(warnings.map((warning) => warning.code)).toEqual(['lyria-rt-tempo-clamped']);

    await connector.update({ state }, { bar: 2 });
    await connector.update(
      { state: { ...state, globals: { ...state.globals, tempo: 250 } } },
      { bar: 3 }
    );
    expect(warnings.map((warning) => warning.code)).toEqual([
      'lyria-rt-tempo-clamped',
      'lyria-rt-tempo-clamped'
    ]);
  });

  it('rejects invalid direct-call configuration without constructing a client', async () => {
    const { connector, sdk } = setup();
    await connector.open({ apiKey: 'test-key' });
    await expect(
      connector.prepare(INITIAL_STATE, { generation: { topK: 0, vendorSecret: 'hidden' } })
    ).rejects.toMatchObject({ code: 'lyria-rt-invalid-configuration' });
    expect(sdk.connections.length).toBe(0);
  });
});

describe('Lyria RealTime connector prompts, flow control, and audio', () => {
  it('starts empty without play, resumes for prompts, and never sends an empty SDK prompt set', async () => {
    const { connector, sdk, sink } = setup();
    await prepare(connector, { apiKey: 'test-key' }, EMPTY_STATE);
    await completeStart(connector, sink, sdk);
    expect(sdk.last.calls.map((call) => call.kind)).toEqual(['config']);

    await connector.update({ state: INITIAL_STATE }, { bar: 2 });
    await connector.update({ state: EMPTY_STATE }, { bar: 3 });
    const promptCalls = sdk.last.calls.filter((call) => call.kind === 'prompts');
    expect(promptCalls).toHaveLength(1);
    expect(promptCalls[0].value).not.toEqual([]);
    expect(sdk.last.calls.map((call) => call.kind)).toEqual(['config', 'prompts', 'play', 'pause']);
  });

  it('gives flow pause precedence and suppresses duplicate controls', async () => {
    const { connector, sdk, sink, statuses } = setup();
    await prepare(connector);
    await completeStart(connector, sink, sdk);
    sdk.last.calls.length = 0;

    await connector.setGenerationPaused?.(true);
    await connector.setGenerationPaused?.(true);
    await connector.setGenerationPaused?.(false);
    await connector.setGenerationPaused?.(false);
    expect(sdk.last.calls.map((call) => call.kind)).toEqual(['pause', 'play']);
    expect(statuses).toEqual(['streaming', 'throttled', 'streaming']);
  });

  it('cancels a crossfade still in flight when stopped', async () => {
    const { clock, connector, sdk, sink, failures } = setup();
    await prepare(connector, { apiKey: 'test-key' }, INITIAL_STATE, DEFAULT_LYRIA_RT_CONFIG);
    await completeStart(connector, sink, sdk);
    expect(clock.pendingDeadlines()).not.toEqual([]);

    await connector.stop('run-1');
    expect(clock.pendingDeadlines()).toEqual([]);
    clock.advanceBy(10);
    await flushAsync();
    expect(failures).toEqual([]);
  });

  it('settles a start stopped while connecting as cancelled', async () => {
    const { connector, sink } = setup();
    await prepare(connector);
    const started = connector.start(sink, TIMING, 'run-1');
    await flushAsync();
    await connector.stop('run-1');
    await expect(started).rejects.toMatchObject({ code: 'lyria-rt-start-cancelled' });
  });

  it('ignores a Stop for another run', async () => {
    const { connector, sdk, sink } = setup();
    await prepare(connector);
    await completeStart(connector, sink, sdk);
    await connector.stop('run-0');
    expect(sdk.last.released).toBe(false);
    await connector.update({ state: EMPTY_STATE }, { bar: 2 });
  });

  it('decodes and emits every audio chunk with exact metadata and duration', async () => {
    const { connector, sdk, sink, chunks } = setup();
    await prepare(connector);
    await completeStart(connector, sink, sdk);
    sdk.last.audio([1, 2, 3, 4], [5, 6, 7, 8, 9, 10, 11, 12]);

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

  it('sanitizes filtered prompts and malformed audio', async () => {
    const { connector, sdk, sink, warnings, failures } = setup();
    await prepare(connector);
    await completeStart(connector, sink, sdk);
    sdk.last.message({
      filteredPrompt: { text: 'private prompt', filteredReason: 'vendor detail' },
      serverContent: { audioChunks: [{ data: 'not-base64' }] }
    });

    expect(warnings.map((warning) => warning.code)).toEqual(['lyria-rt-prompt-filtered']);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      code: 'lyria-rt-malformed-audio',
      reason: 'provider',
      retryable: true,
      runId: 'run-1'
    });
    expect(JSON.stringify({ warnings, failures })).not.toMatch(/private prompt|vendor detail/);
  });
});

describe('Lyria RealTime connector failure and lifecycle guards', () => {
  it.each([
    [1002, 'lyria-rt-provider-failure', 'provider', true],
    [1011, 'lyria-rt-provider-failure', 'provider', true],
    [1006, 'lyria-rt-network-failure', 'network', true],
    // After setup the policy codes are transport noise, not an auth verdict.
    [1007, 'lyria-rt-network-failure', 'network', true],
    [1008, 'lyria-rt-network-failure', 'network', true],
    // An application code belongs to whoever served the endpoint: classified as a
    // network failure, with the raw number left for the host to map.
    [4429, 'lyria-rt-network-failure', 'network', true],
    [4500, 'lyria-rt-network-failure', 'network', true]
  ] as const)('maps runtime close %i to %s', async (closeCode, code, reason, retryable) => {
    const { connector, sdk, sink, failures } = setup();
    await prepare(connector, { apiKey: 'test-key', endpoint: 'https://proxy.example' });
    await completeStart(connector, sink, sdk);
    sdk.last.serverClose(closeCode);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ code, reason, retryable, runId: 'run-1', closeCode });
  });

  it.each([1007, 1008] as const)(
    'maps pre-setup close %i to auth without leaking close detail',
    async (closeCode) => {
      const { connector, sdk, sink } = setup();
      await prepare(connector);
      const { started } = await beginStart(connector, sink, sdk);
      sdk.last.serverClose(closeCode);
      const failure = await started.catch((error: unknown) => error);
      expect(failure).toMatchObject({
        code: 'lyria-rt-auth-rejected',
        reason: 'auth',
        retryable: false,
        closeCode
      });
      expect(JSON.stringify(failure)).not.toMatch(/test-key/);
    }
  );

  it('stops and closes idempotently, supports a later explicit run, and ignores stale callbacks', async () => {
    const { connector, sdk, sink, chunks } = setup();
    await prepare(connector);
    await completeStart(connector, sink, sdk);
    const stale = sdk.last;
    // A chunk already in flight still arrives while the close completes.
    const stopping = connector.stop('run-1');
    stale.audio([1, 2, 3, 4]);
    await stopping;
    await connector.stop('run-1');
    expect(stale.kinds().filter((kind) => kind === 'stop')).toHaveLength(1);
    expect(stale.kinds().filter((kind) => kind === 'close')).toHaveLength(1);
    expect(chunks).toEqual([]);

    await connector.prepare(INITIAL_STATE, IMMEDIATE_CONFIG);
    await completeStart(connector, sink, sdk, 'run-2');
    expect(sdk.connections.length).toBe(2);
    await connector.close();
    await connector.close();
    await expect(connector.open({ apiKey: 'new-key' })).rejects.toBeInstanceOf(ConnectorError);
  });
});
