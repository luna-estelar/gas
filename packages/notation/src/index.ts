// @luna-estelar/gas-notation
// Pure notation helpers. Owns no I/O, no clock, no Renderer state, and no
// Language parser dependency.

export { AldaParseError } from './alda/errors.js';
export { parseAlda } from './parse-alda.js';
export { toMidi } from './to-midi.js';
export type { NoteEvent } from './note-event.js';

export const packageName = '@luna-estelar/gas-notation';
export const version = '0.1.1';
