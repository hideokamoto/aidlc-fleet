# Unit Test Instructions — aidlc-fleet Distribution CLI

## Test Framework Setup

`bun test` (bun's built-in test runner) — no external test dependency
needed for a bun/TypeScript project. No `vitest.config`/`jest.config`
required; bun discovers `*.test.ts` files automatically.

## How to Run THIS UNIT's Tests

This is the zero-Unit stage-level implementation (units-generation was
SKIP), so "this unit" is the whole CLI. Exact scoped commands, never a
bare project-wide invocation:

```bash
bun test src/types/                    # data model layer
bun test src/io/channel-client.test.ts # repository/data-access layer
bun test src/core/                     # business logic layer
bun test src/orchestration/            # business logic layer (orchestration)
bun test src/commands/                 # API/endpoint layer
```

Combined (still workspace-scoped, not project-wide — this workspace's
`src/` **is** the whole unit, since there is only one unit):

```bash
bun test src/
```

Runner-readiness command (must succeed, even with zero tests, before the
first Red step — Step 2 of the plan):

```bash
bun test src/types/lockfile.test.ts
```

## Test Strategy: Standard

- 5–8 tests per component (9 components total: `LockfileStore`,
  `ChannelClient`, `VersionGate`, `FileOwnershipGuard`, `SuccessVerifier`,
  `DriftDetector`, `PluginManager`, `EngineInstaller`, `CommandLayer`'s 7
  command modules treated as one API/endpoint layer for volume purposes).
- Unit tests plus integration tests for key boundaries.
- `FileOwnershipGuard`'s invariant tests (BR2.1–BR2.6) MUST be real
  **filesystem integration tests** against a temp directory (`fs.mkdtemp`),
  not mocks — team.md's explicit Mandated rule: "モックのみのテストで代替
  してはならない" (mock-only tests may not substitute). This applies
  specifically to the write-through-symlink refusal (BR2.4), the
  engine-directory backup-before-force-replace (BR2.1), and the
  receipt-external no-auto-delete guarantee (BR2.5) — each requires
  actually creating files/symlinks on disk and asserting on real
  filesystem state afterward.

## Expected Coverage Targets

80% line coverage (team.md Testing Posture, CI-enforced) across
`src/**`. Run with:

```bash
bun test --coverage src/
```

## Mocking/Stubbing Guidance

- `ChannelClient`'s network calls: mock `fetch`/`codeload.github.com`
  responses in its own unit tests (Step 6–7); real network calls are
  never made in the test suite.
- `EngineInstaller`/`PluginManager`'s `child_process` calls to upstream
  `install.ts`/`compose.ts`: mock the child-process invocation in unit
  tests; do not actually invoke upstream tooling in the standard test
  suite (upstream is out of scope per the §0 non-goal — never
  reimplemented, and never exercised live in CI either).
- `CommandLayer`'s tests (Step 12–13): inject/mock the core-logic layer
  (`VersionGate`, `SuccessVerifier`, etc.) so these tests assert only
  argv parsing, dispatch, and exit-code mapping — never re-verify business
  logic already covered by Step 9's tests (team.md's mandated layer
  separation exists precisely so this boundary is testable in isolation).
- `FileOwnershipGuard`'s tests: NO mocking of the filesystem — use real
  temp directories (see Test Strategy above).

## Test Data Management

- Temp directories created per-test via `fs.mkdtemp(os.tmpdir())` and
  cleaned up in an `afterEach`/`finally` block — never left behind.
- Fixture `Lockfile`/`Channel` JSON objects live alongside their test
  files (e.g. `src/types/__fixtures__/lockfile.valid.json`), not
  hand-inlined as giant object literals repeated across test files.
- No fixture ever contains a real secret or credential (NFR2.3 — this
  applies to test fixtures too, not just production code paths).
