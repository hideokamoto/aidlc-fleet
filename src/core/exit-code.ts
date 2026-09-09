/**
 * Shared exit-code-classification helper (M8, `intent-statement.md` v0.1
 * §8): `0`=in sync/success, `1`=behind channel (drift), `2`=local
 * modification drift, `3`=version-gate rejection, `4`=compose degraded /
 * install incomplete. Extracted during the business-logic Refactor step
 * (plan Step 11) so `CommandLayer` never re-derives this contract per
 * command — every mapping below traces back to `functional-spec.md`'s
 * canonical per-command exit-code prose (see each function's docstring).
 *
 * `CommandLayer` is the only caller of this module — the mapping itself
 * is deterministic bookkeeping, not business logic in its own right, but
 * lives in `src/core/` (not `src/commands/`) so it stays independently
 * testable in isolation from argv parsing, matching the same reasoning
 * `components.md` gives for isolating `VersionGate`/`SuccessVerifier`.
 */

export type ExitCode = 0 | 1 | 2 | 3 | 4;

/** `init`: no VersionGate, no drift comparison — `0` on success, `4` on a SuccessVerifier failure (BR3.1). */
export function exitCodeForInstall(success: boolean): ExitCode {
  return success ? 0 : 4;
}

/** `update`: `3` on any VersionGate rejection (BR1.1/BR1.2/BR1.5), else `0`/`4` per SuccessVerifier. `1`/`2` never apply to `update`. */
export function exitCodeForUpdate(outcome: {
  gateAllowed: boolean;
  verifierSuccess: boolean;
}): ExitCode {
  if (!outcome.gateAllowed) return 3;
  return outcome.verifierSuccess ? 0 : 4;
}

/** `check` (and the drift portion of `status`, reported rather than exited on): `DriftDetector`'s own 0/1/2 classification (BR5.2) passes through unchanged. */
export function exitCodeForDrift(driftExitCode: 0 | 1 | 2): ExitCode {
  return driftExitCode;
}

/** `plugin add`/`plugin remove`: no VersionGate, no drift comparison — `0` on success, `4` on a SuccessVerifier failure. */
export function exitCodeForPluginOp(success: boolean): ExitCode {
  return success ? 0 : 4;
}

/**
 * `check`/`status`/`plugin add`/`plugin remove`/`pin`/`unpin`/`doctor`
 * all read the Lockfile first (`LockfileStore.load()`) and must map an
 * absent-or-malformed result to a non-zero exit before any of the above
 * command-specific mappings apply (BR8.1). No approved artifact assigns
 * this case a specific member of the canonical contract beyond "non-zero"
 * (`reliability-design.md`'s NFR4.2 fixes only the classification's
 * *owner* — `LockfileStore` — not the number `CommandLayer` maps it to).
 * This build's documented choice: `1`, the same code used for
 * "behind channel" drift — both describe a project that needs the human
 * to take a corrective action (`init`) before the requested command can
 * proceed, as opposed to `2`'s "something was modified out from under
 * this CLI" or `3`'s "a decision was actively declined." Flagged here so
 * a future stage can revisit it if an approved artifact ever pins a
 * different value.
 */
export function exitCodeForLockfileAccess(state: 'present' | 'absent' | 'malformed'): ExitCode {
  return state === 'present' ? 0 : 1;
}

/**
 * `pin`: exit code for a ref that fails `pin.ts`'s `VALID_REF_PATTERN`
 * check (BR6.1's `violation_behaviour`). No approved artifact pins this
 * to a specific M8 member beyond "non-zero," so — same reasoning as
 * {@link exitCodeForLockfileAccess} above, and kept alongside it here so
 * this module stays the single source of truth for every undocumented
 * exit-code default rather than each command re-deriving its own — this
 * defaults to `1`: the closest existing M8 member, since an invalid ref
 * is neither a version-gate rejection (`3`), a drift finding (`1`/`2`
 * proper), nor a degraded install (`4`), and describes a request the
 * human must correct before retrying, same bucket as "needs `init`."
 */
export const INVALID_REF_EXIT_CODE: ExitCode = 1;
