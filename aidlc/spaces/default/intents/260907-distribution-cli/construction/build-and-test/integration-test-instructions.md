# Integration Test Instructions — aidlc-fleet Distribution CLI

Standard test strategy requires integration coverage at key boundaries.
This is a zero-Unit CLI (no cross-Unit boundaries exist), so "key
boundary" here means cross-component boundaries inside the single
binary, plus one true end-to-end smoke test of the built artifact.

## Test Framework Setup

Same as unit tests: `bun test` (built into bun). No separate integration
framework — integration tests live alongside unit tests in the same
`*.test.ts` files, distinguished by using real dependencies (real
`fs.mkdtemp` temp directories, a real `EngineInstaller`-produced
Lockfile) rather than by a separate directory or runner.

## Existing Cross-Component Integration Coverage (already in the suite)

These are genuine integration tests, not unit tests with a mocked
boundary — already written and passing as part of Code Generation's
Step 9-11 (`FileOwnershipGuard`'s Mandated real-fs requirement) and the
architecture-review fix cycle:

| Boundary | Test file | What it proves |
|---|---|---|
| `CommandLayer` → `core` → `io` (real Lockfile) | `src/commands/update.test.ts` | A Lockfile produced by a real `EngineInstaller.install()` (plain `init`, no `--adopt`) flows through `runUpdate` end-to-end and succeeds — not a hand-crafted synthetic Lockfile |
| `FileOwnershipGuard` invariants (BR2.1–BR2.6) | `src/core/file-ownership-guard.test.ts` | Real `fs.mkdtemp` temp directories, real symlinks, real writes — no filesystem mocking, per team.md's Mandated rule |
| `PluginManager` → `real-deps.ts` → `child_process` (doctor wiring) | `src/commands/real-deps.test.ts` | `buildRealDeps().pluginManager.remove()` driven through a mocked `child_process.spawn` doctor invocation, confirming parsed doctor output actually flows into `SuccessVerifier`'s real verification result |
| `EngineInstaller`/`PluginManager` → upstream (opaque port) | `src/orchestration/engine-installer.test.ts`, `src/orchestration/plugin-manager.test.ts` | Injected port contracts are exercised end-to-end through the orchestration layer, confirming no upstream logic is reimplemented inline |

## Run Command (scoped to these boundary tests)

```bash
bun test src/commands/update.test.ts src/core/file-ownership-guard.test.ts src/commands/real-deps.test.ts src/orchestration/engine-installer.test.ts src/orchestration/plugin-manager.test.ts
```

## New: Built-Artifact End-to-End Smoke Test

The suite above exercises the TypeScript source directly. This adds one
true end-to-end check of the **bundled** artifact (`dist/aidlc-fleet.js`,
produced by `build-instructions.md`), run manually via shell rather than
`bun test` (there is no fixture-driven harness for this — it is a
one-shot smoke check, not a repeatable suite):

```bash
bun run build
TMPDIR_PROJECT=$(mktemp -d)
cd "$TMPDIR_PROJECT"
AIDLC_FLEET_CHANNEL_URL="https://example.invalid/channel.json" node /home/user/aidlc-fleet/dist/aidlc-fleet.js status; echo "exit: $?"
cd -
rm -rf "$TMPDIR_PROJECT"
```

`AIDLC_FLEET_CHANNEL_URL` is a required config env var (`bin/aidlc-fleet.ts`
refuses to start without it, per its own `--help` text) — any URL value
works for this check since the command fails at the Lockfile-read step,
before the URL is ever fetched.

Expected: the bundled CLI runs against a project with no `aidlc.lock.json`
and exits non-zero per BR8.1 (missing lockfile is a hard failure outside
`init`), printing a directive to run `init` — confirming the bundle
itself is executable and the exit-code contract holds through the real
build artifact, not just the source-level test doubles.

## Expected Coverage Targets

No additional coverage floor beyond the 80% line-coverage floor already
met by the full suite (98.03% per `bun test --coverage src/`) — these
integration tests are a subset of that suite, not an additive target.

## Mocking/Stubbing Guidance

Same as `unit-test-instructions.md`: `child_process` is mocked at the
`real-deps.ts` boundary; the filesystem is never mocked for
`FileOwnershipGuard`'s tests. The built-artifact smoke test above uses
zero mocking — it is a real process invocation against a real temp
directory.

## Test Data Management

The built-artifact smoke test creates and destroys its own temp
directory per run (`mktemp -d` / `rm -rf`), matching the same-pattern
convention already used inside the `bun test` suite's own fixtures.
