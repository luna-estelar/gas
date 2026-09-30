# @luna-estelar/gas-api

## 0.2.0

### Minor Changes

- [`49e9774`](https://github.com/luna-estelar/gas/commit/49e977451a0f1aa0477b05e0d49e58edbbcc5776) Thanks [@sathira10](https://github.com/sathira10)! - A finite piece now actually completes its session. The session used to end a run on
  `stream: 'ended'`, a value the real Renderer never produced, so completion worked only against a
  fake renderer: overrides were never cleared and the session stayed `active` after the music stopped.
  It now ends on the Renderer's own `completed` flag, and forwards that flag on the `lifecycle` event
  so a host can tell a piece that finished from one it stopped. A provider that ends its stream early
  no longer ends the session, because a stream that stopped is not a piece that finished.

  `GasOperationError` gains `closeCode`, the raw transport close code, passed through unclassified for
  a host to map. It reaches both the `error` event and the error thrown by a failed `play()`, held to
  the Protocol's own range so no gate here is looser than the structural guard or the JSON Schema.

### Patch Changes

- [`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439) Thanks [@sathira10](https://github.com/sathira10)! - Internal dependency ranges widened to caret, so each package can be released on its own.
- Updated dependencies [[`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2), [`b98522b`](https://github.com/luna-estelar/gas/commit/b98522bb8a61fb00b5cbb2f4ca7e8f4557d07c7b), [`864382a`](https://github.com/luna-estelar/gas/commit/864382a00805593b954301351f3938e6e503fd74), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2)]:
  - @luna-estelar/gas-core@0.2.0
  - @luna-estelar/gas-language@0.1.2
  - @luna-estelar/gas-protocol@0.2.0

## 0.1.1

### Patch Changes

- Released with the Protocol validator fix; no changes to this package.

## 0.1.0

### Minor Changes

- First public preview. The application-facing session surface. Package APIs may change in
  minor releases before 1.0.
