# @luna-estelar/gas

## 0.1.0

### Minor Changes

- [`4c7f950`](https://github.com/luna-estelar/gas/commit/4c7f950ca4d1c1377982d211b9710cbe26c59a73) Thanks [@sathira10](https://github.com/sathira10)! - First release of `@luna-estelar/gas`, one install for the language, the session runtime, the
  renderer and the Lyria connector.

  - The root re-exports `@luna-estelar/gas-api` (sessions, source helpers, `GasOperationError` and
    the protocol types a host handles), plus this package's own `packageName` and `version`.
  - Every package is available at a subpath that mirrors it: `/protocol`, `/protocol/validation`,
    `/language`, `/core`, `/api`, `/renderer`, `/notation`, `/highlight`, `/lyria`, and
    `/browser/{session,audio,capture,compile,timeline,inspect}`. Only `/lyria` loads the Google
    GenAI SDK.
  - The `gas` command runs `@luna-estelar/gas-cli`; use it as `npx @luna-estelar/gas`.

  Dependencies are pinned to exact versions, so use this package or the individual packages, not
  both at different versions.

### Patch Changes

- Updated dependencies [[`49e9774`](https://github.com/luna-estelar/gas/commit/49e977451a0f1aa0477b05e0d49e58edbbcc5776), [`7187051`](https://github.com/luna-estelar/gas/commit/7187051bbee674c36d9ca492cdc54e8d6e386866), [`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439), [`49e9774`](https://github.com/luna-estelar/gas/commit/49e977451a0f1aa0477b05e0d49e58edbbcc5776), [`b98522b`](https://github.com/luna-estelar/gas/commit/b98522bb8a61fb00b5cbb2f4ca7e8f4557d07c7b), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2), [`b98522b`](https://github.com/luna-estelar/gas/commit/b98522bb8a61fb00b5cbb2f4ca7e8f4557d07c7b), [`864382a`](https://github.com/luna-estelar/gas/commit/864382a00805593b954301351f3938e6e503fd74), [`49e9774`](https://github.com/luna-estelar/gas/commit/49e977451a0f1aa0477b05e0d49e58edbbcc5776), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2)]:
  - @luna-estelar/gas-api@0.2.0
  - @luna-estelar/gas-browser@0.2.0
  - @luna-estelar/gas-cli@0.1.2
  - @luna-estelar/gas-connector-lyria@0.2.0
  - @luna-estelar/gas-core@0.2.0
  - @luna-estelar/gas-highlight@0.1.2
  - @luna-estelar/gas-language@0.1.2
  - @luna-estelar/gas-notation@0.1.2
  - @luna-estelar/gas-protocol@0.2.0
  - @luna-estelar/gas-renderer@0.2.0
