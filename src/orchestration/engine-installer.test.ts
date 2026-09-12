import { test, expect, describe } from 'bun:test';
import { EngineInstaller } from './engine-installer';
import type { EngineInstallerPorts } from './engine-installer';
import type { ChannelEngine } from '../types/channel';
import type { Lockfile } from '../types/lockfile';
import { assertDefined } from '../test-support/assert-defined';

function makeLockfile(overrides: Partial<Lockfile> = {}): Lockfile {
  return {
    schema: 1,
    channel: 'stable',
    channel_commit: 'c1',
    engine: {
      ref: 'old-ref',
      version: '0.1.0',
      sha256: 'x',
      harness: 'claude-code',
      installed_at: 't0',
    },
    engine_origin: 'old-ref',
    plugins: [],
    managed: [],
    known_failures: [],
    pin: null,
    ...overrides,
  };
}

const channelEngine: ChannelEngine = {
  ref: 'new-ref',
  version: '0.2.0',
  tag: null,
  sha256: 'sha-new',
};

interface RecordedCalls {
  checkEngineDirectoryReplace: Array<{ force: boolean; harness: string }>;
  placeEngine: Array<[Uint8Array, string]>;
  runCompose: Array<Record<string, string>>;
  saveLockfile: Lockfile[];
}

function makePorts(overrides: Partial<EngineInstallerPorts> = {}): {
  ports: EngineInstallerPorts;
  calls: RecordedCalls;
} {
  const calls: RecordedCalls = {
    checkEngineDirectoryReplace: [],
    placeEngine: [],
    runCompose: [],
    saveLockfile: [],
  };
  let lockfile: Lockfile | undefined;

  const ports: EngineInstallerPorts = {
    fetchEngineTarball: async () => new TextEncoder().encode('engine-bytes'),
    checkEngineDirectoryReplace: async (opts: { force: boolean; harness: string }) => {
      calls.checkEngineDirectoryReplace.push(opts);
    },
    placeEngine: async (bytes: Uint8Array, harness: string) => {
      calls.placeEngine.push([bytes, harness]);
    },
    runCompose: async (env: Record<string, string>) => {
      calls.runCompose.push(env);
      return { exitCode: 0, dropsFileContent: 'ok\n' };
    },
    doctorFailures: async () => ({ failures: [], configured: true }),
    loadLockfile: async () => lockfile,
    saveLockfile: async (next: Lockfile) => {
      calls.saveLockfile.push(next);
      lockfile = next;
    },
    projectRoot: '/tmp/fake-project',
    ...overrides,
  };
  return { ports, calls };
}

describe('EngineInstaller.install (init)', () => {
  test('places the engine and creates the Lockfile on first init — no VersionGate check', async () => {
    const { ports, calls } = makePorts();
    const installer = new EngineInstaller(ports);
    const result = await installer.install(channelEngine, {
      harness: 'claude-code',
      force: false,
      isFirstInit: true,
    });

    expect(result.success).toBe(true);
    expect(calls.saveLockfile).toHaveLength(1);
    const saved = assertDefined(calls.saveLockfile[0]);
    expect(saved.engine_origin).toBe('new-ref');
    expect(saved.engine.ref).toBe('new-ref');
  });

  test('BR2.1: does not place the engine when FileOwnershipGuard rejects (no --force on existing dir)', async () => {
    const { ports, calls } = makePorts({
      checkEngineDirectoryReplace: async () => {
        throw new Error('refused: no --force');
      },
    });
    const installer = new EngineInstaller(ports);
    await expect(
      installer.install(channelEngine, {
        harness: 'claude-code',
        force: false,
        isFirstInit: false,
      }),
    ).rejects.toThrow();
    expect(calls.placeEngine).toHaveLength(0);
    expect(calls.saveLockfile).toHaveLength(0);
  });

  test('BR3.1: fails when SuccessVerifier does not pass, and the Lockfile is not updated', async () => {
    const { ports, calls } = makePorts({
      runCompose: async () => ({ exitCode: 1, dropsFileContent: 'ok\n' }),
    });
    const installer = new EngineInstaller(ports);
    const result = await installer.install(channelEngine, {
      harness: 'claude-code',
      force: false,
      isFirstInit: true,
    });
    expect(result.success).toBe(false);
    expect(calls.saveLockfile).toHaveLength(0);
  });

  test('an update (isFirstInit: false) writes an update transition, preserving engine_origin', async () => {
    const { ports, calls } = makePorts({ loadLockfile: async () => makeLockfile() });
    const installer = new EngineInstaller(ports);
    await installer.install(channelEngine, {
      harness: 'claude-code',
      force: true,
      isFirstInit: false,
    });
    const saved = assertDefined(calls.saveLockfile[0]);
    expect(saved.engine_origin).toBe('old-ref');
    expect(saved.engine.ref).toBe('new-ref');
  });

  test('issue #6: checkEngineDirectoryReplace is called with the install options harness, not just force', async () => {
    const { ports, calls } = makePorts();
    const installer = new EngineInstaller(ports);
    await installer.install(channelEngine, {
      harness: 'cursor',
      force: true,
      isFirstInit: true,
    });
    expect(calls.checkEngineDirectoryReplace).toEqual([{ force: true, harness: 'cursor' }]);
  });

  test('--adopt records the adoption marker consumed by BR1.5', async () => {
    const { ports, calls } = makePorts();
    const installer = new EngineInstaller(ports);
    await installer.install(channelEngine, {
      harness: 'claude-code',
      force: false,
      isFirstInit: true,
      adopt: true,
    });
    const saved = assertDefined(calls.saveLockfile[0]);
    expect(saved.managed).toContain('adopted');
  });

  /**
   * issue #14 (CodeRabbit pre-merge finding on PR #23): `doctorFailures()`
   * now reports whether a doctor command actually ran, and that must
   * reach `EngineInstallResult` so `init`/`update` can tell "doctor never
   * ran" apart from "doctor ran, found nothing" — the four-part success
   * check itself still passes either way (BR3.1's existing stance is
   * unchanged), only the visibility is new.
   */
  test('issue #14: doctorConfigured: false is surfaced on a successful install', async () => {
    const { ports } = makePorts({
      doctorFailures: async () => ({ failures: [], configured: false }),
    });
    const installer = new EngineInstaller(ports);
    const result = await installer.install(channelEngine, {
      harness: 'claude-code',
      force: false,
      isFirstInit: true,
    });
    expect(result.success).toBe(true);
    expect(result.doctorConfigured).toBe(false);
  });

  test('issue #14: doctorConfigured: true is surfaced on a successful, configured install', async () => {
    const { ports } = makePorts();
    const installer = new EngineInstaller(ports);
    const result = await installer.install(channelEngine, {
      harness: 'claude-code',
      force: false,
      isFirstInit: true,
    });
    expect(result.success).toBe(true);
    expect(result.doctorConfigured).toBe(true);
  });
});
