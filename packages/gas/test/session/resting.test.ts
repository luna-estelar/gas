// Rule 4: musical time runs through silence. GAS writes silence while no track
// plays, pauses the model, and resumes it one start-up delay before the next
// track comes in. The missing-audio timeout runs only while a track plays.
// Skipped until GAS 0.4 step 4 implements the session these describe.
import { describe, expect, it } from 'vitest';
import type { AudioChunk } from '../../src/protocol/index.js';
import {
  MAX_FIRST_AUDIO_TIMEOUT_SECONDS,
  MAX_LOOKAHEAD_SECONDS,
  RESUME_LEAD_SECONDS
} from '../../src/renderer/constants.js';
import { flushAsync } from '../../../../test/support/deferred.js';
import { FAKE_CHANNELS, FAKE_SAMPLE_RATE } from '../../../../test/support/fake-connection.js';
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

function expectSilenceUpTo(chunks: readonly AudioChunk[], seconds: number): void {
  expect(chunks.every(isSilent)).toBe(true);
  expect(totalSeconds(chunks)).toBeGreaterThanOrEqual(seconds - 1e-9);
  expect(totalSeconds(chunks)).toBeLessThanOrEqual(seconds + MAX_LOOKAHEAD_SECONDS + 1e-9);
}

describe.skip('resting', () => {
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

    it('resumes the model when the app starts a track', async () => {
      const h = await harness({ source: NO_PLAYS });
      await h.session.play();
      await h.advanceTo(5);

      await h.session.playTrack(PAD);
      await h.advanceTo(barTime(5));
      expect(h.connector.latest().flow).toEqual(['pause', 'resume']);
    });
  });
});
