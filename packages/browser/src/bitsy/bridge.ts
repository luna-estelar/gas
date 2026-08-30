import type {
  BitsyBridgeMessage,
  BitsyEventName,
  GameSnapshot,
  InventoryEntry,
  NamedEntity
} from './types.js';

const eventNames = new Set<BitsyEventName>([
  'room-enter',
  'inventory-change',
  'dialog-start',
  'dialog-end',
  'variable-change',
  'game-ready'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNamedEntity(value: unknown): value is NamedEntity {
  return isRecord(value) && isNullableString(value.id) && isNullableString(value.name);
}

function isInventoryEntry(value: unknown): value is InventoryEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isNullableString(value.name) &&
    typeof value.count === 'number' &&
    Number.isFinite(value.count)
  );
}

function isVariables(value: unknown): value is GameSnapshot['variables'] {
  if (!isRecord(value)) return false;
  return Object.values(value).every(
    (entry) =>
      entry === null ||
      typeof entry === 'string' ||
      typeof entry === 'boolean' ||
      (typeof entry === 'number' && Number.isFinite(entry))
  );
}

function isVariableValue(value: unknown): value is GameSnapshot['variables'][string] {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function isEventDetail(event: BitsyEventName, detail: unknown): boolean {
  if (
    event === 'room-enter' ||
    event === 'game-ready' ||
    event === 'dialog-start' ||
    event === 'dialog-end'
  ) {
    return isNamedEntity(detail);
  }
  if (event === 'inventory-change') {
    return (
      isRecord(detail) &&
      typeof detail.id === 'string' &&
      isNullableString(detail.name) &&
      typeof detail.count === 'number' &&
      Number.isFinite(detail.count)
    );
  }
  return isRecord(detail) && typeof detail.name === 'string' && isVariableValue(detail.value);
}

export function parseBitsyBridgeMessage(value: unknown): BitsyBridgeMessage | undefined {
  if (!isRecord(value)) return undefined;
  if (value.source !== 'gas-bitsy' || value.version !== 1) return undefined;
  if (typeof value.event !== 'string' || !eventNames.has(value.event as BitsyEventName)) {
    return undefined;
  }
  const event = value.event as BitsyEventName;
  if (!isNamedEntity(value.room)) return undefined;
  if (!Array.isArray(value.inventory) || !value.inventory.every(isInventoryEntry)) return undefined;
  if (!isVariables(value.variables)) return undefined;
  if (!isEventDetail(event, value.detail)) return undefined;
  return value as unknown as BitsyBridgeMessage;
}

/**
 * Match the sending iframe by contentWindow. Sandboxed frames can have a null
 * origin, so origin comparison cannot identify them. Validate the payload
 * separately with parseBitsyBridgeMessage.
 */
export function isFrameMessage(
  event: { readonly source: unknown },
  frame: { readonly contentWindow: unknown } | null | undefined
): boolean {
  if (frame === null || frame === undefined) return false;
  // A closed or not-yet-loaded iframe has a null contentWindow, and an event
  // from a closed window has a null source; matching those to each other would
  // accept anything.
  if (frame.contentWindow === null || frame.contentWindow === undefined) return false;
  return event.source === frame.contentWindow;
}

export function emptyGameSnapshot(): GameSnapshot {
  return { room: { id: null, name: null }, inventory: [], variables: {} };
}

export function snapshotFrom(message: BitsyBridgeMessage): GameSnapshot {
  return {
    room: message.room,
    inventory: message.inventory,
    variables: message.variables
  };
}

export function inventoryCount(snapshot: GameSnapshot, name: string): number {
  const target = name.toLowerCase();
  return snapshot.inventory.find((entry) => entry.name?.toLowerCase() === target)?.count ?? 0;
}

export function entityName(detail: unknown): string | undefined {
  if (!isRecord(detail) || typeof detail.name !== 'string') return undefined;
  return detail.name.toLowerCase();
}
