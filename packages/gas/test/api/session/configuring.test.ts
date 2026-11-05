// Swapping the connector, changing its config, and `documentDefaults`. Config is
// read when a connection opens, so it changes only while stopped.
import { describe, expect, it } from 'vitest';
import type { Command } from '../../../src/protocol/index.js';
import { flushAsync } from '../../../../../test/support/deferred.js';
import { FakeConnector } from '../../../../../test/support/fake-connection.js';
import { NO_TIMING, PAD, harness, playing, rejectionOf } from './support/harness.js';

const LEVEL: Command = { kind: 'setTrackLevel', trackId: PAD, value: 0.3 };

async function starting() {
  const h = await harness();
  h.connector.autoConnect = false;
  const play = h.session.play();
  await flushAsync();
  return { ...h, play };
}

describe('configuring', () => {
  describe('setConnector', () => {
    it('swaps the connector while stopped and keeps app values', async () => {
      const h = await harness();
      await h.session.apply([LEVEL]);
      const next = new FakeConnector({
        description: { id: 'other', defaultConfig: { temperature: 1 } }
      });

      await h.session.setConnector(next, { temperature: 0.5 });
      await h.session.play();

      expect(h.connector.connects).toEqual([]);
      expect(next.connects).toHaveLength(1);
      expect(next.connects[0]!.config).toEqual({ temperature: 0.5 });
      expect(h.session.getState().appValues).toEqual([LEVEL]);
    });

    it("uses the new connector's default config when none is passed", async () => {
      const h = await harness();
      await h.session.updateConnectorConfig({ temperature: 2 });
      const next = new FakeConnector({ description: { defaultConfig: { guidance: 3 } } });

      await h.session.setConnector(next);
      await h.session.play();

      // The old connector's config is not carried over.
      expect(next.connects[0]!.config).toEqual({ guidance: 3 });
    });

    it('rejects a config the new connector refuses, and keeps the old connector', async () => {
      const h = await harness();
      const next = new FakeConnector({
        validateConfig: () => ({
          ok: false,
          problems: [{ path: '/temperature', code: 'out-of-range', message: 'Too hot.' }]
        })
      });

      expect((await rejectionOf(h.session.setConnector(next, { temperature: 9 }))).kind).toBe(
        'command'
      );
      await h.session.play();
      expect(h.connector.connects).toHaveLength(1);
      expect(next.connects).toEqual([]);
    });

    it('rejects with state while starting', async () => {
      const h = await starting();
      const error = await rejectionOf(h.session.setConnector(new FakeConnector()));
      expect(error.kind).toBe('state');
      h.connector.resolveConnect();
      await h.play;
    });

    it('rejects with state while playing', async () => {
      const h = await playing();
      expect((await rejectionOf(h.session.setConnector(new FakeConnector()))).kind).toBe('state');
    });

    it('works again after Stop', async () => {
      const h = await playing();
      await h.session.stop();
      const next = new FakeConnector();
      await h.session.setConnector(next);
      await h.session.play();
      expect(next.connects).toHaveLength(1);
    });
  });

  describe('updateConnectorConfig', () => {
    it('reaches the next connection', async () => {
      const h = await harness();
      await h.session.updateConnectorConfig({ temperature: 0.7 });
      await h.session.play();
      expect(h.connector.connects[0]!.config).toMatchObject({ temperature: 0.7 });
    });

    it('rejects with state while starting', async () => {
      const h = await starting();
      expect((await rejectionOf(h.session.updateConnectorConfig({ temperature: 1 }))).kind).toBe(
        'state'
      );
      h.connector.resolveConnect();
      await h.play;
    });

    it('rejects with state while playing', async () => {
      const h = await playing();
      expect((await rejectionOf(h.session.updateConnectorConfig({ temperature: 1 }))).kind).toBe(
        'state'
      );
    });
  });

  describe('documentDefaults', () => {
    it('fill the timing a document leaves out', async () => {
      const h = await harness({
        source: NO_TIMING,
        documentDefaults: { tempo: 120, timeSignature: { beatsPerBar: 6, beatUnit: 8 }, key: 'D' }
      });
      await h.session.play();

      expect(h.connector.connects[0]!.timing).toMatchObject({
        tempo: 120,
        // 120 eighth notes a minute is 60 quarter notes.
        quarterNoteTempo: 60,
        timeSignature: { beatsPerBar: 6, beatUnit: 8 },
        key: 'D',
        secondsPerBar: 3
      });
    });

    it('never override what the document sets', async () => {
      const h = await harness({
        documentDefaults: { tempo: 90, timeSignature: { beatsPerBar: 3, beatUnit: 4 } }
      });
      await h.session.play();

      expect(h.connector.connects[0]!.timing).toMatchObject({
        tempo: 120,
        quarterNoteTempo: 120,
        timeSignature: { beatsPerBar: 4, beatUnit: 4 }
      });
    });

    it('rejects a bad default with command', async () => {
      const h = await harness();
      expect((await rejectionOf(h.session.updateDocumentDefaults({ tempo: -1 }))).kind).toBe(
        'command'
      );
    });
  });

  describe('apply() while starting', () => {
    it('reaches the connection once it opens', async () => {
      const h = await starting();
      await h.session.apply([LEVEL]);
      const connection = h.connector.resolveConnect();
      await h.play;
      await flushAsync();

      const pad = connection.updates
        .at(-1)
        ?.update.state.tracks.find((track) => track.trackId === PAD);
      expect(pad?.level).toEqual({ kind: 'level', value: 0.3 });
    });

    it('returns no position, since nothing is playing yet', async () => {
      const h = await starting();
      const result = await h.session.apply([LEVEL]);
      expect(result.requestedPosition).toBeUndefined();
      expect(result.appliedPosition).toBeUndefined();
      h.connector.resolveConnect();
      await h.play;
    });
  });

  describe('apply() while playing', () => {
    it('returns the position the connection applied it at', async () => {
      const h = await playing();
      h.connector.latest().appliedPosition = { bar: 3 };
      const result = await h.session.apply([LEVEL]);

      expect(result.requestedPosition).toBeDefined();
      expect(result.appliedPosition).toEqual({ bar: 3 });
    });
  });
});
