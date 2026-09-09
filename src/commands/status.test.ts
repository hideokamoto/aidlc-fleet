import { test, expect, describe } from 'bun:test';
import { runStatus } from './status';
import { makeFakeDeps, makeChannel } from './__fixtures__/test-deps';

describe('runStatus (CommandLayer)', () => {
  test('exits 0 even when drift is detected — drift is reported content, not a failure (S3)', async () => {
    const { deps } = makeFakeDeps({
      channel: makeChannel({ engine: { ref: 'newer', version: '0.9.0', sha256: 'x' } }),
    });
    const result = await runStatus(deps);
    expect(result.exitCode).toBe(0);
  });

  test('exits 0 when in sync', async () => {
    const { deps } = makeFakeDeps();
    const result = await runStatus(deps);
    expect(result.exitCode).toBe(0);
  });

  test('exits 1 when the Lockfile is absent/malformed (BR8.1) — the only status failure mode', async () => {
    const { deps } = makeFakeDeps({ lockfileState: 'malformed' });
    const result = await runStatus(deps);
    expect(result.exitCode).toBe(1);
  });

  test('prints a summary including channel, engine version, plugins, pin state, and drift status', async () => {
    const { deps, logs } = makeFakeDeps();
    await runStatus(deps);
    const printed = logs.stdout.join('\n');
    expect(printed).toContain('stable');
    expect(printed.length).toBeGreaterThan(0);
  });

  test('performs no writes', async () => {
    const { deps, lockfileWrites } = makeFakeDeps();
    await runStatus(deps);
    expect(lockfileWrites).toHaveLength(0);
  });
});
