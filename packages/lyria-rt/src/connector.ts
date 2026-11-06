import type {
  CapabilitiesTable,
  ConnectOptions,
  Connection,
  Connector,
  ConnectorDescription,
  ConnectorError
} from '@luna-estelar/gas/protocol';
import {
  DEFAULT_LYRIA_RT_CONFIG,
  LYRIA_RT_CONFIG_SCHEMA,
  deepFreeze,
  validateAndResolveLyriaRtConfig,
  validateLyriaRtConfig
} from './config.js';
import {
  LYRIA_RT_WARNING_MESSAGE,
  LyriaRtConnection,
  type LyriaRtTranslate
} from './connection.js';
import { LYRIA_RT_MODEL_ID, PCM_CHANNELS, PCM_SAMPLE_RATE } from './constants.js';
import { cancelledStart, connectorError, hostCall, raceAbort, safeError } from './errors.js';
import { translatePrompts } from './prompts.js';
import { type LyriaRtConnectorOptions, resolveApiKey, validateLyriaRtOptions } from './settings.js';
import { createPromptTransition } from './transition.js';
import {
  DEFAULT_DEPENDENCIES,
  type LyriaRtConnectorDependencies,
  openLyriaRtSessionWithDependencies
} from './transport.js';

/** Lyria RealTime support levels for each GAS intent. */
export const LYRIA_RT_CAPABILITIES: CapabilitiesTable = deepFreeze({
  intents: {
    flavor: 'supported',
    key: 'approximated',
    tempo: 'supported',
    time_signature: 'unsupported',
    timbre: 'supported',
    level: 'approximated',
    notes: 'unsupported',
    motif: 'unsupported'
  }
});

/**
 * What the official connector is. A variant that renders differently uses its
 * own id: `{ ...LYRIA_RT_DESCRIPTION, id: 'my-lyria' }`.
 */
export const LYRIA_RT_DESCRIPTION: ConnectorDescription = deepFreeze({
  id: 'lyria-rt',
  displayName: 'Lyria RealTime',
  capabilities: LYRIA_RT_CAPABILITIES,
  model: {
    connectorId: 'lyria-rt',
    modelId: LYRIA_RT_MODEL_ID,
    displayName: 'Lyria RealTime',
    codec: 'pcm',
    sampleFormat: 's16le',
    sampleRate: PCM_SAMPLE_RATE,
    channels: PCM_CHANNELS,
    chunkDurationSeconds: 2,
    startupDelaySeconds: 1.2,
    initialStartupDelaySeconds: 5.4
  },
  configSchema: LYRIA_RT_CONFIG_SCHEMA,
  defaultConfig: DEFAULT_LYRIA_RT_CONFIG
});

const defaultTranslate: LyriaRtTranslate = (state, config) =>
  translatePrompts(state, config.prompt);

/** A Lyria RealTime connector. Throws `lyria-rt-invalid-settings` for bad options. */
export function createLyriaRtConnector(options: LyriaRtConnectorOptions): Connector {
  return createLyriaRtConnectorWithDependencies(options, DEFAULT_DEPENDENCIES);
}

/** @internal The test seam. */
export function createLyriaRtConnectorWithDependencies(
  options: LyriaRtConnectorOptions,
  dependencies: LyriaRtConnectorDependencies
): Connector {
  const settings = validateLyriaRtOptions(options);
  const translate = settings.translate ?? defaultTranslate;
  const transition = settings.transition ?? createPromptTransition;

  async function connect(connectOptions: ConnectOptions): Promise<Connection> {
    const { signal } = connectOptions;
    if (signal.aborted) throw cancelledStart();
    const config = validateAndResolveLyriaRtConfig(connectOptions.config);
    const apiKey = await raceAbort(signal, resolveApiKey(settings.apiKey));

    // A close can land between the transport resolving and the connection
    // existing; it is held and handed over.
    let connection: LyriaRtConnection | undefined;
    let earlyClose: ConnectorError | undefined;
    const session = await openLyriaRtSessionWithDependencies(
      {
        apiKey,
        ...(settings.endpoint !== undefined ? { endpoint: settings.endpoint } : {}),
        signal,
        onAudio: (chunk) => connectOptions.onAudio(chunk),
        onWarning: (code) =>
          hostCall(() => connectOptions.onWarning({ code, message: LYRIA_RT_WARNING_MESSAGE })),
        onClose: (error) => {
          if (connection === undefined) earlyClose = error;
          else connection.fail(error);
        }
      },
      dependencies
    );

    // Building the connection runs the app's transition hook, so it shares the
    // startup failure path: the socket closes and the hook's error stays private.
    try {
      connection = new LyriaRtConnection({
        session,
        config,
        timing: connectOptions.timing,
        clock: dependencies.clock,
        translate,
        transition,
        onWarning: (warning) => connectOptions.onWarning(warning),
        onError: (error) => connectOptions.onError(error)
      });
      if (earlyClose !== undefined) connection.fail(earlyClose);
      await connection.start(connectOptions.state, signal);
    } catch (error) {
      void (connection?.close() ?? session.close());
      if (signal.aborted) throw cancelledStart();
      throw safeError(error, connectorError('lyria-rt-startup-failure', 'internal', false));
    }
    return connection;
  }

  return Object.freeze({
    description: LYRIA_RT_DESCRIPTION,
    validateConfig: validateLyriaRtConfig,
    connect
  });
}
