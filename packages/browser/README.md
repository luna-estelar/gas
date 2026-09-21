# GAS Browser

`@luna-estelar/gas-browser` is the framework-free browser host for GAS. It composes sessions and
credentials, decodes and plays Web Audio, derives timeline view models, and provides the worked
Bitsy integration used by the demos.

## Install

```bash
npm install @luna-estelar/gas-browser
```

The package is ESM-only. It runs in modern browsers; Node.js 22 or newer is required by the
compiler dependency when browser projects install or build it.

Import the browser package through its explicit subpaths. The `compile` subpath loads the
language package, Langium, and Chevrotain. Use a dynamic import to defer that cost until
compilation is needed. Other subpaths provide timeline, inspection, audio, and Bitsy helpers.

| Subpath                      | Purpose                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| `compile`                    | Compile and highlight GAS source; loads the parser           |
| `wiring`, `config`, `access` | Compose sessions, credentials, and connector settings        |
| `playback`, `audio`          | Browser playback and decoded Web Audio delivery              |
| `timeline`, `inspect`        | Pure timeline view models and state inspection               |
| `bitsy/*`                    | Types, bridge, score mapping, and controller for Bitsy hosts |

```ts
import { compileGas } from '@luna-estelar/gas-browser/compile';

const result = compileGas('tempo 88\nlength bars 4\n', 'example.gas');
if (result.ok) console.log(result.timeline?.compilerVersion);
```

Applications consume the compiled output. Rebuild it during local development:

```sh
pnpm exec tsc -b packages/browser --watch
```
