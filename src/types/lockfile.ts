/**
 * `Lockfile` entity — the single source of on-disk project state, per
 * `entities.md`. One Lockfile per project, written at
 * `<project root>/aidlc.lock.json`. Owned and authored solely by
 * `LockfileStore` (`src/io/lockfile-store.ts`); this module only defines
 * the shape and the parse/validate function it uses.
 */
import {
  EntityParseError,
  isArray,
  isPlainObject,
  isString,
  parseJsonOrThrow,
  requireField,
  notAnObject,
} from './errors';

const ENTITY_NAME = 'Lockfile';

/** Raised by {@link parseLockfile} on malformed JSON or a missing/invalid required field. */
export class LockfileParseError extends EntityParseError {}

export interface LockfileEngine {
  /** Installed engine's commit SHA. */
  ref: string;
  /** Display/compare version. */
  version: string;
  /** Tarball hash verified at install time. */
  sha256: string;
  /** Which harness this install targets, e.g. "cursor", "claude-code". */
  harness: string;
  /** ISO-8601 install timestamp. */
  installed_at: string;
}

export interface LockfilePlugin {
  name: string;
  ref: string;
  version: string;
  sha256: string;
  /** ISO-8601 timestamp. */
  composed_at: string;
  engine_version_at_compose: string;
}

export interface Lockfile {
  /** Version marker; consumers must ignore an unrecognized value rather than guess its meaning. */
  schema: number;
  /** Name of the channel this project follows, e.g. "stable". */
  channel: string;
  /** Commit SHA of the channel declaration this lockfile was last synced against. */
  channel_commit: string;
  engine: LockfileEngine;
  /** The engine version this CLI first installed; the version-gate anchor (v0.1 §4, M3). */
  engine_origin: string;
  plugins: LockfilePlugin[];
  /** Marker identifiers for BEGIN/END-managed blocks (v0.1 §7). */
  managed: string[];
  /** Doctor findings accepted as known; consumed by SuccessVerifier. */
  known_failures: string[];
  /** Per-project pin override (C1, ADR-004); when set, overrides the channel's resolved latest ref. */
  pin: string | null;
}

function parseEngine(raw: unknown): LockfileEngine {
  if (!isPlainObject(raw)) {
    throw new LockfileParseError(`${ENTITY_NAME}: "engine" must be an object`, 'engine');
  }
  return {
    ref: requireField(ENTITY_NAME, raw, 'ref', isString, LockfileParseError),
    version: requireField(ENTITY_NAME, raw, 'version', isString, LockfileParseError),
    sha256: requireField(ENTITY_NAME, raw, 'sha256', isString, LockfileParseError),
    harness: requireField(ENTITY_NAME, raw, 'harness', isString, LockfileParseError),
    installed_at: requireField(ENTITY_NAME, raw, 'installed_at', isString, LockfileParseError),
  };
}

function parsePlugin(raw: unknown, index: number): LockfilePlugin {
  if (!isPlainObject(raw)) {
    throw new LockfileParseError(`${ENTITY_NAME}: plugins[${index}] must be an object`, 'plugins');
  }
  return {
    name: requireField(ENTITY_NAME, raw, 'name', isString, LockfileParseError),
    ref: requireField(ENTITY_NAME, raw, 'ref', isString, LockfileParseError),
    version: requireField(ENTITY_NAME, raw, 'version', isString, LockfileParseError),
    sha256: requireField(ENTITY_NAME, raw, 'sha256', isString, LockfileParseError),
    composed_at: requireField(ENTITY_NAME, raw, 'composed_at', isString, LockfileParseError),
    engine_version_at_compose: requireField(
      ENTITY_NAME,
      raw,
      'engine_version_at_compose',
      isString,
      LockfileParseError,
    ),
  };
}

/**
 * Parse and validate a Lockfile from its raw JSON text.
 *
 * Unknown top-level fields are ignored (additive-only evolution, per
 * `entities.md`'s entity_constraints). Missing optional array fields
 * (`plugins`, `managed`, `known_failures`) default to `[]`, matching the
 * entity's declared defaults. Throws {@link LockfileParseError} — never
 * `LockfileParseError`'s "absent file" sibling, which is `LockfileStore`'s
 * concern (BR8.1's absent/malformed distinction is split across two
 * layers: this function only ever sees content that exists).
 */
export function parseLockfile(raw: string): Lockfile {
  const parsed = parseJsonOrThrow(ENTITY_NAME, raw, LockfileParseError);
  if (!isPlainObject(parsed)) {
    notAnObject(ENTITY_NAME, LockfileParseError);
  }

  const pluginsRaw = parsed.plugins ?? [];
  if (!isArray(pluginsRaw)) {
    throw new LockfileParseError(`${ENTITY_NAME}: "plugins" must be an array`, 'plugins');
  }

  const managedRaw = parsed.managed ?? [];
  if (!isArray(managedRaw) || !managedRaw.every(isString)) {
    throw new LockfileParseError(
      `${ENTITY_NAME}: "managed" must be an array of strings`,
      'managed',
    );
  }

  const knownFailuresRaw = parsed.known_failures ?? [];
  if (!isArray(knownFailuresRaw) || !knownFailuresRaw.every(isString)) {
    throw new LockfileParseError(
      `${ENTITY_NAME}: "known_failures" must be an array of strings`,
      'known_failures',
    );
  }

  const pinRaw = Object.prototype.hasOwnProperty.call(parsed, 'pin') ? parsed.pin : null;
  if (pinRaw !== null && !isString(pinRaw)) {
    throw new LockfileParseError(`${ENTITY_NAME}: "pin" must be a string or null`, 'pin');
  }

  return {
    schema: requireField(
      ENTITY_NAME,
      parsed,
      'schema',
      (v): v is number => typeof v === 'number',
      LockfileParseError,
    ),
    channel: requireField(ENTITY_NAME, parsed, 'channel', isString, LockfileParseError),
    channel_commit: requireField(
      ENTITY_NAME,
      parsed,
      'channel_commit',
      isString,
      LockfileParseError,
    ),
    engine: parseEngine(parsed.engine),
    engine_origin: requireField(ENTITY_NAME, parsed, 'engine_origin', isString, LockfileParseError),
    plugins: pluginsRaw.map(parsePlugin),
    managed: managedRaw,
    known_failures: knownFailuresRaw,
    pin: pinRaw,
  };
}

/** Serialize a Lockfile back to its canonical on-disk JSON form (pretty-printed, trailing newline). */
export function serializeLockfile(lockfile: Lockfile): string {
  return JSON.stringify(lockfile, null, 2) + '\n';
}
