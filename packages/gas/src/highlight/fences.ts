// Dependency-free fence metadata and Markdown fence detection.

/** Display labels for document, live-command and excerpt fences. */
export const GAS_FENCE_LABELS: Readonly<Record<string, string>> = {
  gas: 'gas',
  'gas-fragment': 'gas excerpt',
  'gas-live': 'gas live'
};

/** The languages Shiki must be told to skip. Same set, one source of truth. */
export const GAS_LANGS: readonly string[] = Object.keys(GAS_FENCE_LABELS);

/** An opening fence, and whatever info string follows it. */
const FENCE = /^ {0,3}(?:`{3,}|~{3,})/m;

/** Detect fenced code blocks in Markdown source. */
export function hasCodeFence(markdown: string): boolean {
  return FENCE.test(markdown);
}
