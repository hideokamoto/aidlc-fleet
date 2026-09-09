import { test, expect } from 'bun:test';
import { parseLockfile, LockfileParseError } from './lockfile';
import validFixture from './__fixtures__/lockfile.valid.json';

test('parseLockfile accepts a well-formed lockfile and returns typed fields', () => {
  const lockfile = parseLockfile(JSON.stringify(validFixture));
  expect(lockfile.schema).toBe(1);
  expect(lockfile.channel).toBe('stable');
  expect(lockfile.engine.harness).toBe('claude-code');
  expect(lockfile.plugins).toHaveLength(1);
  expect(lockfile.plugins[0]?.name).toBe('sample-plugin');
  expect(lockfile.pin).toBeNull();
});

test('parseLockfile throws a distinct LockfileParseError on malformed JSON (BR8.1: malformed is fatal outside init)', () => {
  expect(() => parseLockfile('{not valid json')).toThrow(LockfileParseError);
});

test('parseLockfile throws LockfileParseError when a required field is missing', () => {
  const broken = { ...validFixture } as Record<string, unknown>;
  delete broken.channel_commit;
  expect(() => parseLockfile(JSON.stringify(broken))).toThrow(LockfileParseError);
});

test('parseLockfile ignores unknown/additive fields (entities.md: additive-only evolution)', () => {
  const withExtra = { ...validFixture, future_field: 'ignored-by-this-build' };
  const lockfile = parseLockfile(JSON.stringify(withExtra));
  expect(lockfile.channel).toBe('stable');
});

test('parseLockfile accepts a non-null pin value', () => {
  const pinned = { ...validFixture, pin: 'deadbeefcafe' };
  const lockfile = parseLockfile(JSON.stringify(pinned));
  expect(lockfile.pin).toBe('deadbeefcafe');
});

test('parseLockfile defaults missing optional array fields per entities.md defaults', () => {
  const noKnownFailures = { ...validFixture } as Record<string, unknown>;
  delete noKnownFailures.known_failures;
  const lockfile = parseLockfile(JSON.stringify(noKnownFailures));
  expect(lockfile.known_failures).toEqual([]);
});

test('parseLockfile rejects a non-object top-level value', () => {
  expect(() => parseLockfile(JSON.stringify([1, 2, 3]))).toThrow(LockfileParseError);
});

test('LockfileParseError carries a human-readable message distinguishing the failure reason', () => {
  try {
    parseLockfile('not json at all');
    throw new Error('expected parseLockfile to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(LockfileParseError);
    expect((err as LockfileParseError).message.length).toBeGreaterThan(0);
  }
});
