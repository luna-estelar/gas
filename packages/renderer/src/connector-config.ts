import { Ajv2020, type ErrorObject, type SchemaObject } from 'ajv/dist/2020.js';
import addFormatsImport, { type FormatsPlugin } from 'ajv-formats';
import type { ConnectorConfigSchema, JsonObject, JsonValue } from '@luna-estelar/gas-protocol';

// Node exposes the CJS module.exports as the default import, while NodeNext
// models that binding as the module namespace. Keep the runtime value intact
// and narrow only its type to the package's callable plugin interface.
const addFormats = addFormatsImport as unknown as FormatsPlugin;

/**
 * Raised when a value that must be plain JSON contains something that JSON
 * cannot represent (`undefined`, functions, symbols, non-finite numbers, class
 * instances, symbol keys, or a cycle). The offending location is reported as a
 * JSON-Pointer-style path so a caller can find it in their own input; it is
 * never derived from connector or vendor text.
 */
export class NonJsonValueError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`The value at "${path === '' ? '/' : path}" is not plain JSON.`);
    this.name = 'NonJsonValueError';
    this.path = path === '' ? '/' : path;
  }
}

export interface SanitizedSchemaProblem {
  readonly instancePath: string;
  readonly schemaPath: string;
  readonly keyword: string;
  readonly message: string;
  readonly params: JsonObject;
}

export interface ConfigValidator {
  /** An empty array means valid. Returned problems are deeply frozen. */
  validate(candidate: JsonObject): readonly SanitizedSchemaProblem[];
}

export function isPlainJsonObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Deep-clones a JSON object graph, rejecting any non-JSON value rather than dropping it. */
export function cloneJsonObject(value: JsonObject): JsonObject {
  return cloneJsonValue(value, '', new Set()) as JsonObject;
}

function cloneJsonValue(value: unknown, path: string, stack: Set<object>): JsonValue {
  if (value === null) return null;
  const kind = typeof value;
  if (kind === 'string' || kind === 'boolean') return value as JsonValue;
  if (kind === 'number') {
    if (!Number.isFinite(value)) throw new NonJsonValueError(path);
    return value as number;
  }
  if (kind !== 'object') throw new NonJsonValueError(path);
  const container = value as object;
  if (stack.has(container)) throw new NonJsonValueError(path);
  if (Array.isArray(container)) {
    stack.add(container);
    const cloned = container.map((entry, index) =>
      cloneJsonValue(entry, `${path}/${index}`, stack)
    );
    stack.delete(container);
    return cloned;
  }
  const proto = Object.getPrototypeOf(container);
  if (proto !== Object.prototype && proto !== null) throw new NonJsonValueError(path);
  if (Object.getOwnPropertySymbols(container).length > 0) throw new NonJsonValueError(path);
  stack.add(container);
  const result: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(container)) {
    result[key] = cloneJsonValue(entry, `${path}/${key}`, stack);
  }
  stack.delete(container);
  return result;
}

/**
 * RFC 7386 JSON Merge Patch. Objects recurse, arrays and primitives replace, and
 * `null` deletes a member. Pure: neither input is mutated. Unmodified subtrees may
 * be shared with the inputs, so callers deep-freeze the result before storing it.
 */
export function applyMergePatch(base: JsonObject, patch: JsonObject): JsonObject {
  const result: Record<string, JsonValue> = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === null) {
      delete result[key];
    } else if (isPlainJsonObject(patchValue) && isPlainJsonObject(result[key])) {
      result[key] = applyMergePatch(result[key], patchValue);
    } else {
      result[key] = patchValue;
    }
  }
  return result;
}

/**
 * Compiles a connector's advertised config schema with the repo-canonical
 * Draft 2020-12 setup. Any failure (non-JSON schema, invalid schema, or an async
 * schema) throws; callers treat every throw as a connector contract failure and
 * never surface the schema text.
 */
export function compileConfigSchema(schema: ConnectorConfigSchema): ConfigValidator {
  const schemaClone = cloneJsonObject(schema);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schemaClone as SchemaObject);
  if ((validate as { $async?: boolean }).$async === true) {
    throw new Error('Async connector configuration schemas are not supported.');
  }
  return {
    validate(candidate: JsonObject): readonly SanitizedSchemaProblem[] {
      if (validate(candidate)) return Object.freeze([]);
      const problems = (validate.errors ?? []).map(sanitizeProblem);
      return Object.freeze(problems);
    }
  };
}

function sanitizeProblem(error: ErrorObject): SanitizedSchemaProblem {
  return Object.freeze({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? '',
    params: freezeJson(cloneParams(error.params))
  });
}

function cloneParams(params: unknown): JsonObject {
  if (!isPlainJsonObject(params)) return {};
  try {
    return cloneJsonObject(params);
  } catch {
    return {};
  }
}

/** Deep-clones and deep-freezes a JSON object graph. */
export function freezeJson<T extends JsonObject>(value: T): T {
  return freezeJsonValue(value) as T;
}

function freezeJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => freezeJsonValue(entry)));
  }
  if (value !== null && typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeJsonValue(entry)]))
    );
  }
  return value;
}
