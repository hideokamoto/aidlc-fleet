/**
 * `Channel` entity — the central declaration this CLI reads to learn the
 * target engine version, plugin set, and migration boundaries, per
 * `entities.md`. Owned externally; this CLI treats it as read-only input,
 * fetched by `ChannelClient` (`src/io/channel-client.ts`). This module
 * only defines the shape and the parse/validate function it uses.
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

const ENTITY_NAME = 'Channel';

/** Highest `schema` value this build understands (v0.1 §2.1: current = 1). */
export const HIGHEST_SUPPORTED_CHANNEL_SCHEMA = 1;

/** Raised by {@link parseChannel} on malformed JSON or a missing/invalid required field. */
export class ChannelParseError extends EntityParseError {}

/**
 * Raised specifically when `Channel.schema` is higher than this build
 * understands (BR7.2: surfaced to the human, never guessed at). A subtype
 * of {@link ChannelParseError} so callers can catch either the general
 * case or branch specifically on an unrecognized schema.
 */
export class ChannelSchemaError extends ChannelParseError {
  public readonly schema: number;

  constructor(schema: number) {
    super(
      `Channel: unrecognized schema version ${schema} (this build understands up to ${HIGHEST_SUPPORTED_CHANNEL_SCHEMA})`,
      'schema',
    );
    this.schema = schema;
    Object.setPrototypeOf(this, ChannelSchemaError.prototype);
  }
}

export interface ChannelEngine {
  /** `owner/name` GitHub repo the engine tarball is fetched from (matches `ChannelPlugin.repo` — issue #11). */
  repo: string;
  /** Commit SHA — tags mostly absent in upstream releases. */
  ref: string;
  version: string;
  tag?: string | null;
  sha256: string;
}

export interface MigrationBoundary {
  /** Version boundary this rule applies below. */
  before: string;
  action: 'reject' | 'manual' | 'none';
  /** Single-boundary note. */
  note?: string;
  /** Multi-line notes, used for manual boundaries. */
  notes?: string[];
}

export interface ChannelPlugin {
  name: string;
  repo: string;
  /** Commit SHA. */
  ref: string;
  version: string;
  sha256: string;
}

export interface Channel {
  schema: number;
  channel: string;
  engine: ChannelEngine;
  migration_boundaries: MigrationBoundary[];
  plugins: ChannelPlugin[];
  /** Opaque overlay, passed through without interpretation. */
  settings_overlay?: Record<string, unknown>;
  /** Opaque overlay, passed through without interpretation. */
  mcp_overlay?: Record<string, unknown>;
}

function parseEngine(raw: unknown): ChannelEngine {
  if (!isPlainObject(raw)) {
    throw new ChannelParseError(`${ENTITY_NAME}: "engine" must be an object`, 'engine');
  }
  const tag = raw.tag;
  if (tag !== undefined && tag !== null && !isString(tag)) {
    throw new ChannelParseError(
      `${ENTITY_NAME}: "engine.tag" must be a string or null`,
      'engine.tag',
    );
  }
  return {
    repo: requireField(ENTITY_NAME, raw, 'repo', isString, ChannelParseError),
    ref: requireField(ENTITY_NAME, raw, 'ref', isString, ChannelParseError),
    version: requireField(ENTITY_NAME, raw, 'version', isString, ChannelParseError),
    tag: tag ?? null,
    sha256: requireField(ENTITY_NAME, raw, 'sha256', isString, ChannelParseError),
  };
}

function parseMigrationBoundary(raw: unknown, index: number): MigrationBoundary {
  if (!isPlainObject(raw)) {
    throw new ChannelParseError(
      `${ENTITY_NAME}: migration_boundaries[${index}] must be an object`,
      'migration_boundaries',
    );
  }
  const action = raw.action;
  if (action !== 'reject' && action !== 'manual' && action !== 'none') {
    throw new ChannelParseError(
      `${ENTITY_NAME}: migration_boundaries[${index}].action must be "reject" | "manual" | "none"`,
      'migration_boundaries',
    );
  }
  const boundary: MigrationBoundary = {
    before: requireField(ENTITY_NAME, raw, 'before', isString, ChannelParseError),
    action,
  };
  if (isString(raw.note)) boundary.note = raw.note;
  if (isArray(raw.notes) && raw.notes.every(isString)) boundary.notes = raw.notes;
  return boundary;
}

function parsePlugin(raw: unknown, index: number): ChannelPlugin {
  if (!isPlainObject(raw)) {
    throw new ChannelParseError(`${ENTITY_NAME}: plugins[${index}] must be an object`, 'plugins');
  }
  return {
    name: requireField(ENTITY_NAME, raw, 'name', isString, ChannelParseError),
    repo: requireField(ENTITY_NAME, raw, 'repo', isString, ChannelParseError),
    ref: requireField(ENTITY_NAME, raw, 'ref', isString, ChannelParseError),
    version: requireField(ENTITY_NAME, raw, 'version', isString, ChannelParseError),
    sha256: requireField(ENTITY_NAME, raw, 'sha256', isString, ChannelParseError),
  };
}

/**
 * Parse and validate a Channel from its raw JSON text.
 *
 * Validates `schema` immediately after parsing, before any other field is
 * read (security-design.md's NFR2.5 placement) — an unrecognized schema
 * throws {@link ChannelSchemaError} rather than attempting a best-effort
 * parse (BR7.2). Unknown top-level fields are otherwise ignored
 * (additive-only evolution).
 */
export function parseChannel(raw: string): Channel {
  const parsed = parseJsonOrThrow(ENTITY_NAME, raw, ChannelParseError);
  if (!isPlainObject(parsed)) {
    notAnObject(ENTITY_NAME, ChannelParseError);
  }

  const schema = requireField(
    ENTITY_NAME,
    parsed,
    'schema',
    (v): v is number => typeof v === 'number',
    ChannelParseError,
  );
  if (schema > HIGHEST_SUPPORTED_CHANNEL_SCHEMA) {
    throw new ChannelSchemaError(schema);
  }

  const migrationBoundariesRaw = parsed.migration_boundaries ?? [];
  if (!isArray(migrationBoundariesRaw)) {
    throw new ChannelParseError(
      `${ENTITY_NAME}: "migration_boundaries" must be an array`,
      'migration_boundaries',
    );
  }

  const pluginsRaw = parsed.plugins ?? [];
  if (!isArray(pluginsRaw)) {
    throw new ChannelParseError(`${ENTITY_NAME}: "plugins" must be an array`, 'plugins');
  }

  const channel: Channel = {
    schema,
    channel: requireField(ENTITY_NAME, parsed, 'channel', isString, ChannelParseError),
    engine: parseEngine(parsed.engine),
    migration_boundaries: migrationBoundariesRaw.map(parseMigrationBoundary),
    plugins: pluginsRaw.map(parsePlugin),
  };
  if (isPlainObject(parsed.settings_overlay)) channel.settings_overlay = parsed.settings_overlay;
  if (isPlainObject(parsed.mcp_overlay)) channel.mcp_overlay = parsed.mcp_overlay;
  return channel;
}
