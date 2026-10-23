import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAGENTA_RT2_CONFIG,
  resolveMagentaRt2Config,
  validateMagentaRt2Config
} from '../src/config.js';
import { validateMagentaRt2Settings } from '../src/settings.js';
import { AUDIO_HEADER_BYTES, decodeAudioPacket, parseServerMessage } from '../src/protocol.js';

describe('Magenta RT2 settings', () => {
  it.each([
    'ws://127.0.0.1:8765',
    'ws://localhost:8765/',
    'ws://[::1]:8765',
    'wss://music.example/mrt2'
  ])('accepts %s', (endpoint) => {
    expect(validateMagentaRt2Settings({ endpoint }).endpoint).toBe(new URL(endpoint).href);
  });

  it.each([
    'ws://192.168.1.4:8765',
    'http://127.0.0.1:8765',
    'wss://user:pass@music.example',
    'wss://music.example/?token=x',
    'wss://music.example/#x',
    'not a url'
  ])('refuses %s', (endpoint) => {
    expect(() => validateMagentaRt2Settings({ endpoint })).toThrow(
      expect.objectContaining({ code: 'magenta-rt2-invalid-settings' })
    );
  });

  it('takes an optional token and nothing else', () => {
    expect(validateMagentaRt2Settings({ endpoint: 'ws://127.0.0.1:1', token: 't' })).toEqual({
      endpoint: 'ws://127.0.0.1:1/',
      token: 't'
    });
    expect(() => validateMagentaRt2Settings({ endpoint: 'ws://127.0.0.1:1', token: '' })).toThrow();
    expect(() =>
      validateMagentaRt2Settings({ endpoint: 'ws://127.0.0.1:1', apiKey: 'k' })
    ).toThrow();
  });
});

describe('Magenta RT2 configuration', () => {
  it('accepts its own defaults and fills them in', () => {
    expect(validateMagentaRt2Config(DEFAULT_MAGENTA_RT2_CONFIG)).toEqual({ ok: true });
    expect(resolveMagentaRt2Config({ generation: { temperature: 1.1 } })).toEqual({
      prompt: { globalWeight: 1, trackWeight: 1 },
      generation: { temperature: 1.1 },
      connectTimeoutSeconds: 10
    });
  });

  it('reports every problem with its JSON Pointer', () => {
    expect(
      validateMagentaRt2Config({
        prompt: { globalWeight: -1, extra: 1 },
        generation: { topK: 1.5 },
        connectTimeoutSeconds: 'soon',
        other: true
      })
    ).toEqual({
      ok: false,
      problems: [
        expect.objectContaining({ path: '/prompt/globalWeight', code: 'out-of-range' }),
        expect.objectContaining({ path: '/prompt/extra', code: 'unknown-member' }),
        expect.objectContaining({ path: '/generation/topK', code: 'wrong-type' }),
        expect.objectContaining({ path: '/connectTimeoutSeconds', code: 'wrong-type' }),
        expect.objectContaining({ path: '/other', code: 'unknown-member' })
      ]
    });
  });
});

describe('Magenta RT2 wire codec', () => {
  it('decodes an audio packet header and payload', () => {
    const bytes = new Uint8Array(AUDIO_HEADER_BYTES + 8);
    bytes.set([0x4d, 0x52, 0x54, 0x31]);
    const view = new DataView(bytes.buffer);
    view.setUint32(4, 7, true);
    view.setBigUint64(8, 15_360n, true);
    bytes.set([1, 2, 3, 4, 5, 6, 7, 8], AUDIO_HEADER_BYTES);
    expect(decodeAudioPacket(bytes.buffer)).toEqual({
      sequence: 7,
      position: 15_360,
      pcm: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      frames: 2
    });
  });

  it('refuses a wrong magic, an empty payload or a partial frame', () => {
    const wrongMagic = new Uint8Array(AUDIO_HEADER_BYTES + 4);
    expect(decodeAudioPacket(wrongMagic.buffer)).toBeUndefined();
    const empty = new Uint8Array(AUDIO_HEADER_BYTES);
    empty.set([0x4d, 0x52, 0x54, 0x31]);
    expect(decodeAudioPacket(empty.buffer)).toBeUndefined();
    const partial = new Uint8Array(AUDIO_HEADER_BYTES + 6);
    partial.set([0x4d, 0x52, 0x54, 0x31]);
    expect(decodeAudioPacket(partial.buffer)).toBeUndefined();
  });

  it('refuses malformed control messages', () => {
    expect(parseServerMessage('not json')).toBeUndefined();
    expect(parseServerMessage('{"type":"ack","id":0}')).toBeUndefined();
    expect(parseServerMessage('{"type":"error","code":"x"}')).toBeUndefined();
    expect(parseServerMessage('{"type":"surprise"}')).toBeUndefined();
    expect(parseServerMessage('{"type":"ack","id":3}')).toEqual({ type: 'ack', id: 3 });
  });
});
