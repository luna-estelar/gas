// The application layer: sessions, sources, errors and the protocol types a
// host handles. It loads the api, Core and Protocol — and nothing else:
// the renderer, the notation and highlight code, a connector and the browser
// modules are all subpaths, and the compiler loads on demand, so the root is
// parser-free. `./language` and `./browser/compile` are the two entry points
// that do load it.
export * from '@luna-estelar/gas-api';

// Local exports take precedence over the star export's own.
export const version = '0.1.0';
