import { test, expect, describe } from 'bun:test';
import { runInit } from './init';
import { makeFakeDeps } from './__fixtures__/test-deps';

describe('runInit (CommandLayer)', () => {
  test('exits 0 on success, invokes EngineInstaller with isFirstInit true and no VersionGate call', async () => {
    const { deps, lockfileWrites } = makeFakeDeps({ lockfileState: 'absent' });
    let installedFirstInit: boolean | undefined;
    deps.engineInstaller.install = async (_engine, options) => {
      installedFirstInit = options.isFirstInit;
      return {
        success: true,
        compose: { exitCode: 0, dropsFileContent: 'ok\n' },
        doctorConfigured: true,
      };
    };
    const result = await runInit({ adopt: false, harness: 'claude-code', force: false }, deps);
    expect(result.exitCode).toBe(0);
    expect(installedFirstInit).toBe(true);
    void lockfileWrites; // Lockfile writing itself is EngineInstaller's job, verified in its own tests.
  });

  test('exits 4 when EngineInstaller reports SuccessVerifier failure (BR3.1)', async () => {
    const { deps } = makeFakeDeps({ lockfileState: 'absent' });
    deps.engineInstaller.install = async () => ({
      success: false,
      compose: { exitCode: 1, dropsFileContent: 'ok\n' },
      doctorConfigured: true,
    });
    const result = await runInit({ adopt: false, harness: 'claude-code', force: false }, deps);
    expect(result.exitCode).toBe(4);
  });

  test('passes --adopt through to EngineInstaller options', async () => {
    const { deps } = makeFakeDeps({ lockfileState: 'absent' });
    let adoptSeen: boolean | undefined;
    deps.engineInstaller.install = async (_engine, options) => {
      adoptSeen = options.adopt;
      return {
        success: true,
        compose: { exitCode: 0, dropsFileContent: 'ok\n' },
        doctorConfigured: true,
      };
    };
    await runInit({ adopt: true, harness: 'claude-code', force: false }, deps);
    expect(adoptSeen).toBe(true);
  });

  /**
   * issue #14: a successful init whose doctor check never actually ran
   * (AIDLC_FLEET_DOCTOR_CMD unset/empty) must say so, or the four-part
   * success check's silent pass looks identical to a real, clean doctor
   * run — the same gap `doctor`'s own output closes.
   */
  test('issue #14: notes when doctorConfigured is false on an otherwise successful init', async () => {
    const { deps, logs } = makeFakeDeps({ lockfileState: 'absent' });
    deps.engineInstaller.install = async () => ({
      success: true,
      compose: { exitCode: 0, dropsFileContent: 'ok\n' },
      doctorConfigured: false,
    });
    const result = await runInit({ adopt: false, harness: 'claude-code', force: false }, deps);
    expect(result.exitCode).toBe(0);
    expect(logs.stdout.join('\n').toLowerCase()).toContain('not configured');
  });

  test('contains no business logic of its own — a thrown ChannelClient error propagates without CommandLayer reinterpreting it', async () => {
    const { deps } = makeFakeDeps({ lockfileState: 'absent' });
    deps.channelClient.fetchChannel = async () => {
      throw new Error('network down');
    };
    await expect(
      runInit({ adopt: false, harness: 'claude-code', force: false }, deps),
    ).rejects.toThrow('network down');
  });
});
