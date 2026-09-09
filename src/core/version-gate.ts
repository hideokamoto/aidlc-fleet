/**
 * `VersionGate` — decides whether an `update` may proceed, per the
 * origin-record migration-boundary logic (v0.1 §4, M3). Pure decision
 * component: performs no I/O itself, per `components.md`. Reads are
 * handed to it by `CommandLayer`/`EngineInstaller`.
 */
import type { Channel, MigrationBoundary } from '../types/channel';
import type { Lockfile } from '../types/lockfile';

export type VersionGateRejectReason =
  'reject-boundary' | 'manual-boundary-unacknowledged';

export interface VersionGateOptions {
  /** Whether `--acknowledge-migration` was passed (BR1.2). */
  acknowledgeMigration: boolean;
  /**
   * When `Lockfile.pin` is set (BR1.4), the version the pinned ref
   * resolves to. `VersionGate` cannot itself resolve an arbitrary commit
   * ref to a version — that resolution is the caller's (`ChannelClient`/
   * `EngineInstaller`'s) job; this field is how the resolved value
   * reaches the gate. When omitted while a pin is set, the gate treats
   * the pinned target as crossing no boundary (a pin to an unresolvable
   * ref is a routing no-op, not a rejection this component can classify).
   */
  pinnedTargetVersion?: string;
}

export interface VersionGateDecision {
  allowed: boolean;
  reason?: VersionGateRejectReason;
  /** The ref this decision was classified against (channel's latest, or the pin when one is set). */
  targetRef: string;
  /** The migration boundary that produced this decision, when one was crossed. */
  crossedBoundary?: MigrationBoundary;
}

/** Raised by {@link VersionGate.classifyOrThrow} when the gate rejects the transition. */
export class VersionGateRejection extends Error {
  public readonly decision: VersionGateDecision;

  constructor(decision: VersionGateDecision) {
    super(`VersionGate: update rejected (${decision.reason}) targeting ${decision.targetRef}`);
    this.name = 'VersionGateRejection';
    this.decision = decision;
    Object.setPrototypeOf(this, VersionGateRejection.prototype);
  }
}

/**
 * Compare two dotted version strings. Returns negative if `a < b`, 0 if
 * equal, positive if `a > b`. Missing/non-numeric segments compare as 0 —
 * this is a lightweight comparator, not a full semver implementation,
 * since no approved artifact specifies pre-release/build-metadata
 * handling for this CLI's version strings.
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map((n) => parseInt(n, 10) || 0);
  const partsB = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** A boundary is "crossed" moving from `fromVersion` to `toVersion` when `fromVersion < boundary.before <= toVersion`. */
function crossesBoundary(
  fromVersion: string,
  toVersion: string,
  boundary: MigrationBoundary,
): boolean {
  return (
    compareVersions(fromVersion, boundary.before) < 0 &&
    compareVersions(toVersion, boundary.before) >= 0
  );
}

export class VersionGate {
  /**
   * Classify a version transition. Never throws — see
   * {@link classifyOrThrow} for the throwing variant `CommandLayer`
   * prefers for exit-code mapping.
   *
   * BR1.5 ("an adopted project's first update requires `init --adopt` to
   * have already run and recorded `engine_origin`") is enforced
   * *structurally*, not by a runtime branch in this method. This CLI's
   * own write path is the only way `aidlc.lock.json` is ever produced
   * (contract-summary.md Contract 2): `LockfileStore`
   * (`src/io/lockfile-store.ts`) is the sole writer, and every Lockfile
   * it writes goes through `EngineInstaller.install()`
   * (`src/orchestration/engine-installer.ts`), which sets
   * `engine_origin` unconditionally on every `init` — adopted or not
   * (`nextLockfile.engine_origin = previous?.engine_origin ?? engine.ref`).
   * `Lockfile.engine_origin` is also a mandatory field on parse
   * (`src/types/lockfile.ts`'s `requireField`), so `parseLockfile` can
   * never hand back a Lockfile with an empty/absent `engine_origin` in
   * the first place. And before `VersionGate.classify` is ever reached,
   * `src/commands/update.ts` has already rejected an absent/malformed
   * Lockfile via `exitCodeForLockfileAccess` (BR8.1) — so a hand-authored
   * or brownfield Lockfile that never went through this CLI's write path
   * is caught at that earlier boundary, not here.
   *
   * Given that, no lockfile this method could ever be called with can
   * violate BR1.5's precondition — there is no reachable failure branch
   * to gate on. (`EngineInstaller` does record a real, distinct adoption
   * signal — the `ADOPTED_MARKER` ('adopted') it pushes into
   * `Lockfile.managed` when `--adopt` was passed — which stays available
   * on the Lockfile for future rules or diagnostics that want to
   * distinguish an adopted install from a fresh one; `VersionGate` simply
   * has nothing to reject using it today.)
   */
  classify(lockfile: Lockfile, channel: Channel, options: VersionGateOptions): VersionGateDecision {
    const targetRef = lockfile.pin ?? channel.engine.ref;
    const targetVersion = lockfile.pin
      ? (options.pinnedTargetVersion ?? lockfile.engine.version)
      : channel.engine.version;

    // invariant: lockfile.engine_origin is always non-empty here — see
    // the BR1.5 doc comment above for why no reachable input violates it.

    const crossed = channel.migration_boundaries.find((boundary) =>
      crossesBoundary(lockfile.engine.version, targetVersion, boundary),
    );

    if (!crossed || crossed.action === 'none') {
      // BR1.3
      return { allowed: true, targetRef, crossedBoundary: crossed };
    }

    if (crossed.action === 'reject') {
      // BR1.1
      return { allowed: false, reason: 'reject-boundary', targetRef, crossedBoundary: crossed };
    }

    // crossed.action === 'manual' — BR1.2
    if (!options.acknowledgeMigration) {
      return {
        allowed: false,
        reason: 'manual-boundary-unacknowledged',
        targetRef,
        crossedBoundary: crossed,
      };
    }
    return { allowed: true, targetRef, crossedBoundary: crossed };
  }

  /** Same as {@link classify}, but throws {@link VersionGateRejection} instead of returning `allowed: false`. */
  classifyOrThrow(
    lockfile: Lockfile,
    channel: Channel,
    options: VersionGateOptions,
  ): VersionGateDecision {
    const decision = this.classify(lockfile, channel, options);
    if (!decision.allowed) {
      throw new VersionGateRejection(decision);
    }
    return decision;
  }
}
