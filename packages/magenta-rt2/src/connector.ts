import type {
  CapabilitiesTable,
  ConnectOptions,
  Connection,
  Connector,
  ConnectorDescription,
  ConnectorError
} from '@luna-estelar/gas/protocol';
import {
  DEFAULT_MAGENTA_RT2_CONFIG,
  MAGENTA_RT2_CONFIG_SCHEMA,
  deepFreeze,
  validateAndResolveMagentaRt2Config,
  validateMagentaRt2Config
} from './config.js';
import { MagentaRt2Connection } from './connection.js';
import { cancelledStart, connectorError, safeError } from './errors.js';
import { CHANNELS, FRAMES_PER_PACKET, SAMPLE_RATE } from './protocol.js';
import { type MagentaRt2ConnectorOptions, validateMagentaRt2Options } from './settings.js';
import {
  DEFAULT_DEPENDENCIES,
  type MagentaRt2Dependencies,
  openMagentaRt2SessionWithDependencies
} from './transport.js';

/** Magenta RT2 support levels for each GAS intent. */
export const MAGENTA_RT2_CAPABILITIES: CapabilitiesTable = deepFreeze({
  intents: {
    flavor: 'supported',
    timbre: 'supported',
    // Relative prompt weights, not independent stem gain.
    level: 'approximated',
    // Described in the prompt text; the model has no native key or tempo control.
    key: 'approximated',
    tempo: 'approximated',
    time_signature: 'unsupported',
    notes: 'unsupported',
    motif: 'unsupported'
  }
});

/**
 * What the official connector is. A variant that renders differently uses its
 * own id: `{ ...MAGENTA_RT2_DESCRIPTION, id: 'my-magenta' }`.
 */
export const MAGENTA_RT2_DESCRIPTION: ConnectorDescription = deepFreeze({
  id: 'magenta-rt2',
  displayName: 'Magenta RealTime 2',
  capabilities: MAGENTA_RT2_CAPABILITIES,
  model: {
    connectorId: 'magenta-rt2',
    modelId: 'magenta-rt-2',
    displayName: 'Magenta RealTime 2',
    codec: 'pcm',
    sampleFormat: 's16le',
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    chunkDurationSeconds: FRAMES_PER_PACKET / SAMPLE_RATE
  },
  configSchema: MAGENTA_RT2_CONFIG_SCHEMA,
  defaultConfig: DEFAULT_MAGENTA_RT2_CONFIG
});

/** A Magenta RT2 connector for one bridge. Throws `magenta-rt2-invalid-settings` for bad options. */
export function createMagentaRt2Connector(options: MagentaRt2ConnectorOptions): Connector {
  return createMagentaRt2ConnectorWithDependencies(options, DEFAULT_DEPENDENCIES);
}

/** @internal The test seam. */
export function createMagentaRt2ConnectorWithDependencies(
  options: MagentaRt2ConnectorOptions,
  dependencies: MagentaRt2Dependencies
): Connector {
  const settings = validateMagentaRt2Options(options);

  async function connect(connectOptions: ConnectOptions): Promise<Connection> {
    const { signal } = connectOptions;
    if (signal.aborted) throw cancelledStart();
    const config = validateAndResolveMagentaRt2Config(connectOptions.config);

    // A close can land between the transport resolving and the connection
    // existing; it is held and handed over.
    let connection: MagentaRt2Connection | undefined;
    let earlyClose: ConnectorError | undefined;
    const session = await openMagentaRt2SessionWithDependencies(
      {
        endpoint: settings.endpoint,
        ...(settings.token !== undefined ? { token: settings.token } : {}),
        signal,
        connectTimeoutSeconds: config.connectTimeoutSeconds,
        onAudio: (chunk) => connectOptions.onAudio(chunk),
        onClose: (error) => {
          if (connection === undefined) earlyClose = error;
          else connection.fail(error);
        }
      },
      dependencies
    );

    // The first translation runs the app's hook, so it shares the startup
    // failure path: the socket closes and the hook's error stays private.
    try {
      connection = new MagentaRt2Connection({
        session,
        config,
        timing: connectOptions.timing,
        clock: dependencies.clock,
        ...(settings.translate !== undefined ? { translate: settings.translate } : {}),
        onWarning: (warning) => connectOptions.onWarning(warning),
        onError: (error) => connectOptions.onError(error)
      });
      if (earlyClose !== undefined) connection.fail(earlyClose);
      await connection.start(connectOptions.state, signal);
    } catch (error) {
      void (connection?.close() ?? session.close());
      if (signal.aborted) throw cancelledStart();
      throw safeError(error, connectorError('magenta-rt2-startup-failure', 'internal', false));
    }
    return connection;
  }

  return Object.freeze({
    description: MAGENTA_RT2_DESCRIPTION,
    validateConfig: validateMagentaRt2Config,
    connect
  });
}
