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
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { ChannelClient } from '../io/channel-client';
import { extractTarGz } from '../io/tar-extract';
import { LockfileStore, LockfileAbsentError, LockfileMalformedError } from '../io/lockfile-store';
import { LocalConfigStore } from '../io/local-config-store';
import { VersionGate } from '../core/version-gate';
import { SuccessVerifier } from '../core/success-verifier';
import { DriftDetector } from '../core/drift-detector';
import { FileOwnershipGuard } from '../core/file-ownership-guard';
import { ENV_CONFIG_KEYS, resolveEnvConfig } from '../core/env-config-resolver';
import { EngineInstaller } from '../orchestration/engine-installer';
import { PluginManager } from '../orchestration/plugin-manager';
import type { CommandDeps, ConfigAccess } from './types';
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
   * `owner/name` GitHub repo the engine tarball is fetched from. Required
   * whenever an engine install/update actually runs (`init`/`update`).
   * Unlike `ChannelPlugin`, `ChannelEngine` carries no `repo` field
   * (`contract-summary.md` Contract 1 — that schema is owned externally by
   * the channel operator, so this CLI cannot add one unilaterally); this
   * config value fills that gap without touching the contract. Configured
   * via `AIDLC_FLEET_ENGINE_REPO`.
   */
  engineRepo?: string;
}

const INSTALLED_STATE_FILE = '.aidlc-fleet-installed.json';
const DROPS_FILE = '.aidlc-fleet.drops';

interface InstalledStateFile {
  engineRef: string;
  pluginRefs: Record<string, string>;
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

async function readInstalledState(projectRoot: string): Promise<InstalledStateFile> {
  try {
    const raw = await readFile(join(projectRoot, INSTALLED_STATE_FILE), 'utf8');
    return JSON.parse(raw) as InstalledStateFile;
  } catch {
    return { engineRef: '', pluginRefs: {} };
  }
}

async function writeInstalledState(projectRoot: string, state: InstalledStateFile): Promise<void> {
  await writeFile(join(projectRoot, INSTALLED_STATE_FILE), JSON.stringify(state, null, 2), 'utf8');
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
    fetchEngineTarball: (engine) =>
      channelClient.fetchTarball(
        buildTarballUrl(config.engineRepo ?? '', engine.ref),
        engine.sha256,
      ),
    checkEngineDirectoryReplace: async (opts) => {
      const engineDir = join(config.projectRoot, resolveHarnessRoot(opts.harness));
      await guard.checkEngineDirectoryReplace(engineDir, opts);
    },
    placeEngine: async (bytes, harness) => {
      const engineDir = join(config.projectRoot, resolveHarnessRoot(harness));
      await mkdir(engineDir, { recursive: true });
      // Actual tarball extraction/install.ts wrapping is upstream's job
      // (never reimplemented here, project.md's Forbidden rule); this
      // writes the verified bytes to a staging path for the configured
      // compose command to consume.
      await writeFile(join(engineDir, `.engine-${harness}.tar`), bytes);
    },
    runCompose: async (env) => {
      const { exitCode } = await runComposeCommand(config.composeCommand, env);
      return { exitCode, dropsFileContent: await readDropsFile(config.projectRoot) };
    },
    doctorFailures: async () => {
      const { failures } = await runDoctorCommand(config.doctorCommand, {
        AIDLC_PROJECT_DIR: config.projectRoot,
      });
      return failures;
    },
    loadLockfile: async () => {
      try {
        return await lockfileStore.load();
      } catch {
        return undefined;
      }
    },
    saveLockfile: async (lockfile) => {
      await lockfileStore.save(lockfile);
      const state = await readInstalledState(config.projectRoot);
      await writeInstalledState(config.projectRoot, { ...state, engineRef: lockfile.engine.ref });
    },
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
    saveLockfile: async (lockfile) => {
      await lockfileStore.save(lockfile);
      const state = await readInstalledState(config.projectRoot);
      const pluginRefs = Object.fromEntries(lockfile.plugins.map((p) => [p.name, p.ref]));
      await writeInstalledState(config.projectRoot, { ...state, pluginRefs });
    },
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
    },
    placeProjection: async (name, bytes) => {
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
    doctorFailures: async () => {
      const { failures } = await runDoctorCommand(config.doctorCommand, {
        AIDLC_PROJECT_DIR: config.projectRoot,
      });
      return failures;
    },
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
      read: async () => {
        const state = await readInstalledState(config.projectRoot);
        return { installedEngineRef: state.engineRef, installedPluginRefs: state.pluginRefs };
      },
    },
    doctorRunner: {
      run: () => runDoctorCommand(config.doctorCommand, { AIDLC_PROJECT_DIR: config.projectRoot }),
    },
    configAccess,
    stdout: (line) => {
      process.stdout.write(`${line}\n`);
    },
    stderr: (line) => {
      process.stderr.write(`${line}\n`);
    },
  };
}
