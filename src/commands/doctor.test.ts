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

  test('issue #18: prints each config variable and its source', async () => {
    const { deps, logs } = makeFakeDeps();
    await runDoctor(deps);
    const printed = logs.stdout.join('\n');
    expect(printed).toContain('AIDLC_FLEET_CHANNEL_URL');
    expect(printed).toContain('(env)');
    expect(printed).toContain('AIDLC_FLEET_ENGINE_REPO');
    expect(printed).toContain('(default)');
  });

  test('issue #18: an unset required variable (no env/local-config/default) is a doctor failure', async () => {
    const { deps } = makeFakeDeps({ envConfig: {} });
    const result = await runDoctor(deps);
    expect(result.exitCode).not.toBe(0);
  });

  test('issue #18: a variable resolved from its built-in default is NOT a doctor failure', async () => {
    const { deps } = makeFakeDeps();
    const result = await runDoctor(deps);
    // The default fixture leaves ENGINE_REPO/COMPOSE_CMD/DOCTOR_CMD on
    // their built-in defaults and only sets CHANNEL_URL via env — none of
    // that should fail doctor on its own.
    expect(result.exitCode).toBe(0);
  });

  /**
   * code-review finding: a malformed `.aidlc-fleet.local.json` used to make
   * `configAccess.resolveAll()` throw uncaught, crashing doctor entirely
   * instead of reporting it as exactly the kind of problem doctor exists
   * to surface.
   */
  test('issue #18: a malformed local-config file is reported as a doctor failure, not a crash', async () => {
    const { deps } = makeFakeDeps();
    deps.configAccess.resolveAll = async () => {
      throw new Error(
        'LocalConfigStore: .aidlc-fleet.local.json in /p is malformed: Unexpected token',
      );
    };
    const result = await runDoctor(deps);
    expect(result.exitCode).not.toBe(0);
  });
});
