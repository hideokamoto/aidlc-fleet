/**
 * `LockfileStore` — reads and writes the project's `aidlc.lock.json`, the
 * single source of on-disk project state (`components.md`). Owns all
 * reads/writes to the Lockfile; never performs network I/O or filesystem
 * mutation outside its own lockfile.
 *
 * BR8.1: classifies "absent" vs. "fails to parse" as distinct fatal
 * cases whenever asked to load outside `init` (`reliability-design.md`'s
 * NFR4.2 attribution — this classification lives here, not in
 * `CommandLayer`, which only invokes `load()` and maps the resulting
 * error to an exit code).
 *
 * NFR4.1: writes via write-to-temp-then-atomic-rename, per
 * `reliability-design.md`.
 */
import { access, open, readFile, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import {
  parseLockfile,
  serializeLockfile,
  LockfileParseError,
  type Lockfile,
} from '../types/lockfile';

const LOCKFILE_NAME = 'aidlc.lock.json';

/** Raised by {@link LockfileStore.load} when `aidlc.lock.json` does not exist (BR8.1). */
export class LockfileAbsentError extends Error {
  constructor(projectDir: string) {
    super(
      `LockfileStore: no ${LOCKFILE_NAME} found in ${projectDir}. Run "aidlc-fleet init" first.`,
    );
    this.name = 'LockfileAbsentError';
    Object.setPrototypeOf(this, LockfileAbsentError.prototype);
  }
}

/** Raised by {@link LockfileStore.load} when `aidlc.lock.json` exists but fails to parse (BR8.1). */
export class LockfileMalformedError extends Error {
  constructor(projectDir: string, cause: LockfileParseError) {
    super(`LockfileStore: ${LOCKFILE_NAME} in ${projectDir} is malformed: ${cause.message}`);
    this.name = 'LockfileMalformedError';
    Object.setPrototypeOf(this, LockfileMalformedError.prototype);
  }
}

export class LockfileStore {
  private readonly projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  private get lockfilePath(): string {
    return join(this.projectDir, LOCKFILE_NAME);
  }

  /** Whether `aidlc.lock.json` currently exists in the project directory. */
  async exists(): Promise<boolean> {
    try {
      await access(this.lockfilePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load and validate the Lockfile. Throws {@link LockfileAbsentError} if
   * the file does not exist, or {@link LockfileMalformedError} if it
   * exists but fails to parse (BR8.1) — the two are always distinguishable
   * to the caller, which `init` uses to decide whether to create afresh.
   */
  async load(): Promise<Lockfile> {
    let raw: string;
    try {
      raw = await readFile(this.lockfilePath, 'utf8');
    } catch (cause) {
      if (isEnoent(cause)) {
        throw new LockfileAbsentError(this.projectDir);
      }
      throw cause;
    }
    try {
      return parseLockfile(raw);
    } catch (cause) {
      if (cause instanceof LockfileParseError) {
        throw new LockfileMalformedError(this.projectDir, cause);
      }
      throw cause;
    }
  }

  /**
   * Persist `lockfile` via write-temp + fsync + atomic rename (NFR4.1).
   * A crash between the temp write and the rename leaves the original
   * `aidlc.lock.json` untouched and an orphaned `.tmp` file that the next
   * successful save overwrites — no corruption window.
   */
  async save(lockfile: Lockfile): Promise<void> {
    const tmpPath = `${this.lockfilePath}.tmp`;
    const serialized = serializeLockfile(lockfile);
    const handle = await open(tmpPath, 'w');
    try {
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmpPath, this.lockfilePath);
  }

  /** BR6.1: set `Lockfile.pin` to `ref`. Requires the Lockfile to already exist (BR8.1). */
  async pin(ref: string): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, pin: ref });
  }

  /** BR6.1: clear `Lockfile.pin` back to `null`. Requires the Lockfile to already exist (BR8.1). */
  async unpin(): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, pin: null });
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
