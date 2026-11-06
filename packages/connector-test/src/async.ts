// Copied from the repo's test/support/deferred.ts: a published package can't
// import the repo's test support.

// Captured at load, before a test can install fake timers, so the wall-time
// limit still fires under vi.useFakeTimers().
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

/** Lets every already-settled promise continuation run. */
export async function flushAsync(rounds = 12): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

export type Outcome<T> =
  | { readonly kind: 'resolved'; readonly value: T }
  | { readonly kind: 'rejected'; readonly error: unknown }
  | { readonly kind: 'pending' };

/** How `promise` settles within `ms` of wall time, or `pending`. */
export function outcomeWithin<T>(promise: Promise<T>, ms: number): Promise<Outcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Promise<Outcome<T>>((resolve) => {
    timer = realSetTimeout(() => resolve({ kind: 'pending' }), ms);
  });
  const settled = promise.then(
    (value): Outcome<T> => ({ kind: 'resolved', value }),
    (error: unknown): Outcome<T> => ({ kind: 'rejected', error })
  );
  return Promise.race([settled, pending]).finally(() => realClearTimeout(timer));
}
