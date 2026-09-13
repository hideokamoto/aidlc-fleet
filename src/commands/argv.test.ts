import { test, expect, describe } from 'bun:test';
import { hasFlag, readOption, positionals } from './argv';

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

  test('readOption throws when the following token is itself a flag (issue #31)', () => {
    expect(() => readOption(['init', '--harness', '--force'], 'harness')).toThrow(
      'missing value for --harness',
    );
  });

  test('readOption throws when --name is the last token with no following value', () => {
    expect(() => readOption(['init', '--harness'], 'harness')).toThrow(
      'missing value for --harness',
    );
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
