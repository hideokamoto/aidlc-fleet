/**
 * `check` command — `functional-spec.md`'s `check` workflow. Read-only:
 * never writes, maps `DriftDetector`'s classification directly to the
 * exit code (M8).
 */
import { exitCodeForDrift, exitCodeForLockfileAccess } from '../core/exit-code';
import type { CommandDeps, CommandResult } from './types';

export async function runCheck(deps: CommandDeps): Promise<CommandResult> {
  const loaded = await deps.lockfileStore.loadClassified();
  if (loaded.state !== 'present') {
    deps.stderr('check: no Lockfile found. Run "aidlc-fleet init" first.');
    return { exitCode: exitCodeForLockfileAccess(loaded.state) };
  }

  const channel = await deps.channelClient.fetchChannel();
  const installed = await deps.installedState.read();
  const drift = deps.driftDetector.compare(loaded.lockfile, channel, installed);

  deps.stdout(`check: ${drift.status}`);
  return { exitCode: exitCodeForDrift(drift.exitCode) };
}
