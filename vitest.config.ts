import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const browserSource = fileURLToPath(new URL('./packages/browser/src/', import.meta.url));

export default defineConfig({
  // Resolve browser subpaths to source for direct test runs.
  resolve: {
    alias: [
      {
        find: /^@luna-estelar\/gas-browser\/(.+)$/,
        replacement: `${browserSource}$1.ts`
      }
    ]
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'test/**/*.test.ts']
  }
});
