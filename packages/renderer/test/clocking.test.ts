import { describe, expect, it, vi } from 'vitest';
import { VirtualClock } from '../../../test/support/virtual-clock.js';

describe('virtual monotonic clock', () => {
  it('fires equal deadlines in insertion order and exposes pending work', () => {
    const clock = new VirtualClock();
    const fired: string[] = [];
    clock.schedule(2, () => fired.push('a'));
    clock.schedule(1, () => fired.push('first'));
    clock.schedule(2, () => fired.push('b'));
    expect(clock.pendingDeadlines()).toEqual([1, 2, 2]);
    clock.advanceTo(2);
    expect(fired).toEqual(['first', 'a', 'b']);
    expect(clock.pendingDeadlines()).toEqual([]);
  });

  it('cancels callbacks and rejects backwards movement', () => {
    const clock = new VirtualClock();
    const callback = vi.fn();
    const timer = clock.schedule(1, callback);
    clock.cancel(timer);
    clock.advanceBy(2);
    expect(callback).not.toHaveBeenCalled();
    expect(() => clock.advanceTo(1)).toThrow(/backwards/);
  });
});
