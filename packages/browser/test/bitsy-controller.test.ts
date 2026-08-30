import { describe, expect, it, vi } from 'vitest';
import { parseBitsyBridgeMessage } from '../src/bitsy/bridge.js';
import {
  asteroidLevels,
  BitsyDemoController,
  type SnippetProvider
} from '../src/bitsy/controller.js';
import type { BrowserSession } from '../src/wiring.js';
import type { BitsyBridgeMessage, GameSnapshot, InventoryEntry } from '../src/bitsy/types.js';

type Call = readonly [name: string, ...args: unknown[]];

class FakeSession {
  readonly calls: Call[] = [];
  submitResult: unknown = { ok: true, applied: 1, warnings: [], appliedPosition: { bar: 2 } };

  on(): () => void {
    return () => undefined;
  }

  getTracks() {
    return ['bed', 'pulse', 'hope', 'bass', 'texture', 'shore'].map((name) => ({
      id: `track.${name}`,
      name
    }));
  }

  loadSource(source: string, options: unknown) {
    return this.call('loadSource', { source, options }, { warnings: [] });
  }

  play() {
    return this.call('play', undefined, 'run-1');
  }

  submitLiveCommands(source: string) {
    return this.call('submitLiveCommands', source, this.submitResult);
  }

  playTrack(id: string) {
    return this.call('playTrack', id, {});
  }

  stopTrack(id: string) {
    return this.call('stopTrack', id, {});
  }

  setTempo(value: number) {
    return this.call('setTempo', value, {});
  }

  setGlobalLevel(value: number) {
    return this.call('setGlobalLevel', value, {});
  }

  setTrackLevel(id: string, value: number) {
    return this.call('setTrackLevel', [id, value], {});
  }

  retryRenderer() {
    return this.call('retryRenderer', undefined, {});
  }

  stop() {
    return this.call('stop', undefined, {});
  }

  close() {
    return this.call('close', undefined, undefined);
  }

  private async call(name: string, args: unknown, result: unknown): Promise<unknown> {
    this.calls.push(args === undefined ? [name] : [name, args]);
    return result;
  }
}

class FakePlayback {
  readonly fades: number[] = [];
  flushes = 0;
  restores = 0;
  closes = 0;

  restoreGain() {
    this.restores += 1;
  }

  flush() {
    this.flushes += 1;
  }

  async fadeOut(seconds: number) {
    this.fades.push(seconds);
  }

  async close() {
    this.closes += 1;
  }
}

function fixture(getSnippet: SnippetProvider = validSnippets()) {
  const session = new FakeSession();
  const playback = new FakePlayback();
  const runtime = {
    session,
    playback,
    close: vi.fn(async () => {
      await session.close();
      await playback.close();
    })
  } as unknown as BrowserSession;
  const createRuntime = vi.fn(async () => runtime);
  const controller = new BitsyDemoController('baseline score', createRuntime, getSnippet);
  return { controller, createRuntime, playback, runtime, session };
}

function validSnippets(): SnippetProvider {
  return (id) => ({ source: `snippet:${id}`, lastValidSource: `snippet:${id}`, valid: true });
}

function inventory(name: string, count = 1, id = name): InventoryEntry {
  return { id, name, count };
}

function message(
  event: BitsyBridgeMessage['event'],
  room: string,
  options: {
    readonly detail?: unknown;
    readonly inventory?: readonly InventoryEntry[];
    readonly variables?: GameSnapshot['variables'];
  } = {}
): BitsyBridgeMessage {
  const roomEntity = { id: room.toLowerCase().replaceAll(' ', '-'), name: room };
  return {
    source: 'gas-bitsy',
    version: 1,
    event,
    room: roomEntity,
    inventory: options.inventory ?? [],
    variables: options.variables ?? {},
    detail: options.detail ?? (event === 'room-enter' || event === 'game-ready' ? roomEntity : null)
  };
}

function calls(session: FakeSession, name: string): unknown[] {
  return session.calls.filter((call) => call[0] === name).map((call) => call[1]);
}

describe('Bitsy bridge validation', () => {
  it('accepts only the versioned, finite, shaped payload', () => {
    const valid = message('room-enter', 'Andromeda');
    expect(parseBitsyBridgeMessage(valid)).toEqual(valid);
    expect(parseBitsyBridgeMessage({ ...valid, version: 2 })).toBeUndefined();
    expect(parseBitsyBridgeMessage({ ...valid, source: 'somewhere-else' })).toBeUndefined();
    expect(
      parseBitsyBridgeMessage({ ...valid, inventory: [{ id: '0', name: 'suit', count: NaN }] })
    ).toBeUndefined();
    expect(parseBitsyBridgeMessage({ ...valid, variables: { hits: Infinity } })).toBeUndefined();
    expect(parseBitsyBridgeMessage({ ...valid, detail: null })).toBeUndefined();
  });
});

describe('Bitsy demo controller', () => {
  it('maps the full playthrough onto one loaded, continuously running session', async () => {
    const { controller, createRuntime, playback, session } = fixture();
    await controller.handleGameEvent(message('room-enter', 'Andromeda'));
    await controller.enableSound('  secret-key  ');

    await controller.handleGameEvent(
      message('dialog-start', 'Andromeda', { detail: { id: '3', name: 'wormhole' } })
    );
    await controller.handleGameEvent(message('room-enter', 'Milky Way'));
    await controller.handleGameEvent(
      message('dialog-start', 'Milky Way', { detail: { id: '5', name: 'martian hungry' } })
    );

    const suit = inventory('carrier suit', 1, '0');
    await controller.handleGameEvent(
      message('inventory-change', 'Milky Way', {
        inventory: [suit],
        detail: { id: '0', name: 'carrier suit', count: 1 }
      })
    );
    const snack = inventory('space snack', 1, '1');
    await controller.handleGameEvent(
      message('dialog-start', 'Milky Way', {
        inventory: [suit, snack],
        detail: { id: '7', name: 'alien saucer' }
      })
    );
    await controller.handleGameEvent(
      message('room-enter', 'Kuiper Belt West', { inventory: [suit, snack] })
    );
    await controller.handleGameEvent(
      message('room-enter', 'Kuiper Belt East', { inventory: [suit, snack] })
    );
    await controller.handleGameEvent(
      message('variable-change', 'Kuiper Belt East', {
        inventory: [suit, snack],
        variables: { hits: 4 },
        detail: { name: 'hits', value: 4 }
      })
    );
    await controller.handleGameEvent(
      message('dialog-start', 'Kuiper Belt East', {
        inventory: [suit, snack],
        variables: { hits: 4 },
        detail: { id: '11', name: 'earth approach' }
      })
    );
    await controller.handleGameEvent(
      message('room-enter', 'Galle Beach', {
        inventory: [suit, snack],
        variables: { hits: 4 }
      })
    );
    const coconut = inventory('king coconut', 1, '2');
    await controller.handleGameEvent(
      message('inventory-change', 'Galle Beach', {
        inventory: [suit, snack, coconut],
        variables: { hits: 4 },
        detail: { id: '2', name: 'king coconut', count: 1 }
      })
    );
    await controller.handleGameEvent(
      message('dialog-start', 'Galle Beach', {
        inventory: [suit, snack, coconut],
        variables: { hits: 4 },
        detail: { id: '12', name: 'beach mat ending' }
      })
    );

    expect(createRuntime).toHaveBeenCalledWith('secret-key');
    expect(calls(session, 'loadSource')).toHaveLength(1);
    expect(calls(session, 'play')).toHaveLength(1);
    expect(calls(session, 'submitLiveCommands')).toEqual([
      'snippet:room-andromeda',
      'snippet:failed-crossing',
      'snippet:room-milky-way',
      'snippet:martian-dialog',
      'snippet:room-kuiper-west',
      'snippet:room-kuiper-east',
      'snippet:room-galle',
      'snippet:coconut-pickup'
    ]);
    expect(calls(session, 'playTrack')).toContain('track.hope');
    expect(calls(session, 'setTempo')).toEqual([116, 76]);
    expect(calls(session, 'setTrackLevel')).toContainEqual(['track.pulse', 1]);
    expect(calls(session, 'stopTrack')).toEqual(['track.pulse', 'track.bass', 'track.texture']);
    expect(calls(session, 'setGlobalLevel')).toEqual([1, 0.25, 0.8]);
    expect(calls(session, 'stop')).toHaveLength(1);
    expect(playback.fades).toEqual([1.2]);
    expect(playback.flushes).toBe(1);
    expect(controller.getState().status).toBe('stopped');
    expect(
      controller.getState().traces.some((trace) => trace.operation.includes('secret-key'))
    ).toBe(false);
  });

  it('rehydrates durable room, inventory, and hit state with the last valid draft', async () => {
    const snippets: SnippetProvider = (id) =>
      id === 'room-kuiper-east'
        ? { source: 'broken draft', lastValidSource: 'last-valid east', valid: false }
        : { source: `snippet:${id}`, lastValidSource: `snippet:${id}`, valid: true };
    const { controller, session } = fixture(snippets);
    await controller.handleGameEvent(
      message('game-ready', 'Kuiper Belt East', {
        inventory: [inventory('carrier suit', 1, '0')],
        variables: { hits: 3 }
      })
    );
    await controller.enableSound('key');

    expect(calls(session, 'submitLiveCommands')).toEqual(['last-valid east']);
    expect(calls(session, 'playTrack')).toEqual(['track.hope']);
    expect(calls(session, 'setGlobalLevel')).toEqual([0.95]);
    expect(calls(session, 'setTrackLevel')).toEqual([['track.pulse', 0.85]]);
    expect(controller.getState().selectedBeat).toBe('room-kuiper-east');
    expect(controller.getState().traces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'skipped',
          detail: expect.stringContaining('last valid')
        })
      ])
    );
  });

  it('serializes simultaneous room events and exposes applied positions in the trace', async () => {
    const { controller, session } = fixture();
    await controller.handleGameEvent(message('room-enter', 'Andromeda'));
    await controller.enableSound('key');
    await Promise.all([
      controller.handleGameEvent(message('room-enter', 'Kuiper Belt West')),
      controller.handleGameEvent(message('room-enter', 'Kuiper Belt East'))
    ]);
    await controller.applySnippet('room-kuiper-east', 'manual edit');

    expect(calls(session, 'submitLiveCommands')).toEqual([
      'snippet:room-andromeda',
      'snippet:room-kuiper-west',
      'snippet:room-kuiper-east',
      'manual edit'
    ]);
    expect(controller.getState().traces[0]).toMatchObject({
      event: 'manual edit: room-kuiper-east',
      status: 'applied',
      detail: expect.stringContaining('audible at bar 2')
    });
  });

  it('reports partial live-command application as an API trace error', async () => {
    const { controller, session } = fixture();
    await controller.handleGameEvent(message('room-enter', 'Andromeda'));
    await controller.enableSound('key');
    session.submitResult = {
      ok: false,
      applied: 2,
      warnings: [{}],
      appliedPosition: { bar: 4 },
      failure: { message: 'shore level was rejected' }
    };

    await controller.applySnippet('room-galle', 'partial edit');
    expect(controller.getState().traces[0]).toMatchObject({
      status: 'error',
      detail: expect.stringContaining('2 statements applied')
    });
    expect(controller.getState().traces[0]?.detail).toContain('shore level was rejected');
  });

  it('uses the fixed asteroid intensity curve and clamps at four hits', () => {
    expect(asteroidLevels(0)).toBeUndefined();
    expect(asteroidLevels(1)).toEqual({ global: 0.85, pulse: 0.55 });
    expect(asteroidLevels(2)).toEqual({ global: 0.9, pulse: 0.7 });
    expect(asteroidLevels(3)).toEqual({ global: 0.95, pulse: 0.85 });
    expect(asteroidLevels(4)).toEqual({ global: 1, pulse: 1 });
    expect(asteroidLevels(999)).toEqual({ global: 1, pulse: 1 });
  });
});
