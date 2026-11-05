---
'@luna-estelar/gas': minor
---

GAS owns the connection lifecycle, and the session is the only public object.

- `createSession({ connector, clock?, documentDefaults?, connectorConfig? })` builds everything.
  The renderer is internal: `createRenderer`, `session.renderer`, `RendererControl`,
  `SessionWiring` and `retryRenderer()` are gone.
- Each Play opens a new connection. Play resolves once it is open, rejects with `provider` if it
  can't open, and rejects with `cancelled` if Stop or Close came first. Stop and Close return at
  once.
- A failure during playback emits one `error` and leaves the session stopped. Play works again
  on the same session.
- `getState()` is `{ status, loaded, ended?, tracks, appValues }`, and one `state` event reports
  every change. The events are `state`, `generationPosition`, `audio`, `warning` and `error`.
  `lifecycle`, `position` and `diagnostic` are gone, and no payload carries a `runId`.
- While no track plays, GAS writes silence and musical time keeps going. It pauses the model
  during a rest and resumes it, with the next track's update, one chunk plus the model's start-up
  delay before that track comes in. A rest too short to be worth it doesn't pause the model.
- New session methods: `getCapabilities`, `getModelInfo`, `getConnectorConfig`,
  `updateConnectorConfig`, `getConfigSchema`, `getDocumentDefaults`, `updateDocumentDefaults` and
  `setConnector`.
- The `Legacy*` connector types are removed. `createBrowserSession` takes a `Connector`, with no
  factory, `settings` or `renderer` option.
- `diagnostics.schema.json` no longer defines `RendererWarning` or `RendererFailure`. The
  `session`, `renderer` and `state` schemas are no longer published. The data schemas stay at 1.0.
- `OverrideCommand` is `AppValueCommand`, and `Override` is `AppValue`. The schema def in
  `commands.schema.json` is renamed to match.
- `PlaybackWarning` is `PlayWarning`.
- `submitLiveCommands` returns `SubmitLiveCommandsResult`, which is `CommandResult` plus
  `applied`. `LiveCommandSuccess`, `LiveCommandResult` and its `ok` field are gone.
- `ConnectorSettings` and `ConnectorAudioChunk.final` are removed.
