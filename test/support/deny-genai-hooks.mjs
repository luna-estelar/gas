// Module resolve hook registered by deny-genai.mjs.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@google/genai' || specifier.startsWith('@google/genai/')) {
    throw new Error(`@google/genai was loaded (from ${context.parentURL ?? 'the entry'})`);
  }
  return nextResolve(specifier, context);
}
