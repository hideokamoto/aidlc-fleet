/**
 * `FileOwnershipGuard` — enforces the file-ownership invariants (v0.1 §7,
 * M4) and fails fast on violation (BR2.1–BR2.6). `components.md`.
 *
 * These checks can only be verified against a real filesystem (symlink
 * resolution, directory backups); team.md's Mandated rule requires real
 * `fs.mkdtemp` integration tests for this component specifically, not
 * mocks. This module therefore does perform real fs I/O itself — the
 * "no I/O" framing for the core-logic layer describes `VersionGate`/
 * `SuccessVerifier`/`DriftDetector`, not this component, whose entire
 * purpose is checking real filesystem state.
 */
import { cp, lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

/** Raised whenever any of BR2.1–BR2.5 detects a violation. BR2.6: always raised immediately, never a warn-and-continue result. */
export class FileOwnershipViolation extends Error {
  constructor(message: string) {
    super(`FileOwnershipGuard: ${message}`);
    this.name = 'FileOwnershipViolation';
    Object.setPrototypeOf(this, FileOwnershipViolation.prototype);
  }
}

export interface EngineDirectoryReplaceResult {
  /** Path the pre-replace backup was copied to. */
  backupPath: string;
}

export interface FileOwnershipGuardOptions {
  /** The project's root directory, used to resolve the `aidlc/` exclusion zone (BR2.3). */
  projectRoot: string;
}

/** A settings/hooks JSON-like object: string keys, arbitrary values. */
export type SettingsObject = Record<string, unknown>;

/** Keys where the engine's value always wins on merge conflict (BR2.2). */
const ENGINE_WINS_KEYS = new Set(['hooks', 'statusLine']);

export class FileOwnershipGuard {
  private readonly projectRoot: string;

  constructor(options: FileOwnershipGuardOptions) {
    this.projectRoot = options.projectRoot;
  }

  /**
   * BR2.1: replacing an engine-owned directory requires `--force` and a
   * backup taken first. Fails fast (no backup, no replace) when `--force`
   * is absent.
   */
  async checkEngineDirectoryReplace(
    targetDir: string,
    options: { force: boolean },
  ): Promise<EngineDirectoryReplaceResult> {
    // BR2.1 governs *replacing* an engine-owned directory. A brand-new
    // project's first `init` has no such directory yet — there is nothing
    // to replace and nothing to back up, so it proceeds regardless of
    // --force. Only an existing directory triggers the force+backup gate.
    if (!(await this.pathExists(targetDir))) {
      return { backupPath: '' };
    }
    if (!options.force) {
      throw new FileOwnershipViolation(
        `refusing to replace engine-owned directory ${targetDir} without --force`,
      );
    }
    const backupPath = `${targetDir}.backup`;
    try {
      await rm(backupPath, { recursive: true, force: true });
      await cp(targetDir, backupPath, { recursive: true });
    } catch (cause) {
      throw new FileOwnershipViolation(
        `failed to back up ${targetDir} before --force replace: ${String(cause)}`,
      );
    }
    return { backupPath };
  }

  /**
   * BR2.3 + BR2.4: checks a single write target before it is written.
   * Refuses any write under `aidlc/` other than the one-time initial
   * memory-seed copy (BR2.3), and refuses any write whose resolved path
   * traverses a symlink (BR2.4).
   */
  async checkWriteAllowed(
    targetPath: string,
    options: { isInitialSeedCopy: boolean },
  ): Promise<void> {
    if (!options.isInitialSeedCopy && this.isUnderAidlcWorkspace(targetPath)) {
      throw new FileOwnershipViolation(
        `refusing to write ${targetPath}: the aidlc/ workspace tree is never touched except the initial memory-seed copy`,
      );
    }
    await this.assertNoSymlinkInPath(targetPath);
  }

  /**
   * BR2.5: given every candidate path a cleanup step is considering
   * deleting, returns only the subset present in `receipt` — files
   * outside the managed receipt are never auto-deleted. This method does
   * not itself delete anything; it only filters the candidate set, so the
   * "default-preserve" behaviour cannot be bypassed by a caller forgetting
   * to check membership.
   */
  async filterDeletable(candidates: string[], receipt: ReadonlySet<string>): Promise<string[]> {
    return candidates.filter((path) => receipt.has(path));
  }

  /**
   * BR2.2: merge `project` and `engine` settings/hooks objects.
   * Keys under `hooks`/`statusLine` take the engine's value; every other
   * key takes the project's value on conflict, engine's value when the
   * project doesn't define it.
   */
  mergeSettings(project: SettingsObject, engine: SettingsObject): SettingsObject {
    const merged: SettingsObject = { ...engine, ...project };
    for (const key of ENGINE_WINS_KEYS) {
      if (key in engine) {
        merged[key] = engine[key];
      }
    }
    return merged;
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await lstat(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private isUnderAidlcWorkspace(targetPath: string): boolean {
    const aidlcRoot = join(this.projectRoot, 'aidlc');
    const rel = relative(aidlcRoot, targetPath);
    return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`.${sep}..`));
  }

  /**
   * Walk every ancestor directory of `targetPath` that currently exists
   * and confirm none of them is a symlink. A write whose path traverses a
   * symlink anywhere along the chain is refused (BR2.4) — this catches
   * both "the target itself is a symlink" and "a parent directory is a
   * symlink to somewhere else," which `fs.realpath` alone would silently
   * follow.
   */
  private async assertNoSymlinkInPath(targetPath: string): Promise<void> {
    let current = targetPath;
    const visited: string[] = [];
    while (true) {
      visited.unshift(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    for (const candidate of visited) {
      try {
        const stat = await lstat(candidate);
        if (stat.isSymbolicLink()) {
          throw new FileOwnershipViolation(
            `refusing to write ${targetPath}: ${candidate} is a symlink; no write ever passes through a symlink`,
          );
        }
      } catch (err) {
        if (err instanceof FileOwnershipViolation) throw err;
        // ENOENT is expected for path segments that don't exist yet
        // (e.g. the file itself, not-yet-created directories) — only
        // existing segments can be symlinks to check.
      }
    }
  }
}

/** Ensure a directory exists, without ever writing through a symlinked ancestor. Exposed for `EngineInstaller`/`PluginManager` placement code. */
export async function ensureDirectory(guard: FileOwnershipGuard, targetDir: string): Promise<void> {
  await guard.checkWriteAllowed(targetDir, { isInitialSeedCopy: false });
  await mkdir(targetDir, { recursive: true });
}

/** Resolve a path's real (symlink-free) location, for callers that need to compare against a canonical root. */
export async function resolveReal(path: string): Promise<string> {
  return realpath(path);
}
