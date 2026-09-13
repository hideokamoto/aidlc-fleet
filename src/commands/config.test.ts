import { test, expect, describe } from 'bun:test';
import { runConfig } from './config';
import { makeFakeDeps } from './__fixtures__/test-deps';
import { assertDefined } from '../test-support/assert-defined';

const ALL_RESOLVED_ENV = {
  AIDLC_FLEET_CHANNEL_URL: 'http://env.example/channel.json',
  AIDLC_FLEET_ENGINE_REPO: 'env-owner/env-repo',
  AIDLC_FLEET_COMPOSE_CMD: 'bun compose.ts',
  AIDLC_FLEET_DOCTOR_CMD: 'bun doctor.ts',
};

describe('runConfig (CommandLayer)', () => {
  test('all 4 variables already resolved from env -> no prompts, no local-config write', async () => {
    const { deps, promptQuestions, configSaves } = makeFakeDeps({ envConfig: ALL_RESOLVED_ENV });
    const result = await runConfig(deps);
    expect(result.exitCode).toBe(0);
    expect(promptQuestions).toHaveLength(0);
    expect(configSaves).toHaveLength(0);
  });

  test('only channel URL and doctor command are unset (ENGINE_REPO/COMPOSE_CMD fall back to built-in defaults) -> prompts only for those two', async () => {
    const { deps, promptQuestions, configSaves } = makeFakeDeps({
      envConfig: {},
      promptAnswers: ['http://answered.example/channel.json', 'bun my-doctor.ts'],
    });
    await runConfig(deps);
    expect(promptQuestions).toHaveLength(2);
    expect(promptQuestions[0]).toContain('AIDLC_FLEET_CHANNEL_URL');
    expect(promptQuestions[1]).toContain('AIDLC_FLEET_DOCTOR_CMD');
    expect(configSaves).toEqual([
      {
        AIDLC_FLEET_CHANNEL_URL: 'http://answered.example/channel.json',
        AIDLC_FLEET_DOCTOR_CMD: 'bun my-doctor.ts',
      },
    ]);
  });

  // issue #19 (Problem 2): AIDLC_FLEET_DOCTOR_CMD no longer has a built-in
  // default (its old default threw on every real invocation), so it is now
  // prompted for alongside AIDLC_FLEET_CHANNEL_URL whenever both are unset.
  test('every env var unset -> only the 2 still-defaulted vars (ENGINE_REPO/COMPOSE_CMD) never prompt', async () => {
    const { deps, promptQuestions, configSaves } = makeFakeDeps({
      envConfig: {},
      promptAnswers: ['http://answered.example/channel.json', 'bun my-doctor.ts'],
    });
    await runConfig(deps);
    expect(promptQuestions).toHaveLength(2);
    expect(configSaves).toHaveLength(1);
    expect(Object.keys(assertDefined(configSaves[0])).sort()).toEqual([
      'AIDLC_FLEET_CHANNEL_URL',
      'AIDLC_FLEET_DOCTOR_CMD',
    ]);
  });

  test('preserves existing local-config entries for variables not being re-answered', async () => {
    const { deps, configSaves } = makeFakeDeps({
      envConfig: {},
      localConfig: { AIDLC_FLEET_CHANNEL_URL: 'http://already-saved.example/channel.json' },
      promptAnswers: [],
    });
    const result = await runConfig(deps);
    expect(result.exitCode).toBe(0);
    // Channel URL already resolves from local-config -> nothing left to
    // prompt for, so no new save happens and the existing entry is untouched.
    expect(configSaves).toHaveLength(0);
  });

  test('a blank answer at a prompt does not persist that key', async () => {
    const { deps, configSaves } = makeFakeDeps({ envConfig: {}, promptAnswers: ['   '] });
    await runConfig(deps);
    expect(configSaves).toHaveLength(0);
  });

  test('prints each variable and its resolved source after saving', async () => {
    const { deps, logs } = makeFakeDeps({
      envConfig: {},
      promptAnswers: ['http://answered.example/channel.json'],
    });
    await runConfig(deps);
    const printed = logs.stdout.join('\n');
    expect(printed).toContain('AIDLC_FLEET_CHANNEL_URL');
    expect(printed).toContain('local-config');
    expect(printed).toContain('AIDLC_FLEET_ENGINE_REPO');
    expect(printed).toContain('default');
  });

  test('never touches the aidlc/ workspace or an upstream file — only configAccess.saveLocal is called', async () => {
    const { deps, configSaves } = makeFakeDeps({
      envConfig: {},
      promptAnswers: ['http://answered.example/channel.json'],
    });
    await runConfig(deps);
    expect(configSaves).toEqual([
      { AIDLC_FLEET_CHANNEL_URL: 'http://answered.example/channel.json' },
    ]);
  });

  /**
   * code-review finding: a malformed `.aidlc-fleet.local.json` used to
   * make `resolveAll()` throw uncaught, so the one command meant to let a
   * user fix their config could not itself run. `config` must instead
   * report the problem and exit non-zero without crashing the process.
   */
  test('a malformed local-config file is reported clearly instead of crashing the process', async () => {
    const { deps } = makeFakeDeps();
    deps.configAccess.resolveAll = async () => {
      throw new Error(
        'LocalConfigStore: .aidlc-fleet.local.json in /p is malformed: Unexpected token',
      );
    };
    const result = await runConfig(deps);
    expect(result.exitCode).not.toBe(0);
  });
});
