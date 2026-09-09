/**
 * `pin`/`unpin` commands — `functional-spec.md`'s `pin <ref>` / `unpin`
 * workflow, the lightest-weight commands in the CLI (no `ChannelClient`,
 * `EngineInstaller`, or `PluginManager` involvement).
 */
import { exitCodeForLockfileAccess, INVALID_REF_EXIT_CODE } from '../core/exit-code';
import type { CommandDeps, CommandResult } from './types';

/**
 * A ref is a commit SHA or similar identifier — restricted to the
 * characters git/GitHub refs and short SHAs actually use. BR6.1's
 * `violation_behaviour` requires this validated at the CommandLayer
 * boundary, before any write is attempted.
 */
const VALID_REF_PATTERN = /^[A-Za-z0-9._/-]+$/;

export async function runPin(ref: string, deps: CommandDeps): Promise<CommandResult> {
  if (!VALID_REF_PATTERN.test(ref)) {
    deps.stderr(`pin: "${ref}" is not a valid ref format.`);
    return { exitCode: INVALID_REF_EXIT_CODE };
  }

  const loaded = await deps.lockfileStore.loadClassified();
  if (loaded.state !== 'present') {
    deps.stderr('pin: no Lockfile found. Run "aidlc-fleet init" first.');
    return { exitCode: exitCodeForLockfileAccess(loaded.state) };
  }

  await deps.lockfileStore.pin(ref);
  deps.stdout(`pin: pinned to ${ref}.`);
  return { exitCode: 0 };
}

export async function runUnpin(deps: CommandDeps): Promise<CommandResult> {
  const loaded = await deps.lockfileStore.loadClassified();
  if (loaded.state !== 'present') {
    deps.stderr('unpin: no Lockfile found. Run "aidlc-fleet init" first.');
    return { exitCode: exitCodeForLockfileAccess(loaded.state) };
  }

  await deps.lockfileStore.unpin();
  deps.stdout('unpin: pin cleared.');
  return { exitCode: 0 };
}
