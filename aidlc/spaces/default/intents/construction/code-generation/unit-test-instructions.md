# Unit Test Instructions — Issue #18: env config persistence

Test strategy: **Standard** (5-8 tests per component, unit + integration for
key boundaries), plus the `feature` scope floor (80% line coverage, CI
execution before merge — `team.md` § Testing Posture / § Deployment).

## Framework & setup

Already configured — no new setup required:
- Runner: `bun test` (Bun's built-in test runner)
- Coverage: `bun test --coverage`
- No mocking library needed; Bun's `mock()` /
  manual fakes are used, matching the existing style in
  `src/commands/__fixtures__/test-deps.ts` and `src/io/lockfile-store.test.ts`.

## How to run THIS unit's tests

Scoped to the files this unit adds/extends — never the whole suite:

```bash
bun test src/io/local-config-store.test.ts src/core/env-config-resolver.test.ts src/commands/config.test.ts src/commands/doctor.test.ts src/commands/status.test.ts
```

Coverage check (still scoped):

```bash
bun test --coverage src/io/local-config-store.test.ts src/core/env-config-resolver.test.ts src/commands/config.test.ts src/commands/doctor.test.ts src/commands/status.test.ts
```

Pre-Red baseline (confirms the runner is ready before the first failing test,
per the Testing Contract's `runner_ready_before_first_test` obligation):

```bash
bun test src/io/lockfile-store.test.ts
```

## Per-component test list

### `src/io/local-config-store.test.ts` (I/O layer) — 7 tests
1. `load()` returns an empty object when `.aidlc-fleet.local.json` is absent.
2. `load()` parses a valid file and returns its 4 recognised keys.
3. `load()` throws `LocalConfigMalformedError` on malformed JSON and on
   valid-JSON-but-non-object input, mirroring `LockfileStore`'s
   `LockfileMalformedError` handling (absent -> `{}`, malformed -> throw;
   no alternative typed-error-result path — callers catch the thrown
   error, same as `LockfileStore`'s absent/malformed split is consumed
   via `try`/`catch` rather than a result type).
4. `save()` then `load()` round-trips the 4 keys (real filesystem, temp dir —
   per `team.md`'s mandate that file-ownership-adjacent I/O gets a real-FS
   integration test, not a mock-only test).
5. `merge()` preserves existing keys not present in a partial update.
6. `save()` replaces an existing symlink at the destination file instead of
   writing through it (write-to-temp + `rename()`, added after a
   code-review finding — the original plain `writeFile()` would have
   followed a pre-existing symlink at `.aidlc-fleet.local.json`).
7. `save()` leaves no leftover temp file behind on success.

### `src/core/env-config-resolver.test.ts` (core logic layer) — 10 tests
Priority order is env > local-config > built-in default > unset. Boundary
matrix per variable (`AIDLC_FLEET_CHANNEL_URL` as the representative
no-default case, `AIDLC_FLEET_ENGINE_REPO` as the representative
has-default case, repeated for the other 2 where behavior could plausibly
diverge):
1. Env set, local-config unset → resolved value = env value, `source: 'env'`.
2. Env unset, local-config set → resolved value = local value,
   `source: 'local-config'`.
3. Both set → resolved value = env value (env wins), `source: 'env'`.
4. Neither set, variable has a built-in default (`AIDLC_FLEET_ENGINE_REPO`,
   `AIDLC_FLEET_COMPOSE_CMD`, `AIDLC_FLEET_DOCTOR_CMD`) → resolved value =
   the default, `source: 'default'`.
5. Neither set, variable has NO built-in default
   (`AIDLC_FLEET_CHANNEL_URL`) → resolved value = `undefined`,
   `source: 'unset'`.
6. Env or local-config set to the same string as the built-in default still
   reports `source: 'env'` / `'local-config'` respectively, never
   `'default'` (source reflects where the value actually came from, not
   value equality).
7. Env set to empty string is treated as unset (falls through to
   local-config, then default), matching `bin/aidlc-fleet.ts`'s existing
   `?? ''` / truthiness convention for these variables.
8. All 4 variables resolved independently in one call (no cross-variable
   leakage — setting one does not affect another's source).
9. `AIDLC_FLEET_COMPOSE_CMD` / `AIDLC_FLEET_DOCTOR_CMD` values (whether from
   env, local-config, or default) remain raw strings from the resolver
   (space-splitting stays the caller's job, as in the current
   `bin/aidlc-fleet.ts`) — the resolver does not reshape values.
10. Resolving with a local-config object that has extra/unknown keys
    ignores them (forward-compatible with a hand-edited file).

### `src/commands/config.test.ts` (command layer) — 8 tests
1. All 4 variables already resolved from env → no prompts shown, local
   config file untouched.
2. `AIDLC_FLEET_CHANNEL_URL` unset, the other 3 fall back to their built-in
   defaults → prompts ONLY for `AIDLC_FLEET_CHANNEL_URL` (the one variable
   with `source: 'unset'`); the 3 defaulted variables are never prompted for
   and never written to the local config file.
3. All 4 variables unset (including channel URL) → prompts only for
   `AIDLC_FLEET_CHANNEL_URL` (the 3 with defaults still resolve, so they are
   never `unset`), saves 1 answer.
4. Only some variables are genuinely `unset` → prompts only for those,
   existing local-config entries for the already-resolved ones are
   preserved (not overwritten with env or default values).
5. Answering blank/empty at a prompt does not persist that key (avoids
   writing an empty string that would later shadow a real value).
6. Output after saving lists each variable and its resulting source
   (`env`/`local-config`/`default`/`unset`), so the user can confirm what
   was recorded.
7. The saved file is written under `projectRoot`, never under `aidlc/`
   (`ISS18-2`; project.md Forbidden — "NEVER `aidlc/` ワークスペース状態を
   読み書きしない").
8. A malformed local-config file is reported clearly and exits non-zero
   instead of crashing the process uncaught (added after a code-review
   finding — `config` is the one command meant to let a user fix this
   exact problem).

### `src/commands/doctor.test.ts` (extended) — 4 new tests
1. `doctor` output includes one line per required variable naming its
   source (`env` / `local-config` / `default` / `unset`).
2. An `unset` required variable is surfaced as a doctor failure (consistent
   with `bin/aidlc-fleet.ts`'s existing hard failure on missing
   `AIDLC_FLEET_CHANNEL_URL`), not silently ignored.
3. A variable resolved from its built-in `default` is NOT surfaced as a
   doctor failure (a default is a valid, working value, not a gap).
4. A malformed local-config file is surfaced as a doctor failure instead of
   crashing the command (added after a code-review finding — doctor exists
   to report exactly this kind of problem).

### `src/commands/status.test.ts` (extended) — 2 new tests
1. `status` output includes the per-variable source summary alongside the
   existing channel/engine/plugins/pin/drift lines.
2. A malformed local-config file is reported as a line in `status`'s
   output, not a crash — status's only failure mode stays BR8.1
   (Lockfile absent/malformed), unchanged by issue #18 (added after a
   code-review finding).

Also extended (integration-glue layer, not itemized above since it has no
dedicated Red/Green cycle of its own per `real-deps.ts`'s own doc comment):
`src/commands/real-deps.test.ts` gained 2 tests for `runDoctorCommand`'s
exit-code handling (a non-zero exit with no parseable stdout is now a
reported failure) plus 3 tests for `buildConfigAccess` (`resolveAll`
against a real temp dir + real env, `saveLocal` round trip, `prompt` via a
mocked `readline`).

Total across the 5 itemized files: 7 + 10 + 8 + 9 + 7 = 41 tests (I/O 7,
core logic 10, command layer 8+9+7=24), all within or above the Standard
strategy's 5-8-per-component band once counted per actual component rather
than averaged.

## Mocking / stubbing guidance

- `local-config-store.test.ts`: use a real temp directory (`fs.mkdtempSync`),
  no mocks — this is the file-ownership-adjacent I/O path the team's testing
  posture requires as a real-filesystem integration test.
- `env-config-resolver.test.ts`: no I/O at all; pass plain objects for
  "env snapshot" and "local config" inputs — this is why the layer is a pure
  function, not `process.env` reader.
- `config.test.ts`: fake stdin/prompt via an injected port (function
  returning a `Promise<string>`), matching the existing `CommandDeps`
  dependency-injection style in `src/commands/__fixtures__/test-deps.ts`.
- `doctor.test.ts` / `status.test.ts`: extend the existing fixture deps in
  `src/commands/__fixtures__/test-deps.ts` with a `resolvedConfig` field
  rather than constructing new mocks from scratch.

## Test data management

No fixtures beyond inline literals — the 4 variables and their values are
short strings; no shared fixture file is warranted.

## Expected coverage targets

80% line coverage on the 3 new/extended layers (`local-config-store.ts`,
`env-config-resolver.ts`, `config.ts`), per the `feature` scope floor. Verify
with the scoped coverage command above before considering Step 11 (Green)
complete.
