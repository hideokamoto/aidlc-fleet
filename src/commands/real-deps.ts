/**
 * Wires the real (non-test) `CommandDeps` bundle: real `LockfileStore`,
 * `ChannelClient`, `FileOwnershipGuard`, `VersionGate`,
 * `SuccessVerifier`, `DriftDetector`, `EngineInstaller`, `PluginManager`,
 * plus the process/filesystem ports each orchestration component needs.
 *
 * This module is integration glue, not business logic — it has no
 * dedicated Red/Green test cycle of its own (nothing here branches on a
 * business rule; every rule it touches is already covered by the
 * component it constructs). `bin/aidlc-fleet.ts` is its only caller.
 *
 * Several conventions fixed here are genuine Code Generation
 * implementation choices with no upstream artifact pinning them (the
 * upstream `install.ts`/`compose.ts` invocation shape, the on-disk
 * "installed state" marker `DriftDetector` compares against, and the
 * `.drops` file location `SuccessVerifier` scans) — each is called out
 * inline and in `code-summary.md`.
 */
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { ChannelClient } from '../io/channel-client';
import { extractTarGz } from '../io/tar-extract';
import { LockfileStore, LockfileAbsentError, LockfileMalformedError } from '../io/lockfile-store';
import { LocalConfigStore } from '../io/local-config-store';
import { VersionGate } from '../core/version-gate';
import { SuccessVerifier } from '../core/success-verifier';
import { DriftDetector } from '../core/drift-detector';
import { FileOwnershipGuard, FileOwnershipViolation } from '../core/file-ownership-guard';
import { ENV_CONFIG_KEYS, resolveEnvConfig } from '../core/env-config-resolver';
import { EngineInstaller } from '../orchestration/engine-installer';
import { PluginManager } from '../orchestration/plugin-manager';
import type { CommandDeps, ConfigAccess } from './types';
import type { Lockfile } from '../types/lockfile';
import pluginTargets from '../../.claude/tools/data/plugin-targets.json';

type PluginTargetEntry = { harnessLeaf: string };
const HARNESS_TARGETS = pluginTargets as Record<string, PluginTargetEntry>;

/**
 * Resolves `harness` (the Lockfile's `engine.harness` value) to its
 * write-target root directory (e.g. `claude` -> `.claude`, `cursor` ->
 * `.cursor`) via `.claude/tools/data/plugin-targets.json` — upstream's own
 * mapping of harness to `harnessLeaf`, never redefined fleet-side (issue #6
 * completion criterion 2). Throws for a harness with no entry in that file;
 * there is no fallback to `.claude` (issue #6 completion criterion 3).
 */
export function resolveHarnessRoot(harness: string): string {
  // Object.prototype.hasOwnProperty guards against `harness` naming an
  // inherited key (e.g. "toString", "constructor") that would otherwise
  // resolve to a truthy, non-plugin-targets value via plain [] lookup.
  if (!Object.prototype.hasOwnProperty.call(HARNESS_TARGETS, harness)) {
    throw new Error(
      `real-deps: unknown harness "${harness}" — no entry in .claude/tools/data/plugin-targets.json (no .claude fallback)`,
    );
  }
  return HARNESS_TARGETS[harness]!.harnessLeaf;
}

/**
 * Best-effort default harness for a bare `init` with no `--harness` flag
 * (issue #15): if this project already has a `.claude/` directory (the
 * "claude" harness's `harnessLeaf` in `plugin-targets.json`), that existing
 * layout is a far stronger signal than a hardcoded default, so `init` uses
 * it without asking. Returns `undefined` when nothing on disk says so —
 * `cli.ts` then asks the human instead of guessing and silently placing
 * the engine in the wrong directory.
 */
export async function detectDefaultHarness(projectRoot: string): Promise<string | undefined> {
  const claudeLeaf = HARNESS_TARGETS['claude']?.harnessLeaf ?? '.claude';
  try {
    const info = await stat(join(projectRoot, claudeLeaf));
    return info.isDirectory() ? 'claude' : undefined;
  } catch {
    return undefined;
  }
}

export interface RealDepsConfig {
  projectRoot: string;
  channelUrl: string;
  /** Upstream compose command, e.g. `["bun", "/path/to/compose.ts"]`. Configurable since no approved artifact pins upstream's install location — this CLI never reimplements it (project.md's Forbidden rule), only shells out to whatever is configured. */
  composeCommand: string[];
  /**
   * Upstream `doctor` command, e.g. `["bun", "/path/to/doctor.ts"]`.
   * Configurable via `AIDLC_FLEET_DOCTOR_CMD` for the same reason as
   * `composeCommand`: no approved artifact pins upstream `doctor`'s
   * location, and this CLI never reimplements upstream `doctor`'s own
   * logic (project.md's Forbidden rule) — only shells out to it and
   * parses its stdout (see {@link runDoctorCommand}). Optional: when
   * unset (or empty), `doctorFailures`/`doctorRunner.run` report no
   * failures rather than fail the command outright, matching this CLI's
   * general BR3.1 stance that a doctor invocation problem degrades the
   * verification rather than crashing the CLI.
   */
  doctorCommand?: string[];
  /**
   * `owner/name` GitHub repo override for the engine tarball fetch.
   * Optional (issue #11): the Channel's own `engine.repo` field is the
   * normal, central source of truth for where the engine comes from — a
   * fleet operator moves the engine to a fork/mirror by updating that one
   * Channel file, and every project tracking it follows automatically.
   * This config value, set via `AIDLC_FLEET_ENGINE_REPO`, only exists for
   * the exceptional per-project override case (e.g. testing a fork before
   * it lands in the Channel) and takes precedence over `engine.repo` when
   * present; see {@link buildRealDeps}'s `fetchEngineTarball`.
   */
  engineRepo?: string;
}

const DROPS_FILE = '.aidlc-fleet.drops';

/**
 * B: tool-owned bookkeeping directory for post-extraction "installed"
 * markers — one per engine/plugin target, keyed by `engine-<harness>` /
 * `plugin-<name>`. Deliberately outside every harness-owned directory
 * (`.claude/`, `.cursor/`, ...) so it is never mistaken for engine/plugin
 * content and never wiped by an engine replace (`placeEngine` below).
 */
const MARKERS_DIR = '.aidlc-fleet-markers';

/**
 * B: what `installedState.read()` actually verifies against current disk
 * content. `contentHash`/`files` are computed from the real,
 * just-extracted file tree at `placeEngine`/`placeProjection` time — never
 * copied from the Lockfile — so a later out-of-band edit or deletion under
 * `files` changes the recomputed hash and is caught by
 * {@link verifyInstalledRef} on the next read (this is what makes
 * `DriftDetector`'s `local-modification` branch reachable at all: before
 * this fix, `installedEngineRef` was written once, inside `saveLockfile`,
 * as a bare echo of `lockfile.engine.ref`, so disk could never disagree
 * with it in `DriftDetector`'s eyes even after real files were altered).
 */
interface InstallMarker {
  /** The engine/plugin channel ref this content was extracted for. */
  ref: string;
  /** sha256 over the sorted (relative path, content) pairs of `files`. */
  contentHash: string;
  /** Relative (posix-joined via `join`, so platform-native) paths, under the target directory, that this hash covers. */
  files: string[];
}

function markerPath(projectRoot: string, key: string): string {
  return join(projectRoot, MARKERS_DIR, `${key}.json`);
}

async function writeInstallMarker(
  projectRoot: string,
  key: string,
  marker: InstallMarker,
): Promise<void> {
  await mkdir(join(projectRoot, MARKERS_DIR), { recursive: true });
  await writeFile(markerPath(projectRoot, key), JSON.stringify(marker, null, 2), 'utf8');
}

async function readInstallMarker(
  projectRoot: string,
  key: string,
): Promise<InstallMarker | undefined> {
  try {
    const raw = await readFile(markerPath(projectRoot, key), 'utf8');
    return JSON.parse(raw) as InstallMarker;
  } catch {
    return undefined;
  }
}

async function deleteInstallMarker(projectRoot: string, key: string): Promise<void> {
  await rm(markerPath(projectRoot, key), { force: true });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Every file (not directory) under `dir`, as `/`-joined paths relative to `dir`, sorted. Pure disk read, no hashing. */
async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string, rel: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(join(current, entry.name), entryRel);
      } else if (entry.isFile()) {
        out.push(entryRel);
      }
    }
  }
  await walk(dir, '');
  out.sort();
  return out;
}

/**
 * sha256 over `relFiles` (sorted, so file order never affects the digest)
 * resolved against `baseDir` — the actual bytes on disk right now, read
 * fresh on every call. A missing file throws (ENOENT from `readFile`),
 * which callers treat as "content changed" (deletion is a change).
 */
async function hashFiles(baseDir: string, relFiles: string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const rel of [...relFiles].sort()) {
    hash.update(rel);
    hash.update('\0');
    hash.update(await readFile(join(baseDir, rel)));
  }
  return hash.digest('hex');
}

/**
 * B's read-time verification: re-derive "is `ref` still actually
 * installed at `baseDir`" from current disk content, instead of trusting
 * a stored label. Returns `ref` only when every recorded file is still
 * present with unchanged content; otherwise `''` (the same "nothing
 * installed" value `DriftDetector` already treats as never matching a
 * real Lockfile ref), so a manual edit or deletion under `baseDir` is
 * indistinguishable, to the caller, from the marker never having existed.
 */
async function verifyInstalledRef(
  projectRoot: string,
  key: string,
  baseDir: string,
): Promise<string> {
  const marker = await readInstallMarker(projectRoot, key);
  if (!marker) return '';
  try {
    const currentHash = await hashFiles(baseDir, marker.files);
    return currentHash === marker.contentHash ? marker.ref : '';
  } catch {
    return '';
  }
}

/**
 * Builds the tarball URL for a given `owner/name` repo and commit ref,
 * using GitHub's codeload archive convention.
 *
 * Bug fix: before this existed, `fetchEngineTarball`/`fetchPluginTarball`
 * passed `engine.ref`/`plugin.ref` — a bare commit SHA per
 * `contract-summary.md` Contract 1 — directly to `ChannelClient.fetchTarball`
 * as if it were already a URL. Against a real channel this throws
 * `TypeError [ERR_INVALID_URL]` before any tarball is ever fetched
 * (confirmed against a local HTTP server serving a valid Channel
 * declaration); the prior test suite never caught it because its `fetch`
 * mock accepted any string as a valid URL.
 */
export function buildTarballUrl(repo: string, ref: string): string {
  if (!repo) {
    throw new Error('real-deps: cannot build a tarball URL without a repo (owner/name)');
  }
  return `https://codeload.github.com/${repo}/tar.gz/${ref}`;
}

async function runComposeCommand(
  composeCommand: string[],
  env: Record<string, string>,
): Promise<{ exitCode: number }> {
  const [cmd, ...args] = composeCommand;
  if (!cmd) {
    throw new Error('real-deps: no compose command configured');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'], // stdin closed, per PluginManager's workflow requirement
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ exitCode: code ?? 1 }));
  });
}

/**
 * Parse upstream `doctor`'s stdout into the `string[]` of failure lines
 * the `doctorFailures`/`doctorRunner.run` port contract expects (BR3.1,
 * `SuccessVerifier`'s third predicate). No approved artifact specifies
 * upstream `doctor`'s output format, so this Code Generation
 * implementation choice treats each non-blank, non-comment line of
 * stdout as one reported failure — mirroring how `.drops`/other
 * upstream-produced text files are already read line-oriented elsewhere
 * in this module. Exported so its parsing logic is independently unit
 * testable without spawning a real process (per team.md's mocked-spawn
 * test convention for this module's external-command invocations).
 */
export function parseDoctorOutput(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

export async function runDoctorCommand(
  doctorCommand: string[] | undefined,
  env: Record<string, string>,
): Promise<{ failures: string[]; configured: boolean }> {
  const [cmd, ...args] = doctorCommand ?? [];
  if (!cmd) {
    // No upstream doctor command configured (AIDLC_FLEET_DOCTOR_CMD
    // unset/empty): report zero failures (never silently invents one,
    // since there is no real invocation to have found one) but flag
    // `configured: false` so callers (issue #14) can tell "never
    // checked" apart from "checked, found nothing" instead of both
    // collapsing into the same `{ failures: [] }` shape.
    return { failures: [], configured: false };
  }
  const { stdout, exitCode } = await new Promise<{ stdout: string; exitCode: number }>(
    (resolve, reject) => {
      const child = spawn(cmd, args, {
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const chunks: Buffer[] = [];
      child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.on('error', reject);
      child.on('close', (code) =>
        resolve({ stdout: Buffer.concat(chunks).toString('utf8'), exitCode: code ?? 1 }),
      );
    },
  );
  const failures = parseDoctorOutput(stdout);
  // code-review finding: a doctor command that exits non-zero but prints
  // no parseable failure line (crash, bad path, permission error) used to
  // come back as `{ failures: [] }` — indistinguishable from a genuinely
  // clean run. issue #18's built-in AIDLC_FLEET_DOCTOR_CMD default makes
  // this command actually run by default now, so a broken default (or a
  // broken override) must be surfaced rather than silently swallowed.
  if (exitCode !== 0 && failures.length === 0) {
    failures.push(`doctor command "${doctorCommand!.join(' ')}" exited with code ${exitCode}`);
  }
  return { failures, configured: true };
}

async function readDropsFile(projectRoot: string): Promise<string> {
  try {
    return await readFile(join(projectRoot, DROPS_FILE), 'utf8');
  } catch {
    return '';
  }
}

/**
 * issue #18: env > project-local `.aidlc-fleet.local.json` > built-in
 * default > unset. `resolveAll` re-reads `process.env` and the local file
 * on every call (never cached) so a `config` save is reflected immediately
 * within the same process, and a change to the file between commands is
 * always picked up.
 */
export function buildConfigAccess(projectRoot: string): ConfigAccess {
  const localConfigStore = new LocalConfigStore(projectRoot);
  return {
    resolveAll: async () => {
      const local = await localConfigStore.load();
      const envSnapshot: Partial<Record<(typeof ENV_CONFIG_KEYS)[number], string>> = {};
      for (const key of ENV_CONFIG_KEYS) {
        envSnapshot[key] = process.env[key];
      }
      return resolveEnvConfig(envSnapshot, local);
    },
    saveLocal: async (values) => {
      await localConfigStore.merge(values);
    },
    prompt: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
  };
}

export function buildRealDeps(config: RealDepsConfig): CommandDeps {
  const lockfileStore = new LockfileStore(config.projectRoot);
  const channelClient = new ChannelClient();
  const guard = new FileOwnershipGuard({ projectRoot: config.projectRoot });
  const successVerifier = new SuccessVerifier();
  const configAccess = buildConfigAccess(config.projectRoot);

  /**
   * issue #6 (Step 9 Refactor): the four `pluginManager` closures below
   * each need "load the Lockfile, resolve its engine.harness's root
   * directory" — factored here once instead of repeating those two lines
   * four times. Loads the Lockfile directly (it is already in scope via
   * `lockfileStore`) rather than widening `PluginManagerPorts` to carry a
   * harness, keeping the fix contained to this module.
   */
  async function resolveConfiguredHarnessRoot(): Promise<string> {
    const lockfile = await lockfileStore.load();
    return resolveHarnessRoot(lockfile.engine.harness);
  }

  const engineInstaller = new EngineInstaller({
    projectRoot: config.projectRoot,
    // issue #11: `config.engineRepo` (AIDLC_FLEET_ENGINE_REPO) is an
    // optional per-project override; the Channel's own `engine.repo` is
    // the normal source of truth, so it wins whenever no override is
    // configured.
    fetchEngineTarball: (engine) =>
      channelClient.fetchTarball(
        buildTarballUrl(config.engineRepo ?? engine.repo, engine.ref),
        engine.sha256,
      ),
    checkEngineDirectoryReplace: async (opts) => {
      const engineDir = join(config.projectRoot, resolveHarnessRoot(opts.harness));
      await guard.checkEngineDirectoryReplace(engineDir, opts);
    },
    // A: actually extract the verified engine tarball (mirrors
    // `placeProjection`'s pattern below) instead of writing its raw bytes
    // to a `.engine-<harness>.tar` file nothing ever reads. Extract fully
    // into an isolated staging directory first; only once that succeeds
    // completely does it replace the live harness directory via `rm` +
    // `rename`, so a failed/corrupt tarball leaves the previous install
    // (if any) completely untouched, same failure-safety property
    // `placeProjection` already has for plugins.
    placeEngine: async (bytes, harness, ref) => {
      const engineDir = join(config.projectRoot, resolveHarnessRoot(harness));
      const stagingDir = join(config.projectRoot, `.staging-engine-${harness}-${randomUUID()}`);
      await mkdir(stagingDir, { recursive: true });
      try {
        await extractTarGz(bytes, stagingDir);
      } catch (cause) {
        await rm(stagingDir, { recursive: true, force: true });
        throw cause;
      }

      // B: hash exactly what the engine tarball produced, before folding
      // in subtrees `PluginManager` owns independently of the engine
      // channel (see the preservation step just below) — those change on
      // their own schedule and must never register as engine drift.
      const engineFiles = await listFilesRecursive(stagingDir);
      const contentHash = await hashFiles(stagingDir, engineFiles);

      // code-review finding: unlike the plugin write path (`checkWriteAllowed`
      // below), this destructive rm+rename previously had no symlink check of
      // its own — `checkEngineDirectoryReplace` only enforces BR2.1
      // (force+backup), never BR2.4 (no write through a symlink). A
      // symlinked `engineDir` would have this rm/rename operate through it.
      // Reuses `checkWriteAllowed` rather than duplicating the ancestor-walk
      // logic that already lives in `FileOwnershipGuard`.
      await guard.checkWriteAllowed(engineDir, { isInitialSeedCopy: false });

      // Preserve plugin-owned state across an engine replace:
      // `PluginManager` writes `<engineDir>/plugins/*` and the generated
      // `<engineDir>/hooks/session-start.sh` independently of the engine
      // channel; an engine update must not silently destroy
      // already-installed plugins just because they live under the same
      // harness-root directory the engine tarball also owns.
      //
      // code-review finding: `cp(existing, ..., { recursive: true })`
      // dereferences symlinks by default — if `existing` were a symlink, this
      // would silently copy whatever it points at into the new live engine
      // tree. `lstat` (not `stat`) so a symlink itself is detected rather
      // than resolved.
      for (const preserved of ['plugins', 'hooks']) {
        const existing = join(engineDir, preserved);
        if (await pathExists(existing)) {
          if ((await lstat(existing)).isSymbolicLink()) {
            throw new FileOwnershipViolation(
              `refusing to preserve ${existing} across an engine replace: it is a symlink; no write ever passes through a symlink`,
            );
          }
          await rm(join(stagingDir, preserved), { recursive: true, force: true });
          await cp(existing, join(stagingDir, preserved), { recursive: true });
        }
      }

      await rm(engineDir, { recursive: true, force: true });
      await rename(stagingDir, engineDir);

      await writeInstallMarker(config.projectRoot, `engine-${harness}`, {
        ref,
        contentHash,
        files: engineFiles,
      });
    },
    runCompose: async (env) => {
      const { exitCode } = await runComposeCommand(config.composeCommand, env);
      return { exitCode, dropsFileContent: await readDropsFile(config.projectRoot) };
    },
    doctorFailures: () =>
      runDoctorCommand(config.doctorCommand, { AIDLC_PROJECT_DIR: config.projectRoot }),
    loadLockfile: async () => {
      try {
        return await lockfileStore.load();
      } catch {
        return undefined;
      }
    },
    // B: no longer echoes `engine.ref` into a side "installed state" file
    // here — `installedState.read()` now derives its answer from the
    // post-extraction marker `placeEngine` writes above, verified live
    // against disk on every read.
    saveLockfile: (lockfile) => lockfileStore.save(lockfile),
  });

  const pluginManager = new PluginManager({
    projectRoot: config.projectRoot,
    fetchPluginTarball: (plugin) =>
      channelClient.fetchTarball(buildTarballUrl(plugin.repo, plugin.ref), plugin.sha256),
    checkWriteAllowed: async (pluginLogicalName) => {
      // issue #5 (FR3.2): `PluginManager.pluginDirLabel()` now returns
      // only the plugin's logical name (FR3.1) — this integration-glue
      // closure is responsible for completing it into the real physical
      // write target (`.claude/plugins/<name>`) before handing it to
      // `FileOwnershipGuard`, so the symlink check (M4, BR2.4) actually
      // inspects the path this module writes to (`placeProjection`
      // below), not a `<projectRoot>/plugins/<name>` path that was never
      // the real target.
      //
      // issue #6: the plugin write root is resolved from the seeded
      // Lockfile's `engine.harness` (via plugin-targets.json), not
      // hardcoded to `.claude`.
      const harnessRoot = await resolveConfiguredHarnessRoot();
      await guard.checkWriteAllowed(
        join(config.projectRoot, harnessRoot, 'plugins', pluginLogicalName),
        { isInitialSeedCopy: false },
      );
    },
    loadLockfile: () => lockfileStore.load(),
    // B: same rationale as the engine's saveLockfile above — plugin
    // "installed" state is derived from `placeProjection`'s marker, not
    // echoed here.
    saveLockfile: (lockfile) => lockfileStore.save(lockfile),
    removeProjection: async (name) => {
      // FR2.1: recursively removes the entire extracted plugin tree.
      // Used directly by PluginManager.remove(); PluginManager.add()'s
      // update path no longer calls this ahead of placeProjection (see
      // placeProjection below — CodeRabbit review, issue #5 PR #7) since
      // placeProjection now performs its own atomic old-tree replacement.
      //
      // issue #6: resolved via the Lockfile's engine.harness, not
      // hardcoded to `.claude`.
      const harnessRoot = await resolveConfiguredHarnessRoot();
      await rm(join(config.projectRoot, harnessRoot, 'plugins', name), {
        recursive: true,
        force: true,
      });
      await deleteInstallMarker(config.projectRoot, `plugin-${name}`);
    },
    placeProjection: async (name, bytes, ref) => {
      // issue #5 (FR1.1): actually extract the verified gzip'd tar bytes
      // into a readable file tree, instead of writing the raw archive
      // bytes to `.projection.tar` (the original bug — upstream compose
      // never got a usable plugin directory). `extractTarGz` handles
      // gunzip, ustar parsing, wrapper-directory stripping (FR1.3), and
      // tar-slip path validation (FR4) itself.
      //
      // CodeRabbit review (PR #7) flagged two related data-integrity gaps
      // in extracting straight into the live `.claude/plugins/<name>`
      // directory: (1) a tarball whose entries conflict on the filesystem
      // (e.g. `a` as a file, then `a/b` needing `a` to be a directory)
      // could leave a partially-written live tree, and (2) BR4.1's
      // previous "remove old, then extract new" sequencing meant a
      // mid-extraction failure lost the old, working version entirely.
      // Fix: extract fully into a staging directory first; only once
      // extraction succeeds completely do we replace the live directory,
      // via `rm` + `rename` back to back. A failure at any point during
      // extraction leaves the live directory (old version, if any)
      // completely untouched and cleans up the staging directory.
      //
      // issue #6: resolved via the Lockfile's engine.harness, not
      // hardcoded to `.claude`.
      const harnessRoot = await resolveConfiguredHarnessRoot();
      const pluginsDir = join(config.projectRoot, harnessRoot, 'plugins');
      const targetDir = join(pluginsDir, name);
      const stagingDir = join(pluginsDir, `.staging-${name}-${randomUUID()}`);
      await mkdir(stagingDir, { recursive: true });
      try {
        await extractTarGz(bytes, stagingDir);
      } catch (cause) {
        await rm(stagingDir, { recursive: true, force: true });
        throw cause;
      }
      await rm(targetDir, { recursive: true, force: true });
      await rename(stagingDir, targetDir);

      // B: record a post-extraction marker from the real, just-placed
      // file tree (same mechanism as `placeEngine` above).
      const files = await listFilesRecursive(targetDir);
      const contentHash = await hashFiles(targetDir, files);
      await writeInstallMarker(config.projectRoot, `plugin-${name}`, { ref, contentHash, files });
    },
    runCompose: async (env) => {
      const { exitCode } = await runComposeCommand(config.composeCommand, env);
      return { exitCode, dropsFileContent: await readDropsFile(config.projectRoot) };
    },
    regenerateSessionStartHook: async (pluginNames) => {
      // issue #6: resolved via the Lockfile's engine.harness, not
      // hardcoded to `.claude`.
      const harnessRoot = await resolveConfiguredHarnessRoot();
      const hooksDir = join(config.projectRoot, harnessRoot, 'hooks');
      const hookPath = join(hooksDir, 'session-start.sh');
      await mkdir(hooksDir, { recursive: true });
      const body = pluginNames.map((name) => `# BEGIN ${name}\n# END ${name}`).join('\n');
      await writeFile(hookPath, `#!/bin/sh\n${body}\n`, 'utf8');
    },
    doctorFailures: () =>
      runDoctorCommand(config.doctorCommand, { AIDLC_PROJECT_DIR: config.projectRoot }),
  });

  return {
    lockfileStore: {
      loadClassified: async () => {
        try {
          const lockfile = await lockfileStore.load();
          return { state: 'present', lockfile };
        } catch (err) {
          if (err instanceof LockfileAbsentError) return { state: 'absent' };
          if (err instanceof LockfileMalformedError) return { state: 'malformed' };
          throw err;
        }
      },
      save: (lockfile) => lockfileStore.save(lockfile),
      pin: (ref) => lockfileStore.pin(ref),
      unpin: () => lockfileStore.unpin(),
    },
    channelClient: {
      fetchChannel: () => channelClient.fetchChannel(config.channelUrl),
    },
    versionGate: new VersionGate(),
    engineInstaller,
    pluginManager,
    driftDetector: new DriftDetector(),
    successVerifier,
    installedState: {
      // B: derives its answer from the real, post-extraction markers
      // `placeEngine`/`placeProjection` write, re-verified against
      // current disk content on every call — never from a value copied
      // out of the Lockfile at save time (issue: `installedEngineRef`
      // used to be a bare echo of `lockfile.engine.ref`, so
      // `DriftDetector`'s `local-modification` branch could structurally
      // never fire).
      read: async () => {
        let lockfile: Lockfile;
        try {
          lockfile = await lockfileStore.load();
        } catch {
          // No Lockfile yet — nothing to compare disk against.
          return { installedEngineRef: '', installedPluginRefs: {} };
        }
        let harnessRoot: string;
        try {
          harnessRoot = resolveHarnessRoot(lockfile.engine.harness);
        } catch {
          return { installedEngineRef: '', installedPluginRefs: {} };
        }
        const engineDir = join(config.projectRoot, harnessRoot);
        const installedEngineRef = await verifyInstalledRef(
          config.projectRoot,
          `engine-${lockfile.engine.harness}`,
          engineDir,
        );
        const installedPluginRefs: Record<string, string> = {};
        for (const plugin of lockfile.plugins) {
          const pluginDir = join(config.projectRoot, harnessRoot, 'plugins', plugin.name);
          installedPluginRefs[plugin.name] = await verifyInstalledRef(
            config.projectRoot,
            `plugin-${plugin.name}`,
            pluginDir,
          );
        }
        return { installedEngineRef, installedPluginRefs };
      },
    },
    doctorRunner: {
      run: () => runDoctorCommand(config.doctorCommand, { AIDLC_PROJECT_DIR: config.projectRoot }),
    },
    configAccess,
    harnessDetector: {
      detectDefault: () => detectDefaultHarness(config.projectRoot),
    },
    stdout: (line) => {
      process.stdout.write(`${line}\n`);
    },
    stderr: (line) => {
      process.stderr.write(`${line}\n`);
    },
  };
}
