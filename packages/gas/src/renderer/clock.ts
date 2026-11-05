// The default clock outside the browser: `performance.now()` in seconds, with
// `setTimeout` for deadlines. The browser uses its `AudioClock` instead.
import type { ClockTimer, MonotonicClock } from '../protocol/index.js';

export class SystemClock implements MonotonicClock {
  now(): number {
    return performance.now() / 1000;
  }

  schedule(deadlineSeconds: number, callback: () => void): ClockTimer {
    const delay = Math.max(0, (deadlineSeconds - this.now()) * 1000);
    return { token: setTimeout(callback, delay) };
  }

  cancel(timer: ClockTimer): void {
    clearTimeout(timer.token as ReturnType<typeof setTimeout>);
  }
}
