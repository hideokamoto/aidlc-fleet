/**
 * `doctor` command — `functional-spec.md`'s `doctor` workflow. Runs
 * upstream `doctor` via the injected port, filters `known_failures`
 * through `SuccessVerifier.wrapDoctor` (BR3.4), and exits per the
 * filtered result. Read-only — no Lockfile transition.
 */
import { exitCodeForInstall, exitCodeForLockfileAccess } from '../core/exit-code';
import type { CommandDeps, CommandResult } from './types';

export async function runDoctor(deps: CommandDeps): Promise<CommandResult> {
  const loaded = await deps.lockfileStore.loadClassified();
  if (loaded.state !== 'present') {
    deps.stderr('doctor: no Lockfile found. Run "aidlc-fleet init" first.');
    return { exitCode: exitCodeForLockfileAccess(loaded.state) };
  }

  const raw = await deps.doctorRunner.run();
  const wrapped = deps.successVerifier.wrapDoctor(raw, loaded.lockfile.known_failures);

  if (wrapped.effectiveFailedCount === 0) {
    deps.stdout('doctor: no unaddressed failures.');
  } else {
    deps.stderr(
      `doctor: ${wrapped.effectiveFailedCount} failure(s): ${wrapped.effectiveFailures.join(', ')}`,
    );
  }

  // doctor's own success/failure reuses the same "compose degraded /
  // install incomplete" bucket (M8's code 4) that SuccessVerifier
  // failures use elsewhere, since a failing doctor run is exactly that
  // predicate's third conjunct (BR3.1) evaluated standalone.
  return { exitCode: exitCodeForInstall(wrapped.effectiveFailedCount === 0) };
}
