// Hosts supply a renderer factory through protocol types. Retrying calls the
// factory again, using connection settings captured by the host.

import type { Renderer } from '@luna-estelar/gas-protocol';

export interface SessionWiring {
  // Build a Renderer ready to be `load`ed. Called once at session creation and
  // again on every `retryRenderer`. The API never constructs a Renderer itself.
  createRenderer(): Promise<Renderer>;
}
