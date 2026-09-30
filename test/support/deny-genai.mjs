// Preloaded with `node --import`: any attempt to resolve the Google GenAI SDK
// throws, so an entry point that imports cleanly under it provably never loads
// the SDK.
import { register } from 'node:module';

register(new URL('./deny-genai-hooks.mjs', import.meta.url));
