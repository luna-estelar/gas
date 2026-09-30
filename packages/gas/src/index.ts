// The application layer: sessions, sources, errors and the protocol types a
// host handles. Everything else is a subpath, so importing the root does not
// load the renderer, the notation or highlight code, a connector or browser
// code.
export * from '@luna-estelar/gas-api';

// Local exports take precedence over the star export's own.
export const packageName = '@luna-estelar/gas';
export const version = '0.0.0';
