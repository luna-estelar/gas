// CLI scaffold with a placeholder command.

export const packageName = '@luna-estelar/gas-cli';
export const version = '0.1.0';

const KNOWN_FLAGS = new Set(['-h', '--help', '-v', '--version']);

/** Prints the scaffold status, or exits with an error for an unknown option. */
export function run(argv: readonly string[] = process.argv.slice(2)): void {
  const unknownFlag = argv.find((arg) => arg.startsWith('-') && !KNOWN_FLAGS.has(arg));
  if (unknownFlag !== undefined) {
    process.stderr.write(`gas: unknown option '${unknownFlag}'\nusage: gas\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('GAS CLI — not implemented in this scaffold.\n');
}
