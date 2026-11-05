// The connector interface: what a package that knows one model implements. A
// connector opens one connection per Play and reports what happens on it. GAS
// decides when to start, pause and stop it. The numbered rules are in the GAS
// 0.4 behaviour contract.

import type { CapabilitiesTable } from './capabilities.js';
import type { EffectiveState } from './effective-state.js';
import type { ConnectorError } from './errors.js';
import type { MusicalPosition, TimeSignature } from './timeline.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface ClockTimer {
  readonly token: unknown;
}

export interface MonotonicClock {
  now(): number;
  schedule(deadlineSeconds: number, callback: () => void): ClockTimer;
  cancel(timer: ClockTimer): void;
}

export type ConnectorFailureReason = 'network' | 'auth' | 'quota' | 'provider' | 'internal';
export type SampleFormat = 's16le' | (string & {});

export interface AudioFormat {
  readonly codec: string;
  readonly sampleFormat: SampleFormat;
  readonly sampleRate: number;
  readonly channels: number;
}

export interface ModelInfo extends AudioFormat {
  readonly connectorId: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly chunkDurationSeconds: number;
}

export type ConnectorConfig = JsonObject;
export type ConnectorConfigSchema = JsonObject;

/**
 * One thing wrong with a proposed connector configuration. Deliberately not an
 * AJV-shaped problem: a hand-written validator should not have to imitate a
 * schema compiler to report a bad value.
 */
export interface ConnectorConfigProblem {
  /** JSON Pointer to the offending member, '' for the root. */
  readonly path: string;
  /** Stable machine code, e.g. 'unknown-member', 'out-of-range', 'wrong-type'. */
  readonly code: string;
  /** Safe, fixed text. Never provider or caller input. */
  readonly message: string;
}

export type ConnectorConfigValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly problems: readonly ConnectorConfigProblem[] };

/** What a connector is, known without opening anything. */
export interface ConnectorDescription {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: CapabilitiesTable;
  readonly model: ModelInfo;
  readonly configSchema: ConnectorConfigSchema;
  readonly defaultConfig: ConnectorConfig;
}

/**
 * The connection's defaults: the document's timing, with any document defaults
 * applied. They are what applies wherever an effective state leaves tempo or key
 * unset, so a connector resolves `state.globals.tempo ?? timing.tempo`.
 */
export interface ConnectorTiming {
  /**
   * Beats per minute where a beat is `timeSignature.beatUnit`, so 120 in 6/8 is
   * 120 eighth notes a minute and a bar lasts 3 s.
   */
  readonly tempo: number;
  /**
   * `tempo` in quarter notes a minute: `tempo * 4 / beatUnit`. A model that
   * wants an absolute tempo uses this rather than converting `tempo` itself.
   */
  readonly quarterNoteTempo: number;
  readonly timeSignature: TimeSignature;
  readonly key?: string;
  /** The length of a bar at the default `tempo`. */
  readonly secondsPerBar: number;
}

export interface ConnectorNotation {
  readonly trackId: string;
  readonly intent: 'notes' | 'motif';
  readonly source: string;
  readonly midi?: Uint8Array;
}

export interface ConnectorUpdate {
  readonly state: EffectiveState;
  readonly notation?: readonly ConnectorNotation[];
}

/** Audio from a connection. A chunk belongs to the connection that sent it. */
export interface ConnectorAudioChunk extends AudioFormat {
  readonly bytes: Uint8Array;
  readonly durationSeconds: number;
}

/** Audio as the session delivers it, numbered in delivery order. */
export interface AudioChunk extends ConnectorAudioChunk {
  readonly sequence: number;
}

/** Something that degraded but kept playing, such as a clamped tempo. */
export interface ConnectorWarning {
  readonly code: string;
  readonly message: string;
}

export interface ConnectOptions {
  readonly config: ConnectorConfig;
  /** The effective state at bar 1, app values included. */
  readonly state: EffectiveState;
  readonly timing: ConnectorTiming;
  /**
   * Aborted when Stop or Close comes before `connect()` resolves (rule 2). Stop
   * starting: leave pending provider calls and reject or resolve as soon as you
   * can. GAS has already moved on and won't wait.
   */
  readonly signal: AbortSignal;
  /** Calling it after GAS ends the connection does nothing, so no guard is needed. */
  onAudio(chunk: ConnectorAudioChunk): void;
  onWarning(warning: ConnectorWarning): void;
  /**
   * A failure after `connect()` resolved (rule 3). Report it once, as a
   * `ConnectorError`. GAS ends this connection only; the next Play connects
   * again. A failure during startup is a rejection of `connect()` instead.
   */
  onError(error: ConnectorError): void;
}

export interface Connector {
  readonly description: ConnectorDescription;
  /**
   * Checks a configuration the app proposes, so GAS never has to compile
   * `configSchema`.
   */
  validateConfig?(config: ConnectorConfig): ConnectorConfigValidation;
  /**
   * Opens one connection for one Play (rule 1). Resolve once audio can flow;
   * reject with a `ConnectorError` if startup fails, which is the only report of
   * that failure (rule 2). If it resolves after `signal` aborted, GAS closes the
   * connection it returns.
   */
  connect(options: ConnectOptions): Promise<Connection>;
}

export interface Connection {
  /**
   * Sends a change. Resolves with the position where it takes effect, which the
   * session reports as `appliedPosition`.
   */
  update(update: ConnectorUpdate, requested: MusicalPosition): Promise<MusicalPosition>;
  /**
   * Stops the provider generating, not just reading the stream (rule 6). A model
   * that can't stop generating drops its audio until `resume()`.
   */
  pause(): Promise<void>;
  /** Starts generating again after `pause()` (rule 6). */
  resume(): Promise<void>;
  /**
   * Closes the transport. GAS doesn't wait for it before the next Play, but
   * times it. Sends after close need no guard of their own as long as the
   * transport is closed.
   */
  close(): Promise<void>;
}
