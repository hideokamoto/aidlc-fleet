import { test, expect, describe } from 'bun:test';
import { runUpdate } from './update';
import { makeFakeDeps, makeChannel } from './__fixtures__/test-deps';
import { EngineInstaller } from '../orchestration/engine-installer';
import type { EngineInstallerPorts } from '../orchestration/engine-installer';
import type { ChannelEngine } from '../types/channel';
import type { Lockfile } from '../types/lockfile';

describe('runUpdate (CommandLayer)', () => {
  test('exits 3 when VersionGate rejects (BR1.1 reject boundary)', async () => {
    const { deps } = makeFakeDeps({
      channel: makeChannel({
        engine: { ref: 'new', version: '0.5.0', sha256: 'x' },
        migration_boundaries: [{ before: '0.5.0', action: 'reject' }],
      }),
    });
    const result = await runUpdate({ acknowledgeMigration: false }, deps);
    expect(result.exitCode).toBe(3);
  });

  test('exits 3 when a manual boundary lacks --acknowledge-migration', async () => {
    const { deps } = makeFakeDeps({
      channel: makeChannel({
        engine: { ref: 'new', version: '0.5.0', sha256: 'x' },
        migration_boundaries: [{ before: '0.5.0', action: 'manual' }],
      }),
    });
    const result = await runUpdate({ acknowledgeMigration: false }, deps);
    expect(result.exitCode).toBe(3);
  });

  test('exits 0 when the gate passes and EngineInstaller succeeds', async () => {
    const { deps } = makeFakeDeps({
      channel: makeChannel({ engine: { ref: 'new', version: '0.2.0', sha256: 'x' } }),
    });
    const result = await runUpdate({ acknowledgeMigration: false }, deps);
    expect(result.exitCode).toBe(0);
  });

  test('issue #14: notes when doctorConfigured is false on an otherwise successful update', async () => {
    const { deps, logs } = makeFakeDeps({
      channel: makeChannel({ engine: { ref: 'new', version: '0.2.0', sha256: 'x' } }),
    });
    deps.engineInstaller.install = async () => ({
      success: true,
      compose: { exitCode: 0, dropsFileContent: 'ok\n' },
      doctorConfigured: false,
    });
    const result = await runUpdate({ acknowledgeMigration: false }, deps);
    expect(result.exitCode).toBe(0);
    expect(logs.stdout.join('\n').toLowerCase()).toContain('not configured');
  });

  test('exits 4 when the gate passes but SuccessVerifier fails', async () => {
    const { deps } = makeFakeDeps({
      channel: makeChannel({ engine: { ref: 'new', version: '0.2.0', sha256: 'x' } }),
    });
    deps.engineInstaller.install = async () => ({
      success: false,
      compose: { exitCode: 1, dropsFileContent: 'ok\n' },
      doctorConfigured: true,
    });
    const result = await runUpdate({ acknowledgeMigration: false }, deps);
    expect(result.exitCode).toBe(4);
  });

  test('exits 1 when the Lockfile is absent (BR8.1 — directs the human to init)', async () => {
    const { deps } = makeFakeDeps({ lockfileState: 'absent' });
    const result = await runUpdate({ acknowledgeMigration: false }, deps);
    expect(result.exitCode).toBe(1);
  });

  describe('BR1.5 (structural, see version-gate.ts doc comment)', () => {
    /**
     * BR1.5's precondition ("an adopted project's first update requires
     * `init --adopt` to have already run") can never actually be
     * violated by any Lockfile this CLI itself produced — `EngineInstaller`
     * sets `engine_origin` unconditionally on every `init`, adopted or
     * not. This drives a real `EngineInstaller.install()` call (a plain
     * `init`, no `--adopt`) to produce the Lockfile it would actually
     * write on disk, then feeds that exact Lockfile through `runUpdate`
     * to confirm the real end-to-end flow succeeds normally rather than
     * being rejected by a dead "adoption precondition" branch.
     */
    test('a Lockfile produced by a plain `init` (no --adopt) updates successfully', async () => {
      const channelEngine: ChannelEngine = {
        ref: 'origin-ref',
        version: '0.1.0',
        tag: null,
        sha256: 'sha-origin',
      };
      let savedLockfile: Lockfile | undefined;
      const initPorts: EngineInstallerPorts = {
        fetchEngineTarball: async () => new TextEncoder().encode('engine-bytes'),
        checkEngineDirectoryReplace: async () => {},
        placeEngine: async () => {},
        runCompose: async () => ({ exitCode: 0, dropsFileContent: 'ok\n' }),
        doctorFailures: async () => ({ failures: [], configured: true }),
        loadLockfile: async () => undefined,
        saveLockfile: async (next) => {
          savedLockfile = next;
        },
        projectRoot: '/tmp/fake-project',
      };
      const installer = new EngineInstaller(initPorts);
      const initResult = await installer.install(channelEngine, {
        harness: 'claude-code',
        force: false,
        isFirstInit: true,
        adopt: false,
      });
      expect(initResult.success).toBe(true);
      expect(savedLockfile).toBeDefined();
      // Sanity-check the precondition this test is actually exercising:
      // a plain init already recorded a non-empty engine_origin.
      expect(savedLockfile!.engine_origin).toBe('origin-ref');

      const { deps } = makeFakeDeps({
        lockfile: savedLockfile,
        channel: makeChannel({ engine: { ref: 'new-ref', version: '0.2.0', sha256: 'x' } }),
      });
      const result = await runUpdate({ acknowledgeMigration: false }, deps);
      expect(result.exitCode).toBe(0);
    });
  });
});
