// Example metadata shared by consumers. Filesystem access belongs in support.ts.

/** Playback shape a document arranges into, as reported by its timeline. */
export type ExampleMode = 'finite' | 'loop' | 'infinite';

export interface ExampleSpec {
  /** File stem — the document is `documents/${name}.gas`. */
  readonly name: string;
  /** Short label for the example switcher. */
  readonly label: string;
  /** One line on what the document shows, under the label. */
  readonly blurb: string;
  /** Playback mode its timeline declares. */
  readonly mode: ExampleMode;
  /** Bars the arrangement runs to. */
  readonly bars: number;
  /** Tempo in bpm, as the derived meta line reports it. */
  readonly tempo: number;
  /** Optional display order for the homepage example selection. */
  readonly homepage?: number;
}

/** Example documents in display order, covering finite, loop and infinite playback. */
export const EXAMPLES: readonly ExampleSpec[] = [
  {
    name: 'spec-example',
    label: 'Spec example',
    blurb: 'Three tracks, two sections, alda motifs.',
    mode: 'finite',
    bars: 16,
    tempo: 104,
    homepage: 0
  },
  {
    name: 'drum-loop',
    label: 'Loop',
    blurb: 'Eight bars, set to loop forever.',
    mode: 'loop',
    bars: 8,
    tempo: 96,
    homepage: 1
  },
  {
    name: 'minimal',
    label: 'Minimal',
    blurb: 'The smallest complete document.',
    mode: 'finite',
    bars: 4,
    tempo: 88,
    homepage: 2
  },
  {
    name: 'arrangement',
    label: 'Arrangement',
    blurb: 'Three sections, played in a written order.',
    mode: 'finite',
    bars: 24,
    tempo: 100
  },
  {
    name: 'drone',
    label: 'Drone',
    blurb: 'Declared infinite — it holds its final state and keeps going.',
    mode: 'infinite',
    bars: 4,
    tempo: 60
  },
  {
    name: 'alda-sketch',
    label: 'Alda sketch',
    blurb: 'Motifs written as notes rather than described.',
    mode: 'finite',
    bars: 6,
    tempo: 72
  },
  {
    name: 'alda-phrase',
    label: 'Alda phrase',
    blurb: 'A phrase overridden per section.',
    mode: 'finite',
    bars: 8,
    tempo: 104
  }
];

/** The homepage's documents, in the order it shows them. */
export const HOMEPAGE_EXAMPLES: readonly ExampleSpec[] = EXAMPLES.filter(
  (example) => example.homepage !== undefined
).sort((a, b) => a.homepage! - b.homepage!);

/** File name of a spec, as the compiler and the pane header want it. */
export function exampleFileName(spec: ExampleSpec): string {
  return `${spec.name}.gas`;
}
