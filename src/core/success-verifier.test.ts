import { test, expect, describe } from 'bun:test';
import { SuccessVerifier } from './success-verifier';

describe('SuccessVerifier', () => {
  test('BR3.1: success requires all three checks together (all pass -> success)', () => {
    const verifier = new SuccessVerifier();
    const result = verifier.verify({
      composeExitCode: 0,
      dropsFileContent: 'ok: all good\n',
      doctorFailures: [],
      doctorConfigured: true,
      knownFailures: [],
    });
    expect(result.success).toBe(true);
  });

  test('BR3.2: compose exit 0 alone is insufficient — a [degraded] line still fails the whole check', () => {
    const verifier = new SuccessVerifier();
    const result = verifier.verify({
      composeExitCode: 0,
      dropsFileContent: 'status: [degraded] plugin sync incomplete\n',
      doctorFailures: [],
      doctorConfigured: true,
      knownFailures: [],
    });
    expect(result.success).toBe(false);
    expect(result.composeOk).toBe(true);
    expect(result.noDegraded).toBe(false);
  });

  test('BR3.1: a non-zero compose exit fails the whole check even with no degraded line and clean doctor', () => {
    const verifier = new SuccessVerifier();
    const result = verifier.verify({
      composeExitCode: 1,
      dropsFileContent: 'ok\n',
      doctorFailures: [],
      doctorConfigured: true,
      knownFailures: [],
    });
    expect(result.success).toBe(false);
    expect(result.composeOk).toBe(false);
  });

  test('BR3.4: doctor failures matching known_failures are filtered before the count is judged', () => {
    const verifier = new SuccessVerifier();
    const result = verifier.verify({
      composeExitCode: 0,
      dropsFileContent: 'ok\n',
      doctorFailures: ['stale-cache-warning', 'missing-optional-tool'],
      doctorConfigured: true,
      knownFailures: ['stale-cache-warning', 'missing-optional-tool'],
    });
    expect(result.effectiveFailedCount).toBe(0);
    expect(result.success).toBe(true);
  });

  test('BR3.4: a doctor failure not in known_failures still counts against success', () => {
    const verifier = new SuccessVerifier();
    const result = verifier.verify({
      composeExitCode: 0,
      dropsFileContent: 'ok\n',
      doctorFailures: ['stale-cache-warning', 'unexpected-real-failure'],
      doctorConfigured: true,
      knownFailures: ['stale-cache-warning'],
    });
    expect(result.effectiveFailedCount).toBe(1);
    expect(result.success).toBe(false);
    expect(result.doctorOk).toBe(false);
  });

  test('BR3.3: a plugin-sync exit code of 1 classifies as installation-incomplete, not failure', () => {
    const verifier = new SuccessVerifier();
    const classification = verifier.classifyPluginSyncExit(1);
    expect(classification).toBe('installation-incomplete');
  });

  test('BR3.3: a plugin-sync exit code of 0 classifies as ok', () => {
    const verifier = new SuccessVerifier();
    expect(verifier.classifyPluginSyncExit(0)).toBe('ok');
  });

  test('BR3.3: a plugin-sync exit code other than 0/1 classifies as failure', () => {
    const verifier = new SuccessVerifier();
    expect(verifier.classifyPluginSyncExit(2)).toBe('failure');
  });

  test('doctor wrap: filters known_failures out of the raw doctor failure list (S2)', () => {
    const verifier = new SuccessVerifier();
    const filtered = verifier.wrapDoctor({ failures: ['a', 'b', 'c'] }, ['b']);
    expect(filtered.effectiveFailures).toEqual(['a', 'c']);
    expect(filtered.effectiveFailedCount).toBe(2);
  });

  /**
   * issue #14 (CodeRabbit pre-merge finding on PR #23): the "not
   * configured" distinction added to `runDoctorCommand`/`doctor` must
   * also reach the four-part install success check `EngineInstaller`/
   * `PluginManager` use, or `init`/`update` still cannot tell "doctor
   * never ran" apart from "doctor ran and found nothing" — exactly the
   * gap the issue's Impact section calls out. `doctorConfigured` is
   * carried through to the result unchanged; it does NOT alter
   * `success`/`doctorOk` — an unconfigured doctor command remains
   * non-blocking by design (BR3.1's existing stance), only now that
   * fact is visible to callers instead of silently indistinguishable.
   */
  test('issue #14: doctorConfigured is carried through to the result without affecting success', () => {
    const verifier = new SuccessVerifier();
    const result = verifier.verify({
      composeExitCode: 0,
      dropsFileContent: 'ok\n',
      doctorFailures: [],
      doctorConfigured: false,
      knownFailures: [],
    });
    expect(result.doctorConfigured).toBe(false);
    expect(result.success).toBe(true);
    expect(result.doctorOk).toBe(true);
  });

  test('issue #14: a configured, clean doctor run reports doctorConfigured: true', () => {
    const verifier = new SuccessVerifier();
    const result = verifier.verify({
      composeExitCode: 0,
      dropsFileContent: 'ok\n',
      doctorFailures: [],
      doctorConfigured: true,
      knownFailures: [],
    });
    expect(result.doctorConfigured).toBe(true);
    expect(result.success).toBe(true);
  });
});
