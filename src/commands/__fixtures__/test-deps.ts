/** Shared fake `CommandDeps` builder for CommandLayer tests (Step 12). */
import { VersionGate } from '../../core/version-gate';
import { SuccessVerifier } from '../../core/success-verifier';
import { DriftDetector } from '../../core/drift-detector';
import type { CommandDeps, LockfileAccess } from '../types';
import type { Lockfile } from '../../types/lockfile';
import type { Channel } from '../../types/channel';

export function makeLockfile(overrides: Partial<Lockfile> = {}): Lockfile {
  return {
    schema: 1,
    channel: 'stable',
    channel_commit: 'c1',
    engine: { ref: 'e1', version: '0.1.0', sha256: 'x', harness: 'claude-code', installed_at: 't' },
    engine_origin: 'e1',
    plugins: [],
    managed: [],
    known_failures: [],
    pin: null,
    ...overrides,
  };
}

export function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    schema: 1,
    channel: 'stable',
    engine: { ref: 'e1', version: '0.1.0', sha256: 'x' },
    migration_boundaries: [],
    plugins: [],
    ...overrides,
  };
}

export interface FakeDepsOptions {
  lockfileState?: 'present' | 'absent' | 'malformed';
  lockfile?: Lockfile;
  channel?: Channel;
}

export function makeFakeDeps(options: FakeDepsOptions = {}): {
  deps: CommandDeps;
  logs: { stdout: string[]; stderr: string[] };
  lockfileWrites: Lockfile[];
  pinCalls: string[];
  unpinCalls: { count: number };
} {
  const logs = { stdout: [] as string[], stderr: [] as string[] };
  const lockfileWrites: Lockfile[] = [];
  const pinCalls: string[] = [];
  const unpinCalls = { count: 0 };
  const lockfileState = options.lockfileState ?? 'present';
  const lockfile = options.lockfile ?? makeLockfile();
  const channel = options.channel ?? makeChannel();

  const lockfileStore: LockfileAccess = {
    loadClassified: async () => {
      if (lockfileState === 'present') return { state: 'present', lockfile };
      return { state: lockfileState };
    },
    save: async (next) => {
      lockfileWrites.push(next);
    },
    pin: async (ref) => {
      pinCalls.push(ref);
    },
    unpin: async () => {
      unpinCalls.count += 1;
    },
  };

  const deps: CommandDeps = {
    lockfileStore,
    channelClient: { fetchChannel: async () => channel },
    versionGate: new VersionGate(),
    engineInstaller: {
      install: async () => ({ success: true, compose: { exitCode: 0, dropsFileContent: 'ok\n' } }),
    },
    pluginManager: {
      add: async () => ({
        success: true,
        compose: { exitCode: 0, dropsFileContent: 'ok\n' },
        pluginSyncClassification: 'ok',
      }),
      remove: async () => ({
        success: true,
        compose: { exitCode: 0, dropsFileContent: 'ok\n' },
        pluginSyncClassification: 'ok',
      }),
    },
    driftDetector: new DriftDetector(),
    successVerifier: new SuccessVerifier(),
    installedState: {
      read: async () => ({ installedEngineRef: lockfile.engine.ref, installedPluginRefs: {} }),
    },
    doctorRunner: { run: async () => ({ failures: [] }) },
    stdout: (line) => logs.stdout.push(line),
    stderr: (line) => logs.stderr.push(line),
  };

  return { deps, logs, lockfileWrites, pinCalls, unpinCalls };
}
