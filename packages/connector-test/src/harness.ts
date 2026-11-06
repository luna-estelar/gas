import type {
  Connector,
  ConnectorConfig,
  ConnectorFailureReason,
  ConnectorTiming,
  EffectiveState
} from '@luna-estelar/gas/protocol';

/** One way the fake provider can fail, and how the connector should classify it. */
export interface HarnessFailure {
  readonly name: string;
  /** `connect`: while `connect()` is pending. `playing`: after it resolved. */
  readonly when: 'connect' | 'playing';
  /**
   * Makes the provider fail. For `connect`, the provider connect is still
   * pending, so finish whatever part of it the failure needs.
   */
  cause(): void | Promise<void>;
  readonly expect: { readonly reason: ConnectorFailureReason; readonly retryable: boolean };
}

/**
 * Your connector over a fake provider you control. The checks build a fresh
 * harness for each check.
 */
export interface ConnectorHarness {
  readonly connector: Connector;
  /** Defaults to `connector.description.defaultConfig`. */
  readonly config?: ConnectorConfig;
  /** Defaults to one active track and a global flavor. */
  readonly state?: EffectiveState;
  /** Defaults to 120 bpm in 4/4. */
  readonly timing?: ConnectorTiming;
  /** Wall-time limit for anything the connector must settle. Defaults to 1000 ms. */
  readonly timeoutMs?: number;
  /**
   * Finishes the pending provider connect, so `connect()` can resolve. Until
   * this is called, the provider connect must hang.
   */
  open(): void | Promise<void>;
  /** Transports the connector has opened so far, closed or not. */
  transportsOpened(): number;
  /** Transports opened and not yet closed by either side. */
  transportsOpen(): number;
  /** Messages that reached the provider, on every transport. */
  sent(): number;
  /** Whether the most recently opened transport is generating audio. */
  generating(): boolean;
  /** Runs pending work: flush promises and advance fake clocks. Defaults to a promise flush. */
  settle?(): void | Promise<void>;
  /** Needs at least one `connect` and one `playing` failure. */
  readonly failures: readonly HarnessFailure[];
}

export type CreateHarness = () => ConnectorHarness | Promise<ConnectorHarness>;

export const DEFAULT_STATE: EffectiveState = {
  globals: { flavor: { kind: 'text', text: 'warm and spacious' }, tempo: 120 },
  tracks: [
    {
      trackId: 'pad',
      name: 'pad',
      description: 'soft synthesizer chords',
      active: true,
      timbre: { kind: 'text', text: 'rounded analog tone' },
      level: { kind: 'level', value: 0.75 }
    }
  ]
};

export const DEFAULT_TIMING: ConnectorTiming = {
  tempo: 120,
  quarterNoteTempo: 120,
  timeSignature: { beatsPerBar: 4, beatUnit: 4 },
  secondsPerBar: 2
};
