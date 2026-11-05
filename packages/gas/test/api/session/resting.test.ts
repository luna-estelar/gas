// Rule 4: musical time runs through silence. GAS writes silence while no track
// plays, pauses the model, and resumes it one start-up delay before the next
// track comes in. The missing-audio timeout runs only while a track plays.
import { describe, expect, it } from 'vitest';
import type { AudioChunk } from '../../../src/protocol/index.js';
import {
  MAX_FIRST_AUDIO_TIMEOUT_SECONDS,
  MAX_LOOKAHEAD_SECONDS,
  RESUME_LEAD_SECONDS
} from '../../../src/renderer/constants.js';
import { flushAsync } from '../../../../../test/support/deferred.js';
import {
  FAKE_CHANNELS,
  FAKE_SAMPLE_RATE,
  fakeDescription
} from '../../../../../test/support/fake-connection.js';
import {
  MIDDLE_REST,
  NO_PLAYS,
  OPENING_REST,
  PAD,
  barTime,
  harness,
  isSilent,
  totalSeconds
} from './support/harness.js';

/** Seconds of audio delivered before the first chunk of the model's own audio. */
function secondsBeforeModelAudio(chunks: readonly AudioChunk[], from = 0): number {
  const first = chunks.findIndex((chunk, index) => index >= from && !isSilent(chunk));
  expect(first).toBeGreaterThanOrEqual(0);
  return totalSeconds(chunks.slice(0, first));
}

/** Bytes in `seconds` of the fake model's stereo s16le audio. */
function bytesFor(seconds: number): number {
  return Math.round(seconds * FAKE_SAMPLE_RATE) * FAKE_CHANNELS * 2;
}

function sampleAt(chunk: AudioChunk, frame: number): number {
  const view = new DataView(chunk.bytes.buffer, chunk.bytes.byteOffset, chunk.bytes.byteLength);
  return view.getInt16(frame * FAKE_CHANNELS * 2, true);
}

function expectSilenceUpTo(chunks: readonly AudioChunk[], seconds: number): void {
  expect(chunks.every(isSilent)).toBe(true);
  expect(totalSeconds(chunks)).toBeGreaterThanOrEqual(seconds - 1e-9);
  expect(totalSeconds(chunks)).toBeLessThanOrEqual(seconds + MAX_LOOKAHEAD_SECONDS + 1e-9);
}

describe('resting', () => {
  describe('an opening rest', () => {
    it('writes silence in the model format from the moment the connection opens', async () => {
      const h = await harness({ source: OPENING_REST });
      await h.session.play();
      await h.advanceTo(10);

      expectSilenceUpTo(h.audio, 10);
      for (const chunk of h.audio) {
        expect(chunk).toMatchObject({
          codec: 'pcm',
          sampleFormat: 's16le',
          sampleRate: FAKE_SAMPLE_RATE,
          channels: FAKE_CHANNELS
        });
      }
      expect(h.audio.map((chunk) => chunk.sequence)).toEqual(h.audio.map((_, index) => index));
    });

    it('starts bar 1 when the connection opens', async () => {
      const h = await harness({ source: OPENING_REST });
      h.connector.autoConnect = false;
      const play = h.session.play();
      await h.advanceTo(0.7);
      expect(h.positions).toEqual([]);

      h.connector.resolveConnect();
      await play;
      expect(h.positions[0]).toEqual({ position: { bar: 1 }, seconds: 0, loopIteration: 1 });
    });

    it('pauses the model at once and resumes it one lead before the track', async () => {
      const h = await harness({ source: OPENING_REST });
      await h.session.play();
      await flushAsync();
      const connection = h.connector.latest();
      expect(connection.flow).toEqual(['pause']);

      await h.advanceTo(barTime(9) - RESUME_LEAD_SECONDS - 0.01);
      expect(connection.flow).toEqual(['pause']);
      await h.advanceTo(barTime(9) - RESUME_LEAD_SECONDS);
      expect(connection.flow).toEqual(['pause', 'resume']);
    });

    it('starts the track on time', async () => {
      const h = await harness({ source: OPENING_REST });
      await h.session.play();
      await h.advanceTo(barTime(9) - RESUME_LEAD_SECONDS);
      h.connector.latest().pushAudio(2);
      await h.advanceTo(barTime(10));

      expect(secondsBeforeModelAudio(h.audio)).toBeCloseTo(barTime(9), 6);
    });

    it('cuts the last silent chunk short at the entry', async () => {
      // Three-second chunks don't line up with the entry at 16 s.
      const h = await harness({
        source: OPENING_REST,
        connector: {
          description: { model: { ...fakeDescription().model, chunkDurationSeconds: 3 } }
        }
      });
      await h.session.play();
      await h.advanceTo(barTime(9) - RESUME_LEAD_SECONDS);
      h.connector.latest().pushAudio(3);
      await h.advanceTo(barTime(10));

      const first = h.audio.findIndex((chunk) => !isSilent(chunk));
      const silence = h.audio.slice(0, first);
      expect(totalSeconds(silence)).toBeCloseTo(barTime(9), 6);
      const last = silence.at(-1)!;
      expect(last.durationSeconds).toBeCloseTo(1, 6);
      expect(last.bytes.byteLength).toBe(bytesFor(last.durationSeconds));
    });

    it('runs no missing-audio timeout during the rest', async () => {
      // The rest is longer than the longest missing-audio timeout.
      expect(barTime(9)).toBeGreaterThan(MAX_FIRST_AUDIO_TIMEOUT_SECONDS);
      const h = await harness({ source: OPENING_REST });
      await h.session.play();
      await h.advanceTo(barTime(9) - 0.01);

      expect(h.errors).toEqual([]);
      expect(h.session.getState().status).toBe('playing');
    });

    it('fails once the track plays and no audio comes', async () => {
      const h = await harness({ source: OPENING_REST });
      await h.session.play();
      await h.advanceTo(barTime(9) + MAX_FIRST_AUDIO_TIMEOUT_SECONDS + 1);

      expect(h.errors).toHaveLength(1);
      expect(h.errors[0]!.kind).toBe('provider');
    });
  });

  describe('a track at bar 1', () => {
    it('starts bar 1 at the first audio', async () => {
      const h = await harness();
      await h.session.play();
      await h.advanceTo(1.3);
      expect(h.positions).toEqual([]);

      h.connector.latest().pushAudio(2);
      await flushAsync();
      expect(h.positions[0]).toEqual({ position: { bar: 1 }, seconds: 0, loopIteration: 1 });
      expect(isSilent(h.audio[0]!)).toBe(false);
    });

    it('does not pause the model at the start', async () => {
      const h = await harness();
      await h.session.play();
      await flushAsync();

      expect(h.connector.latest().flow).toEqual([]);
    });
  });

  describe('a rest mid-piece', () => {
    async function restStarted() {
      const h = await harness({ source: MIDDLE_REST });
      await h.session.play();
      // Bars 1 and 2, then the rest from bar 3.
      h.connector.latest().pushAudio(barTime(3));
      await h.advanceTo(barTime(3));
      return h;
    }

    it('writes silence after the track stops', async () => {
      const h = await restStarted();
      await h.advanceTo(barTime(8));
      const modelAudio = h.audio.filter((chunk) => !isSilent(chunk));
      const rest = h.audio.slice(h.audio.indexOf(modelAudio.at(-1)!) + 1);

      expect(totalSeconds(modelAudio)).toBeCloseTo(barTime(3), 6);
      expectSilenceUpTo(rest, barTime(8) - barTime(3));
    });

    it('resumes one lead before the next track and starts it on time', async () => {
      const h = await restStarted();
      const connection = h.connector.latest();
      await h.advanceTo(barTime(11) - RESUME_LEAD_SECONDS - 0.01);
      expect(connection.flow).toEqual(['pause']);

      await h.advanceTo(barTime(11) - RESUME_LEAD_SECONDS);
      expect(connection.flow).toEqual(['pause', 'resume']);
      const before = h.audio.length;
      connection.pushAudio(2);
      await h.advanceTo(barTime(12));

      // Bars 1 and 2 of model audio, then silence, then the track exactly at bar 11.
      expect(secondsBeforeModelAudio(h.audio, before)).toBeCloseTo(barTime(11), 6);
    });

    it('cuts model audio that runs past the rest, with a fade', async () => {
      const h = await harness({ source: MIDDLE_REST });
      await h.session.play();
      // Chunks 0-1, 1-3 and 3-5 s: the last crosses the rest at bar 3 (4 s).
      h.connector.latest().pushAudio(1);
      h.connector.latest().pushAudio(4);
      await h.advanceTo(barTime(6));

      const model = h.audio.filter((chunk) => !isSilent(chunk));
      expect(totalSeconds(model)).toBeCloseTo(barTime(3), 6);
      const cut = model.at(-1)!;
      expect(cut.durationSeconds).toBeCloseTo(1, 6);
      expect(cut.bytes.byteLength).toBe(bytesFor(cut.durationSeconds));
      // Full level at the start, faded to near zero at the cut so it doesn't click.
      expect(sampleAt(cut, 0)).toBe(1000);
      const lastFrame = Math.round(cut.durationSeconds * FAKE_SAMPLE_RATE) - 1;
      expect(Math.abs(sampleAt(cut, lastFrame))).toBeLessThan(100);
      // Silence follows from bar 3.
      const after = h.audio.slice(h.audio.indexOf(cut) + 1);
      expect(after.length).toBeGreaterThan(0);
      expect(after.every(isSilent)).toBe(true);
    });

    it('runs no missing-audio timeout during the rest', async () => {
      const h = await restStarted();
      await h.advanceTo(barTime(11) - 0.01);

      expect(h.errors).toEqual([]);
    });
  });

  describe('no track playing', () => {
    it('writes silence and keeps time without failing', async () => {
      const h = await harness({ source: NO_PLAYS });
      await h.session.play();
      await h.advanceTo(20);

      expectSilenceUpTo(h.audio, 20);
      expect(h.errors).toEqual([]);
      expect(h.connector.latest().flow).toEqual(['pause']);
      expect(h.positions[0]).toMatchObject({ position: { bar: 1 }, seconds: 0 });
    });

    // The model is paused, so a track the app starts comes in at the first bar
    // line at least one resume lead away. It starts on time and on a bar line.
    describe.each([
      { before: RESUME_LEAD_SECONDS + 0.01, label: 'a lead and a bit', late: false },
      { before: RESUME_LEAD_SECONDS / 2, label: 'half a lead', late: true }
    ])('when the app starts a track $label before bar 5', ({ before, late }) => {
      const now = barTime(5) - before;
      let entry = 1;
      while (barTime(entry) - now < RESUME_LEAD_SECONDS) entry += 1;

      it(`enters ${late ? 'after' : 'at'} bar 5`, () => {
        if (late) expect(entry).toBeGreaterThan(5);
        else expect(entry).toBe(5);
      });

      it(`enters at bar ${entry}, resumed one lead before`, async () => {
        const h = await harness({ source: NO_PLAYS });
        await h.session.play();
        await h.advanceTo(now);

        const result = await h.session.playTrack(PAD);
        expect(result.requestedPosition).toEqual({ bar: entry });

        const connection = h.connector.latest();
        await h.advanceTo(barTime(entry) - RESUME_LEAD_SECONDS - 0.01);
        expect(connection.flow).toEqual(['pause']);
        await h.advanceTo(barTime(entry) - RESUME_LEAD_SECONDS);
        expect(connection.flow).toEqual(['pause', 'resume']);

        connection.pushAudio(2);
        await h.advanceTo(barTime(entry + 1));
        expect(secondsBeforeModelAudio(h.audio)).toBeCloseTo(barTime(entry), 6);
      });
    });
  });

  describe('the app stopping the last track', () => {
    it('rests where the audio already handed out ends, fading what follows', async () => {
      const h = await harness();
      await h.session.play();
      h.connector.latest().pushAudio(6);
      await h.advanceTo(1);
      const handedOut = totalSeconds(h.audio);

      const result = await h.session.stopTrack(PAD);
      // Before the loop at bar 5 restarts the musical clock.
      await h.advanceTo(barTime(4));

      // The rest can't start before audio the player already has.
      const model = h.audio.filter((chunk) => !isSilent(chunk));
      const end = totalSeconds(model);
      expect(end).toBeGreaterThanOrEqual(handedOut);
      expect(end).toBeLessThanOrEqual(handedOut + 0.011);
      expect(result.requestedPosition).toEqual(h.session.positionAtSeconds(end));
      // The model audio after that point fades out instead of stopping dead.
      const last = model.at(-1)!;
      const lastFrame = Math.round(last.durationSeconds * FAKE_SAMPLE_RATE) - 1;
      expect(Math.abs(sampleAt(last, lastFrame))).toBeLessThan(100);
      expect(h.audio.slice(h.audio.indexOf(last) + 1).every(isSilent)).toBe(true);
    });
  });
});
