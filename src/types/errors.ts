/**
 * Shared base error shape for the data-model layer's parse/validate
 * functions (`src/types/lockfile.ts`, `src/types/channel.ts`).
 *
 * Extracted during the data-model Refactor step (Step 5 of the code
 * generation plan) so every entity-parse error carries a consistent
 * `.name`/`.message`/optional `.field` shape instead of each entity
 * module inventing its own ad-hoc error class.
 */
export class EntityParseError extends Error {
  /** The field path that failed validation, when known. */
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = new.target.name;
    this.field = field;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Constructor shape every entity module's own parse-error subclass implements. */
export type EntityParseErrorCtor = new (message: string, field?: string) => EntityParseError;

/** Narrow helper: is `value` a non-null, non-array plain object? */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse a JSON string, wrapping a syntax error in an instance of the
 * caller's own entity-specific error subclass (so `err instanceof
 * LockfileParseError` holds for every failure mode, not just some).
 */
export function parseJsonOrThrow(
  entityName: string,
  raw: string,
  ErrorCtor: EntityParseErrorCtor,
): unknown {
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new ErrorCtor(`${entityName}: input is not valid JSON (${String(cause)})`);
  }
}

/** Raise a "top-level value is not an object" error via the caller's entity-specific error subclass. */
export function notAnObject(entityName: string, ErrorCtor: EntityParseErrorCtor): never {
  throw new ErrorCtor(`${entityName}: expected a JSON object at the top level`);
}

/** Read a required field of a given primitive type off a raw object, or throw via the caller's entity-specific error subclass. */
export function requireField<T>(
  entityName: string,
  obj: Record<string, unknown>,
  field: string,
  check: (value: unknown) => value is T,
  ErrorCtor: EntityParseErrorCtor,
): T {
  const value = obj[field];
  if (!check(value)) {
    throw new ErrorCtor(
      `${entityName}: required field "${field}" is missing or has the wrong type`,
      field,
    );
  }
  return value;
}

export const isString = (value: unknown): value is string => typeof value === 'string';
export const isNumber = (value: unknown): value is number => typeof value === 'number';
export const isArray = (value: unknown): value is unknown[] => Array.isArray(value);
