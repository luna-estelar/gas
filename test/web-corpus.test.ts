// Compile, inspect and derive browser timelines from the library corpus.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  compileGas,
  inspectTimeline,
  previewLiveCommands,
  retainTimeline
} from '@luna-estelar/gas-browser/compile';
import {
  advance,
  deriveTimeline,
  secondsPerBar,
  totalBars,
  totalSeconds
} from '@luna-estelar/gas-browser/timeline';

const here = path.dirname(fileURLToPath(import.meta.url));
const corpusRoot = path.resolve(here, '../packages/language/test/corpus');

function compile(name: string) {
  const result = compileGas(
    readFileSync(path.join(corpusRoot, `${name}.gas`), 'utf8'),
    `${name}.gas`
  );
  expect(result.ok).toBe(true);
  if (result.timeline === undefined) throw new Error(`Could not compile ${name}.gas`);
  return result.timeline;
}

describe('host compile and timeline over the language corpus', () => {
  it('derives musical time and timeline view models without mutating the timeline', () => {
    const timeline = compile('spec-example');
    expect(secondsPerBar(timeline)).toBeCloseTo(240 / 104);
    expect(totalBars(timeline)).toBe(16);
    expect(totalSeconds(timeline)).toBeCloseTo((16 * 240) / 104);
    const view = deriveTimeline(timeline);
    expect(
      view.sections.map((section) => [section.name, section.startBar, section.endBar])
    ).toEqual([
      ['chorus', 1, 9],
      ['verse', 9, 17]
    ]);
    expect(view.events.some((event) => event.detail === 'section started')).toBe(true);
    expect(view.meta).toContain('104 bpm');
  });

  it('advances finite, loop, and infinite previews correctly', () => {
    const finite = compile('arrangement');
    const finiteEnd = totalSeconds(finite)!;
    let completed = false;
    expect(
      advance(finite, finiteEnd - 1, 2, () => {
        completed = true;
      })
    ).toBe(finiteEnd);
    expect(completed).toBe(true);

    const loop = compile('drum-loop');
    const loopEnd = totalSeconds(loop)!;
    expect(advance(loop, loopEnd - 1, 2)).toBeCloseTo(1);

    const infinite = compile('drone');
    expect(totalBars(infinite)).toBeNull();
    expect(advance(infinite, 100, 2)).toBe(102);
  });

  it('retains the last-good timeline across a failed edit', () => {
    const timeline = compile('minimal');
    expect(retainTimeline(timeline, { ok: false, diagnostics: [], tokens: [], symbols: [] })).toBe(
      timeline
    );
  });

  it('inspects Core state across section boundaries', () => {
    const timeline = compile('arrangement');
    const bassId = timeline.tracks.find((track) => track.name === 'bass')!.trackId;
    const atEight = inspectTimeline(timeline, 8);
    const atNine = inspectTimeline(timeline, 9);
    expect(atEight.sectionName).not.toBe(atNine.sectionName);
    expect(atEight.state.tracks.find((track) => track.trackId === bassId)?.active).toBe(false);
    expect(atNine.state.tracks.find((track) => track.trackId === bassId)?.active).toBe(true);
  });

  it('handles a globals-only document with no scrub range', () => {
    const result = compileGas('tempo 90\nlength bars 4\ntrack pad "p"\n', 'globals.gas');
    expect(result.timeline?.arrangedBars).toBe(0);
    if (result.timeline !== undefined) expect(deriveTimeline(result.timeline).sections).toEqual([]);
  });

  it('previews live command fragments and describes their statements', () => {
    expect(previewLiveCommands('   ')).toEqual({ status: 'empty' });
    const valid = previewLiveCommands('pad.level 0.4');
    expect(valid.status).toBe('valid');
    if (valid.status === 'valid') {
      expect(valid.statements).toEqual([
        { label: 'pad.level 0.4', kind: 'Level', trackName: 'pad' }
      ]);
    }
    expect(previewLiveCommands('pad.level not-a-number').status).toBe('invalid');
  });

  // Consumers receive the statement kind and target without parsing its display label.
  it('carries the target and kind through for play and stop', () => {
    const preview = previewLiveCommands('pad.play\npad.stop\ntempo 96');
    expect(preview.status).toBe('valid');
    if (preview.status !== 'valid') return;
    expect(preview.statements.map((statement) => [statement.kind, statement.trackName])).toEqual([
      ['Play', 'pad'],
      ['Stop', 'pad'],
      ['Tempo', undefined]
    ]);
  });
});
