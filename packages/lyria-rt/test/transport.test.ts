import { describe, expect, it, vi } from 'vitest';
import type {
  Connection,
  ConnectorAudioChunk,
  ConnectorConfig,
  ConnectorError,
  ConnectorTiming,
  ConnectorWarning,
  EffectiveState
} from '@luna-estelar/gas/protocol';
import { createLyriaRtConnectorWithDependencies } from '../src/connector.js';
import { DEFAULT_LYRIA_RT_CONFIG } from '../src/config.js';
import { LYRIA_RT_MODEL_ID } from '../src/constants.js';
import { translatePrompts } from '../src/prompts.js';
import type { LyriaRtConnectorOptions } from '../src/settings.js';
import { createPromptTransition } from '../src/transition.js';
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
  quarterNoteTempo: 96,
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

interface ConnectOverrides {
  readonly state?: EffectiveState;
  readonly config?: ConnectorConfig;
  readonly timing?: ConnectorTiming;
}

function setup(options: Partial<LyriaRtConnectorOptions> = {}) {
  const clock = new VirtualClock();
  const sdk = new FakeLiveMusic();
  const connector = createLyriaRtConnectorWithDependencies(
    { apiKey: 'test-key', ...options },
    { clock, setupTimeoutSeconds: 15, createClient: sdk.createClient }
  );
  const chunks: ConnectorAudioChunk[] = [];
  const warnings: ConnectorWarning[] = [];
  const errors: ConnectorError[] = [];

  function connect(overrides: ConnectOverrides = {}) {
    const controller = new AbortController();
    const connecting = connector.connect({
      config: overrides.config ?? IMMEDIATE_CONFIG,
      state: overrides.state ?? INITIAL_STATE,
      timing: overrides.timing ?? TIMING,
      signal: controller.signal,
      onAudio: (chunk) => chunks.push(chunk),
      onWarning: (warning) => warnings.push(warning),
      onError: (error) => errors.push(error)
    });
    return { connecting, controller };
  }

  /** Starts a connect and lets the socket open, short of setup. */
  async function beginConnect(overrides: ConnectOverrides = {}) {
    const expected = sdk.connections.length + 1;
    const started = connect(overrides);
    await flushAsync();
    expect(sdk.connections).toHaveLength(expected);
    expect(sdk.last.model).toBe(LYRIA_RT_MODEL_ID);
    sdk.last.open();
    await flushAsync();
    return started;
  }

  async function completeConnect(overrides: ConnectOverrides = {}): Promise<Connection> {
    const { connecting } = await beginConnect(overrides);
    sdk.last.setupComplete();
    return connecting;
  }

  return {
    clock,
    sdk,
    connector,
    chunks,
    warnings,
    errors,
    connect,
    beginConnect,
    completeConnect
  };
}

/** `TIMING` in another meter, at a tempo counted in that meter's beat unit. */
function timingIn(beatsPerBar: number, beatUnit: number, tempo: number): ConnectorTiming {
  return {
    ...TIMING,
    tempo,
    quarterNoteTempo: (tempo * 4) / beatUnit,
    timeSignature: { beatsPerBar, beatUnit },
    secondsPerBar: (60 / tempo) * beatsPerBar
  };
}

describe('Lyria RealTime connector description and options', () => {
  it('describes immutable model facts without constructing a client', () => {
    const { connector, sdk } = setup();
    const { description } = connector;
    expect(description.id).toBe('lyria-rt');
    expect(description.model).toMatchObject({
      modelId: LYRIA_RT_MODEL_ID,
      codec: 'pcm',
      sampleFormat: 's16le',
      sampleRate: 48_000,
      channels: 2,
      chunkDurationSeconds: 2,
      // Measured in manual/startup.mjs: p95 1.0 s, max 1.17 s.
      startupDelaySeconds: 1.2
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
    expect('supportsFlowControl' in description).toBe(false);
    expect(Object.isFrozen(description)).toBe(true);
    expect(Object.isFrozen(description.capabilities.intents)).toBe(true);
    expect(sdk.options).toEqual([]);
  });

  it.each([
    {},
    { apiKey: '' },
    { apiKey: '   ' },
    { apiKey: 42 },
    { apiKey: 'x', extra: true },
    { apiKey: 'x', accessMode: 'byok' },
    { apiKey: 'x', translate: 'loud' },
    { apiKey: 'x', transition: {} },
    { endpoint: 'https://proxy.example' },
    { apiKey: 'x', endpoint: '' },
    { apiKey: 'x', endpoint: 'not-a-url' },
    { apiKey: 'x', endpoint: 'http://proxy.example' },
    { apiKey: 'x', endpoint: 'wss://proxy.example' },
    { apiKey: 'x', endpoint: 'https://user:pass@proxy.example' },
    { apiKey: 'x', endpoint: 'https://proxy.example/path' },
    { apiKey: 'x', endpoint: 'https://proxy.example?key=secret' },
    { apiKey: 'x', endpoint: 'https://proxy.example#fragment' }
  ])('throws for invalid options at once: %j', (options) => {
    const sdk = new FakeLiveMusic();
    expect(() =>
      createLyriaRtConnectorWithDependencies(options as unknown as LyriaRtConnectorOptions, {
        clock: new VirtualClock(),
        setupTimeoutSeconds: 15,
        createClient: sdk.createClient
      })
    ).toThrow(expect.objectContaining({ code: 'lyria-rt-invalid-settings', retryable: false }));
    expect(sdk.options).toEqual([]);
  });

  it('constructs the client only at connect, with an endpoint only when one was given', async () => {
    const direct = setup();
    expect(direct.sdk.options).toEqual([]);
    await direct.completeConnect();
    expect(direct.sdk.options).toEqual([{ apiKey: 'test-key', apiVersion: 'v1alpha' }]);

    // A trailing slash is a path the origin does not need; the endpoint is
    // normalised so two spellings of one origin cannot behave differently.
    const routed = setup({ endpoint: 'https://proxy.example/' });
    await routed.completeConnect();
    expect(routed.sdk.options).toEqual([
      {
        apiKey: 'test-key',
        apiVersion: 'v1alpha',
        httpOptions: { baseUrl: 'https://proxy.example' }
      }
    ]);
  });

  it('calls a key function once per connect', async () => {
    let issued = 0;
    const apiKey = vi.fn(async () => `token-${++issued}`);
    const { sdk, completeConnect } = setup({ apiKey });
    await completeConnect();
    await completeConnect();
    expect(apiKey).toHaveBeenCalledTimes(2);
    expect(sdk.options.map((options) => options.apiKey)).toEqual(['token-1', 'token-2']);
  });

  it.each([
    ['throws', () => Promise.reject(new Error('secret-token-service-detail'))],
    ['returns an empty string', () => '']
  ] as const)('rejects when the key function %s', async (_, apiKey) => {
    const { sdk, connect } = setup({ apiKey });
    const failure = await connect().connecting.catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: 'lyria-rt-api-key-unavailable',
      reason: 'auth',
      retryable: true
    });
    expect(JSON.stringify(failure)).not.toMatch(/secret-token-service-detail/);
    expect(sdk.options).toEqual([]);
  });

  it('reports every configuration problem at once, by JSON Pointer', () => {
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

  it('rejects an invalid configuration without constructing a client', async () => {
    const { sdk, connect } = setup();
    await expect(
      connect({ config: { generation: { topK: 0, vendorSecret: 'hidden' } } }).connecting
    ).rejects.toMatchObject({ code: 'lyria-rt-invalid-configuration' });
    expect(sdk.options).toEqual([]);
  });
});

describe('Lyria RealTime connector startup and model configuration', () => {
  it('waits for setup before config, prompts, and play', async () => {
    const { clock, sdk, beginConnect } = setup();
    const { connecting } = await beginConnect();
    expect(sdk.last.calls).toEqual([]);

    sdk.last.setupComplete();
    await connecting;
    expect(clock.pendingDeadlines()).toEqual([]);
    expect(sdk.last.kinds()).toEqual(['config', 'prompts', 'play']);
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
    const { clock, sdk, beginConnect } = setup();
    const { connecting } = await beginConnect();
    clock.advanceBy(15);
    await expect(connecting).rejects.toMatchObject({
      code: 'lyria-rt-setup-timeout',
      reason: 'network',
      retryable: true
    });
    expect(sdk.last.released).toBe(true);
  });

  it('resends the complete config then resets context before prompt updates', async () => {
    const { sdk, completeConnect } = setup();
    const connection = await completeConnect();
    sdk.last.calls.length = 0;

    const applied = await connection.update(
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
    expect(applied).toEqual({ bar: 3 });
    expect(sdk.last.kinds()).toEqual(['config', 'reset', 'prompts']);
    expect(sdk.last.calls[0].value).toMatchObject({
      bpm: 140,
      scale: 'D_MAJOR_B_MINOR',
      temperature: 1.1,
      guidance: 4,
      topK: 40
    });
  });

  // A GAS tempo counts the meter's beat unit; Lyria RealTime's bpm counts quarter
  // notes. The connector converts through `quarterNoteTempo`, and clamps against
  // the converted number.
  it.each([
    { meter: '4/4', beatsPerBar: 4, beatUnit: 4, tempo: 120, bpm: 120, clamped: false },
    { meter: '6/8', beatsPerBar: 6, beatUnit: 8, tempo: 120, bpm: 60, clamped: false },
    { meter: '6/8', beatsPerBar: 6, beatUnit: 8, tempo: 90, bpm: 60, clamped: true },
    { meter: '2/2', beatsPerBar: 2, beatUnit: 2, tempo: 120, bpm: 200, clamped: true }
  ])(
    'sends $tempo bpm in $meter as $bpm quarter-note bpm',
    async ({ beatsPerBar, beatUnit, tempo, bpm, clamped }) => {
      const { sdk, warnings, completeConnect } = setup();
      const state = { ...INITIAL_STATE, globals: { ...INITIAL_STATE.globals, tempo } };
      await completeConnect({ state, timing: timingIn(beatsPerBar, beatUnit, tempo) });

      expect(sdk.last.calls[0].value).toMatchObject({ bpm });
      expect(warnings.map((warning) => warning.code)).toEqual(
        clamped ? ['lyria-rt-tempo-clamped'] : []
      );
    }
  );

  it('converts a live tempo change in a non-quarter meter and resets context', async () => {
    const { sdk, completeConnect } = setup();
    const state = { ...INITIAL_STATE, globals: { ...INITIAL_STATE.globals, tempo: 120 } };
    const connection = await completeConnect({ state, timing: timingIn(6, 8, 120) });
    expect(sdk.last.calls[0].value).toMatchObject({ bpm: 60 });
    sdk.last.calls.length = 0;

    await connection.update(
      { state: { ...state, globals: { ...state.globals, tempo: 160 } } },
      { bar: 3 }
    );
    // Config and reset, but no prompt send: a tempo change alters the model
    // context without altering a single prompt.
    expect(sdk.last.kinds()).toEqual(['config', 'reset']);
    expect(sdk.last.calls[0].value).toMatchObject({ bpm: 80 });
  });

  it('clamps tempo and warns once for each distinct out-of-range value, per connection', async () => {
    const { warnings, completeConnect } = setup();
    const state = { ...INITIAL_STATE, globals: { ...INITIAL_STATE.globals, tempo: 240 } };
    const connection = await completeConnect({ state });
    expect(warnings.map((warning) => warning.code)).toEqual(['lyria-rt-tempo-clamped']);

    await connection.update({ state }, { bar: 2 });
    await connection.update(
      { state: { ...state, globals: { ...state.globals, tempo: 250 } } },
      { bar: 3 }
    );
    expect(warnings).toHaveLength(2);

    // The next Play warns again.
    await completeConnect({ state });
    expect(warnings).toHaveLength(3);
  });
});

describe('Lyria RealTime connector prompts, pause, and audio', () => {
  it('starts empty without play, plays for prompts, and never sends an empty prompt set', async () => {
    const { sdk, completeConnect } = setup();
    const connection = await completeConnect({ state: EMPTY_STATE });
    expect(sdk.last.kinds()).toEqual(['config']);

    await connection.update({ state: INITIAL_STATE }, { bar: 2 });
    await connection.update({ state: EMPTY_STATE }, { bar: 3 });
    const promptCalls = sdk.last.calls.filter((call) => call.kind === 'prompts');
    expect(promptCalls).toHaveLength(1);
    expect(promptCalls[0].value).not.toEqual([]);
    expect(sdk.last.kinds()).toEqual(['config', 'prompts', 'play', 'pause']);
  });

  it('gives pause precedence over prompts and suppresses duplicate controls', async () => {
    const { sdk, completeConnect } = setup();
    const connection = await completeConnect();
    sdk.last.calls.length = 0;

    await connection.pause();
    await connection.pause();
    await connection.resume();
    await connection.resume();
    expect(sdk.last.kinds()).toEqual(['pause', 'play']);
  });

  // The renderer resumes one lead before a track comes in after a rest, then
  // sends the entry's update. The model must not play until it has prompts.
  it('resumes during a rest without playing, and plays at the next update with prompts', async () => {
    const { sdk, completeConnect } = setup();
    const connection = await completeConnect();
    await connection.pause();
    await connection.update({ state: EMPTY_STATE }, { bar: 3 });
    sdk.last.calls.length = 0;

    await connection.resume();
    expect(sdk.last.kinds()).toEqual([]);
    await connection.update({ state: INITIAL_STATE }, { bar: 5 });
    expect(sdk.last.kinds()).toEqual(['prompts', 'play']);
  });

  it('cancels a crossfade in flight on close, and resolves once the socket closes', async () => {
    const { clock, sdk, errors, completeConnect } = setup();
    const connection = await completeConnect({ config: DEFAULT_LYRIA_RT_CONFIG });
    expect(clock.pendingDeadlines()).not.toEqual([]);

    let closed = false;
    const closing = connection.close().then(() => (closed = true));
    expect(clock.pendingDeadlines()).toEqual([]);
    expect(closed).toBe(false);
    await closing;
    expect(sdk.last.kinds().slice(-2)).toEqual(['stop', 'close']);

    clock.advanceBy(10);
    await flushAsync();
    expect(errors).toEqual([]);
  });

  it('decodes and emits every audio chunk with exact metadata and duration', async () => {
    const { sdk, chunks, completeConnect } = setup();
    await completeConnect();
    sdk.last.audio([1, 2, 3, 4], [5, 6, 7, 8, 9, 10, 11, 12]);

    expect(chunks).toHaveLength(2);
    expect([...chunks[0].bytes]).toEqual([1, 2, 3, 4]);
    expect(chunks[0]).toEqual({
      bytes: expect.any(Uint8Array),
      codec: 'pcm',
      sampleFormat: 's16le',
      sampleRate: 48_000,
      channels: 2,
      durationSeconds: 4 / 192_000
    });
    expect(chunks[1].durationSeconds).toBe(8 / 192_000);
  });

  it('sanitizes filtered prompts and malformed audio', async () => {
    const { sdk, warnings, errors, completeConnect } = setup();
    await completeConnect();
    sdk.last.message({
      filteredPrompt: { text: 'private prompt', filteredReason: 'vendor detail' },
      serverContent: { audioChunks: [{ data: 'not-base64' }] }
    });

    expect(warnings.map((warning) => warning.code)).toEqual(['lyria-rt-prompt-filtered']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: 'lyria-rt-malformed-audio',
      reason: 'provider',
      retryable: true
    });
    expect(sdk.last.released).toBe(true);
    expect(JSON.stringify({ warnings, errors })).not.toMatch(/private prompt|vendor detail/);
  });

  it('reports malformed audio at once but closes only on the close event', async () => {
    const { sdk, warnings, errors, completeConnect } = setup();
    const connection = await completeConnect();
    sdk.last.holdCloseEvent();
    sdk.last.message({ serverContent: { audioChunks: [{ data: 'not-base64' }] } });
    expect(errors.map((error) => error.code)).toEqual(['lyria-rt-malformed-audio']);

    sdk.last.message({ warning: 'late' });
    expect(warnings).toEqual([]);

    let closed = false;
    void connection.close().then(() => {
      closed = true;
    });
    await flushAsync();
    expect(closed).toBe(false);
    expect(sdk.last.kinds().filter((kind) => kind === 'stop')).toEqual([]);

    sdk.last.releaseClose();
    await flushAsync();
    expect(closed).toBe(true);
    expect(errors).toHaveLength(1);
  });
});

describe('Lyria RealTime connector hooks', () => {
  it('uses the translate hook for the first prompts and every update', async () => {
    const translate = vi.fn((state: EffectiveState, config) =>
      translatePrompts(state, config.prompt).map((prompt) => ({ ...prompt, text: 'hooked' }))
    );
    const { sdk, completeConnect } = setup({ translate });
    const connection = await completeConnect();
    await connection.update({ state: INITIAL_STATE }, { bar: 2 });

    expect(translate).toHaveBeenCalledTimes(2);
    // The hook gets the resolved config, so it never sees a missing member.
    expect(translate.mock.calls[0][1]).toEqual(IMMEDIATE_CONFIG);
    expect(sdk.last.calls[1].value).toEqual([{ text: 'hooked', weight: 0.75 }]);
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('hook-internal-detail');
      }
    ],
    ['returns an empty text', () => [{ text: ' ', weight: 1 }]],
    ['returns a weight that is not finite', () => [{ text: 'a', weight: Number.NaN }]],
    ['returns something other than a list', () => 'a' as unknown as []]
  ] as const)('fails with lyria-rt-translate-failed when the hook %s', async (_, translate) => {
    const { sdk, beginConnect } = setup({ translate });
    const { connecting } = await beginConnect();
    sdk.last.setupComplete();
    const failure = await connecting.catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: 'lyria-rt-translate-failed',
      reason: 'internal',
      retryable: false
    });
    expect(JSON.stringify(failure)).not.toMatch(/hook-internal-detail/);
    expect(sdk.last.released).toBe(true);
  });

  it('closes the socket and hides the detail when the transition hook throws', async () => {
    const transition = () => {
      throw new Error('hook-internal-detail');
    };
    const { sdk, beginConnect } = setup({ transition });
    const { connecting } = await beginConnect();
    sdk.last.setupComplete();
    const failure = await connecting.catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: 'lyria-rt-startup-failure',
      reason: 'internal',
      retryable: false
    });
    expect(JSON.stringify(failure)).not.toMatch(/hook-internal-detail/);
    expect(sdk.last.kinds().slice(-2)).toEqual(['stop', 'close']);
  });

  it('makes one transition per connection with the transition hook', async () => {
    const transition = vi.fn(createPromptTransition);
    const { completeConnect } = setup({ transition });
    await completeConnect();
    await completeConnect();
    expect(transition).toHaveBeenCalledTimes(2);
    expect(transition.mock.calls[0][0]).toMatchObject({
      transitionDurationMs: 0,
      transitionSteps: 1
    });
  });
});

// Cancelling, close and failure reporting in general are in conformance.test.ts.
describe('Lyria RealTime connector connections and cancelling', () => {
  it('rejects at once when the signal aborts during the first sends', async () => {
    const { sdk, beginConnect } = setup();
    const { connecting, controller } = await beginConnect();
    // Hold the config send so the abort lands while it is pending.
    const pending = sdk.last.session.setMusicGenerationConfig;
    sdk.last.session.setMusicGenerationConfig = () => new Promise(() => undefined);
    sdk.last.setupComplete();
    await flushAsync();
    controller.abort();
    await expect(connecting).rejects.toMatchObject({ code: 'lyria-rt-start-cancelled' });
    sdk.last.session.setMusicGenerationConfig = pending;
    await flushAsync();
    expect(sdk.last.released).toBe(true);
  });

  it('reports a failed update only as its rejection', async () => {
    const { sdk, errors, completeConnect } = setup();
    const connection = await completeConnect();
    sdk.last.session.setWeightedPrompts = () => Promise.reject(new Error('socket gone'));
    await expect(
      connection.update(
        {
          state: {
            ...INITIAL_STATE,
            tracks: [{ ...INITIAL_STATE.tracks[0], timbre: { kind: 'text', text: 'glassy' } }]
          }
        },
        { bar: 2 }
      )
    ).rejects.toMatchObject({ code: 'lyria-rt-network-failure' });
    expect(errors).toEqual([]);
  });
});

describe('Lyria RealTime connector close codes', () => {
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
    const { sdk, errors, completeConnect } = setup({ endpoint: 'https://proxy.example' });
    await completeConnect();
    sdk.last.serverClose(closeCode);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code, reason, retryable, closeCode });
  });

  it.each([1007, 1008] as const)(
    'maps pre-setup close %i to auth without leaking close detail',
    async (closeCode) => {
      const { sdk, errors, beginConnect } = setup();
      const { connecting } = await beginConnect();
      sdk.last.serverClose(closeCode);
      const failure = await connecting.catch((error: unknown) => error);
      expect(failure).toMatchObject({
        code: 'lyria-rt-auth-rejected',
        reason: 'auth',
        retryable: false,
        closeCode
      });
      expect(errors).toEqual([]);
      expect(JSON.stringify(failure)).not.toMatch(/test-key/);
    }
  );

  it('rejects connect, not onError, for a close during the first sends', async () => {
    const { sdk, errors, beginConnect } = setup();
    const { connecting } = await beginConnect();
    sdk.last.session.setMusicGenerationConfig = () => new Promise(() => undefined);
    sdk.last.setupComplete();
    await flushAsync();
    sdk.last.serverClose(1011);
    await expect(connecting).rejects.toMatchObject({ code: 'lyria-rt-provider-failure' });
    expect(errors).toEqual([]);
  });
});
