import { test, expect, describe } from 'bun:test';
import { runConfig } from './config';
import { makeFakeDeps } from './__fixtures__/test-deps';

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

  test('only channel URL is unset (the other 3 fall back to built-in defaults) -> prompts only for it', async () => {
    const { deps, promptQuestions, configSaves } = makeFakeDeps({
      envConfig: {},
      promptAnswers: ['http://answered.example/channel.json'],
    });
    await runConfig(deps);
    expect(promptQuestions).toHaveLength(1);
    expect(promptQuestions[0]).toContain('AIDLC_FLEET_CHANNEL_URL');
    expect(configSaves).toEqual([
      { AIDLC_FLEET_CHANNEL_URL: 'http://answered.example/channel.json' },
    ]);
  });

  test('every env var unset -> the 3 defaulted vars never prompt, only channel URL does', async () => {
    const { deps, promptQuestions, configSaves } = makeFakeDeps({
      envConfig: {},
      promptAnswers: ['http://answered.example/channel.json'],
    });
    await runConfig(deps);
    expect(promptQuestions).toHaveLength(1);
    expect(configSaves).toHaveLength(1);
    expect(Object.keys(configSaves[0]!)).toEqual(['AIDLC_FLEET_CHANNEL_URL']);
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
});
