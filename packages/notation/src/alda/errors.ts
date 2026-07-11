export class AldaParseError extends Error {
  override readonly name = 'AldaParseError';

  constructor(
    message: string,
    readonly offset: number
  ) {
    super(`${message} (at offset ${offset})`);
  }
}
