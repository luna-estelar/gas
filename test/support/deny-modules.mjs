// Preloaded with `node --import`: any attempt to resolve one of the modules
// named in DENY_MODULES throws, so an entry point that imports cleanly under it
// provably never loads them. Only a module graph's first evaluation can be
// observed, which is why each check runs in its own process.
import { register } from 'node:module';

register(new URL('./deny-modules-hooks.mjs', import.meta.url));
