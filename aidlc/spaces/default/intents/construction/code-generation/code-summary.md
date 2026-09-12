# Code Summary — Issue #18: env config persistence

## Files created

- `src/core/env-config-resolver.ts` — pure resolver: env > local-config >
  built-in default > unset, for the 4 `AIDLC_FLEET_*` variables. Owns
  `ENV_CONFIG_KEYS` and `ENV_CONFIG_DEFAULTS`.
- `src/core/env-config-resolver.test.ts` — 10 tests.
- `src/io/local-config-store.ts` — reads/writes `.aidlc-fleet.local.json`
  under `projectRoot`; `load`/`save`/`merge`.
- `src/io/local-config-store.test.ts` — 5 real-filesystem tests (temp dir).
- `src/commands/config.ts` — `runConfig`: prompts only for variables whose
  source is `unset`, persists answers, prints the final resolved config.
- `src/commands/config.test.ts` — 7 tests.

## Files modified

- `src/commands/types.ts` — added `ConfigAccess` port and
  `CommandDeps.configAccess`.
- `src/commands/__fixtures__/test-deps.ts` — added a fake `configAccess`
  (in-memory local config + queued prompt answers) to the shared fixture,
  with `envConfig`/`localConfig`/`promptAnswers` options and `configSaves`/
  `promptQuestions` observers.
- `src/commands/doctor.ts` — prints each variable's resolved value/source;
  an `unset` variable is now a doctor failure alongside upstream doctor's
  own findings.
- `src/commands/doctor.test.ts` — +3 tests.
- `src/commands/status.ts` — appends the per-variable source summary to
  the existing status lines.
- `src/commands/status.test.ts` — +1 test.
- `src/commands/real-deps.ts` — added `buildConfigAccess(projectRoot)`
  (real `LocalConfigStore` + `resolveEnvConfig` + a `node:readline/promises`
  prompt), wired into `buildRealDeps()`'s returned `configAccess`.
- `src/commands/real-deps.test.ts` — +3 tests (`resolveAll` against a real
  temp dir + real env, `saveLocal` round trip, `prompt` via a mocked
  `readline`).
- `bin/aidlc-fleet.ts` — resolves the 4 variables via
  `buildConfigAccess(...).resolveAll()` instead of reading `process.env`
  directly; added the `config` subcommand (runs even when
  `AIDLC_FLEET_CHANNEL_URL` is unset, since it is how a user answers it);
  updated `USAGE` text with the new command and the default values.
- `.gitignore` — added `.aidlc-fleet.local.json`.
- `README.md` — added an "aidlc-fleet CLI" section documenting the 4
  variables, their defaults, and the `config` subcommand.

## Key implementation decisions

- **Defaults added per human feedback, grounded in this repo's own
  source** (not invented): `AIDLC_FLEET_ENGINE_REPO` defaults to
  `awslabs/aidlc-workflows` (the exact upstream repo `project.md`'s
  Forbidden rule already names); `AIDLC_FLEET_COMPOSE_CMD`/
  `AIDLC_FLEET_DOCTOR_CMD` default to the exact commands
  `.claude/tools/aidlc.ts`'s own route table dispatches `compose`/`doctor`
  to. `AIDLC_FLEET_CHANNEL_URL` has no default — it names a team's own
  hosted distribution and no canonical value exists to default to.
- **`config` runs before the channel-URL hard-stop** in
  `bin/aidlc-fleet.ts`, since it is the only way to answer that one
  variable that still has no default.
- **`ConfigAccess.resolveAll()` re-reads on every call** (no caching)
  rather than being computed once — so a `config` save is reflected
  immediately within the same process, and the design stays simple (a
  malformed local file surfaces as a thrown error rather than being
  silently swallowed, consistent with `LockfileStore`'s absent/malformed
  distinction and the project's fail-fast mandate).
- **Layer separation preserved**: `env-config-resolver.ts` has no I/O; all
  filesystem/readline access lives in `local-config-store.ts` /
  `real-deps.ts`; `config.ts` only orchestrates via the injected
  `ConfigAccess` port — matching `team.md`'s mandated
  command/core-logic/I-O split.

## Test coverage summary

`bun test --coverage` on the new/extended files:
`env-config-resolver.ts` 100%, `local-config-store.ts` 100%, `config.ts`
100%, `doctor.ts` 100%, `status.ts` 100% lines, `real-deps.ts` 99.57% lines
(all reachable lines of the new `buildConfigAccess` covered). Full suite:
203 tests, 0 failures. `bunx tsc --noEmit` and `bun run lint` both clean.

## Deviations from the plan

None — all 14 plan steps completed as written (after the default-values
refinement folded into Steps 5/6/8/10 before Green).
