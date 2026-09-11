import { test, expect, describe } from 'bun:test';
import { PluginManager } from './plugin-manager';
import type { PluginManagerPorts } from './plugin-manager';
import type { ChannelPlugin } from '../types/channel';
import type { Lockfile } from '../types/lockfile';

function makeLockfile(overrides: Partial<Lockfile> = {}): Lockfile {
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

const channelPlugin: ChannelPlugin = {
  name: 'sample-plugin',
  repo: 'org/sample-plugin',
  ref: 'new-ref',
  version: '2.0.0',
  sha256: 'sha-new',
};

interface RecordedCalls {
  removeProjection: string[];
  placeProjection: Array<[string, number]>;
  runCompose: Array<Record<string, string>>;
  saveLockfile: Lockfile[];
  regenerateHook: Array<string[]>;
}

function makePorts(overrides: Partial<PluginManagerPorts> = {}): {
  ports: PluginManagerPorts;
  calls: RecordedCalls;
} {
  const calls: RecordedCalls = {
    removeProjection: [],
    placeProjection: [],
    runCompose: [],
    saveLockfile: [],
    regenerateHook: [],
  };
  let lockfile = makeLockfile();

  const ports: PluginManagerPorts = {
    fetchPluginTarball: async (plugin: ChannelPlugin) =>
      new TextEncoder().encode(`bytes-for-${plugin.name}`),
    checkWriteAllowed: async () => undefined,
    loadLockfile: async () => lockfile,
    saveLockfile: async (next: Lockfile) => {
      calls.saveLockfile.push(next);
      lockfile = next;
    },
    removeProjection: async (name: string) => {
      calls.removeProjection.push(name);
    },
    placeProjection: async (name: string, bytes: Uint8Array) => {
      calls.placeProjection.push([name, bytes.length]);
    },
    runCompose: async (env: Record<string, string>) => {
      calls.runCompose.push(env);
      return { exitCode: 0, dropsFileContent: 'ok\n' };
    },
    regenerateSessionStartHook: async (names: string[]) => {
      calls.regenerateHook.push(names);
    },
    doctorFailures: async () => [],
    projectRoot: '/tmp/fake-project',
    ...overrides,
  };
  return { ports, calls };
}

describe('PluginManager.add', () => {
  test('places a new plugin and records it in the Lockfile on success', async () => {
    const { ports, calls } = makePorts();
    const manager = new PluginManager(ports);
    const result = await manager.add(channelPlugin);

    expect(result.success).toBe(true);
    expect(calls.placeProjection).toHaveLength(1);
    expect(calls.saveLockfile).toHaveLength(1);
    const saved = calls.saveLockfile[0]!;
    expect(saved.plugins.map((p) => p.name)).toContain('sample-plugin');
  });

  test('BR4.1: places the new projection without a separate pre-removal call when one already exists (placeProjection performs the atomic swap itself)', async () => {
    const { ports, calls } = makePorts();
    const existingLockfile = makeLockfile({
      plugins: [
        {
          name: 'sample-plugin',
          ref: 'old-ref',
          version: '1.0.0',
          sha256: 'sha-old',
          composed_at: 't0',
          engine_version_at_compose: '0.1.0',
        },
      ],
    });
    ports.loadLockfile = async () => existingLockfile;

    const manager = new PluginManager(ports);
    await manager.add(channelPlugin);

    expect(calls.placeProjection).toHaveLength(1);
    // No separate removeProjection call ahead of placement: the old
    // version must stay intact until the new one is fully, successfully
    // extracted — an eager pre-removal would delete a working old version
    // before that is known (CodeRabbit review, issue #5 PR #7). The real
    // `placeProjection` port implementation (real-deps.ts) performs the
    // old-tree replacement atomically as part of placement itself, and
    // that atomicity is verified against the real filesystem in
    // real-deps.test.ts, not here (this test only exercises dispatch
    // ordering against mocked ports).
    expect(calls.removeProjection).toEqual([]);
  });

  test('runs compose with AIDLC_PROJECT_DIR set', async () => {
    const { ports, calls } = makePorts();
    const manager = new PluginManager(ports);
    await manager.add(channelPlugin);
    const env = calls.runCompose[0]!;
    expect(env.AIDLC_PROJECT_DIR).toBeTruthy();
  });

  test('BR3.1 via SuccessVerifier: a [degraded] drops line fails the add, and the Lockfile is not updated', async () => {
    const { ports, calls } = makePorts({
      runCompose: async () => ({ exitCode: 0, dropsFileContent: '[degraded]\n' }),
    });
    const manager = new PluginManager(ports);
    const result = await manager.add(channelPlugin);
    expect(result.success).toBe(false);
    expect(calls.saveLockfile).toHaveLength(0);
  });

  test('regenerates the sessionStart hook wrapper to include the new plugin', async () => {
    const { ports, calls } = makePorts();
    const manager = new PluginManager(ports);
    await manager.add(channelPlugin);
    expect(calls.regenerateHook[0]).toContain('sample-plugin');
  });
});

describe('PluginManager.remove', () => {
  test('removes the plugin and updates the Lockfile plugins[] on success', async () => {
    const existingLockfile = makeLockfile({
      plugins: [
        {
          name: 'sample-plugin',
          ref: 'old-ref',
          version: '1.0.0',
          sha256: 'sha-old',
          composed_at: 't0',
          engine_version_at_compose: '0.1.0',
        },
      ],
    });
    const { ports, calls } = makePorts({ loadLockfile: async () => existingLockfile });
    const manager = new PluginManager(ports);
    const result = await manager.remove('sample-plugin');

    expect(result.success).toBe(true);
    expect(calls.removeProjection).toEqual(['sample-plugin']);
    const saved = calls.saveLockfile[0]!;
    expect(saved.plugins).toEqual([]);
  });

  test('regenerates the sessionStart hook wrapper without the removed plugin', async () => {
    const existingLockfile = makeLockfile({
      plugins: [
        {
          name: 'sample-plugin',
          ref: 'r',
          version: '1.0.0',
          sha256: 's',
          composed_at: 't',
          engine_version_at_compose: '0.1.0',
        },
        {
          name: 'other-plugin',
          ref: 'r2',
          version: '1.0.0',
          sha256: 's2',
          composed_at: 't',
          engine_version_at_compose: '0.1.0',
        },
      ],
    });
    const { ports, calls } = makePorts({ loadLockfile: async () => existingLockfile });
    const manager = new PluginManager(ports);
    await manager.remove('sample-plugin');
    expect(calls.regenerateHook[0]).toEqual(['other-plugin']);
  });
});
