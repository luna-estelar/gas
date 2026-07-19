import type { RendererFailure } from '@luna-estelar/gas-protocol';

export type RendererErrorCode =
  | 'renderer-state-conflict'
  | 'invalid-timeline'
  | 'connector-unavailable'
  | 'renderer-closed';

export class RendererError extends Error {
  readonly code: RendererErrorCode;
  readonly failure?: RendererFailure;
  readonly problems?: readonly unknown[];

  constructor(
    code: RendererErrorCode,
    message: string,
    options: { readonly failure?: RendererFailure; readonly problems?: readonly unknown[] } = {}
  ) {
    super(message);
    this.name = 'RendererError';
    this.code = code;
    this.failure = options.failure;
    this.problems = options.problems;
  }
}
