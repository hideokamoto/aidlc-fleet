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
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ChannelClient } from '../io/channel-client';
import { extractTarGz } from '../io/tar-extract';
import { LockfileStore, LockfileAbsentError, LockfileMalformedError } from '../io/lockfile-store';
import { VersionGate } from '../core/version-gate';
import { SuccessVerifier } from '../core/success-verifier';
import { DriftDetector } from '../core/drift-detector';
import { FileOwnershipGuard } from '../core/file-ownership-guard';
import { EngineInstaller } from '../orchestration/engine-installer';
import { PluginManager } from '../orchestration/plugin-manager';
import type { CommandDeps } from './types';

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
): Promise<{ failures: string[] }> {
  const [cmd, ...args] = doctorCommand ?? [];
  if (!cmd) {
    // No upstream doctor command configured (AIDLC_FLEET_DOCTOR_CMD
    // unset): safe default is "no unaddressed failures reported," same
    // as an upstream doctor run that found nothing wrong — this never
    // silently swallows a real failure, since there is no real
    // invocation to swallow one from.
    return { failures: [] };
  }
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
  return { failures: parseDoctorOutput(stdout) };
}

async function readDropsFile(projectRoot: string): Promise<string> {
  try {
    return await readFile(join(projectRoot, DROPS_FILE), 'utf8');
  } catch {
    return '';
  }
}

export function buildRealDeps(config: RealDepsConfig): CommandDeps {
  const lockfileStore = new LockfileStore(config.projectRoot);
  const channelClient = new ChannelClient();
  const guard = new FileOwnershipGuard({ projectRoot: config.projectRoot });
  const successVerifier = new SuccessVerifier();

  const engineInstaller = new EngineInstaller({
    projectRoot: config.projectRoot,
    fetchEngineTarball: (engine) =>
      channelClient.fetchTarball(
        buildTarballUrl(config.engineRepo ?? '', engine.ref),
        engine.sha256,
      ),
    checkEngineDirectoryReplace: async (opts) => {
      await guard.checkEngineDirectoryReplace(join(config.projectRoot, '.claude'), opts);
    },
    placeEngine: async (bytes, harness) => {
      const engineDir = join(config.projectRoot, '.claude');
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
      await guard.checkWriteAllowed(
        join(config.projectRoot, '.claude', 'plugins', pluginLogicalName),
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
      // FR2.1: recursively removes the entire extracted plugin tree (not
      // just a single `.projection.tar` file, now that placeProjection
      // below actually extracts one) — PluginManager.add() always calls
      // this before placeProjection when a prior version exists (BR4.1),
      // so no file from the old version can survive into the new one.
      await rm(join(config.projectRoot, '.claude', 'plugins', name), {
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
      const dir = join(config.projectRoot, '.claude', 'plugins', name);
      await mkdir(dir, { recursive: true });
      await extractTarGz(bytes, dir);
    },
    runCompose: async (env) => {
      const { exitCode } = await runComposeCommand(config.composeCommand, env);
      return { exitCode, dropsFileContent: await readDropsFile(config.projectRoot) };
    },
    regenerateSessionStartHook: async (pluginNames) => {
      const hookPath = join(config.projectRoot, '.claude', 'hooks', 'session-start.sh');
      await mkdir(join(config.projectRoot, '.claude', 'hooks'), { recursive: true });
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
    stdout: (line) => {
      process.stdout.write(`${line}\n`);
    },
    stderr: (line) => {
      process.stderr.write(`${line}\n`);
    },
  };
}
