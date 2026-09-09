import { test, expect, describe } from 'bun:test';
import { runCheck } from './check';
import { makeFakeDeps, makeChannel, makeLockfile } from './__fixtures__/test-deps';

describe('runCheck (CommandLayer)', () => {
  test('exits 0 when in sync (BR5.2)', async () => {
    const { deps } = makeFakeDeps();
    const result = await runCheck(deps);
    expect(result.exitCode).toBe(0);
  });

  test('exits 1 when behind channel', async () => {
    const { deps } = makeFakeDeps({
      channel: makeChannel({ engine: { ref: 'newer', version: '0.9.0', sha256: 'x' } }),
    });
    const result = await runCheck(deps);
    expect(result.exitCode).toBe(1);
  });

  test('exits 2 when disk disagrees with the lockfile', async () => {
    const { deps } = makeFakeDeps();
    deps.installedState.read = async () => ({
      installedEngineRef: 'hand-modified',
      installedPluginRefs: {},
    });
    const result = await runCheck(deps);
    expect(result.exitCode).toBe(2);
  });

  test('exits 1 when the Lockfile is absent (BR8.1)', async () => {
    const { deps } = makeFakeDeps({ lockfileState: 'absent' });
    const result = await runCheck(deps);
    expect(result.exitCode).toBe(1);
  });

  test('performs no writes — check never mutates the Lockfile', async () => {
    const { deps, lockfileWrites } = makeFakeDeps();
    await runCheck(deps);
    expect(lockfileWrites).toHaveLength(0);
  });

  test('respects a pin override (BR5.3)', async () => {
    const { deps } = makeFakeDeps({
      lockfile: makeLockfile({ pin: 'e1' }),
      channel: makeChannel({ engine: { ref: 'much-newer', version: '9.0.0', sha256: 'x' } }),
    });
    const result = await runCheck(deps);
    expect(result.exitCode).toBe(0);
  });
});
