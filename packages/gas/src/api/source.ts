// Explicit source input helpers. Strings contain GAS text; paths and URLs use
// their own helpers. Structural Blob/File inputs avoid a DOM type dependency.
interface BlobLike {
  text(): Promise<string>;
}
interface FileLike extends BlobLike {
  readonly name: string;
}

export type SourceInput =
  | string
  | { readonly kind: 'text'; readonly text: string; readonly name?: string }
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array; readonly name?: string }
  | { readonly kind: 'blob'; readonly blob: BlobLike; readonly name?: string }
  | { readonly kind: 'file'; readonly file: FileLike }
  | { readonly kind: 'url'; readonly url: string; readonly name?: string }
  | { readonly kind: 'path'; readonly path: string };

export interface ResolvedSource {
  readonly text: string;
  readonly name?: string;
}

// Explicit constructors so a host disambiguates intent at the call site.
export function sourceText(text: string, name?: string): SourceInput {
  return { kind: 'text', text, ...(name !== undefined ? { name } : {}) };
}
export function sourceBytes(bytes: Uint8Array, name?: string): SourceInput {
  return { kind: 'bytes', bytes, ...(name !== undefined ? { name } : {}) };
}
export function sourceBlob(blob: BlobLike, name?: string): SourceInput {
  return { kind: 'blob', blob, ...(name !== undefined ? { name } : {}) };
}
export function sourceFile(file: FileLike): SourceInput {
  return { kind: 'file', file };
}
export function sourceUrl(url: string, name?: string): SourceInput {
  return { kind: 'url', url, ...(name !== undefined ? { name } : {}) };
}
export function sourcePath(path: string): SourceInput {
  return { kind: 'path', path };
}

// Resolves any input to text plus an optional identity label. Only `url` and
// `path` perform I/O, and only when the host chose those helpers; a plain string
// stays untouched.
export async function resolveSource(input: SourceInput): Promise<ResolvedSource> {
  if (typeof input === 'string') {
    return { text: input };
  }
  switch (input.kind) {
    case 'text':
      return { text: input.text, ...named(input.name) };
    case 'bytes':
      return { text: decodeUtf8(input.bytes), ...named(input.name) };
    case 'blob':
      return { text: await input.blob.text(), ...named(input.name) };
    case 'file':
      return { text: await input.file.text(), name: input.file.name };
    case 'url': {
      const text = await fetchText(input.url);
      return { text, name: input.name ?? input.url };
    }
    case 'path': {
      const { readFile } = await import('node:fs/promises');
      const text = await readFile(input.path, 'utf-8');
      return { text, name: input.path };
    }
    default:
      return assertNever(input);
  }
}

function named(name: string | undefined): { name?: string } {
  return name !== undefined ? { name } : {};
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetching GAS source from ${url} failed with status ${response.status}.`);
  }
  return response.text();
}

function assertNever(value: never): never {
  throw new Error(`Unhandled source input: ${JSON.stringify(value)}`);
}
