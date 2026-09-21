# GAS Browser

`@luna-estelar/gas-browser` is the framework-free browser host for GAS. It composes sessions and
credentials, decodes and plays Web Audio, derives timeline view models, and provides the worked
Bitsy integration used by the demos.

Import the browser package through its explicit subpaths. The `compile` subpath loads the
language package, Langium, and Chevrotain. Use a dynamic import to defer that cost until
compilation is needed. Other subpaths provide timeline, inspection, audio, and Bitsy helpers.

Applications consume the compiled output. Rebuild it during local development:

```sh
pnpm exec tsc -b packages/browser --watch
```
