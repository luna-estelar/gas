// What the listener hears, for a page that draws a playhead. Positions are
// collected as they are generated, one per beat plus the session's own
// generation events, and each is replayed when the engine's playhead reaches
// its seconds.
import type {
  AudiblePositionEvent,
  ClockTimer,
  GenerationPositionEvent,
  MonotonicClock,
  MusicalPosition
} from '../protocol/index.js';
import type { AudioStatus, PlaybackEngine } from './audio/engine.js';

// Half a millisecond, so a timer that lands a float's width short still counts.
const EPSILON_SECONDS = 0.0005;
// How often to look again while the playhead waits for scheduled audio to
// become audible: the start lead plus the output latency, tens of ms.
const START_POLL_SECONDS = 0.005;
// The longest beat looked for: 7.5 BPM.
const BEAT_HORIZON_SECONDS = 8;
// Where the beat search stops, well inside a sample.
const BEAT_PRECISION_SECONDS = 1e-9;

interface Queued {
  readonly event: GenerationPositionEvent;
  /** A beat between generation events, which a generation event replaces. */
  readonly tick: boolean;
}

/** The musical position `seconds` into the current Play, as the session places it. */
export type PositionAt = (seconds: number) => MusicalPosition | undefined;

export class AudiblePositions {
  private queue: Queued[] = [];
  private timer: ClockTimer | undefined;
  private lastPlayhead: number | undefined;
  // Bumped by reset, so a listener that stops or closes mid-dispatch ends it.
  private generation = 0;
  private readonly unsubscribe: () => void;
  private readonly beats: BeatTicks;

  constructor(
    private readonly engine: PlaybackEngine,
    private readonly clock: MonotonicClock,
    positionAt: PositionAt,
    private readonly emit: (event: AudiblePositionEvent) => void
  ) {
    this.unsubscribe = engine.on('status', (status) => this.onStatus(status));
    this.beats = new BeatTicks(clock, positionAt, (event) => this.enqueue(event, true));
  }

  /** A generation event, as the session emits it. */
  push(event: GenerationPositionEvent): void {
    // A beat queued at or after this event was placed on the map this event
    // replaces, such as the one before a loop restart.
    this.queue = this.queue.filter(
      (queued) => !queued.tick || queued.event.seconds < event.seconds - EPSILON_SECONDS
    );
    this.enqueue(event, false);
    this.beats.restart(event);
  }

  /** Drop what hasn't been heard yet. */
  reset(): void {
    this.queue = [];
    this.lastPlayhead = undefined;
    this.generation++;
    this.cancel();
    this.beats.stop();
  }

  dispose(): void {
    this.reset();
    this.unsubscribe();
  }

  private enqueue(event: GenerationPositionEvent, tick: boolean): void {
    this.queue.push({ event, tick });
    this.arm();
  }

  // Only a playing engine moves its playhead. Anything else holds it, so a timer
  // would fire early; the next `playing` re-arms. A `stopped` engine is either a
  // finished piece or a chain waiting on a late chunk, so the queue stays.
  private onStatus(status: AudioStatus): void {
    if (status.state === 'playing') {
      this.arm();
      return;
    }
    this.cancel();
    this.emitDue();
  }

  private arm(): void {
    if (this.timer !== undefined) return;
    const reading = this.emitDue();
    if (this.timer !== undefined) return;
    const head = this.queue[0];
    if (reading === undefined || head === undefined) return;
    if (this.engine.status().state !== 'playing') return;
    // A playhead that hasn't moved is waiting for its audio to be heard, and
    // the gap says nothing about when that will be. Otherwise wake a little
    // early, inside the epsilon, so a deadline a float's width late can't slip
    // to the clock's next tick.
    const wait = reading.moving
      ? Math.max(0, head.event.seconds - reading.playhead - EPSILON_SECONDS / 2)
      : START_POLL_SECONDS;
    this.timer = this.clock.schedule(this.clock.now() + wait, () => {
      this.timer = undefined;
      this.arm();
    });
  }

  // Emits, in order, every queued position the playhead has reached. One at the
  // playhead itself counts only once the playhead is moving, since a playhead
  // waiting at the start of scheduled audio reads the same as one that got there.
  private emitDue(): { playhead: number; moving: boolean } | undefined {
    const playhead = this.engine.playheadSeconds();
    if (playhead === undefined) return undefined;
    const moving = this.lastPlayhead !== undefined && playhead > this.lastPlayhead;
    this.lastPlayhead = playhead;
    const reached = moving ? playhead + EPSILON_SECONDS : playhead - EPSILON_SECONDS;
    let due = 0;
    while (due < this.queue.length && this.queue[due]!.event.seconds <= reached) due++;
    const heard = this.queue.splice(0, due);
    const generation = this.generation;
    for (const { event } of heard) {
      if (this.generation !== generation) break;
      this.emit({
        position: event.position,
        seconds: event.seconds,
        loopIteration: event.loopIteration
      });
    }
    return { playhead, moving };
  }

  private cancel(): void {
    if (this.timer === undefined) return;
    this.clock.cancel(this.timer);
    this.timer = undefined;
  }
}

/**
 * A position for each beat as it is generated. The session only reports
 * boundaries, and its map of seconds to positions only covers the current loop,
 * so beats are placed while they are current rather than when they are heard.
 */
class BeatTicks {
  private timer: ClockTimer | undefined;

  constructor(
    private readonly clock: MonotonicClock,
    private readonly positionAt: PositionAt,
    private readonly tick: (event: GenerationPositionEvent) => void
  ) {}

  /** Count beats on from a generation event, which arrives as it happens. */
  restart(from: GenerationPositionEvent): void {
    this.stop();
    const origin = this.clock.now() - from.seconds;
    this.next(origin, from.seconds, from.loopIteration);
  }

  stop(): void {
    if (this.timer === undefined) return;
    this.clock.cancel(this.timer);
    this.timer = undefined;
  }

  private next(origin: number, after: number, loopIteration: number): void {
    const beat = this.beatAfter(after);
    if (beat === undefined) return;
    this.timer = this.clock.schedule(origin + beat.seconds, () => {
      this.timer = undefined;
      this.tick({ position: beat.position, seconds: beat.seconds, loopIteration });
      this.next(origin, beat.seconds, loopIteration);
    });
  }

  // The next beat after `seconds`. Positions round to the nearest tick, so a
  // beat reads as itself from half a tick before it to half a tick after; the
  // middle of that span is the beat. Undefined when no beat comes within the
  // horizon: the Play is held, ended or not anchored.
  private beatAfter(seconds: number): { position: MusicalPosition; seconds: number } | undefined {
    const current = this.positionAt(seconds);
    if (current === undefined) return undefined;
    const sameBeat = (at: number): boolean => sameBeatAs(this.positionAt(at), current);
    if (sameBeat(seconds + BEAT_HORIZON_SECONDS)) return undefined;
    const first = this.firstFalse(seconds, seconds + BEAT_HORIZON_SECONDS, sameBeat);
    const position = this.positionAt(first);
    if (position === undefined) return undefined;
    const last = this.firstFalse(first, first + BEAT_HORIZON_SECONDS, (at) =>
      samePosition(this.positionAt(at), position)
    );
    return { position, seconds: (first + last) / 2 };
  }

  // The earliest time in (low, high] where `holds` stops, given it holds at low.
  private firstFalse(low: number, high: number, holds: (at: number) => boolean): number {
    while (high - low > BEAT_PRECISION_SECONDS) {
      const middle = (low + high) / 2;
      if (holds(middle)) low = middle;
      else high = middle;
    }
    return high;
  }
}

// A bar start leaves out its beat: it is beat 1.
function sameBeatAs(a: MusicalPosition | undefined, b: MusicalPosition): boolean {
  return a !== undefined && a.bar === b.bar && (a.beat?.index ?? 1) === (b.beat?.index ?? 1);
}

function samePosition(a: MusicalPosition | undefined, b: MusicalPosition): boolean {
  return (
    sameBeatAs(a, b) &&
    a!.beat?.offset?.numerator === b.beat?.offset?.numerator &&
    a!.beat?.offset?.denominator === b.beat?.offset?.denominator
  );
}
