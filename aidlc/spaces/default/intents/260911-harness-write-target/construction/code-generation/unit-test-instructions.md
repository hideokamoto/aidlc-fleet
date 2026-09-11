# Unit Test Instructions — harness-write-target-fix

Test strategy: **Minimal** (requirement-driven, one test per acceptance
criterion at the narrowest effective level, plus a happy-path floor per
component). Scope `harness-write-target-fix` (custom, composed) adds no
extra new-test floor beyond the selected strategy — the existing suite must
stay green.

## Framework / Configuration

Already established in this repo; no new setup required:
- Runner: `bun test` (bun's built-in test runner, per `package.json`
  `"test": "bun test src/"`).
- No separate config file beyond `tsconfig.json` (`resolveJsonModule: true`,
  already relied on by existing JSON-fixture imports).

## How to run THIS unit's tests

Exact, unit-scoped commands (never the bare project-wide `bun test`):

```bash
bun test src/orchestration/engine-installer.test.ts
bun test src/commands/real-deps.test.ts
```

Both files together cover every change in this fix. Run them individually
per TDD Red/Green step as indicated in `code-generation-plan.md`, and
together once both are green.

## Planned New Tests

### `src/orchestration/engine-installer.test.ts` (+1 test)

- `checkEngineDirectoryReplace` is called with the install's harness` —
  asserts the port receives `{ force, harness }` (both fields), proving
  `EngineInstaller.install()` threads `options.harness` through instead of
  leaving the harness-specific target directory unresolvable at that call
  site.

### `src/commands/real-deps.test.ts` (+7 tests, ~3 fixture updates)

`resolveHarnessRoot` (pure function, mirrors the existing `buildTarballUrl`/
`parseDoctorOutput` pure-function test style):
1. Resolves the `claude` harness key to `.claude` (per `plugin-targets.json`).
2. Resolves a second, distinct harness key (`cursor`) to `.cursor` —
   the "2+ harnesses" acceptance criterion at the pure-function level.
3. Throws an explicit error for an unrecognized harness value (no `.claude`
   fallback) — asserts the thrown message names the offending value.

`buildRealDeps()` real-port integration (real temp-directory filesystem,
mocked `spawn`/`fetch`, per the existing pattern in this file's
"remaining port coverage" describe block — team.md's Mandated M4 rule: file
placement is verified against a real filesystem, not mocks):
4. `engineInstaller.install()` with `{ harness: 'cursor', ... }` places the
   staged engine tarball under `.cursor/`, not `.claude/` — the "2+
   harnesses" criterion at the integration level, engine side.
5. `pluginManager.add()` against a lockfile whose `engine.harness` is
   `'cursor'` extracts the plugin projection under
   `.cursor/plugins/<name>/` and writes the session-start hook at
   `.cursor/hooks/session-start.sh` — the "2+ harnesses" criterion at the
   integration level, plugin side.
6. `pluginManager.remove()` against a lockfile whose `engine.harness` is
   `'cursor'` removes from `.cursor/plugins/<name>`, leaving `.claude/`
   untouched.
7. An unrecognized harness value (`engineInstaller.install()`'s
   `options.harness`, and separately a seeded lockfile's `engine.harness`
   for `pluginManager.add()`) rejects explicitly and writes nothing under
   any dot-directory — the "fail explicitly, no `.claude` fallback"
   acceptance criterion, exercised on both the engine and plugin paths.

Fixture updates (no new test count, existing tests kept green):
- The `makeProjectRoot()`/inline lockfile fixtures already in this file that
  set `engine.harness: 'claude-code'` are updated to `'claude'` (a real
  `plugin-targets.json` key that still resolves to `.claude`, per the
  plan's Design Decision) so their existing assertions keep passing under
  the newly-enforced harness resolution.

## Expected Coverage

Both changed files (`engine-installer.ts`'s one new field, `real-deps.ts`'s
five call sites plus the new `resolveHarnessRoot` function) are exercised
directly by the tests above; no coverage gap is introduced. This satisfies
the Minimal strategy's "one test per requirement, happy-path floor per
component" obligation without adding an 80%-floor scope requirement (not in
this scope's floor list).

## Mocking / Stubbing

Unchanged from the existing file's established pattern:
- `node:child_process`'s `spawn` is mocked via `mock.module` (compose/doctor
  invocations never actually spawn a process).
- `global.fetch` is mocked to return canned tarball bytes.
- No mocking of the filesystem itself — every write/read under test goes
  through a real `mkdtemp` temp directory per team.md's Mandated M4
  integration-test rule.

## Test Data Management

Follows the existing file's convention: tarball fixtures are built
in-test via the existing `buildPluginGzipTarball`/`buildTarHeader` helpers
already defined in this file — no new binary fixture files are added.
