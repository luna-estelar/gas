import { effectiveLengthBars, resolveSection } from './ast.js';
import type { GasDocument, GasNode, Global, TrackCommand } from './ast.js';
import { informationalDiagnostic, semanticDiagnostic, type GasDiagnostic } from './diagnostics.js';

const GLOBAL_KEYWORDS: Record<Global['kind'], string> = {
  Tempo: 'tempo',
  Key: 'key',
  TimeSignature: 'time_signature',
  Length: 'length',
  Flavor: 'flavor',
  Level: 'level'
};

const COMMAND_KEYWORDS: Record<TrackCommand['kind'], string> = {
  Play: 'play',
  Stop: 'stop',
  Flavor: 'flavor',
  Timbre: 'timbre',
  Level: 'level',
  Notes: 'notes',
  Motif: 'motif'
};

export function validate(document: GasDocument): readonly GasDiagnostic[] {
  const diagnostics: GasDiagnostic[] = [];
  checkMissingLength(document, diagnostics);
  checkDuplicateGlobals(document, diagnostics);
  checkTempoTimeAndLengthValues(document, diagnostics);
  checkLevels(document, diagnostics);
  checkPlayStopPlacement(document, diagnostics);
  checkBars(document, diagnostics);
  checkSectionFlavors(document, diagnostics);
  checkRegionOrder(document, diagnostics);
  checkArrangementLength(document, diagnostics);
  checkLyriaHints(document, diagnostics);
  return diagnostics;
}

function checkMissingLength(document: GasDocument, diagnostics: GasDiagnostic[]): void {
  if (document.globals.length === undefined) {
    diagnostics.push(
      semanticDiagnostic(
        'missing-length',
        'error',
        'Add a length, for example `length bars 16`, `length bars 16 loop`, or `length infinite`.',
        document.range
      )
    );
  }
}

function checkDuplicateGlobals(document: GasDocument, diagnostics: GasDiagnostic[]): void {
  const seen = new Set<Global['kind']>();
  for (const global of document.globals.all) {
    if (seen.has(global.kind)) {
      diagnostics.push(
        semanticDiagnostic(
          'duplicate-global',
          'warning',
          `You already set ${GLOBAL_KEYWORDS[global.kind]}; GAS will use the first value.`,
          global.range
        )
      );
    }
    seen.add(global.kind);
  }
}

function checkTempoTimeAndLengthValues(document: GasDocument, diagnostics: GasDiagnostic[]): void {
  const { tempo, timeSignature, length } = document.globals;
  if (tempo !== undefined && tempo.bpm < 1) {
    diagnostics.push(
      semanticDiagnostic(
        'invalid-tempo',
        'error',
        `Tempo must be at least 1 bpm, got ${tempo.bpm}.`,
        tempo.range
      )
    );
  }
  if (
    timeSignature !== undefined &&
    (timeSignature.numerator < 1 || timeSignature.denominator < 1)
  ) {
    diagnostics.push(
      semanticDiagnostic(
        'invalid-time-signature',
        'error',
        `Time signature must use positive numbers, got ${timeSignature.numerator}/${timeSignature.denominator}.`,
        timeSignature.range
      )
    );
  }

  if (length !== undefined && length.mode !== 'infinite' && (length.bars ?? 0) < 1) {
    diagnostics.push(
      semanticDiagnostic('invalid-length', 'error', 'Length must be at least 1 bar.', length.range)
    );
  }

  for (const section of document.sections) {
    if (section.length !== undefined && section.length.bars < 1) {
      diagnostics.push(
        semanticDiagnostic(
          'invalid-length',
          'error',
          `Section '${section.name}' needs a length of at least 1 bar.`,
          section.length.range
        )
      );
    }
  }
}

function checkLevels(document: GasDocument, diagnostics: GasDiagnostic[]): void {
  if (document.globals.level !== undefined) {
    checkLevelValue(document.globals.level.value, document.globals.level, diagnostics);
  }
  for (const command of allCommands(document)) {
    if (command.kind === 'Level') {
      checkLevelValue(command.value, command, diagnostics);
    }
  }
}

function checkLevelValue(value: number, node: GasNode, diagnostics: GasDiagnostic[]): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    diagnostics.push(
      semanticDiagnostic(
        'invalid-level',
        'error',
        `Level must be between 0 and 1, got ${value}.`,
        node.range
      )
    );
  }
}

function checkPlayStopPlacement(document: GasDocument, diagnostics: GasDiagnostic[]): void {
  for (const command of document.tracks.flatMap((track) => track.defaults)) {
    if (command.kind === 'Play' || command.kind === 'Stop') {
      diagnostics.push(
        semanticDiagnostic(
          'play-stop-not-timed',
          'error',
          `Put ${COMMAND_KEYWORDS[command.kind]} inside a section bar, not at the top level.`,
          command.range
        )
      );
    }
  }

  for (const section of document.sections) {
    const firstBarOrder = section.bars[0]?.sourceOrder;
    if (firstBarOrder === undefined) {
      continue;
    }
    for (const command of section.setup) {
      if (
        (command.kind === 'Play' || command.kind === 'Stop') &&
        command.sourceOrder > firstBarOrder
      ) {
        diagnostics.push(
          semanticDiagnostic(
            'play-stop-after-bar',
            'error',
            `Move ${command.trackName}.${COMMAND_KEYWORDS[command.kind]} before the first bar or put it inside a bar block.`,
            command.range
          )
        );
      }
    }
  }
}

function checkBars(document: GasDocument, diagnostics: GasDiagnostic[]): void {
  for (const section of document.sections) {
    const lengthBars = effectiveLengthBars(section, document.globals);
    let previous: number | undefined;
    for (const bar of section.bars) {
      if (previous !== undefined && bar.number <= previous) {
        diagnostics.push(
          semanticDiagnostic(
            'bar-not-monotonic',
            'error',
            `Bar ${bar.number} must come after bar ${previous} in section '${section.name}'.`,
            bar.range
          )
        );
      }
      previous = bar.number;
      if (bar.number < 1) {
        diagnostics.push(
          semanticDiagnostic(
            'bar-out-of-range',
            'error',
            `Bar numbers start at 1, got ${bar.number}.`,
            bar.range
          )
        );
      } else if (lengthBars !== undefined && bar.number > lengthBars) {
        diagnostics.push(
          semanticDiagnostic(
            'bar-out-of-range',
            'error',
            `Bar ${bar.number} is beyond the ${lengthBars}-bar length of section '${section.name}'.`,
            bar.range
          )
        );
      }
    }
  }
}

function checkSectionFlavors(document: GasDocument, diagnostics: GasDiagnostic[]): void {
  for (const section of document.sections) {
    for (const flavor of section.flavors.slice(1)) {
      diagnostics.push(
        semanticDiagnostic(
          'duplicate-section-flavor',
          'warning',
          `Section '${section.name}' already has a flavor; GAS will use the first one.`,
          flavor.range
        )
      );
    }
  }
}

function checkRegionOrder(document: GasDocument, diagnostics: GasDiagnostic[]): void {
  const regions: Array<{ rank: number; name: string; node: GasNode; label: string }> = [
    ...document.globals.all.map((node) => ({
      rank: 0,
      name: 'globals',
      node,
      label: GLOBAL_KEYWORDS[node.kind]
    })),
    ...document.tracks.map((node) => ({
      rank: 1,
      name: 'tracks',
      node,
      label: `track '${node.name}'`
    })),
    ...document.tracks.flatMap((track) =>
      track.defaults.map((node) => ({
        rank: 1,
        name: 'tracks',
        node,
        label: `${node.trackName}.${COMMAND_KEYWORDS[node.kind]}`
      }))
    ),
    ...document.sections.map((node) => ({
      rank: 2,
      name: 'sections',
      node,
      label: `section '${node.name}'`
    })),
    ...document.arrangement.map((node) => ({
      rank: 3,
      name: 'arrangement',
      node,
      label: `${node.sectionName}()`
    }))
  ];
  regions.sort((a, b) => a.node.sourceOrder - b.node.sourceOrder);

  let maxRank = -1;
  let maxName = '';
  for (const region of regions) {
    if (region.rank < maxRank) {
      diagnostics.push(
        semanticDiagnostic(
          'region-order',
          'warning',
          `${region.label} appears after the ${maxName} region; GAS reads best as globals, tracks, sections, then arrangement.`,
          region.node.range
        )
      );
    } else {
      maxRank = region.rank;
      maxName = region.name;
    }
  }
}

function checkArrangementLength(document: GasDocument, diagnostics: GasDiagnostic[]): void {
  if (document.arrangement.length === 0) {
    diagnostics.push(
      semanticDiagnostic(
        'empty-arrangement',
        'warning',
        'There are no section calls yet, so this document has nothing arranged to play.',
        document.range
      )
    );
    return;
  }

  const declared = document.globals.length;
  if (declared === undefined || declared.mode === 'infinite') {
    return;
  }

  let totalBars = 0;
  for (const call of document.arrangement) {
    const section = resolveSection(document, call);
    const lengthBars = section && effectiveLengthBars(section, document.globals);
    if (lengthBars === undefined) {
      return;
    }
    totalBars += lengthBars;
  }

  if (totalBars !== declared.bars) {
    diagnostics.push(
      semanticDiagnostic(
        'length-mismatch',
        'warning',
        `The arrangement spans ${totalBars} bars, but the document length is ${declared.bars} bars.`,
        declared.range
      )
    );
  }
}

function checkLyriaHints(document: GasDocument, diagnostics: GasDiagnostic[]): void {
  for (const command of allCommands(document)) {
    if (command.kind === 'Notes' || command.kind === 'Motif') {
      diagnostics.push(
        informationalDiagnostic(
          'lyria-unsupported-intent',
          `GAS accepts ${command.trackName}.${COMMAND_KEYWORDS[command.kind]}, but Lyria realtime v1 will warn and drop it.`,
          command.range
        )
      );
    }
  }
}

function allCommands(document: GasDocument): TrackCommand[] {
  return [
    ...document.tracks.flatMap((track) => track.defaults),
    ...document.sections.flatMap((section) => [
      ...section.setup,
      ...section.bars.flatMap((bar) => bar.commands)
    ])
  ];
}
