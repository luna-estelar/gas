// The renderer's clock, read from the audio device so musical time and audible
// time share one timeline.
import type { ClockTimer, MonotonicClock } from '@luna-estelar/gas-protocol';

interface Timer {
  readonly deadline: number;
  readonly callback: () => void;
  handle: ReturnType<typeof setTimeout> | undefined;
}

export class AudioClock implements MonotonicClock {
  private readonly timers = new Set<Timer>();
  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'visible') this.fireOverdue();
  };

  constructor(private readonly context: BaseAudioContext) {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  now(): number {
    return this.context.currentTime;
  }

  schedule(deadlineSeconds: number, callback: () => void): ClockTimer {
    const timer: Timer = { deadline: deadlineSeconds, callback, handle: undefined };
    this.timers.add(timer);
    this.arm(timer);
    return { token: timer };
  }

  cancel(timer: ClockTimer): void {
    const entry = timer.token as Timer;
    clearTimeout(entry.handle);
    this.timers.delete(entry);
  }

  /** Clears every timer and stops listening for visibility changes. */
  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer.handle);
    this.timers.clear();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
  }

  private arm(timer: Timer): void {
    const delay = Math.max(0, (timer.deadline - this.context.currentTime) * 1000);
    timer.handle = setTimeout(() => this.fire(timer), delay);
  }

  // A timeout measures wall time and the deadline is device time. They drift, and
  // a suspended context stops device time altogether, so a timeout that fires
  // before the device reaches the deadline waits again for the remainder.
  private fire(timer: Timer): void {
    if (!this.timers.has(timer)) return;
    if (this.context.currentTime < timer.deadline) {
      this.arm(timer);
      return;
    }
    this.timers.delete(timer);
    timer.callback();
  }

  // Background tabs throttle timeouts to once a second or worse. Coming back,
  // run whatever fell due in the meantime rather than waiting for the throttled
  // timeout to catch up.
  private fireOverdue(): void {
    const now = this.context.currentTime;
    const due = [...this.timers]
      .filter((timer) => timer.deadline <= now)
      .sort((left, right) => left.deadline - right.deadline);
    for (const timer of due) {
      clearTimeout(timer.handle);
      this.fire(timer);
    }
  }
}
