/**
 * `SuccessVerifier` — implements the four-part success criterion (v0.1
 * §6, "最重要") and wraps upstream `doctor` with `known_failures`
 * filtering. `components.md`.
 *
 * BR3.1: success requires ALL THREE of (compose exited 0), (no
 * `[degraded]` line in the relevant `.drops` file), (doctor failed count
 * minus known_failures == 0) — a genuine boolean AND, not a checklist any
 * one of which suffices. BR3.3's plugin-sync-exit-1 reclassification is a
 * separate, independently-applied rule (`classifyPluginSyncExit`), not a
 * fourth conjunct folded into the AND (per `functional-spec.md`'s R-04
 * fix note).
 */

const DEGRADED_MARKER = '[degraded]';

export interface SuccessVerifierInput {
  composeExitCode: number;
  /** Content of the relevant `.drops` file, scanned for a `[degraded]` line. */
  dropsFileContent: string;
  /** Raw doctor failure identifiers, before known_failures filtering. */
  doctorFailures: string[];
  /** `Lockfile.known_failures` — doctor findings accepted as known. */
  knownFailures: string[];
}

export interface SuccessVerifierResult {
  success: boolean;
  composeOk: boolean;
  noDegraded: boolean;
  doctorOk: boolean;
  effectiveFailedCount: number;
  effectiveFailures: string[];
}

export type PluginSyncClassification = 'ok' | 'installation-incomplete' | 'failure';

export interface DoctorWrapResult {
  effectiveFailures: string[];
  effectiveFailedCount: number;
}

export class SuccessVerifier {
  /** BR3.1–BR3.2, BR3.4: the three-predicate boolean AND. */
  verify(input: SuccessVerifierInput): SuccessVerifierResult {
    const composeOk = input.composeExitCode === 0;
    const noDegraded = !input.dropsFileContent.includes(DEGRADED_MARKER);
    const { effectiveFailures, effectiveFailedCount } = this.wrapDoctor(
      { failures: input.doctorFailures },
      input.knownFailures,
    );
    const doctorOk = effectiveFailedCount === 0;

    return {
      success: composeOk && noDegraded && doctorOk,
      composeOk,
      noDegraded,
      doctorOk,
      effectiveFailedCount,
      effectiveFailures,
    };
  }

  /** BR3.4: filter raw doctor failures by `known_failures` before they contribute to the success determination (also used standalone by the `doctor` command, S2). */
  wrapDoctor(doctor: { failures: string[] }, knownFailures: string[]): DoctorWrapResult {
    const known = new Set(knownFailures);
    const effectiveFailures = doctor.failures.filter((failure) => !known.has(failure));
    return { effectiveFailures, effectiveFailedCount: effectiveFailures.length };
  }

  /** BR3.3: classify a plugin-sync step's exit code — 1 is "installation incomplete," not a hard failure. */
  classifyPluginSyncExit(exitCode: number): PluginSyncClassification {
    if (exitCode === 0) return 'ok';
    if (exitCode === 1) return 'installation-incomplete';
    return 'failure';
  }
}
