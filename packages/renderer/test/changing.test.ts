import { applyCommand, createInputState } from '@luna-estelar/gas-core';
import type {
  CapabilitiesTable,
  InputState,
  Renderer,
  RendererWarning,
  Timeline
} from '@luna-estelar/gas-protocol';
import { describe, expect, it } from 'vitest';
import { createRenderer } from '../src/index.js';
import { FakeConnector } from './support/fake-connector.js';
import { testTimeline } from './support/timeline.js';
import { VirtualClock } from './support/virtual-clock.js';

describe('running renderer changes', () => {
  it('re-anchors live tempo without moving the current position', async () => {
    const timeline = testTimeline();
    const connector = new FakeConnector({ appliedBoundary: { bar: 3 } });
    const { clock, renderer } = await runningRenderer(timeline, connector);
    clock.advanceTo(2);

    const state = applyActive(createInputState(timeline), { kind: 'setTempo', bpm: 60 });
    const result = await renderer.updateState(state);

    expect(result).toEqual({
      requestedPosition: { bar: 2.5 },
      appliedPosition: { bar: 3 }
    });
    expect(connector.updates.at(-1)?.update.state.globals.tempo).toBe(60);

    // Two bars elapsed before the change. The remaining three bars now take
    // twelve seconds, so the finite end moves from t=8 to t=14.
    clock.advanceTo(8);
    await flushAsync();
    expect(connector.calls).not.toContain('stop:run-1');
    clock.advanceTo(14);
    await flushAsync();
    expect(connector.calls).toContain('stop:run-1');
  });

  it('preserves live overrides and restarts authored boundaries at loop bar one', async () => {
    const timeline = testTimeline({ playback: { mode: 'loop', declaredBars: 4 } });
    const { clock, connector, renderer } = await runningRenderer(timeline);
    const positions: Array<{ bar: number; iteration: number }> = [];
    renderer.on('position', (event) =>
      positions.push({ bar: event.position.bar, iteration: event.loopIteration })
    );

    const state = applyActive(createInputState(timeline), {
      kind: 'setTrackFlavor',
      trackId: 'track.pad',
      value: 'persistent live warmth'
    });
    await renderer.updateState(state);
    clock.advanceTo(8);
    await flushAsync();

    expect(connector.calls.filter((call) => call === 'start')).toHaveLength(1);
    expect(connector.calls.some((call) => call.startsWith('stop:'))).toBe(false);
    expect(positions.at(-1)).toEqual({ bar: 1, iteration: 2 });
    expect(connector.updates.at(-1)?.requested).toEqual({ bar: 1 });
    expect(connector.updates.at(-1)?.update.state.tracks[0]?.flavor).toEqual({
      kind: 'text',
      text: 'persistent live warmth'
    });

    await renderer.stop();
  });

  it('enters holding after an infinite arranged pass and still accepts updates', async () => {
    const timeline = testTimeline({ playback: { mode: 'infinite' } });
    const { clock, connector, renderer } = await runningRenderer(timeline);
    const statuses: string[] = [];
    renderer.on('status', (event) => statuses.push(event.playback));

    clock.advanceTo(8);
    await flushAsync();
    expect(statuses.at(-1)).toBe('holding');
    expect(connector.updates.at(-1)?.requested).toEqual({ bar: 5 });

    const state = applyActive(createInputState(timeline), {
      kind: 'setTrackLevel',
      trackId: 'track.pad',
      value: 0.4
    });
    const result = await renderer.updateState(state);
    expect(result).toEqual({ requestedPosition: { bar: 5 }, appliedPosition: { bar: 5 } });
    expect(connector.updates.at(-1)?.update.state.tracks[0]?.level).toEqual({
      kind: 'level',
      value: 0.4
    });

    await renderer.stop();
    expect(statuses.at(-1)).toBe('stopped');
  });

  it('converts supported Alda values and skips only a malformed slot', async () => {
    const timeline = testTimeline();
    const connector = notationConnector();
    const { renderer } = await runningRenderer(timeline, connector);
    const warnings: RendererWarning[] = [];
    renderer.on('warning', (warning) => warnings.push(warning));

    let state = applyActive(createInputState(timeline), {
      kind: 'setTrackMotif',
      trackId: 'track.pad',
      alda: 'o4 c e g'
    });
    state = applyActive(state, {
      kind: 'setTrackNotes',
      trackId: 'track.pad',
      alda: 'c/e'
    });
    await renderer.updateState(state);

    const notation = connector.updates.at(-1)?.update.notation;
    expect(notation).toHaveLength(1);
    expect(notation?.[0]).toMatchObject({
      trackId: 'track.pad',
      intent: 'motif',
      source: 'o4 c e g'
    });
    expect(notation?.[0]?.midi).toBeInstanceOf(Uint8Array);
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'notation-parse-failed', runId: 'run-1' })
    ]);
  });

  it('does not convert Alda for an unsupported connector capability', async () => {
    const timeline = testTimeline();
    const { connector, renderer } = await runningRenderer(timeline);
    const state = applyActive(createInputState(timeline), {
      kind: 'setTrackMotif',
      trackId: 'track.pad',
      alda: 'o4 c e g'
    });

    await renderer.updateState(state);
    expect(connector.updates.at(-1)?.update.notation).toBeUndefined();
  });

  it('returns a structured, sanitized failure when a running update fails', async () => {
    const secret = 'connector-secret-value';
    const timeline = testTimeline();
    const connector = new FakeConnector({
      updateFailure: new Error(`provider rejected ${secret}`)
    });
    const { renderer } = await runningRenderer(timeline, connector);
    const state = applyActive(createInputState(timeline), {
      kind: 'setTrackFlavor',
      trackId: 'track.pad',
      value: 'brighter'
    });

    let caught: unknown;
    try {
      await renderer.updateState(state);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'connector-unavailable',
      failure: { code: 'generation-failed', runId: 'run-1' }
    });
    expect(JSON.stringify(caught)).not.toContain(secret);
  });
});

async function runningRenderer(
  timeline: Timeline,
  connector = new FakeConnector()
): Promise<{ clock: VirtualClock; connector: FakeConnector; renderer: Renderer }> {
  const clock = new VirtualClock();
  const renderer = await createRenderer({ clock, connector, runIdFactory: () => 'run-1' });
  await renderer.load(timeline, createInputState(timeline));
  await renderer.start();
  return { clock, connector, renderer };
}

function applyActive(state: InputState, command: Parameters<typeof applyCommand>[1]): InputState {
  const result = applyCommand(state, command, {
    phase: 'active',
    capabilities: allSupportedCapabilities()
  });
  if (!result.ok) throw new Error(result.failure.message);
  return result.state;
}

function notationConnector(): FakeConnector {
  return new FakeConnector({
    description: { capabilities: allSupportedCapabilities() }
  });
}

function allSupportedCapabilities(): CapabilitiesTable {
  return {
    intents: {
      flavor: 'supported',
      key: 'supported',
      tempo: 'supported',
      time_signature: 'supported',
      timbre: 'supported',
      level: 'supported',
      notes: 'supported',
      motif: 'supported'
    }
  };
}

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}
