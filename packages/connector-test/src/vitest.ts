import { describe, it } from 'vitest';
import { CONNECTOR_CHECKS } from './checks.js';
import type { CreateHarness } from './harness.js';

/** Registers one vitest test per check, each with a fresh harness. */
export function describeConnector(name: string, createHarness: CreateHarness): void {
  describe(name, () => {
    for (const [title, check] of Object.entries(CONNECTOR_CHECKS)) {
      it(title, async () => check(await createHarness()));
    }
  });
}
