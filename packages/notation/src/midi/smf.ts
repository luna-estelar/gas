import type { NoteEvent } from '../note-event.js';
import { encodeVlq } from './vlq.js';

export interface MidiOptions {
  readonly tempo?: number;
  readonly ppq?: number;
}

interface TimedMidiEvent {
  readonly tick: number;
  readonly order: number;
  readonly bytes: readonly number[];
}

const DEFAULT_TEMPO = 120;
const DEFAULT_PPQ = 480;

export function encodeSmf(events: readonly NoteEvent[], options: MidiOptions = {}): Uint8Array {
  const tempo = options.tempo ?? DEFAULT_TEMPO;
  const ppq = options.ppq ?? DEFAULT_PPQ;
  assertTempo(tempo);
  assertPpq(ppq);

  const track = [
    ...encodeDelta(0),
    0xff,
    0x51,
    0x03,
    ...encodeTempo(tempo),
    ...encodeTimedEvents(events, ppq),
    ...encodeDelta(0),
    0xff,
    0x2f,
    0x00
  ];

  return Uint8Array.from([
    0x4d,
    0x54,
    0x68,
    0x64,
    0x00,
    0x00,
    0x00,
    0x06,
    0x00,
    0x00,
    0x00,
    0x01,
    ...uint16(ppq),
    0x4d,
    0x54,
    0x72,
    0x6b,
    ...uint32(track.length),
    ...track
  ]);
}

function encodeTimedEvents(events: readonly NoteEvent[], ppq: number): number[] {
  const midiEvents: TimedMidiEvent[] = [];
  for (const event of events) {
    assertNoteEvent(event);
    const start = Math.round(event.start * ppq);
    // Guarantee a note-off strictly after its note-on: rounding a very short
    // duration to 0 ticks would emit off-before-on and leave a stuck note.
    const end = Math.max(Math.round((event.start + event.duration) * ppq), start + 1);
    midiEvents.push(
      { tick: end, order: 0, bytes: [0x80, event.pitch, 0] },
      { tick: start, order: 1, bytes: [0x90, event.pitch, event.velocity] }
    );
  }

  midiEvents.sort((a, b) => a.tick - b.tick || a.order - b.order || a.bytes[1] - b.bytes[1]);

  const bytes: number[] = [];
  let previousTick = 0;
  for (const event of midiEvents) {
    bytes.push(...encodeDelta(event.tick - previousTick), ...event.bytes);
    previousTick = event.tick;
  }
  return bytes;
}

function encodeTempo(tempo: number): number[] {
  const microsecondsPerQuarter = Math.round(60_000_000 / tempo);
  return [
    (microsecondsPerQuarter >> 16) & 0xff,
    (microsecondsPerQuarter >> 8) & 0xff,
    microsecondsPerQuarter & 0xff
  ];
}

function encodeDelta(delta: number): number[] {
  return encodeVlq(delta);
}

function assertNoteEvent(event: NoteEvent): void {
  if (!Number.isInteger(event.pitch) || event.pitch < 0 || event.pitch > 127) {
    throw new RangeError(`MIDI pitch out of range: ${event.pitch}`);
  }
  if (!Number.isFinite(event.start) || event.start < 0) {
    throw new RangeError(`MIDI note start out of range: ${event.start}`);
  }
  if (!Number.isFinite(event.duration) || event.duration <= 0) {
    throw new RangeError(`MIDI note duration out of range: ${event.duration}`);
  }
  if (!Number.isInteger(event.velocity) || event.velocity < 0 || event.velocity > 127) {
    throw new RangeError(`MIDI velocity out of range: ${event.velocity}`);
  }
}

function assertTempo(tempo: number): void {
  if (!Number.isFinite(tempo) || tempo <= 0) {
    throw new RangeError(`MIDI tempo out of range: ${tempo}`);
  }
  // The tempo meta event stores microseconds per quarter note in three bytes;
  // values past 0xffffff would be silently truncated to a different tempo.
  const microsecondsPerQuarter = Math.round(60_000_000 / tempo);
  if (microsecondsPerQuarter < 1 || microsecondsPerQuarter > 0xffffff) {
    throw new RangeError(`MIDI tempo not encodable in a 24-bit meta event: ${tempo} BPM`);
  }
}

function assertPpq(ppq: number): void {
  if (!Number.isInteger(ppq) || ppq < 1 || ppq > 0xffff) {
    throw new RangeError(`MIDI PPQ out of range: ${ppq}`);
  }
}

function uint16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function uint32(value: number): number[] {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}
