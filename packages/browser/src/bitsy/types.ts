import type { GasDiagnostic, HighlightToken, SymbolOccurrence } from '@luna-estelar/gas-language';

export const beatIds = [
  'room-andromeda',
  'failed-crossing',
  'room-milky-way',
  'martian-dialog',
  'room-kuiper-west',
  'room-kuiper-east',
  'room-galle',
  'coconut-pickup'
] as const;

export type BeatId = (typeof beatIds)[number];

export interface NamedEntity {
  readonly id: string | null;
  readonly name: string | null;
}

export interface InventoryEntry extends NamedEntity {
  readonly id: string;
  readonly count: number;
}

export interface GameSnapshot {
  readonly room: NamedEntity;
  readonly inventory: readonly InventoryEntry[];
  readonly variables: Readonly<Record<string, string | number | boolean | null>>;
}

export type BitsyEventName =
  | 'room-enter'
  | 'inventory-change'
  | 'dialog-start'
  | 'dialog-end'
  | 'variable-change'
  | 'game-ready';

export interface BitsyBridgeMessage extends GameSnapshot {
  readonly source: 'gas-bitsy';
  readonly version: 1;
  readonly event: BitsyEventName;
  readonly detail: unknown;
}

export interface SnippetDefinition {
  readonly id: BeatId;
  readonly label: string;
  readonly description: string;
  readonly defaultSource: string;
}

export interface SnippetAnalysis {
  readonly valid: boolean;
  readonly diagnostics: readonly GasDiagnostic[];
  readonly tokens: readonly HighlightToken[];
  readonly symbols: readonly SymbolOccurrence[];
}

export type TraceStatus = 'pending' | 'applied' | 'warning' | 'error' | 'skipped';

export interface TraceEntry {
  readonly id: number;
  readonly createdAt: number;
  readonly event: string;
  readonly operation: string;
  readonly status: TraceStatus;
  readonly detail?: string;
}

export type DemoStatus = 'silent' | 'connecting' | 'active' | 'stopped' | 'failed';

export interface DemoState {
  readonly status: DemoStatus;
  readonly retryAvailable: boolean;
  readonly snapshot: GameSnapshot;
  readonly selectedBeat: BeatId;
  readonly traces: readonly TraceEntry[];
  readonly runId?: string;
  readonly error?: { readonly reason?: string; readonly message: string };
}
