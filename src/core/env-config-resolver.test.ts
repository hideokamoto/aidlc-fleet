import { test, expect, describe } from 'bun:test';
import {
  ENV_CONFIG_KEYS,
  ENV_CONFIG_DEFAULTS,
  resolveEnvConfig,
  resolveEnvConfigKey,
} from './env-config-resolver';
import { assertDefined } from '../test-support/assert-defined';

describe('resolveEnvConfigKey (CoreLogicLayer)', () => {
  test('env set, local-config unset -> env wins', () => {
    const result = resolveEnvConfigKey('AIDLC_FLEET_CHANNEL_URL', 'http://env', undefined);
    expect(result).toEqual({ value: 'http://env', source: 'env' });
  });

  test('env unset, local-config set -> local-config wins', () => {
    const result = resolveEnvConfigKey('AIDLC_FLEET_CHANNEL_URL', undefined, 'http://local');
    expect(result).toEqual({ value: 'http://local', source: 'local-config' });
  });

  test('both set -> env wins over local-config', () => {
    const result = resolveEnvConfigKey('AIDLC_FLEET_CHANNEL_URL', 'http://env', 'http://local');
    expect(result).toEqual({ value: 'http://env', source: 'env' });
  });

  test('neither set, variable has a built-in default -> default wins', () => {
    const result = resolveEnvConfigKey('AIDLC_FLEET_ENGINE_REPO', undefined, undefined);
    expect(result).toEqual({
      value: ENV_CONFIG_DEFAULTS.AIDLC_FLEET_ENGINE_REPO,
      source: 'default',
    });
  });

  test('neither set, variable has no built-in default -> unset', () => {
    const result = resolveEnvConfigKey('AIDLC_FLEET_CHANNEL_URL', undefined, undefined);
    expect(result).toEqual({ value: undefined, source: 'unset' });
  });

  test('a value equal to the built-in default still reports its real source, not "default"', () => {
    const defaultValue = assertDefined(ENV_CONFIG_DEFAULTS.AIDLC_FLEET_ENGINE_REPO);
    const viaEnv = resolveEnvConfigKey('AIDLC_FLEET_ENGINE_REPO', defaultValue, undefined);
    expect(viaEnv.source).toBe('env');
    const viaLocal = resolveEnvConfigKey('AIDLC_FLEET_ENGINE_REPO', undefined, defaultValue);
    expect(viaLocal.source).toBe('local-config');
  });

  test('an empty-string env value is treated as unset and falls through to local-config', () => {
    const result = resolveEnvConfigKey('AIDLC_FLEET_CHANNEL_URL', '', 'http://local');
    expect(result).toEqual({ value: 'http://local', source: 'local-config' });
  });

  test('AIDLC_FLEET_COMPOSE_CMD / AIDLC_FLEET_DOCTOR_CMD values pass through unsplit', () => {
    const result = resolveEnvConfigKey(
      'AIDLC_FLEET_COMPOSE_CMD',
      'bun script.ts --flag',
      undefined,
    );
    expect(result.value).toBe('bun script.ts --flag');
  });
});

describe('resolveEnvConfig (CoreLogicLayer)', () => {
  test('resolves all 4 keys independently with no cross-variable leakage', () => {
    const resolved = resolveEnvConfig(
      { AIDLC_FLEET_CHANNEL_URL: 'http://env' },
      { AIDLC_FLEET_ENGINE_REPO: 'someone/fork' },
    );
    expect(resolved.AIDLC_FLEET_CHANNEL_URL).toEqual({ value: 'http://env', source: 'env' });
    expect(resolved.AIDLC_FLEET_ENGINE_REPO).toEqual({
      value: 'someone/fork',
      source: 'local-config',
    });
    expect(resolved.AIDLC_FLEET_COMPOSE_CMD.source).toBe('default');
    expect(resolved.AIDLC_FLEET_DOCTOR_CMD.source).toBe('default');
  });

  test('ignores extra/unknown keys in the local-config object', () => {
    const resolved = resolveEnvConfig({}, {
      AIDLC_FLEET_ENGINE_REPO: 'someone/fork',
      UNKNOWN_KEY: 'ignored',
    } as never);
    expect(Object.keys(resolved)).toEqual(ENV_CONFIG_KEYS as unknown as string[]);
  });
});
