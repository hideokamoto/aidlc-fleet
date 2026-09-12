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

  /**
   * issue #14: when no doctor command is configured at all, `doctor`
   * used to print "no unaddressed failures" — indistinguishable from a
   * real run that checked and found nothing. It must now say plainly
   * that nothing was checked, while still exiting 0 (an unconfigured
   * doctor command is not itself a failure).
   */
  test('issue #14: reports "not configured" distinctly from a genuinely clean run', async () => {
    const { deps, logs } = makeFakeDeps();
    deps.doctorRunner.run = async () => ({ failures: [], configured: false });
    const result = await runDoctor(deps);
    expect(result.exitCode).toBe(0);
    const printed = [...logs.stdout, ...logs.stderr].join('\n');
    expect(printed).not.toContain('doctor: no unaddressed failures.');
    expect(printed.toLowerCase()).toContain('not configured');
  });

  test('issue #14: a genuinely clean, configured run still prints "no unaddressed failures"', async () => {
    const { deps, logs } = makeFakeDeps();
    deps.doctorRunner.run = async () => ({ failures: [], configured: true });
    const result = await runDoctor(deps);
    expect(result.exitCode).toBe(0);
    expect(logs.stdout.join('\n')).toContain('doctor: no unaddressed failures.');
  });
});
