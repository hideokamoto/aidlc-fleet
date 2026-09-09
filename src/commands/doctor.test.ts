import { test, expect, describe } from 'bun:test';
import { runDoctor } from './doctor';
import { makeFakeDeps, makeLockfile } from './__fixtures__/test-deps';

describe('runDoctor (CommandLayer)', () => {
  test('exits 0 when doctor reports no failures', async () => {
    const { deps } = makeFakeDeps();
    const result = await runDoctor(deps);
    expect(result.exitCode).toBe(0);
  });

  test('BR3.4: known_failures are filtered out before the exit code is decided', async () => {
    const { deps } = makeFakeDeps({ lockfile: makeLockfile({ known_failures: ['flaky-check'] }) });
    deps.doctorRunner.run = async () => ({ failures: ['flaky-check'] });
    const result = await runDoctor(deps);
    expect(result.exitCode).toBe(0);
  });

  test('a genuine (non-known) failure yields a non-zero exit', async () => {
    const { deps } = makeFakeDeps();
    deps.doctorRunner.run = async () => ({ failures: ['real-problem'] });
    const result = await runDoctor(deps);
    expect(result.exitCode).not.toBe(0);
  });

  test('is read-only — no Lockfile write', async () => {
    const { deps, lockfileWrites } = makeFakeDeps();
    await runDoctor(deps);
    expect(lockfileWrites).toHaveLength(0);
  });

  test('exits 1 when the Lockfile is absent (BR8.1)', async () => {
    const { deps } = makeFakeDeps({ lockfileState: 'absent' });
    const result = await runDoctor(deps);
    expect(result.exitCode).toBe(1);
  });
});
