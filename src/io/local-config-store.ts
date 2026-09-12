/**
 * `LocalConfigStore` — reads and writes `.aidlc-fleet.local.json`, a
 * project-local, CLI-owned file (issue #18) that lets the 4
 * `AIDLC_FLEET_*` environment variables be answered once and reused,
 * instead of re-exported every shell session. Mirrors `LockfileStore`'s
 * shape (own file, own error types, write via atomic-enough single write
 * since this file is not part of the M4 file-ownership invariant's
 * managed-receipt surface).
 *
 * Scope boundary (project.md Forbidden): this file lives under
 * `projectRoot` only — never under `aidlc/`, never an upstream file.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ENV_CONFIG_KEYS, type LocalConfigValues } from '../core/env-config-resolver';

const LOCAL_CONFIG_NAME = '.aidlc-fleet.local.json';

/** Raised by {@link LocalConfigStore.load} when the file exists but is not valid JSON, or not a JSON object. */
export class LocalConfigMalformedError extends Error {
  constructor(projectDir: string, cause?: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause ?? 'not a JSON object');
    super(`LocalConfigStore: ${LOCAL_CONFIG_NAME} in ${projectDir} is malformed: ${reason}`);
    this.name = 'LocalConfigMalformedError';
    Object.setPrototypeOf(this, LocalConfigMalformedError.prototype);
  }
}

export class LocalConfigStore {
  private readonly projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  private get path(): string {
    return join(this.projectDir, LOCAL_CONFIG_NAME);
  }

  /** Absent file -> `{}` (BR-equivalent to "nothing configured yet"). Malformed file -> throws. */
  async load(): Promise<LocalConfigValues> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (cause) {
      if (isEnoent(cause)) return {};
      throw cause;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new LocalConfigMalformedError(this.projectDir, cause);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new LocalConfigMalformedError(this.projectDir);
    }
    const record = parsed as Record<string, unknown>;
    const result: LocalConfigValues = {};
    for (const key of ENV_CONFIG_KEYS) {
      const value = record[key];
      if (typeof value === 'string' && value.length > 0) {
        result[key] = value;
      }
    }
    return result;
  }

  /** Overwrites the file with exactly `values` (only the 4 recognised keys are ever written). */
  async save(values: LocalConfigValues): Promise<void> {
    const toWrite: LocalConfigValues = {};
    for (const key of ENV_CONFIG_KEYS) {
      const value = values[key];
      if (typeof value === 'string' && value.length > 0) {
        toWrite[key] = value;
      }
    }
    await writeFile(this.path, `${JSON.stringify(toWrite, null, 2)}\n`, 'utf8');
  }

  /**
   * Read-modify-write: merges `partial` into the current file's values
   * (partial keys win over stored ones) without disturbing keys `partial`
   * does not mention, then persists and returns the merged result.
   */
  async merge(partial: LocalConfigValues): Promise<LocalConfigValues> {
    const current = await this.load();
    const merged = { ...current, ...partial };
    await this.save(merged);
    return merged;
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  );
}
