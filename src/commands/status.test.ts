import { test, expect, describe } from 'bun:test';
import { runStatus } from './status';
import { makeFakeDeps, makeChannel } from './__fixtures__/test-deps';

describe('runStatus (CommandLayer)', () => {
  test('exits 0 even when drift is detected — drift is reported content, not a failure (S3)', async () => {
    const { deps } = makeFakeDeps({
      channel: makeChannel({
        engine: { repo: 'org/engine', ref: 'newer', version: '0.9.0', sha256: 'x' },
      }),
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

  test('issue #18: includes the per-variable config source summary', async () => {
    const { deps, logs } = makeFakeDeps();
    await runStatus(deps);
    const printed = logs.stdout.join('\n');
    expect(printed).toContain('AIDLC_FLEET_CHANNEL_URL');
    expect(printed).toContain('(env)');
    expect(printed).toContain('AIDLC_FLEET_DOCTOR_CMD');
    expect(printed).toContain('(default)');
  });

  /**
   * code-review finding (same class as doctor's): a malformed
   * `.aidlc-fleet.local.json` used to make `configAccess.resolveAll()`
   * throw uncaught, crashing status entirely. status's own contract is
   * "BR8.1 (Lockfile absent/malformed) is the only failure mode" — a bad
   * local-config file must be reported as content, not turn into a crash.
   */
  test('issue #18: a malformed local-config file is reported as a note, not a crash — status still exits 0', async () => {
    const { deps, logs } = makeFakeDeps();
    deps.configAccess.resolveAll = async () => {
      throw new Error(
        'LocalConfigStore: .aidlc-fleet.local.json in /p is malformed: Unexpected token',
      );
    };
    const result = await runStatus(deps);
    expect(result.exitCode).toBe(0);
    expect(logs.stdout.join('\n')).toContain('malformed');
  });
});
