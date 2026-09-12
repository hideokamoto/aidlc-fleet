import { test, expect, describe } from 'bun:test';
import { DriftDetector } from './drift-detector';
import type { Channel } from '../types/channel';
import type { Lockfile } from '../types/lockfile';

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    schema: 1,
    channel: 'stable',
    engine: { repo: 'org/engine', ref: 'lockfile-ref', version: '0.2.0', sha256: 'x' },
    migration_boundaries: [],
    plugins: [{ name: 'p1', repo: 'org/p1', ref: 'p1-ref', version: '1.0.0', sha256: 'y' }],
    ...overrides,
  };
}

function makeLockfile(overrides: Partial<Lockfile> = {}): Lockfile {
  return {
    schema: 1,
    channel: 'stable',
    channel_commit: 'c1',
    engine: {
      ref: 'lockfile-ref',
      version: '0.2.0',
      sha256: 'x',
      harness: 'claude-code',
      installed_at: '2026-01-01T00:00:00Z',
    },
    engine_origin: 'lockfile-ref',
    plugins: [
      {
        name: 'p1',
        ref: 'p1-ref',
        version: '1.0.0',
        sha256: 'y',
        composed_at: 't',
        engine_version_at_compose: '0.2.0',
      },
    ],
    managed: [],
    known_failures: [],
    pin: null,
    ...overrides,
  };
}

describe('DriftDetector', () => {
  test('BR5.1/BR5.2: all three sources agree -> exit code 0 (in sync)', () => {
    const detector = new DriftDetector();
    const result = detector.compare(makeLockfile(), makeChannel(), {
      installedEngineRef: 'lockfile-ref',
      installedPluginRefs: { p1: 'p1-ref' },
    });
    expect(result.exitCode).toBe(0);
    expect(result.status).toBe('in-sync');
  });

  test('BR5.2: lockfile/disk agree but channel has moved ahead -> exit code 1 (behind channel)', () => {
    const detector = new DriftDetector();
    const channel = makeChannel({
      engine: { repo: 'org/engine', ref: 'newer-channel-ref', version: '0.3.0', sha256: 'x' },
    });
    const result = detector.compare(makeLockfile(), channel, {
      installedEngineRef: 'lockfile-ref',
      installedPluginRefs: { p1: 'p1-ref' },
    });
    expect(result.exitCode).toBe(1);
    expect(result.status).toBe('behind-channel');
  });

  test('BR5.2: disk disagrees with lockfile -> exit code 2 (local modification drift)', () => {
    const detector = new DriftDetector();
    const result = detector.compare(makeLockfile(), makeChannel(), {
      installedEngineRef: 'someone-modified-this-locally',
      installedPluginRefs: { p1: 'p1-ref' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.status).toBe('local-modification');
  });

  test('BR5.2: a plugin ref mismatch on disk also classifies as local modification drift', () => {
    const detector = new DriftDetector();
    const result = detector.compare(makeLockfile(), makeChannel(), {
      installedEngineRef: 'lockfile-ref',
      installedPluginRefs: { p1: 'hand-edited-ref' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.status).toBe('local-modification');
  });

  test('BR5.3: when pin is set, the pinned ref substitutes for the channel latest in comparison', () => {
    const detector = new DriftDetector();
    const channel = makeChannel({
      engine: { repo: 'org/engine', ref: 'channel-latest-ref', version: '0.9.0', sha256: 'x' },
    });
    const lockfile = makeLockfile({ pin: 'lockfile-ref' }); // pinned to what's already installed
    const result = detector.compare(lockfile, channel, {
      installedEngineRef: 'lockfile-ref',
      installedPluginRefs: { p1: 'p1-ref' },
    });
    // Without the pin substitution this would report "behind channel"
    // (0.2.0 lockfile vs 0.9.0 channel); with the pin, the comparison
    // target is the pinned ref, which matches what's installed.
    expect(result.exitCode).toBe(0);
    expect(result.status).toBe('in-sync');
  });

  test('summarize() produces a human-readable drift summary for status (S3) without exiting', () => {
    const detector = new DriftDetector();
    const summary = detector.summarize(makeLockfile(), makeChannel(), {
      installedEngineRef: 'lockfile-ref',
      installedPluginRefs: { p1: 'p1-ref' },
    });
    expect(summary.status).toBe('in-sync');
    expect(summary.exitCode).toBe(0);
  });
});
