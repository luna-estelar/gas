import type { NoteEvent } from './note-event.js';
import { encodeSmf, type MidiOptions } from './midi/smf.js';

export function toMidi(events: readonly NoteEvent[], options?: MidiOptions): Uint8Array {
  return encodeSmf(events, options);
}
