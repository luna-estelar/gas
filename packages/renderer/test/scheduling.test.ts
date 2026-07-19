import { createInputState } from '@luna-estelar/gas-core';
import type { Renderer, Timeline, TimelineEvent } from '@luna-estelar/gas-protocol';
import { describe, expect, it } from 'vitest';
import { createRenderer } from '../src/index.js';
import { FakeConnector } from './support/fake-connector.js';
import { testTimeline } from './support/timeline.js';
import { VirtualClock } from './support/virtual-clock.js';

describe('renderer scheduling and derivation', () => {
  it('prepares bar one before starting and derives authored boundaries ahead', async () => {
    const { clock, connector, renderer } = await runningRenderer(timelineWithBarThreeStop());
    expect(connector.calls.slice(-2)).toEqual(['prepare', 'start']);
    expect(connector.prepared[0]?.state.tracks[0]?.active).toBe(true);

    clock.advanceTo(1.99);
    await flushAsync();
    expect(connector.updates).toHaveLength(0);

    // Bar 3 is four seconds after bar 1 at 120 BPM. One two-second provider
    // chunk of lookahead submits its state update at t=2.
    clock.advanceTo(2);
    await flushAsync();
    expect(connector.updates).toHaveLength(1);
    expect(connector.updates[0]?.requested).toEqual({ bar: 3 });
    expect(connector.updates[0]?.update.state.tracks[0]?.active).toBe(false);
  });

  it('emits position at the actual boundary rather than the lookahead deadline', async () => {
    const timeline = timelineWithBarThreeStop();
    const clock = new VirtualClock();
    const connector = new FakeConnector();
    const renderer = await createRenderer({
      clock,
      connector,
      runIdFactory: () => 'run-position'
    });
    await renderer.load(timeline, createInputState(timeline));
    const positions: Array<{ bar: number; seconds: number }> = [];
    renderer.on('position', (event) =>
      positions.push({ bar: event.position.bar, seconds: event.seconds })
    );
    await renderer.start();
    clock.advanceTo(2);
    await flushAsync();
    expect(positions).toEqual([{ bar: 1, seconds: 0 }]);
    clock.advanceTo(4);
    await flushAsync();
    expect(positions).toEqual([
      { bar: 1, seconds: 0 },
      { bar: 3, seconds: 4 }
    ]);
  });

  it('completes finite playback at the end boundary and clears every timer', async () => {
    const { clock, connector, renderer } = await runningRenderer(timelineWithBarThreeStop());
    const statuses: string[] = [];
    renderer.on('status', (event) => statuses.push(event.playback));
    clock.advanceTo(8);
    await flushAsync();
    expect(connector.calls).toContain('stop:run-1');
    expect(statuses.slice(-2)).toEqual(['stopping', 'stopped']);
    expect(clock.pendingDeadlines()).toEqual([]);
  });

  it('cancels future work on stop and rejects double start', async () => {
    const { clock, connector, renderer } = await runningRenderer(timelineWithBarThreeStop());
    await expect(renderer.start()).rejects.toMatchObject({ code: 'renderer-state-conflict' });
    await renderer.stop();
    expect(clock.pendingDeadlines()).toEqual([]);
    clock.advanceTo(20);
    await flushAsync();
    expect(connector.updates).toHaveLength(0);
    expect(connector.calls.filter((call) => call === 'stop:run-1')).toHaveLength(1);
  });

  it('isolates status listeners while starting playback', async () => {
    const clock = new VirtualClock();
    const connector = new FakeConnector();
    const renderer = await createRenderer({ clock, connector, runIdFactory: () => 'run-listener' });
    const timeline = testTimeline();
    await renderer.load(timeline, createInputState(timeline));
    const statuses: string[] = [];
    renderer.on('status', () => {
      throw new Error('host listener failure');
    });
    renderer.on('status', (status) => statuses.push(status.playback));

    await expect(renderer.start()).resolves.toBe('run-listener');
    expect(statuses.slice(0, 2)).toEqual(['starting', 'running']);
    await renderer.stop();
  });

  it('stops a partially started connector when startup fails', async () => {
    const connector = new FakeConnector({ startFailure: new Error('provider startup failed') });
    const clock = new VirtualClock();
    const renderer = await createRenderer({
      clock,
      connector,
      runIdFactory: () => 'run-start-fail'
    });
    const timeline = testTimeline();
    await renderer.load(timeline, createInputState(timeline));

    await expect(renderer.start()).rejects.toMatchObject({
      code: 'connector-unavailable',
      failure: { code: 'generation-failed', runId: 'run-start-fail' }
    });
    expect(connector.calls).toEqual([
      'describe',
      'open',
      'prepare',
      'start',
      'stop:run-start-fail'
    ]);
    await renderer.close();
    expect(connector.calls.at(-1)).toBe('close');
  });

  it('fails terminally when an explicit connector stop is rejected', async () => {
    const secret = 'provider-stop-secret';
    const connector = new FakeConnector({ stopFailure: new Error(`stop rejected ${secret}`) });
    const clock = new VirtualClock();
    const renderer = await createRenderer({
      clock,
      connector,
      runIdFactory: () => 'run-stop-fail'
    });
    const timeline = testTimeline({ playback: { mode: 'infinite' } });
    await renderer.load(timeline, createInputState(timeline));
    const failures: unknown[] = [];
    const statuses: Array<{ lifecycle: string; playback: string }> = [];
    renderer.on('failure', (failure) => failures.push(failure));
    renderer.on('status', (status) =>
      statuses.push({ lifecycle: status.lifecycle, playback: status.playback })
    );
    await renderer.start();

    let caught: unknown;
    try {
      await renderer.stop();
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'connector-unavailable',
      failure: { code: 'connector-unavailable', runId: 'run-stop-fail' }
    });
    expect(JSON.stringify({ caught, failures })).not.toContain(secret);
    expect(statuses.at(-1)).toEqual({ lifecycle: 'failed', playback: 'failed' });
    await expect(renderer.start()).rejects.toMatchObject({ code: 'renderer-state-conflict' });
    expect(connector.calls.filter((call) => call === 'stop:run-stop-fail')).toHaveLength(1);

    await renderer.close();
    expect(connector.calls.at(-1)).toBe('close');
  });

  it('produces deterministic event and connector logs for the same script', async () => {
    expect(await scriptedLog()).toEqual(await scriptedLog());
  });
});

async function runningRenderer(timeline: Timeline): Promise<{
  clock: VirtualClock;
  connector: FakeConnector;
  renderer: Renderer;
}> {
  const clock = new VirtualClock();
  const connector = new FakeConnector();
  const renderer = await createRenderer({
    clock,
    connector,
    runIdFactory: () => 'run-1'
  });
  await renderer.load(timeline, createInputState(timeline));
  await renderer.start();
  return { clock, connector, renderer };
}

function timelineWithBarThreeStop(): Timeline {
  const timeline = testTimeline();
  const stop: TimelineEvent = {
    eventId: 'event.stop',
    type: 'track',
    targetId: 'track.pad',
    action: 'stop',
    position: { bar: 3 },
    sequence: 1,
    scope: 'timed',
    sectionInstanceId: 'section.main.0'
  };
  const flavor: TimelineEvent = {
    eventId: 'event.flavor',
    type: 'track',
    targetId: 'track.pad',
    action: 'flavor',
    position: { bar: 3 },
    sequence: 2,
    scope: 'timed',
    sectionInstanceId: 'section.main.0',
    value: { kind: 'text', text: 'distant' }
  };
  return { ...timeline, events: [...timeline.events, stop, flavor] };
}

async function scriptedLog(): Promise<readonly string[]> {
  const { clock, connector, renderer } = await runningRenderer(timelineWithBarThreeStop());
  const events: string[] = [];
  renderer.on('position', (event) => events.push(`position:${event.position.bar}:${event.runId}`));
  renderer.on('status', (event) => events.push(`status:${event.playback}:${event.runId ?? '-'}`));
  clock.advanceTo(8);
  await flushAsync();
  return [...connector.calls, ...events];
}

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}
