/**
 * `doctor` command — `functional-spec.md`'s `doctor` workflow. Runs
 * upstream `doctor` via the injected port, filters `known_failures`
 * through `SuccessVerifier.wrapDoctor` (BR3.4), and exits per the
 * filtered result. Read-only — no Lockfile transition.
 */
import { exitCodeForInstall, exitCodeForLockfileAccess } from '../core/exit-code';
import { ENV_CONFIG_KEYS } from '../core/env-config-resolver';
import type { CommandDeps, CommandResult } from './types';

export async function runDoctor(deps: CommandDeps): Promise<CommandResult> {
  const loaded = await deps.lockfileStore.loadClassified();
  if (loaded.state !== 'present') {
    deps.stderr('doctor: no Lockfile found. Run "aidlc-fleet init" first.');
    return { exitCode: exitCodeForLockfileAccess(loaded.state) };
  }

  // issue #18: report each of the 4 AIDLC_FLEET_* variables and its
  // resolved source (env/local-config/default/unset). Only `unset` (no
  // env, no local-config, no built-in default) is a doctor failure — a
  // value resolved from a built-in default is a working configuration,
  // not a gap to fix. A malformed local-config file is exactly the kind
  // of problem doctor exists to surface, so it becomes a reported
  // failure here rather than crashing the command (code-review finding).
  let configFailures: string[];
  try {
    const resolvedConfig = await deps.configAccess.resolveAll();
    for (const key of ENV_CONFIG_KEYS) {
      const entry = resolvedConfig[key];
      deps.stdout(`${key}: ${entry.value ?? '(unset)'} (${entry.source})`);
    }
    configFailures = ENV_CONFIG_KEYS.filter((key) => resolvedConfig[key].source === 'unset').map(
      (key) => `${key} is not set (no environment variable, local config, or default)`,
    );
  } catch (err) {
    configFailures = [
      `local config file is malformed (${err instanceof Error ? err.message : String(err)}) — fix or delete .aidlc-fleet.local.json`,
    ];
  }

  const raw = await deps.doctorRunner.run();
  const wrapped = deps.successVerifier.wrapDoctor(raw, loaded.lockfile.known_failures);

  const allFailures = [...configFailures, ...wrapped.effectiveFailures];

  if (allFailures.length === 0) {
    deps.stdout('doctor: no unaddressed failures.');
  } else {
    deps.stderr(`doctor: ${allFailures.length} failure(s): ${allFailures.join(', ')}`);
  }

  // doctor's own success/failure reuses the same "compose degraded /
  // install incomplete" bucket (M8's code 4) that SuccessVerifier
  // failures use elsewhere, since a failing doctor run is exactly that
  // predicate's third conjunct (BR3.1) evaluated standalone.
  return { exitCode: exitCodeForInstall(allFailures.length === 0) };
}
