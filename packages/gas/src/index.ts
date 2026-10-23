// The root: sessions, sources, errors, the renderer and the package version.
// It loads neither the parser (the api imports the language module lazily)
// nor a connector. `./language` is the only entry point that loads the parser.
export * from './api/index.js';
export { createRenderer } from './renderer/index.js';
export { version } from './version.js';
