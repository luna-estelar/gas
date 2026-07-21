// Timeline shape and reference validation, used at load time (API `loadTimeline`).
// Protocol's canonical JSON Schema is the structural gate. Core then adds the
// referential and musical invariants JSON Schema cannot express, rejecting
// hand-authored, persisted, or foreign timelines before a session is built.
// Every problem carries a musician-friendly message.
//
// This is a structural and referential gate, not a musical-quality check: it does
// not, for example, reject a `declaredBars` that differs from the arranged span
// (the language treats that as a non-fatal warning), so it accepts every timeline
// the compiler can produce. The input is typed `unknown` because a load-time
// timeline may be hand-authored or persisted, not freshly compiled.

import type {
  TimelineProblem,
  TimelineProblemCode,
  ValidateTimelineResult
} from '@luna-estelar/gas-protocol';
import {
  validateTimelinePayload,
  type ProtocolValidationIssue
} from '@luna-estelar/gas-protocol/validation';

export type {
  TimelineProblem,
  TimelineProblemCode,
  ValidateTimelineResult
} from '@luna-estelar/gas-protocol';

export function validateTimeline(timeline: unknown): ValidateTimelineResult {
  const problems: TimelineProblem[] = [];

  if (!isObject(timeline)) {
    return fail(problems, 'invalid-shape', 'This timeline is not an object.');
  }

  const structural = validateTimelinePayload(timeline);
  if (!structural.ok) {
    return { ok: false, problems: schemaProblems(structural.issues, timeline) };
  }

  requireNonEmptyString(timeline.timelineId, 'timelineId', problems);
  requireNonEmptyString(timeline.languageVersion, 'languageVersion', problems);
  requireNonEmptyString(timeline.compilerVersion, 'compilerVersion', problems);
  if (!isObject(timeline.source)) {
    problems.push(shape('The timeline is missing its source identity.'));
  }

  validatePlayback(timeline.playback, problems);
  const arrangedBars = validateArrangedBars(timeline.arrangedBars, problems);
  validateMusicalContext(timeline.musicalContext, problems);
  validateGlobals(timeline.globals, problems);

  const resourceIds = collectResources(timeline.resources, problems);
  const trackIds = collectTracks(timeline.tracks, resourceIds, problems);
  const spans = collectArrangement(timeline.arrangement, problems);
  validateEvents(
    timeline.events,
    { trackIds, instanceIds: spans.ids, resourceIds, arrangedBars },
    problems
  );
  validateContiguity(spans, arrangedBars, problems);

  return { ok: problems.length === 0, problems };
}

// --- Top-level fields ---------------------------------------------------------

function schemaProblems(
  issues: readonly ProtocolValidationIssue[],
  timeline: Record<string, unknown>
): readonly TimelineProblem[] {
  const version = timeline.formatVersion;
  if (
    issues.some((issue) => issue.instancePath.startsWith('/formatVersion')) &&
    isObject(version) &&
    isNonNegativeInteger(version.major) &&
    isNonNegativeInteger(version.minor) &&
    (version.major !== 1 || version.minor !== 0)
  ) {
    return [
      {
        code: 'unsupported-format-version',
        message: `This timeline is format version ${describeVersion(version)}, but this version of GAS understands 1.0 timelines.`
      }
    ];
  }

  if (issues.some((issue) => issue.instancePath.startsWith('/playback'))) {
    return [
      {
        code: 'invalid-playback',
        message: 'The timeline playback value does not match the protocol 1.0 playback shape.'
      }
    ];
  }

  if (issues.some((issue) => isLevelSchemaIssue(issue, timeline))) {
    return [
      {
        code: 'invalid-level',
        message: 'A timeline level value is invalid; levels run from 0 to 1.'
      }
    ];
  }

  const issue =
    [...issues]
      .filter((candidate) => !['oneOf', 'if', 'then'].includes(candidate.keyword))
      .sort((left, right) => right.instancePath.length - left.instancePath.length)[0] ?? issues[0];
  const location = issue?.instancePath === '' || issue === undefined ? '/' : issue.instancePath;
  const detail =
    issue?.message === undefined || issue.message === '' ? 'the value is invalid' : issue.message;
  return [
    {
      code: 'invalid-shape',
      message: `The timeline does not match protocol 1.0 at "${location}": ${detail}.`
    }
  ];
}

function isLevelSchemaIssue(
  issue: ProtocolValidationIssue,
  timeline: Record<string, unknown>
): boolean {
  const candidates = [issue.instancePath, issue.instancePath.replace(/\/value$/, '')];
  return candidates.some((pointer) => {
    const value = valueAtPointer(timeline, pointer);
    return isObject(value) && value.kind === 'level';
  });
}

function valueAtPointer(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  let value = root;
  for (const encoded of pointer.slice(1).split('/')) {
    if (!isObject(value) && !Array.isArray(value)) return undefined;
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function validatePlayback(value: unknown, problems: TimelineProblem[]): void {
  if (!isObject(value)) {
    problems.push(shape('The timeline is missing its playback mode.'));
    return;
  }
  switch (value.mode) {
    case 'finite':
    case 'loop':
      if (!isPositiveInteger(value.declaredBars)) {
        problems.push({
          code: 'invalid-playback',
          message: `A ${value.mode} piece needs a length of at least 1 bar.`
        });
      }
      return;
    case 'infinite':
      return;
    default:
      problems.push(
        shape(`The playback mode "${String(value.mode)}" is not one of finite, loop, or infinite.`)
      );
  }
}

function validateArrangedBars(value: unknown, problems: TimelineProblem[]): number | undefined {
  if (!isNonNegativeInteger(value)) {
    problems.push(shape('The timeline needs a whole-number arranged length.'));
    return undefined;
  }
  return value;
}

function validateMusicalContext(value: unknown, problems: TimelineProblem[]): void {
  if (value === undefined) {
    return;
  }
  if (!isObject(value)) {
    problems.push(
      shape('The musical context must be a set of tempo, time signature, and key values.')
    );
    return;
  }
  if (value.tempo !== undefined && !(isFiniteNumber(value.tempo) && value.tempo > 0)) {
    problems.push(shape('The tempo must be a number greater than 0.'));
  }
  if (value.timeSignature !== undefined) {
    const ts = value.timeSignature;
    if (!isObject(ts) || !isPositiveInteger(ts.beatsPerBar) || !isPositiveInteger(ts.beatUnit)) {
      problems.push(
        shape('The time signature needs positive beats-per-bar and beat-unit numbers.')
      );
    }
  }
  if (value.key !== undefined && !isNonEmptyString(value.key)) {
    problems.push(shape('The key must be a non-empty name, for example "A minor".'));
  }
}

function validateGlobals(value: unknown, problems: TimelineProblem[]): void {
  if (!isObject(value)) {
    problems.push(shape('The timeline is missing its global defaults.'));
    return;
  }
  if (value.flavor !== undefined) {
    validateIntentValue(value.flavor, 'the global flavor', new Set(), problems);
  }
  if (value.level !== undefined) {
    validateIntentValue(value.level, 'the global level', new Set(), problems);
  }
}

// --- Collections --------------------------------------------------------------

function collectResources(value: unknown, problems: TimelineProblem[]): Set<string> {
  const ids = new Set<string>();
  if (!isArray(value)) {
    problems.push(shape('The timeline is missing its resource manifest.'));
    return ids;
  }
  value.forEach((resource, index) => {
    if (!isObject(resource)) {
      problems.push(shape(`Resource #${index + 1} must be an object.`));
      return;
    }
    if (!isNonEmptyString(resource.resourceId)) {
      problems.push(shape(`Resource #${index + 1} needs a resource id.`));
      return;
    }
    registerId(resource.resourceId, ids, `resource "${resource.resourceId}"`, problems);
  });
  return ids;
}

function collectTracks(
  value: unknown,
  resourceIds: ReadonlySet<string>,
  problems: TimelineProblem[]
): Set<string> {
  const ids = new Set<string>();
  if (!isArray(value)) {
    problems.push(shape('The timeline is missing its track list.'));
    return ids;
  }
  value.forEach((track, index) => {
    if (!isObject(track)) {
      problems.push(shape(`Track #${index + 1} must be an object.`));
      return;
    }
    const label = isNonEmptyString(track.trackId)
      ? `track "${track.trackId}"`
      : `track #${index + 1}`;
    if (!isNonEmptyString(track.trackId)) {
      problems.push(shape(`Track #${index + 1} needs a track id.`));
    } else {
      registerId(track.trackId, ids, label, problems);
    }
    if (!isNonEmptyString(track.name)) {
      problems.push(shape(`${label} needs a name.`));
    }
    if (typeof track.description !== 'string') {
      problems.push(shape(`${label} needs a description.`));
    }
    validateTrackDefaults(track.defaults, label, resourceIds, problems);
  });
  return ids;
}

function validateTrackDefaults(
  value: unknown,
  trackLabel: string,
  resourceIds: ReadonlySet<string>,
  problems: TimelineProblem[]
): void {
  if (!isArray(value)) {
    problems.push(shape(`${trackLabel} needs a list of defaults.`));
    return;
  }
  for (const def of value) {
    if (!isObject(def)) {
      problems.push(shape(`${trackLabel} has a default that is not an object.`));
      continue;
    }
    validateIntentValue(def.value, `a default on ${trackLabel}`, resourceIds, problems);
  }
}

interface ArrangementSpans {
  readonly ids: Set<string>;
  // Instances with well-formed start/end bars, in document order. Contiguity runs
  // only when every instance parsed cleanly, so shape errors are not doubled up.
  readonly instances: ReadonlyArray<{
    readonly name: string;
    readonly start: number;
    readonly end: number;
  }>;
  readonly complete: boolean;
}

function collectArrangement(value: unknown, problems: TimelineProblem[]): ArrangementSpans {
  const ids = new Set<string>();
  const instances: Array<{ name: string; start: number; end: number }> = [];
  if (!isArray(value)) {
    problems.push(shape('The timeline is missing its arrangement.'));
    return { ids, instances, complete: false };
  }
  let complete = true;
  value.forEach((instance, index) => {
    if (!isObject(instance)) {
      problems.push(shape(`Arrangement instance #${index + 1} must be an object.`));
      complete = false;
      return;
    }
    const label = isNonEmptyString(instance.sectionInstanceId)
      ? `section instance "${instance.sectionInstanceId}"`
      : `arrangement instance #${index + 1}`;
    if (!isNonEmptyString(instance.sectionInstanceId)) {
      problems.push(shape(`Arrangement instance #${index + 1} needs a section instance id.`));
    } else {
      registerId(instance.sectionInstanceId, ids, label, problems);
    }
    if (!isNonEmptyString(instance.sectionName)) {
      problems.push(shape(`${label} needs a section name.`));
    }
    if (!isNonNegativeInteger(instance.callIndex)) {
      problems.push(shape(`${label} needs a whole-number call index.`));
    }
    const start = positionBar(instance.start);
    const end = positionBar(instance.end);
    if (start === undefined || end === undefined) {
      problems.push(shape(`${label} needs start and end bar positions.`));
      complete = false;
      return;
    }
    const name = isNonEmptyString(instance.sectionName) ? instance.sectionName : label;
    instances.push({ name, start, end });
  });
  return { ids, instances, complete };
}

interface EventContext {
  readonly trackIds: ReadonlySet<string>;
  readonly instanceIds: ReadonlySet<string>;
  readonly resourceIds: ReadonlySet<string>;
  readonly arrangedBars: number | undefined;
}

function validateEvents(value: unknown, ctx: EventContext, problems: TimelineProblem[]): void {
  if (!isArray(value)) {
    problems.push(shape('The timeline is missing its event list.'));
    return;
  }
  const ids = new Set<string>();
  value.forEach((event, index) => {
    if (!isObject(event)) {
      problems.push(shape(`Event #${index + 1} must be an object.`));
      return;
    }
    const label = isNonEmptyString(event.eventId)
      ? `event "${event.eventId}"`
      : `event #${index + 1}`;
    if (!isNonEmptyString(event.eventId)) {
      problems.push(shape(`Event #${index + 1} needs an event id.`));
    } else {
      registerId(event.eventId, ids, label, problems);
    }
    if (!isNonEmptyString(event.targetId)) {
      problems.push(shape(`${label} needs a target id.`));
    }
    if (!isNonNegativeInteger(event.sequence)) {
      problems.push(shape(`${label} needs a whole-number sequence.`));
    }
    validateEventPosition(event.position, label, ctx.arrangedBars, problems);
    validateEventReferences(event, label, ctx, problems);
  });
}

function validateEventReferences(
  event: Record<string, unknown>,
  label: string,
  ctx: EventContext,
  problems: TimelineProblem[]
): void {
  const targetId = event.targetId;
  if (event.type === 'track') {
    if (isNonEmptyString(targetId) && !ctx.trackIds.has(targetId)) {
      problems.push(reference(`${label} plays a track "${targetId}" that is not declared.`));
    }
    if (event.sectionInstanceId !== undefined && !instanceKnown(event.sectionInstanceId, ctx)) {
      problems.push(
        reference(
          `${label} is scoped to section instance "${String(event.sectionInstanceId)}", which is not in the arrangement.`
        )
      );
    }
    if (event.value !== undefined) {
      validateIntentValue(event.value, label, ctx.resourceIds, problems);
    }
  } else if (event.type === 'section') {
    if (isNonEmptyString(targetId) && !ctx.instanceIds.has(targetId)) {
      problems.push(
        reference(
          `${label} targets section instance "${targetId}", which is not in the arrangement.`
        )
      );
    }
    if (!instanceKnown(event.sectionInstanceId, ctx)) {
      problems.push(
        reference(
          `${label} is scoped to section instance "${String(event.sectionInstanceId)}", which is not in the arrangement.`
        )
      );
    }
    validateIntentValue(event.value, label, ctx.resourceIds, problems);
  } else {
    problems.push(shape(`${label} has an unknown type "${String(event.type)}".`));
  }
}

function instanceKnown(sectionInstanceId: unknown, ctx: EventContext): boolean {
  return isNonEmptyString(sectionInstanceId) && ctx.instanceIds.has(sectionInstanceId);
}

function validateEventPosition(
  position: unknown,
  label: string,
  arrangedBars: number | undefined,
  problems: TimelineProblem[]
): void {
  const bar = positionBar(position);
  if (bar === undefined) {
    problems.push(shape(`${label} needs a bar position of at least 1.`));
    return;
  }
  if (arrangedBars !== undefined && bar > arrangedBars) {
    problems.push({
      code: 'position-out-of-range',
      message: `${label} is placed at bar ${bar}, past the arranged length of ${arrangedBars} bars.`
    });
  }
}

// --- Arrangement contiguity ---------------------------------------------------

function validateContiguity(
  spans: ArrangementSpans,
  arrangedBars: number | undefined,
  problems: TimelineProblem[]
): void {
  if (!spans.complete || arrangedBars === undefined) {
    return; // shape problems already reported; do not pile on.
  }
  const ordered = [...spans.instances].sort((a, b) => a.start - b.start);
  if (ordered.length === 0) {
    if (arrangedBars !== 0) {
      problems.push({
        code: 'arrangement-not-contiguous',
        message: `The arrangement is empty, so the arranged length should be 0 bars, not ${arrangedBars}.`
      });
    }
    return;
  }

  if (ordered[0].start !== 1) {
    problems.push({
      code: 'arrangement-not-contiguous',
      message: `The arrangement must start at bar 1, but its first section starts at bar ${ordered[0].start}.`
    });
  }

  let expectedStart = ordered[0].start;
  for (const instance of ordered) {
    if (instance.end <= instance.start) {
      problems.push({
        code: 'arrangement-not-contiguous',
        message: `Section "${instance.name}" ends at bar ${instance.end}, which is not after its start at bar ${instance.start}.`
      });
      return;
    }
    if (instance.start !== expectedStart) {
      problems.push({
        code: 'arrangement-not-contiguous',
        message: `The arrangement has a gap or overlap: section "${instance.name}" starts at bar ${instance.start} but bar ${expectedStart} was expected.`
      });
      return;
    }
    expectedStart = instance.end;
  }

  // `end` is exclusive, so the last section ends one bar past the arranged length.
  if (expectedStart !== arrangedBars + 1) {
    problems.push({
      code: 'arrangement-not-contiguous',
      message: `The arrangement spans ${expectedStart - 1} bars, but the arranged length is ${arrangedBars} bars.`
    });
  }
}

// --- Intent values ------------------------------------------------------------

function validateIntentValue(
  value: unknown,
  where: string,
  resourceIds: ReadonlySet<string>,
  problems: TimelineProblem[]
): void {
  if (!isObject(value)) {
    problems.push(shape(`The value for ${where} is missing.`));
    return;
  }
  switch (value.kind) {
    case 'text':
      if (typeof value.text !== 'string') {
        problems.push(shape(`The text value for ${where} is missing its text.`));
      }
      return;
    case 'alda':
      if (typeof value.source !== 'string') {
        problems.push(shape(`The notation value for ${where} is missing its source.`));
      }
      return;
    case 'level':
      if (!(isFiniteNumber(value.value) && value.value >= 0 && value.value <= 1)) {
        problems.push({
          code: 'invalid-level',
          message: `The level for ${where} is ${describeNumber(value.value)}, but levels run from 0 to 1.`
        });
      }
      return;
    case 'resource':
      if (!isNonEmptyString(value.resourceId)) {
        problems.push(shape(`The resource value for ${where} is missing its resource id.`));
      } else if (!resourceIds.has(value.resourceId)) {
        problems.push(
          reference(
            `The value for ${where} refers to resource "${value.resourceId}", which is not in the manifest.`
          )
        );
      }
      return;
    default:
      problems.push(shape(`The value for ${where} has an unknown kind "${String(value.kind)}".`));
  }
}

// --- Helpers ------------------------------------------------------------------

function registerId(
  id: string,
  seen: Set<string>,
  label: string,
  problems: TimelineProblem[]
): void {
  if (seen.has(id)) {
    problems.push({
      code: 'duplicate-id',
      message: `The id "${id}" is used by more than one ${idKind(label)}; each needs a unique id.`
    });
    return;
  }
  seen.add(id);
}

function idKind(label: string): string {
  return label.replace(/\s+".*$/, '');
}

function positionBar(position: unknown): number | undefined {
  if (!isObject(position)) {
    return undefined;
  }
  return isPositiveInteger(position.bar) ? position.bar : undefined;
}

function requireNonEmptyString(value: unknown, field: string, problems: TimelineProblem[]): void {
  if (!isNonEmptyString(value)) {
    problems.push(shape(`The timeline needs a non-empty ${field}.`));
  }
}

function shape(message: string): TimelineProblem {
  return { code: 'invalid-shape', message };
}

function reference(message: string): TimelineProblem {
  return { code: 'unresolved-reference', message };
}

function fail(
  problems: TimelineProblem[],
  code: TimelineProblemCode,
  message: string
): ValidateTimelineResult {
  problems.push({ code, message });
  return { ok: false, problems };
}

function describeVersion(value: Record<string, unknown>): string {
  const major = typeof value.major === 'number' ? value.major : '?';
  const minor = typeof value.minor === 'number' ? value.minor : '?';
  return `${major}.${minor}`;
}

function describeNumber(value: unknown): string {
  return typeof value === 'number' ? String(value) : 'not a number';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}
