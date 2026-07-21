import type {
  CapabilitiesTable,
  CommandWarning,
  IntentKeyword,
  Timeline
} from '@luna-estelar/gas-protocol';

const INTENT_NOUNS: Readonly<Record<IntentKeyword, string>> = {
  flavor: 'flavor',
  key: 'key changes',
  tempo: 'tempo changes',
  time_signature: 'time signatures',
  timbre: 'timbre',
  level: 'level',
  notes: 'notes',
  motif: 'motifs'
};

export function warningForIntent(
  intent: IntentKeyword,
  capabilities: CapabilitiesTable,
  trackId?: string
): CommandWarning | undefined {
  const support = capabilities.intents[intent];
  if (support === 'supported') return undefined;

  const noun = INTENT_NOUNS[intent];
  return {
    code: 'unsupported-intent',
    intent,
    support,
    ...(trackId !== undefined ? { trackId } : {}),
    message:
      support === 'unsupported'
        ? `This model doesn't support ${noun}; the change is kept, but it may not be heard.`
        : `This model approximates ${noun}; what you hear may not match exactly.`
  };
}

/**
 * Reports model-support warnings for authored intent in a validated timeline.
 * Repeated section instances and repeated changes collapse to one warning per
 * global intent or per track/intent pair, preserving the first scanned
 * occurrence so load results stay deterministic and concise.
 */
export function warningsForTimeline(
  timeline: Timeline,
  capabilities: CapabilitiesTable
): readonly CommandWarning[] {
  const warnings: CommandWarning[] = [];
  const seen = new Set<string>();

  const add = (intent: IntentKeyword, trackId?: string): void => {
    // Global level is Renderer-owned post-render gain, so it never depends on a
    // connector capability. Track level still uses the `level` capability.
    if (intent === 'level' && trackId === undefined) return;
    const key = `${intent}\u0000${trackId ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    const warning = warningForIntent(intent, capabilities, trackId);
    if (warning !== undefined) warnings.push(warning);
  };

  if (timeline.musicalContext?.tempo !== undefined) add('tempo');
  if (timeline.musicalContext?.timeSignature !== undefined) add('time_signature');
  if (timeline.musicalContext?.key !== undefined) add('key');
  if (timeline.globals.flavor !== undefined) add('flavor');

  for (const track of timeline.tracks) {
    for (const entry of track.defaults) add(entry.action, track.trackId);
  }

  for (const event of timeline.events) {
    if (event.type === 'section') {
      add('flavor');
    } else if (event.action !== 'play' && event.action !== 'stop') {
      add(event.action, event.targetId);
    }
  }

  return Object.freeze(warnings);
}
