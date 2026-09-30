# @luna-estelar/gas-language

## 0.1.2

### Patch Changes

- [`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439) Thanks [@sathira10](https://github.com/sathira10)! - Internal dependency ranges widened to caret, so each package can be released on its own.

- [`b98522b`](https://github.com/luna-estelar/gas/commit/b98522bb8a61fb00b5cbb2f4ca7e8f4557d07c7b) Thanks [@sathira10](https://github.com/sathira10)! - The generated TextMate grammar now ships in the tarball as `syntaxes/gas.tmLanguage.json`, for
  editors and static highlighters.

- [`864382a`](https://github.com/luna-estelar/gas/commit/864382a00805593b954301351f3938e6e503fd74) Thanks [@sathira10](https://github.com/sathira10)! - README rewritten to the shared layout: install, a complete example, an exports table, runtime
  support and related packages. The notation README now documents the Alda subset it accepts and
  what raises `AldaParseError`.
- Updated dependencies [[`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439), [`2ad4e1f`](https://github.com/luna-estelar/gas/commit/2ad4e1fb94f1dbd36e32b0e06b27630012830cf2)]:
  - @luna-estelar/gas-protocol@0.2.0

## 0.1.1

### Patch Changes

- Released with the Protocol validator fix; no changes to this package.

## 0.1.0

### Minor Changes

- First public preview. Parses, validates and compiles GAS documents and live fragments
  into model-independent timelines in musical time. Package APIs may change in minor
  releases before 1.0.
