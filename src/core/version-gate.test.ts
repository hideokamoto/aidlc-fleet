import { test, expect, describe } from 'bun:test';
import { VersionGate, VersionGateRejection } from './version-gate';
import type { Channel, MigrationBoundary } from '../types/channel';
import type { Lockfile } from '../types/lockfile';

function makeChannel(boundaries: MigrationBoundary[]): Channel {
  return {
    schema: 1,
    channel: 'stable',
    engine: { ref: 'target-ref', version: '0.3.0', sha256: 'x' },
    migration_boundaries: boundaries,
    plugins: [],
  };
}

function makeLockfile(overrides: Partial<Lockfile> = {}): Lockfile {
  return {
    schema: 1,
    channel: 'stable',
    channel_commit: 'c1',
    engine: {
      ref: 'origin-ref',
      version: '0.1.0',
      sha256: 'x',
      harness: 'claude-code',
      installed_at: '2026-01-01T00:00:00Z',
    },
    engine_origin: 'origin-ref',
    plugins: [],
    managed: [],
    known_failures: [],
    pin: null,
    ...overrides,
  };
}

describe('VersionGate', () => {
  test('BR1.1: a "reject" boundary always fails, regardless of flags', () => {
    const gate = new VersionGate();
    const channel = makeChannel([{ before: '0.3.0', action: 'reject' }]);
    const lockfile = makeLockfile();
    const decision = gate.classify(lockfile, channel, { acknowledgeMigration: true });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('reject-boundary');
  });

  test('BR1.2: a "manual" boundary without --acknowledge-migration fails', () => {
    const gate = new VersionGate();
    const channel = makeChannel([{ before: '0.3.0', action: 'manual', note: 'read the notes' }]);
    const lockfile = makeLockfile();
    const decision = gate.classify(lockfile, channel, { acknowledgeMigration: false });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('manual-boundary-unacknowledged');
  });

  test('BR1.2: a "manual" boundary with --acknowledge-migration proceeds', () => {
    const gate = new VersionGate();
    const channel = makeChannel([{ before: '0.3.0', action: 'manual' }]);
    const lockfile = makeLockfile();
    const decision = gate.classify(lockfile, channel, { acknowledgeMigration: true });
    expect(decision.allowed).toBe(true);
  });

  test('BR1.3: a "none" boundary proceeds unconditionally', () => {
    const gate = new VersionGate();
    const channel = makeChannel([{ before: '0.3.0', action: 'none' }]);
    const lockfile = makeLockfile();
    const decision = gate.classify(lockfile, channel, { acknowledgeMigration: false });
    expect(decision.allowed).toBe(true);
  });

  test('BR1.3: no boundary crossed proceeds unconditionally', () => {
    const gate = new VersionGate();
    const channel = makeChannel([]);
    const lockfile = makeLockfile();
    const decision = gate.classify(lockfile, channel, { acknowledgeMigration: false });
    expect(decision.allowed).toBe(true);
  });

  test('BR1.4: a per-project pin overrides the channel resolved latest for classification', () => {
    const gate = new VersionGate();
    // Channel's latest (0.3.0) crosses a reject boundary at 0.3.0, but the
    // pin resolves to a version that does not cross it, so the pin's
    // resolved target — not the channel's latest — decides the outcome.
    const channel = makeChannel([{ before: '0.3.0', action: 'reject' }]);
    const lockfile = makeLockfile({ pin: 'pinned-ref' });
    const decision = gate.classify(lockfile, channel, {
      acknowledgeMigration: false,
      pinnedTargetVersion: '0.1.5',
    });
    expect(decision.allowed).toBe(true);
    expect(decision.targetRef).toBe('pinned-ref');
  });

  test('BR1.4: a pin whose resolved version still crosses a reject boundary is rejected', () => {
    const gate = new VersionGate();
    const channel = makeChannel([{ before: '0.3.0', action: 'reject' }]);
    const lockfile = makeLockfile({ pin: 'pinned-ref' });
    const decision = gate.classify(lockfile, channel, {
      acknowledgeMigration: true,
      pinnedTargetVersion: '0.4.0',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('reject-boundary');
  });

  test('classifyOrThrow raises VersionGateRejection with the reason attached on rejection', () => {
    const gate = new VersionGate();
    const channel = makeChannel([{ before: '0.3.0', action: 'reject' }]);
    const lockfile = makeLockfile();
    expect(() => gate.classifyOrThrow(lockfile, channel, { acknowledgeMigration: false })).toThrow(
      VersionGateRejection,
    );
  });

  test('classifyOrThrow does not throw when the gate allows the transition', () => {
    const gate = new VersionGate();
    const channel = makeChannel([]);
    const lockfile = makeLockfile();
    expect(() =>
      gate.classifyOrThrow(lockfile, channel, { acknowledgeMigration: false }),
    ).not.toThrow();
  });
});
