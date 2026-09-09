import { test, expect, describe } from 'bun:test';
import { runPin, runUnpin } from './pin';
import { makeFakeDeps } from './__fixtures__/test-deps';

describe('runPin (CommandLayer)', () => {
  test('exits 0 and persists the ref on a valid ref (BR6.1)', async () => {
    const { deps, pinCalls } = makeFakeDeps();
    const result = await runPin('deadbeefcafe', deps);
    expect(result.exitCode).toBe(0);
    expect(pinCalls).toEqual(['deadbeefcafe']);
  });

  test('rejects an invalid ref format before the write (BR6.1 violation_behaviour)', async () => {
    const { deps, pinCalls } = makeFakeDeps();
    const result = await runPin('not a valid ref!!', deps);
    expect(result.exitCode).not.toBe(0);
    expect(pinCalls).toEqual([]);
  });

  test('exits 1 when the Lockfile is absent (BR8.1)', async () => {
    const { deps } = makeFakeDeps({ lockfileState: 'absent' });
    const result = await runPin('deadbeefcafe', deps);
    expect(result.exitCode).toBe(1);
  });
});

describe('runUnpin (CommandLayer)', () => {
  test('exits 0 and clears the pin', async () => {
    const { deps, unpinCalls } = makeFakeDeps();
    const result = await runUnpin(deps);
    expect(result.exitCode).toBe(0);
    expect(unpinCalls.count).toBe(1);
  });

  test('exits 1 when the Lockfile is absent (BR8.1)', async () => {
    const { deps } = makeFakeDeps({ lockfileState: 'absent' });
    const result = await runUnpin(deps);
    expect(result.exitCode).toBe(1);
  });
});
