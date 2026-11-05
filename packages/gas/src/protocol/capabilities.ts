// How well a model supports each intent. Core warns from it, and the connector
// reports it. An unsupported intent stays in session state.
export type IntentSupport = 'supported' | 'approximated' | 'unsupported';

// Every intent keyword Core can warn about: the global musical context
// (`key`, `tempo`, `time_signature`), global/track `flavor` and `level`, and the
// track-only `timbre`, `notes`, and `motif`.
export type IntentKeyword =
  'flavor' | 'key' | 'tempo' | 'time_signature' | 'timbre' | 'level' | 'notes' | 'motif';

export interface CapabilitiesTable {
  readonly intents: Readonly<Record<IntentKeyword, IntentSupport>>;
}
