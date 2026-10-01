// Module resolve hook registered by deny-modules.mjs. The denied packages come
// from DENY_MODULES (comma-separated) so one hook serves every such check.
// An empty or missing list denies nothing, which would make a caller's test pass
// vacuously, so that is an error rather than a no-op.
const DENIED = (process.env.DENY_MODULES ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter((name) => name !== '');

if (DENIED.length === 0) {
  throw new Error('DENY_MODULES must name at least one module to deny.');
}

export async function resolve(specifier, context, nextResolve) {
  for (const denied of DENIED) {
    // The bare specifier or any subpath of it.
    if (specifier === denied || specifier.startsWith(`${denied}/`)) {
      throw new Error(`${denied} was loaded (from ${context.parentURL ?? 'the entry'})`);
    }
  }
  return nextResolve(specifier, context);
}
