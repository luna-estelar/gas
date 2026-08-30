// Verify connector configuration, audio forwarding and AudioContext cleanup through mocked packages.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioChunk } from '@luna-estelar/gas-protocol';

const createSession = vi.fn();
const createRenderer = vi.fn();
const createLyriaConnector = vi.fn(() => ({ connector: true }));

vi.mock('@luna-estelar/gas-api', () => ({
  createSession: (...args: unknown[]) => createSession(...args)
}));
vi.mock('@luna-estelar/gas-renderer', () => ({
  createRenderer: (...args: unknown[]) => createRenderer(...args)
}));
vi.mock('@luna-estelar/gas-connector-lyria', () => ({
  createLyriaConnector: () => createLyriaConnector()
}));

const { createBrowserSession } = await import('../src/wiring.js');
const { createCredentialCell } = await import('../src/access.js');

class FakeContext {
  currentTime = 0;
  readonly destination = {};
  resumes = 0;
  closes = 0;
  createGain() {
    return { gain: {}, connect() {} };
  }
  createBuffer(channels: number, frames: number, sampleRate: number) {
    return {
      duration: frames / sampleRate,
      getChannelData: () => new Float32Array(frames),
      channels
    };
  }
  createBufferSource() {
    return { connect() {}, start() {}, stop() {}, onended: null, buffer: null };
  }
  async resume() {
    this.resumes += 1;
  }
  async close() {
    this.closes += 1;
  }
}

/** A minimal GasSession stand-in that lets a test emit renderer audio. */
function fakeSession() {
  const listeners: Array<(chunk: AudioChunk) => void> = [];
  return {
    closed: 0,
    unsubscribed: 0,
    on(event: string, listener: (chunk: AudioChunk) => void) {
      expect(event).toBe('audio');
      listeners.push(listener);
      return () => {
        this.unsubscribed += 1;
      };
    },
    async close() {
      this.closed += 1;
    },
    emit(chunk: AudioChunk) {
      for (const listener of listeners) listener(chunk);
    }
  };
}

function chunk(): AudioChunk {
  return {
    runId: 'run-a',
    sequence: 0,
    codec: 'pcm',
    sampleFormat: 's16le',
    sampleRate: 2,
    channels: 2,
    bytes: new Uint8Array([0, 0, 0, 0]),
    durationSeconds: 0.5
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createLyriaConnector.mockReturnValue({ connector: true });
});

describe('createBrowserSession', () => {
  it('passes BYOK credentials through to the connector settings', async () => {
    const session = fakeSession();
    createSession.mockResolvedValue(session);
    const context = new FakeContext();

    await createBrowserSession({
      access: { mode: 'byok', credentials: createCredentialCell('secret') },
      createContext: () => context as unknown as AudioContext
    });

    await createSession.mock.calls[0]![0].createRenderer();
    expect(createRenderer.mock.calls[0]![0].settings).toEqual({
      accessMode: 'byok',
      apiKey: 'secret'
    });
    expect(context.resumes).toBe(1);
  });

  it('passes a hosted proxy through the same path', async () => {
    createSession.mockResolvedValue(fakeSession());
    const context = new FakeContext();

    await createBrowserSession({
      access: { mode: 'hosted', proxyBaseUrl: 'https://proxy.example' },
      createContext: () => context as unknown as AudioContext
    });

    await createSession.mock.calls[0]![0].createRenderer();
    expect(createRenderer.mock.calls[0]![0].settings).toEqual({
      accessMode: 'hosted',
      proxyBaseUrl: 'https://proxy.example'
    });
  });

  it('routes renderer audio into playback and records only when asked', async () => {
    const session = fakeSession();
    createSession.mockResolvedValue(session);

    const withoutCapture = await createBrowserSession({
      access: { mode: 'hosted', proxyBaseUrl: 'https://proxy.example' },
      createContext: () => new FakeContext() as unknown as AudioContext
    });
    expect(withoutCapture.capture).toBeUndefined();

    const withCapture = await createBrowserSession({
      access: { mode: 'hosted', proxyBaseUrl: 'https://proxy.example' },
      capture: true,
      createContext: () => new FakeContext() as unknown as AudioContext
    });
    session.emit(chunk());
    expect(withCapture.capture?.snapshot()?.durationSeconds).toBeCloseTo(0.5);
  });

  it('unsubscribes, closes the session, then closes audio', async () => {
    const session = fakeSession();
    createSession.mockResolvedValue(session);
    const context = new FakeContext();

    const browser = await createBrowserSession({
      access: { mode: 'hosted', proxyBaseUrl: 'https://proxy.example' },
      createContext: () => context as unknown as AudioContext
    });
    await browser.close();

    expect(session.unsubscribed).toBe(1);
    expect(session.closed).toBe(1);
    expect(context.closes).toBe(1);
  });

  it('closes the AudioContext when the session fails to start', async () => {
    createSession.mockRejectedValue(new Error('no credential'));
    const context = new FakeContext();

    await expect(
      createBrowserSession({
        access: { mode: 'hosted', proxyBaseUrl: 'https://proxy.example' },
        createContext: () => context as unknown as AudioContext
      })
    ).rejects.toThrow('no credential');
    expect(context.closes).toBe(1);
  });
});
