/**
 * `config` command — issue #18. Prompts only for variables that resolved
 * to `source: 'unset'` (no env, no local-config, no built-in default) and
 * persists the answers to the project-local config file via
 * `deps.configAccess`. No business logic of its own — resolution priority
 * lives in `env-config-resolver.ts` (`CommandDeps` pattern, `team.md`'s
 * mandated layer separation).
 */
import {
  ENV_CONFIG_KEYS,
  type EnvConfigKey,
  type LocalConfigValues,
} from '../core/env-config-resolver';
import type { CommandDeps, CommandResult } from './types';

const PROMPT_LABEL: Record<EnvConfigKey, string> = {
  AIDLC_FLEET_CHANNEL_URL: 'AIDLC_FLEET_CHANNEL_URL (Channel declaration URL)',
  AIDLC_FLEET_ENGINE_REPO: 'AIDLC_FLEET_ENGINE_REPO ("owner/name" engine repo)',
  AIDLC_FLEET_COMPOSE_CMD: 'AIDLC_FLEET_COMPOSE_CMD (upstream compose command)',
  AIDLC_FLEET_DOCTOR_CMD: 'AIDLC_FLEET_DOCTOR_CMD (upstream doctor command)',
};

export async function runConfig(deps: CommandDeps): Promise<CommandResult> {
  const resolved = await deps.configAccess.resolveAll();
  const toPrompt = ENV_CONFIG_KEYS.filter((key) => resolved[key].source === 'unset');

  const answers: LocalConfigValues = {};
  for (const key of toPrompt) {
    const raw = await deps.configAccess.prompt(`${PROMPT_LABEL[key]}: `);
    const answer = raw.trim();
    if (answer.length > 0) {
      answers[key] = answer;
    }
  }

  if (Object.keys(answers).length > 0) {
    await deps.configAccess.saveLocal(answers);
  }

  const final = await deps.configAccess.resolveAll();
  for (const key of ENV_CONFIG_KEYS) {
    const entry = final[key];
    deps.stdout(`${key}: ${entry.value ?? '(unset)'} (${entry.source})`);
  }

  return { exitCode: 0 };
}
