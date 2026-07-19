import type { ClockTimer, MonotonicClock } from '@luna-estelar/gas-protocol';

interface Scheduled {
  readonly id: number;
  readonly deadline: number;
  readonly callback: () => void;
  canceled: boolean;
}

export class VirtualClock implements MonotonicClock {
  private time = 0;
  private nextId = 1;
  private readonly scheduled: Scheduled[] = [];

  now(): number {
    return this.time;
  }

  schedule(deadlineSeconds: number, callback: () => void): ClockTimer {
    if (!Number.isFinite(deadlineSeconds)) throw new RangeError('deadline must be finite.');
    const entry: Scheduled = {
      id: this.nextId++,
      deadline: deadlineSeconds,
      callback,
      canceled: false
    };
    this.scheduled.push(entry);
    this.scheduled.sort((a, b) => a.deadline - b.deadline || a.id - b.id);
    return { token: entry };
  }

  cancel(timer: ClockTimer): void {
    const entry = timer.token as Scheduled;
    if (this.scheduled.includes(entry)) entry.canceled = true;
  }

  advanceTo(time: number): void {
    if (!Number.isFinite(time) || time < this.time) {
      throw new RangeError('Virtual clock cannot move backwards or to a non-finite time.');
    }
    while (true) {
      const next = this.scheduled.find((entry) => !entry.canceled && entry.deadline <= time);
      if (next === undefined) break;
      next.canceled = true;
      this.time = Math.max(this.time, next.deadline);
      next.callback();
    }
    this.time = time;
  }

  advanceBy(seconds: number): void {
    if (seconds < 0) throw new RangeError('Virtual clock cannot move backwards.');
    this.advanceTo(this.time + seconds);
  }

  pendingDeadlines(): readonly number[] {
    return this.scheduled.filter((entry) => !entry.canceled).map((entry) => entry.deadline);
  }
}
