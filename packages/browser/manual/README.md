# Manual listening check

`index.html` plays `examples/documents/drum-loop.gas` through the Lyria connector with the
browser session and logs every audio status, warning and lifecycle event. It makes provider
calls with your key and is not part of CI. The key is typed into the page, held in memory, and
never stored.

## Run

```sh
pnpm build
pnpm exec vite packages/browser/manual
```

Open the printed URL. Vite ships with Vitest, so nothing else needs to be
installed. It resolves the workspace packages and serves the example document.

## Acceptance (LE-89)

For each output rate, 44 100 Hz and 48 000 Hz (choose it in the page, or set the system output
device):

1. Paste a Gemini API key and press **Play**.
2. Let it run for at least 10 chunk boundaries (about 22 s with 2 s chunks).
3. Listen for a gap or click at the boundaries. The summary line must read `0 underruns`.
4. Press **Stop**. Audio must go silent at once.

Record the summary line for each rate on the PR and on LE-89.
