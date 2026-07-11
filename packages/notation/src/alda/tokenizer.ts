import type { NoteLetter } from './pitch.js';

export type AldaToken =
  | {
      readonly type: 'note';
      readonly letter: NoteLetter;
      readonly accidental: number;
      readonly length?: number;
      readonly dots: number;
      readonly offset: number;
    }
  | { readonly type: 'octave'; readonly octave: number; readonly offset: number }
  | { readonly type: 'octave-up'; readonly offset: number }
  | { readonly type: 'octave-down'; readonly offset: number }
  | {
      readonly type: 'unsupported';
      readonly text: string;
      readonly message: string;
      readonly offset: number;
    };

const NOTE_LETTERS = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g']);

export function tokenizeAlda(source: string): AldaToken[] {
  const tokens: AldaToken[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index] ?? '';
    if (isWhitespace(char)) {
      index++;
      continue;
    }
    if (char === '#') {
      index = skipLineComment(source, index);
      continue;
    }
    if (char === '>') {
      tokens.push({ type: 'octave-up', offset: index });
      index++;
      continue;
    }
    if (char === '<') {
      tokens.push({ type: 'octave-down', offset: index });
      index++;
      continue;
    }
    if (char === 'o' && isDigit(source[index + 1] ?? '')) {
      const parsed = readInteger(source, index + 1);
      tokens.push({ type: 'octave', octave: parsed.value, offset: index });
      index = parsed.next;
      continue;
    }
    if (isNoteLetter(char)) {
      const parsed = readNote(source, index);
      tokens.push(parsed.token);
      index = parsed.next;
      continue;
    }

    const unsupported = readUnsupported(source, index);
    tokens.push(unsupported.token);
    index = unsupported.next;
  }

  return tokens;
}

function readNote(
  source: string,
  offset: number
): { readonly token: AldaToken; readonly next: number } {
  const letter = source[offset] as NoteLetter;
  let index = offset + 1;
  let accidental = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '+') {
      accidental++;
    } else if (char === '-') {
      accidental--;
    } else if (char === '_') {
      accidental = 0;
    } else {
      break;
    }
    index++;
  }

  let length: number | undefined;
  if (isDigit(source[index] ?? '')) {
    const parsed = readInteger(source, index);
    length = parsed.value;
    index = parsed.next;
  }

  let dots = 0;
  while (source[index] === '.') {
    dots++;
    index++;
  }

  return { token: { type: 'note', letter, accidental, length, dots, offset }, next: index };
}

function readUnsupported(
  source: string,
  offset: number
): { readonly token: AldaToken; readonly next: number } {
  const char = source[offset] ?? '';
  const fixed = unsupportedMessage(char);
  if (fixed !== undefined) {
    return {
      token: { type: 'unsupported', text: char, message: fixed, offset },
      next: offset + 1
    };
  }

  if (isLetter(char) || isDigit(char)) {
    let next = offset + 1;
    while (next < source.length && /[\w:-]/u.test(source[next] ?? '')) {
      next++;
    }
    const text = source.slice(offset, next);
    return {
      token: { type: 'unsupported', text, message: unsupportedIdentifierMessage(text), offset },
      next
    };
  }

  return {
    token: {
      type: 'unsupported',
      text: char,
      message: `Unsupported Alda token '${char}'.`,
      offset
    },
    next: offset + 1
  };
}

function unsupportedMessage(char: string): string | undefined {
  switch (char) {
    case '/':
      return 'Chords are not supported in the minimal Alda subset.';
    case '~':
      return 'Ties are not supported in the minimal Alda subset.';
    case '(':
    case ')':
      return 'Parenthetical attributes are not supported in the minimal Alda subset.';
    case '*':
    case '[':
    case ']':
    case '|':
      return 'Repeats and alternate endings are not supported in the minimal Alda subset.';
    case '%':
    case '@':
      return 'Markers are not supported in the minimal Alda subset.';
    case '{':
    case '}':
      return 'Cram expressions are not supported in the minimal Alda subset.';
    case '=':
      return 'Variables are not supported in the minimal Alda subset.';
    default:
      return undefined;
  }
}

function unsupportedIdentifierMessage(text: string): string {
  if (text === 'r') {
    return 'Rests are not supported in the minimal Alda subset.';
  }
  if (/^V\d+:/u.test(text)) {
    return 'Voices are not supported in the minimal Alda subset.';
  }
  if (/^\d+(?:ms|s)$/u.test(text)) {
    return 'Absolute durations are not supported in the minimal Alda subset.';
  }
  return `Unsupported Alda construct '${text}'.`;
}

function readInteger(
  source: string,
  offset: number
): { readonly value: number; readonly next: number } {
  let next = offset;
  while (isDigit(source[next] ?? '')) {
    next++;
  }
  return { value: Number.parseInt(source.slice(offset, next), 10), next };
}

function skipLineComment(source: string, offset: number): number {
  let next = offset;
  while (next < source.length && source[next] !== '\n' && source[next] !== '\r') {
    next++;
  }
  return next;
}

function isNoteLetter(char: string): char is NoteLetter {
  return NOTE_LETTERS.has(char);
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function isLetter(char: string): boolean {
  return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}
