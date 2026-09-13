/**
 * Resolves the 4 `AIDLC_FLEET_*` environment variables the CLI needs
 * (issue #18): environment variable > project-local config file >
 * built-in default (where one exists) > unset. Pure — no I/O, no
 * `process.env` reads — so this layer stays unit-testable without a
 * filesystem or environment, per `team.md`'s mandated command/core-logic/
 * I-O layer separation.
 *
 * Defaults exist only for the 3 variables that have one fixed, correct
 * value for an ordinary self-hosted AI-DLC install (confirmed against
 * this repo's own source — see each entry below); `AIDLC_FLEET_CHANNEL_URL`
 * names a team's own hosted Channel distribution and has no default.
 */

export const ENV_CONFIG_KEYS = [
  'AIDLC_FLEET_CHANNEL_URL',
  'AIDLC_FLEET_ENGINE_REPO',
  'AIDLC_FLEET_COMPOSE_CMD',
  'AIDLC_FLEET_DOCTOR_CMD',
] as const;

export type EnvConfigKey = (typeof ENV_CONFIG_KEYS)[number];

export type ConfigSource = 'env' | 'local-config' | 'default' | 'unset';

export interface ResolvedConfigEntry {
  value: string | undefined;
  source: ConfigSource;
}

export type ResolvedConfig = Record<EnvConfigKey, ResolvedConfigEntry>;

export type LocalConfigValues = Partial<Record<EnvConfigKey, string>>;

/**
 * `AIDLC_FLEET_ENGINE_REPO` -> the canonical upstream engine repo this
 * project's own `project.md` Forbidden rule already names ("NEVER
 * upstream（`awslabs/aidlc-workflows`）のファイルを変更しない"). issue #11:
 * this is display/prompt cosmetics only now — since `ChannelEngine` carries
 * its own `repo` field, `cli.ts` only treats this variable as an actual
 * override when its resolved `source` is `'env'` or `'local-config'`; a
 * bare `'default'` source here is never passed through to
 * `RealDepsConfig.engineRepo`, so this fallback can never shadow the
 * Channel's declared `engine.repo`.
 * `AIDLC_FLEET_COMPOSE_CMD` -> the exact command a self-hosted Claude Code
 * install actually has on disk under `.claude/tools/` to run `compose`.
 * `AIDLC_FLEET_DOCTOR_CMD` -> the *only* doctor-shaped command this repo's
 * own vendored `.claude/tools/` currently has (`aidlc-utility.ts doctor`) —
 * NOT upstream's newer `aidlc-doctor.ts` (this repo's vendored engine
 * predates the unified `aidlc.ts` CLI generation that ships it, and
 * `aidlc.ts` itself does not exist under `.claude/tools/` here). Unlike
 * `aidlc-doctor.ts`, `aidlc-utility.ts doctor` does not understand `--json`/
 * `--quiet` — it always emits the human-readable multi-line report. Since
 * `runDoctorCommand` (`src/commands/real-deps.ts`) forces `--json` and
 * requires the resulting stdout to parse as that JSON contract, invoking
 * `doctor` validation with this default currently throws rather than
 * succeeding. See README.md § "既知の制約" and issue #19 (Problem 2) — a
 * real fix needs this repo's vendored engine bumped to a generation that
 * actually ships `aidlc-doctor.ts`, which is out of scope here.
 */
export const ENV_CONFIG_DEFAULTS: Partial<Record<EnvConfigKey, string>> = {
  AIDLC_FLEET_ENGINE_REPO: 'awslabs/aidlc-workflows',
  AIDLC_FLEET_COMPOSE_CMD: 'bun .claude/tools/aidlc-orchestrate.ts next compose',
  AIDLC_FLEET_DOCTOR_CMD: 'bun .claude/tools/aidlc-utility.ts doctor',
};

/** Resolve a single variable's value and its source. */
export function resolveEnvConfigKey(
  key: EnvConfigKey,
  envValue: string | undefined,
  localValue: string | undefined,
): ResolvedConfigEntry {
  if (envValue) {
    return { value: envValue, source: 'env' };
  }
  if (localValue) {
    return { value: localValue, source: 'local-config' };
  }
  const fallback = ENV_CONFIG_DEFAULTS[key];
  if (fallback) {
    return { value: fallback, source: 'default' };
  }
  return { value: undefined, source: 'unset' };
}

/** Resolve all 4 variables independently from an env snapshot and local-config values. */
export function resolveEnvConfig(
  env: Partial<Record<EnvConfigKey, string>>,
  local: LocalConfigValues,
): ResolvedConfig {
  const result = {} as ResolvedConfig;
  for (const key of ENV_CONFIG_KEYS) {
    result[key] = resolveEnvConfigKey(key, env[key], local[key]);
  }
  return result;
}
