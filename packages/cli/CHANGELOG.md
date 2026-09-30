# @luna-estelar/gas-cli

## 0.1.2

### Patch Changes

- [`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439) Thanks [@sathira10](https://github.com/sathira10)! - Internal dependency ranges widened to caret, so each package can be released on its own.

- [`b98522b`](https://github.com/luna-estelar/gas/commit/b98522bb8a61fb00b5cbb2f4ca7e8f4557d07c7b) Thanks [@sathira10](https://github.com/sathira10)! - Unused direct dependencies removed. The CLI no longer declares Protocol or Core, neither of which
  it imported; it still depends on the language package for compilation, so installing it still
  brings the parser. The highlight helpers declare their own token types instead of depending on the
  language package, so installing them pulls in neither the parser, Langium, nor Chevrotain.

- [`864382a`](https://github.com/luna-estelar/gas/commit/864382a00805593b954301351f3938e6e503fd74) Thanks [@sathira10](https://github.com/sathira10)! - README rewritten to the shared layout: install, a complete example, an exports table, runtime
  support and related packages. The notation README now documents the Alda subset it accepts and
  what raises `AldaParseError`.
- Updated dependencies [[`a8009b8`](https://github.com/luna-estelar/gas/commit/a8009b820f771736efc683c4d78a57d17577e439), [`b98522b`](https://github.com/luna-estelar/gas/commit/b98522bb8a61fb00b5cbb2f4ca7e8f4557d07c7b), [`864382a`](https://github.com/luna-estelar/gas/commit/864382a00805593b954301351f3938e6e503fd74)]:
  - @luna-estelar/gas-language@0.1.2

## 0.1.1

### Patch Changes

- Released with the Protocol validator fix; no changes to this package.

## 0.1.0

### Minor Changes

- First public preview. The `gas` command. Package APIs may change in minor releases
  before 1.0.
