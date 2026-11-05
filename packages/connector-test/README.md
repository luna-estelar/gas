# @luna-estelar/gas-connector-test

[![npm](https://img.shields.io/npm/v/@luna-estelar/gas-connector-test)](https://www.npmjs.com/package/@luna-estelar/gas-connector-test)

Checks a [GAS](https://gas.lunaestelar.com) connector against the connector contract, in your own
vitest suite. You give it your connector over a fake provider you control.

## Install

```bash
pnpm add -D @luna-estelar/gas-connector-test
```

`@luna-estelar/gas` and `vitest` are peer dependencies.

## Example

```ts
import { describeConnector } from '@luna-estelar/gas-connector-test';
import type { Connector } from '@luna-estelar/gas/protocol';

// Your connector, built over a fake provider that your tests drive.
declare function createTestConnector(provider: FakeProvider): Connector;
declare class FakeProvider {
  open(): void;
  refuseKey(): void;
  drop(): void;
  readonly sockets: readonly { readonly closed: boolean; readonly sent: number }[];
  readonly generating: boolean;
}

describeConnector('My model', () => {
  const provider = new FakeProvider();
  return {
    connector: createTestConnector(provider),
    open: () => provider.open(),
    transportsOpened: () => provider.sockets.length,
    transportsOpen: () => provider.sockets.filter((socket) => !socket.closed).length,
    sent: () => provider.sockets.reduce((total, socket) => total + socket.sent, 0),
    generating: () => provider.generating,
    failures: [
      {
        name: 'key refused',
        when: 'connect',
        cause: () => provider.refuseKey(),
        expect: { reason: 'auth', retryable: false }
      },
      {
        name: 'socket lost',
        when: 'playing',
        cause: () => provider.drop(),
        expect: { reason: 'network', retryable: true }
      }
    ]
  };
});
```

The provider's connect must hang until `open()`. `sent()` counts what reached the provider, and
`generating()` says whether the most recently opened transport is producing audio. A connector
whose timers run on a fake clock passes `settle()` to advance it.
[Lyria's conformance test](https://github.com/luna-estelar/gas/blob/main/packages/lyria-rt/test/conformance.test.ts)
is a full harness.

## Checks

1. `connect()` with an already aborted signal opens nothing.
2. Aborting while the provider connect hangs rejects `connect()` at once.
3. A transport that opens after the abort is closed.
4. Nothing reaches the provider after `close()`.
5. A startup failure rejects `connect()` with a `ConnectorError` of the right `reason` and
   `retryable`, and doesn't call `onError`.
6. A failure while playing calls `onError` once, classified the same way.
7. `pause()` stops the provider generating, and `resume()` starts it again.
8. Two connections have their own transports, and closing one leaves the other playing.

Each check is also exported as a plain async function that throws `ConformanceFailure`, for other
test runners. GAS enforces the rest of the contract itself.

## License

MIT
