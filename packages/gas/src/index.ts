// The root: sessions, sources, errors and the package version. The renderer is
// internal to the session.
// It loads neither the parser (the api imports the language module lazily)
// nor a connector. `./language` is the only entry point that loads the parser.
export * from './api/index.js';
export { version } from './version.js';
