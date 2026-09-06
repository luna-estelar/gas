# Examples

The seven documents under `documents/` form the shared compiler and integration-test corpus.
`manifest.ts` describes their labels, playback modes and musical metadata. `support.ts`
provides filesystem access for tests and checks that the directory matches the manifest.

## Compile a document

```bash
pnpm build
node packages/cli/bin/gas.js compile examples/documents/minimal.gas
```

`minimal.gas` is a short complete document. `spec-example.gas` covers every highlight kind.

## Use examples in tests

Import `exampleFiles` and `readExample` from `examples/support.ts`. The collector rejects
missing documents and manifest mismatches, including an empty directory. Package tests may
read these shared fixtures without importing another package's implementation.

## Add a document

1. Add `documents/<name>.gas` and its metadata in `EXAMPLES`.
2. Set the expected playback mode, bars and tempo from the compiled timeline.
3. Run `pnpm test` to include the new document in each corpus suite.

The optional `homepage` index records display order for consumers. Website teaching
examples are maintained separately.
