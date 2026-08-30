// Frame identity must use the sending window because sandboxed frames have a null origin.
import { describe, expect, test } from 'vitest';
import { isFrameMessage, parseBitsyBridgeMessage } from '../src/bitsy/bridge.js';

/** Stand-ins for the two window objects. Identity is all that is compared. */
const gameWindow = { name: 'game' };
const otherWindow = { name: 'other' };
const frame = { contentWindow: gameWindow };

/** Include an origin field so tests can confirm that frame matching ignores it. */
const messageFrom = (source: unknown, origin = 'null'): { source: unknown; origin: string } => ({
  source,
  origin
});

describe('isFrameMessage', () => {
  test('accepts a message from the frame even on an opaque origin', () => {
    // `origin: 'null'` is exactly what the sandboxed frame produces. The event
    // carries it and the check must not care.
    expect(isFrameMessage(messageFrom(gameWindow, 'null'), frame)).toBe(true);
  });

  test('accepts regardless of what origin says', () => {
    for (const origin of ['null', '', 'https://elsewhere.example', 'https://lunaestelar.com']) {
      expect(isFrameMessage(messageFrom(gameWindow, origin), frame), origin).toBe(true);
    }
  });

  test('rejects a message from another window', () => {
    expect(isFrameMessage(messageFrom(otherWindow), frame)).toBe(false);
  });

  test('rejects when there is no frame yet', () => {
    // The iframe is `loading="lazy"`, so the listener can be attached before it
    // is in the document.
    expect(isFrameMessage(messageFrom(gameWindow), null)).toBe(false);
    expect(isFrameMessage(messageFrom(gameWindow), undefined)).toBe(false);
  });

  test('rejects when both sides are null, rather than matching them', () => {
    // A closed window gives `event.source === null`, and a frame that has not
    // loaded gives `contentWindow === null`. Comparing them directly would make
    // null === null accept anything.
    expect(isFrameMessage(messageFrom(null), { contentWindow: null })).toBe(false);
    expect(isFrameMessage(messageFrom(undefined), { contentWindow: undefined })).toBe(false);
  });
});

describe('the second half of the check', () => {
  // Coming from the right window is not enough on its own: the frame is a whole
  // Bitsy document that could post anything. The payload has to identify itself.
  const valid = {
    source: 'gas-bitsy',
    version: 1,
    event: 'room-enter',
    room: { id: '0', name: 'Andromeda' },
    inventory: [],
    variables: {},
    detail: { id: '0', name: 'Andromeda' }
  };

  test('accepts the bridge’s own message shape', () => {
    expect(parseBitsyBridgeMessage(valid)).toBeDefined();
  });

  test('rejects a message that does not claim to be from the bridge', () => {
    expect(parseBitsyBridgeMessage({ ...valid, source: 'something-else' })).toBeUndefined();
    expect(parseBitsyBridgeMessage({ ...valid, source: undefined })).toBeUndefined();
  });

  test('rejects a future bridge version rather than guessing at it', () => {
    expect(parseBitsyBridgeMessage({ ...valid, version: 2 })).toBeUndefined();
  });
});
