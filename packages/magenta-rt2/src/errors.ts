import type { ConnectorFailureReason } from '@luna-estelar/gas/protocol';
import { ConnectorError } from '@luna-estelar/gas/protocol';

export function connectorError(
  code: string,
  reason: ConnectorFailureReason,
  retryable: boolean,
  closeCode?: number
): ConnectorError {
  return new ConnectorError({
    code,
    reason,
    retryable,
    ...(closeCode !== undefined ? { closeCode } : {})
  });
}

export function safeError(error: unknown, fallback: ConnectorError): ConnectorError {
  return ConnectorError.isConnectorError(error) ? error : fallback;
}

export function cancelledStart(): ConnectorError {
  return connectorError('magenta-rt2-start-cancelled', 'internal', false);
}

/** Settles with `promise`, or rejects with a cancelled start as soon as `signal` aborts. */
export function raceAbort<T>(signal: AbortSignal | undefined, promise: Promise<T>): Promise<T> {
  if (signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(cancelledStart());
      return;
    }
    const onAbort = (): void => reject(cancelledStart());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

/** Calls a host callback and ignores what it throws. */
export function hostCall(call: () => void): void {
  try {
    call();
  } catch {
    // Host callbacks are isolated and never stringified or logged here.
  }
}
