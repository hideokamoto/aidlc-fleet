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

### `src/io/local-config-store.test.ts` (I/O layer) — 4 tests
1. `load()` returns an empty object when `.aidlc-fleet.local.json` is absent.
2. `load()` parses a valid file and returns its 4 recognised keys.
3. `load()` throws (or returns a typed error result — match `LockfileStore`'s
   own absent/malformed split) on malformed JSON, mirroring
   `LockfileMalformedError` handling.
4. `save()` then `load()` round-trips the 4 keys (real filesystem, temp dir —
   per `team.md`'s mandate that file-ownership-adjacent I/O gets a real-FS
   integration test, not a mock-only test).

### `src/core/env-config-resolver.test.ts` (core logic layer) — 8 tests
Boundary matrix per variable (`AIDLC_FLEET_CHANNEL_URL` as the representative
case, repeated for the other 3 where behavior could plausibly diverge):
1. Env set, local-config unset → resolved value = env value, `source: 'env'`.
2. Env unset, local-config set → resolved value = local value,
   `source: 'local-config'`.
3. Both set → resolved value = env value (env wins), `source: 'env'`.
4. Neither set → resolved value = `undefined`, `source: 'unset'`.
5. Env set to empty string is treated as unset (falls through to
   local-config), matching `bin/aidlc-fleet.ts`'s existing
   `?? ''` / truthiness convention for these variables.
6. All 4 variables resolved independently in one call (no cross-variable
   leakage — setting one does not affect another's source).
7. `AIDLC_FLEET_COMPOSE_CMD` / `AIDLC_FLEET_DOCTOR_CMD` values remain raw
   strings from the resolver (space-splitting stays the caller's job, as in
   the current `bin/aidlc-fleet.ts`) — the resolver does not reshape values.
8. Resolving with a local-config object that has extra/unknown keys ignores
   them (forward-compatible with a hand-edited file).

### `src/commands/config.test.ts` (command layer) — 6 tests
1. All 4 variables already resolved from env → no prompts shown, local
   config file untouched.
2. All 4 variables unset → prompts for all 4, saves all 4 answers.
3. Only some variables unset → prompts only for those, existing
   local-config entries for the already-resolved ones are preserved
   (not overwritten with env values).
4. Answering blank/empty at a prompt does not persist that key (avoids
   writing an empty string that would later shadow a real value).
5. Output after saving lists each variable and its resulting source, so the
   user can confirm what was recorded.
6. The saved file is written under `projectRoot`, never under `aidlc/`
   (`ISS18-2`; project.md Forbidden — "NEVER `aidlc/` ワークスペース状態を
   読み書きしない").

### `src/commands/doctor.test.ts` (extended) — 2 new tests
1. `doctor` output includes one line per required variable naming its
   source (`env` / `local-config` / `unset`).
2. An `unset` required variable is surfaced as a doctor failure (consistent
   with `bin/aidlc-fleet.ts`'s existing hard failure on missing
   `AIDLC_FLEET_CHANNEL_URL`), not silently ignored.

### `src/commands/status.test.ts` (extended) — 1 new test
1. `status` output includes the per-variable source summary alongside the
   existing channel/engine/plugins/pin/drift lines.

Total: 21 tests across 5 files — inside the Standard strategy's 5-8-per-component
band (4 components × ~5 average, plus the two thin extensions).

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
