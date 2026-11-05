// The connector's side of the GAS 0.4 behaviour contract. Each check is a plain
// async function that throws ConformanceFailure, so it runs under any test
// runner and the suite can test itself. GAS enforces the other rules itself.
import { ConnectorError } from '@luna-estelar/gas/protocol';
import type { Connection, ConnectorWarning } from '@luna-estelar/gas/protocol';
import { flushAsync, outcomeWithin, type Outcome } from './async.js';
import {
  DEFAULT_STATE,
  DEFAULT_TIMING,
  type ConnectorHarness,
  type HarnessFailure
} from './harness.js';

/** A connector broke the contract. The message says what it did. */
export class ConformanceFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConformanceFailure';
  }
}

function fail(message: string): never {
  throw new ConformanceFailure(message);
}

export type ConnectorCheck = (harness: ConnectorHarness) => Promise<void>;

const DEFAULT_TIMEOUT_MS = 1000;

interface Attempt {
  readonly connecting: Promise<Connection>;
  readonly controller: AbortController;
  readonly errors: unknown[];
  readonly warnings: ConnectorWarning[];
}

function start(harness: ConnectorHarness, controller = new AbortController()): Attempt {
  const errors: unknown[] = [];
  const warnings: ConnectorWarning[] = [];
  let connecting: Promise<Connection>;
  try {
    connecting = harness.connector.connect({
      config: harness.config ?? harness.connector.description.defaultConfig,
      state: harness.state ?? DEFAULT_STATE,
      timing: harness.timing ?? DEFAULT_TIMING,
      signal: controller.signal,
      onAudio: () => undefined,
      onWarning: (warning) => warnings.push(warning),
      onError: (error) => errors.push(error)
    });
  } catch (error) {
    connecting = Promise.reject(error);
  }
  // Checks read the outcome later; this stops an early rejection being reported as unhandled.
  connecting.catch(() => undefined);
  return { connecting, controller, errors, warnings };
}

async function settle(harness: ConnectorHarness): Promise<void> {
  if (harness.settle === undefined) await flushAsync();
  else await harness.settle();
}

/** Settles the harness, then waits up to the time limit for `promise`. */
async function outcome<T>(harness: ConnectorHarness, promise: Promise<T>): Promise<Outcome<T>> {
  await settle(harness);
  return outcomeWithin(promise, harness.timeoutMs ?? DEFAULT_TIMEOUT_MS);
}

/** `what` must settle. Its rejection is allowed unless `mustResolve`. */
async function settled<T>(
  harness: ConnectorHarness,
  what: string,
  call: () => Promise<T>,
  mustResolve = false
): Promise<Outcome<T>> {
  let promise: Promise<T>;
  try {
    promise = call();
  } catch (error) {
    promise = Promise.reject(error);
  }
  const result = await outcome(harness, promise);
  if (result.kind === 'pending') fail(`${what} did not settle.`);
  if (mustResolve && result.kind === 'rejected') fail(`${what} rejected: ${explain(result.error)}`);
  return result;
}

/** Connects all the way: start, open the provider, resolve. */
async function connectOpen(
  harness: ConnectorHarness
): Promise<Attempt & { connection: Connection }> {
  const attempt = start(harness);
  await settle(harness);
  await harness.open();
  const result = await outcome(harness, attempt.connecting);
  if (result.kind === 'pending') fail('connect() did not resolve after the provider opened.');
  if (result.kind === 'rejected') {
    fail(`connect() rejected after the provider opened: ${explain(result.error)}`);
  }
  return { ...attempt, connection: result.value };
}

function explain(value: unknown): string {
  if (ConnectorError.isConnectorError(value)) {
    return `ConnectorError ${value.code} (reason ${value.reason}, retryable ${value.retryable})`;
  }
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  return String(value);
}

function checkClassification(failure: HarnessFailure, error: unknown, how: string): void {
  if (!ConnectorError.isConnectorError(error)) {
    fail(`${failure.name}: ${how} ${explain(error)}, not a ConnectorError.`);
  }
  const { reason, retryable } = failure.expect;
  if (error.reason !== reason || error.retryable !== retryable) {
    fail(
      `${failure.name}: ${how} reason ${error.reason}, retryable ${error.retryable}; ` +
        `expected reason ${reason}, retryable ${retryable}.`
    );
  }
}

function failuresWhen(harness: ConnectorHarness, when: HarnessFailure['when']): HarnessFailure[] {
  const failures = harness.failures.filter((failure) => failure.when === when);
  if (failures.length === 0) {
    fail(`The harness has no '${when}' failure. Add a failure with when: '${when}'.`);
  }
  return failures;
}

function expectOpen(harness: ConnectorHarness, expected: number, after: string): void {
  const open = harness.transportsOpen();
  if (open !== expected) {
    fail(`${after}, ${open} transports were open; expected ${expected}.`);
  }
}

/** 1. A signal that aborted before connect() opens nothing. */
export const alreadyAborted: ConnectorCheck = async (harness) => {
  const controller = new AbortController();
  controller.abort();
  const attempt = start(harness, controller);
  const result = await outcome(harness, attempt.connecting);
  if (result.kind === 'pending') fail('connect() did not settle with an aborted signal.');
  if (result.kind === 'resolved') {
    await result.value.close().catch(() => undefined);
    fail('connect() resolved although the signal had already aborted.');
  }
  const opened = harness.transportsOpened();
  if (opened !== 0) fail(`connect() opened ${opened} transports with an aborted signal.`);
};

/** 2. Aborting while the provider connect hangs rejects connect() at once (rule 2). */
export const abortWhileConnecting: ConnectorCheck = async (harness) => {
  const attempt = start(harness);
  await settle(harness);
  attempt.controller.abort();
  const result = await outcome(harness, attempt.connecting);
  if (result.kind === 'pending') {
    fail('connect() kept waiting for the provider after the signal aborted.');
  }
  if (result.kind === 'resolved') fail('connect() resolved before the provider opened.');
};

/** 3. A provider connect that finishes after the abort is closed (rule 1). */
export const lateConnectionCloses: ConnectorCheck = async (harness) => {
  const attempt = start(harness);
  await settle(harness);
  attempt.controller.abort();
  await harness.open();
  const result = await outcome(harness, attempt.connecting);
  if (result.kind === 'pending') fail('connect() did not settle after the signal aborted.');
  if (result.kind === 'resolved') {
    // GAS closes a connection that resolves after the abort.
    await settled(harness, 'close() on a late connection', () => result.value.close());
    await settle(harness);
    expectOpen(harness, 0, 'After close() on a connection that resolved late');
    return;
  }
  await settle(harness);
  expectOpen(harness, 0, 'After a cancelled connect() whose provider opened late');
};

/** 4. Nothing reaches the provider after close(). */
export const nothingAfterClose: ConnectorCheck = async (harness) => {
  const { connection } = await connectOpen(harness);
  const state = harness.state ?? DEFAULT_STATE;
  await settled(harness, 'update()', () => connection.update({ state }, { bar: 2 }));
  await settled(harness, 'pause()', () => connection.pause());
  await settled(harness, 'resume()', () => connection.resume());
  await settled(harness, 'close()', () => connection.close());
  await settle(harness);
  const before = harness.sent();

  await settled(harness, 'update() after close()', () => connection.update({ state }, { bar: 3 }));
  await settled(harness, 'pause() after close()', () => connection.pause());
  await settled(harness, 'resume() after close()', () => connection.resume());
  await settle(harness);
  const after = harness.sent();
  if (after !== before) fail(`${after - before} messages reached the provider after close().`);
  expectOpen(harness, 0, 'After close()');
};

/** 5. A startup failure rejects connect() with a classified ConnectorError, and isn't reported again. */
export const startupFailureRejects: ConnectorCheck = async (harness) => {
  for (const failure of failuresWhen(harness, 'connect')) {
    const attempt = start(harness);
    await settle(harness);
    await failure.cause();
    const result = await outcome(harness, attempt.connecting);
    if (result.kind === 'pending') fail(`${failure.name}: connect() did not settle.`);
    if (result.kind === 'resolved') {
      await result.value.close().catch(() => undefined);
      fail(`${failure.name}: connect() resolved.`);
    }
    checkClassification(failure, result.error, 'connect() rejected with');
    await settle(harness);
    if (attempt.errors.length > 0) {
      fail(`${failure.name}: onError was called for a failure that rejected connect().`);
    }
  }
};

/** 6. A failure after connect() resolved calls onError once, classified (rule 3). */
export const playingFailureReportsOnce: ConnectorCheck = async (harness) => {
  for (const failure of failuresWhen(harness, 'playing')) {
    const { connection, errors } = await connectOpen(harness);
    await failure.cause();
    await settle(harness);
    if (errors.length === 0) fail(`${failure.name}: onError was not called.`);
    if (errors.length > 1) fail(`${failure.name}: onError was called ${errors.length} times.`);
    checkClassification(failure, errors[0], 'onError got');
    // GAS closes the connection after onError.
    await settled(harness, `${failure.name}: close() after onError`, () => connection.close());
    await settle(harness);
    if (errors.length > 1) fail(`${failure.name}: onError was called ${errors.length} times.`);
    expectOpen(harness, 0, `${failure.name}: after onError and close()`);
  }
};

/** 7. pause() stops the provider generating and resume() starts it again (rule 6). */
export const pauseStopsGenerating: ConnectorCheck = async (harness) => {
  const { connection } = await connectOpen(harness);
  await settle(harness);
  if (!harness.generating()) fail('The provider was not generating after connect() resolved.');
  await settled(harness, 'pause()', () => connection.pause(), true);
  await settle(harness);
  if (harness.generating()) fail('The provider was still generating after pause().');
  await settled(harness, 'A second pause()', () => connection.pause(), true);
  await settled(harness, 'resume()', () => connection.resume(), true);
  await settle(harness);
  if (!harness.generating()) fail('The provider was not generating after resume().');
  await settled(harness, 'close()', () => connection.close());
};

/** 8. Each connect() gets its own transport, and closing one leaves the other playing. */
export const connectionsIndependent: ConnectorCheck = async (harness) => {
  const first = await connectOpen(harness);
  const second = await connectOpen(harness);
  if (first.connection === second.connection) fail('Two connect() calls returned one connection.');
  await settled(harness, 'close() on the first connection', () => first.connection.close());
  await settle(harness);
  expectOpen(harness, 1, 'After closing the first of two connections');
  if (!harness.generating()) {
    fail('The second connection stopped generating when the first closed.');
  }
  await settled(harness, 'close() on the second connection', () => second.connection.close());
};

/** Every check, by the name the vitest suite gives it. */
export const CONNECTOR_CHECKS: Readonly<Record<string, ConnectorCheck>> = Object.freeze({
  'connect() opens nothing with an already aborted signal': alreadyAborted,
  'connect() rejects when aborted while the provider connect hangs': abortWhileConnecting,
  'a connection that opens after the abort is closed': lateConnectionCloses,
  'nothing reaches the provider after close()': nothingAfterClose,
  'a startup failure rejects connect() with a classified ConnectorError': startupFailureRejects,
  'a failure while playing calls onError once, classified': playingFailureReportsOnce,
  'pause() stops generating and resume() starts it again': pauseStopsGenerating,
  'two connections are independent': connectionsIndependent
});
