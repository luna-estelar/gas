import { describe, expect, test } from 'vitest';
import { toMidi, type NoteEvent } from '../src/index.js';
import { encodeVlq } from '../src/midi/vlq.js';

describe('toMidi', () => {
  test('writes SMF type-0 header and one track', () => {
    const midi = toMidi([{ pitch: 60, start: 0, duration: 1, velocity: 69 }]);

    expect(ascii(midi, 0, 4)).toBe('MThd');
    expect(readU32(midi, 4)).toBe(6);
    expect(readU16(midi, 8)).toBe(0);
    expect(readU16(midi, 10)).toBe(1);
    expect(readU16(midi, 12)).toBe(480);
    expect(ascii(midi, 14, 18)).toBe('MTrk');
  });

  test('encodes variable-length quantities', () => {
    expect(encodeVlq(0)).toEqual([0x00]);
    expect(encodeVlq(127)).toEqual([0x7f]);
    expect(encodeVlq(128)).toEqual([0x81, 0x00]);
    expect(encodeVlq(480)).toEqual([0x83, 0x60]);
  });

  test('encodes tempo, note-on/off pairs, and off-before-on ordering', () => {
    const events: NoteEvent[] = [
      { pitch: 60, start: 0, duration: 1, velocity: 64 },
      { pitch: 64, start: 1, duration: 1, velocity: 80 }
    ];
    const midi = toMidi(events, { tempo: 60, ppq: 480 });
    const decoded = decodeTrack(midi);

    expect(decoded).toEqual([
      { tick: 0, kind: 'tempo', value: 1_000_000 },
      { tick: 0, kind: 'on', pitch: 60, velocity: 64 },
      { tick: 480, kind: 'off', pitch: 60, velocity: 0 },
      { tick: 480, kind: 'on', pitch: 64, velocity: 80 },
      { tick: 960, kind: 'off', pitch: 64, velocity: 0 },
      { tick: 960, kind: 'end' }
    ]);
  });

  test('never collapses a note to zero ticks (no stuck notes)', () => {
    // A duration that rounds to 0 ticks must still emit a note-off strictly
    // after its note-on, or the note stays stuck until end-of-track.
    const midi = toMidi([{ pitch: 60, start: 0, duration: 0.0001, velocity: 64 }], { ppq: 480 });
    const decoded = decodeTrack(midi);

    const on = decoded.find((event) => event.kind === 'on');
    const off = decoded.find((event) => event.kind === 'off');
    expect(on?.tick).toBe(0);
    expect(off?.tick).toBe(1);
  });

  test('rejects invalid event data', () => {
    expect(() => toMidi([{ pitch: 128, start: 0, duration: 1, velocity: 69 }])).toThrow(RangeError);
    expect(() => toMidi([{ pitch: 60, start: -1, duration: 1, velocity: 69 }])).toThrow(RangeError);
    expect(() => toMidi([{ pitch: 60, start: 0, duration: 0, velocity: 69 }])).toThrow(RangeError);
    expect(() => toMidi([{ pitch: 60, start: 0, duration: 1, velocity: 128 }])).toThrow(RangeError);
    expect(() => toMidi([], { tempo: 0 })).toThrow(RangeError);
    expect(() => toMidi([], { ppq: 0 })).toThrow(RangeError);
  });

  test('rejects tempos that overflow the 24-bit meta event', () => {
    // 3 BPM => 20,000,000 µs/quarter > 0xffffff; the high byte would be truncated.
    expect(() => toMidi([], { tempo: 3 })).toThrow(RangeError);
    // ~3.58 BPM is the boundary; 4 BPM (15,000,000) still fits.
    expect(() =>
      toMidi([{ pitch: 60, start: 0, duration: 1, velocity: 64 }], { tempo: 4 })
    ).not.toThrow();
  });
});

type DecodedEvent =
  | { readonly tick: number; readonly kind: 'tempo'; readonly value: number }
  | {
      readonly tick: number;
      readonly kind: 'on' | 'off';
      readonly pitch: number;
      readonly velocity: number;
    }
  | { readonly tick: number; readonly kind: 'end' };

function decodeTrack(midi: Uint8Array): DecodedEvent[] {
  const trackStart = 22;
  const trackEnd = trackStart + readU32(midi, 18);
  const events: DecodedEvent[] = [];
  let offset = trackStart;
  let tick = 0;

  while (offset < trackEnd) {
    const delta = readVlq(midi, offset);
    offset = delta.next;
    tick += delta.value;
    const status = midi[offset++];

    if (status === 0xff) {
      const type = midi[offset++];
      const length = readVlq(midi, offset);
      offset = length.next;
      if (type === 0x51) {
        events.push({
          tick,
          kind: 'tempo',
          value: (midi[offset] << 16) | (midi[offset + 1] << 8) | midi[offset + 2]
        });
      } else if (type === 0x2f) {
        events.push({ tick, kind: 'end' });
      }
      offset += length.value;
      continue;
    }

    const pitch = midi[offset++];
    const velocity = midi[offset++];
    if (status === 0x90) {
      events.push({ tick, kind: 'on', pitch, velocity });
    } else if (status === 0x80) {
      events.push({ tick, kind: 'off', pitch, velocity });
    } else {
      throw new Error(`Unexpected MIDI status ${status}.`);
    }
  }

  return events;
}

function readVlq(
  bytes: Uint8Array,
  offset: number
): { readonly value: number; readonly next: number } {
  let value = 0;
  let next = offset;
  while (true) {
    const byte = bytes[next++];
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      return { value, next };
    }
  }
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
  );
}
