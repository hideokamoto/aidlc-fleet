import { test, expect, describe } from 'bun:test';
import { hasFlag, readOption, positionals, resolveHarness } from './argv';

describe('argv helpers', () => {
  test('hasFlag detects a boolean flag', () => {
    expect(hasFlag(['plugin', 'add', '--force'], 'force')).toBe(true);
    expect(hasFlag(['plugin', 'add'], 'force')).toBe(false);
  });

  test('readOption reads --name value form', () => {
    expect(readOption(['init', '--harness', 'claude-code'], 'harness')).toBe('claude-code');
  });

  test('readOption reads --name=value form', () => {
    expect(readOption(['init', '--harness=cursor'], 'harness')).toBe('cursor');
  });

  test('readOption returns undefined when absent', () => {
    expect(readOption(['init'], 'harness')).toBeUndefined();
  });

  test('resolveHarness defaults to "claude" — the only value real-deps.ts can resolve via plugin-targets.json with no --harness given', () => {
    expect(resolveHarness(['init'])).toBe('claude');
  });

  test('resolveHarness reads an explicit --harness flag', () => {
    expect(resolveHarness(['init', '--harness', 'cursor'])).toBe('cursor');
  });

  test('positionals extracts non-flag arguments, skipping option values', () => {
    expect(positionals(['plugin', 'add', 'sample-plugin', '--force'])).toEqual([
      'plugin',
      'add',
      'sample-plugin',
    ]);
    expect(positionals(['pin', 'deadbeef', '--harness', 'cursor'])).toEqual(['pin', 'deadbeef']);
  });
});
