# Code Summary — aidlc-fleet Distribution CLI

Zero-Unit implementation (units-generation was SKIP). Full CLI
implemented in one pass at the workspace root, following the approved
16-step TDD plan.

## Files Created

**Project skeleton**
- `package.json` (bun, `type: module`, `bin` entry)
- `tsconfig.json` (`strict: true`)
- `.prettierrc`, `eslint.config.js`
- `.gitignore` (extended with CLI-specific entries)
- `bin/aidlc-fleet.ts` (argv entrypoint)

**Data model** (`src/types/`) — `lockfile.ts`, `channel.ts`, `errors.ts`
(shared parse-error shape), each with a `.test.ts`, plus fixtures under
`src/types/__fixtures__/`.

**Repository/data-access** (`src/io/`) — `channel-client.ts`,
`integrity.ts` (shared sha256-verify-before-handoff helper per
`security-design.md`), `lockfile-store.ts` (atomic write-temp+fsync+rename
per NFR4.1), each with a `.test.ts`.

**Business logic** (`src/core/`) — `version-gate.ts`,
`file-ownership-guard.ts`, `success-verifier.ts`, `drift-detector.ts`,
`exit-code.ts` (shared M8 classification helper), each with a `.test.ts`.

**Orchestration** (`src/orchestration/`) — `engine-installer.ts`,
`plugin-manager.ts`, both wrapping upstream `install.ts`/`compose.ts` via
injected `child_process`-shaped ports (never reimplementing upstream
logic, per project.md's Forbidden rule).

**API/endpoint** (`src/commands/`) — `init.ts`, `update.ts`, `check.ts`,
`plugin.ts`, `pin.ts`, `status.ts`, `doctor.ts`, `types.ts`, `argv.ts`,
`real-deps.ts` (production dependency wiring), `__fixtures__/test-deps.ts`
(test dependency wiring), each command with a `.test.ts`.

## Key Implementation Decisions

- **3-layer separation** (team.md Mandated): `src/commands/` contains no
  business logic — only argv parsing, dispatch to `src/core/`/
  `src/orchestration/`, and exit-code mapping. `src/core/` has no direct
  I/O. `src/io/` is the only layer touching filesystem/network directly.
- **Exit-code contract (M8)**: `src/core/exit-code.ts` is the single
  source of truth for the canonical 0/1/2/3/4 mapping, used by every
  command module — no command invents its own code.
- **`FileOwnershipGuard`'s BR2.1–BR2.6 tests are real filesystem
  integration tests** against `fs.mkdtemp` temp directories, per team.md's
  explicit Mandated rule that mocks cannot verify these invariants.
- **sha256 verification is synchronous, immediately after download**, in
  `src/io/integrity.ts`, shared by `ChannelClient` and reused by
  `EngineInstaller`/`PluginManager` handoff points — matches
  `security-design.md`'s ordering decision.
- **Atomic Lockfile writes**: `src/io/lockfile-store.ts` writes to a
  `.tmp` file, fsyncs, then renames over the final path — matches
  `reliability-design.md`'s NFR4.1 design solution.
- **`EngineInstaller`/`PluginManager` never reimplement upstream logic**:
  both take an injected `child_process`-shaped port for invoking upstream
  `install.ts`/`compose.ts`, kept as an opaque external call.

## Test Coverage Summary

- `bun test src/`: **134 pass, 0 fail**, across 20 test files, 216
  `expect()` calls (grew from 126/19/202 after the architecture-review
  fixes: `src/commands/real-deps.test.ts` added, `src/commands/
  update.test.ts` and `src/core/exit-code.test.ts` extended,
  `src/core/version-gate.test.ts`'s dead-branch test removed).
- `bun test --coverage src/`: **92.00% function coverage, 95.50% line
  coverage** overall — well above the 80% line-coverage floor (team.md
  Testing Posture). Every business-logic file (`src/core/`,
  `src/orchestration/`, `src/commands/*.ts` other than `real-deps.ts`) is
  at or near 100%. `src/commands/real-deps.ts` alone reports low
  measured coverage (its `buildRealDeps` wiring function is exercised
  only indirectly, and `real-deps.test.ts`'s mocked-`child_process`
  dynamic-import pattern under-reports the lines it does exercise) —
  consistent with this module's own doc comment: "integration glue, not
  business logic... has no dedicated Red/Green test cycle of its own,"
  with the R-02 exception that its new `parseDoctorOutput`/
  `runDoctorCommand` parsing logic (the one piece of this file that does
  branch on business-relevant input) is now directly unit-tested.
- `bunx tsc --noEmit`: clean (no type errors).
- `bunx eslint src bin`: clean (no lint errors).
- `bun run build`: succeeds (esbuild bundle via `bun build`).
- Test strategy: **standard** (5–8 tests per component) — every one of
  the 9 `components.md` components plus the 7 command modules has a
  dedicated `.test.ts` file with multiple cases.

## Deviations from the Plan

None structural — all 16 plan steps were completed as specified. Three
implementation-level choices had no approved artifact pinning them to an
exact value, so a reasoned default was chosen and documented inline in
code comments (not a plan deviation, since the plan's own "Notes on
Scope" section anticipated open items requiring implementation-level
judgment):

- **Validation-failure exit codes** (invalid plugin name/ref format,
  invalid pin ref format): no approved artifact pins these to a specific
  M8 member beyond "non-zero." `exitCodeForLockfileAccess` in
  `src/core/exit-code.ts` and the validation paths in
  `src/commands/plugin.ts`/`pin.ts` use `1`, with the reasoning documented
  inline (closest existing M8 member: a non-gate, non-drift, non-degraded
  failure).
- **`real-deps.ts` production wiring choices**: the installed-state
  marker file location, the `.drops` file path convention, and the
  upstream compose command shape (configurable via
  `AIDLC_FLEET_COMPOSE_CMD`) are Code Generation implementation choices —
  no upstream artifact specifies them. Documented inline.
- **`doctorRunner`/`doctorFailures` in `real-deps.ts`** now shell out to a
  real, `AIDLC_FLEET_DOCTOR_CMD`-configurable external `doctor` command
  (`runDoctorCommand`, modeled on the existing `runComposeCommand`
  pattern) and parse its stdout into the `string[]` failures the
  `SuccessVerifier`/BR3.1 port contract expects (`parseDoctorOutput`:
  each non-blank, non-`#`-prefixed stdout line is one reported failure —
  a Code Generation implementation choice, since no approved artifact
  specifies upstream `doctor`'s output format). When
  `AIDLC_FLEET_DOCTOR_CMD` is unset, the safe default of "no unaddressed
  failures" still applies, but as an explicit no-op branch inside the
  real invocation path rather than a hardcoded stub. Unit-tested in
  `src/commands/real-deps.test.ts` with a mocked `child_process.spawn`.
  `SuccessVerifier`'s `known_failures` filtering logic itself (BR3.4)
  remains fully implemented and tested independently of this wiring.

## Carried-Forward Gaps (explicitly out of scope, per the plan)

- **Concurrent-invocation file locking** on `aidlc.lock.json` — flagged in
  `functional-spec.md`'s Edge Cases as an open item; no approved artifact
  specifies a locking strategy. `// TODO:` comment in
  `src/io/lockfile-store.ts` references this gap.
- **NFR4.5 (Lockfile backup mechanism)** — distinct from the atomic-write
  guarantee (NFR4.1, which IS implemented). `reliability-design.md`
  carries this as an undesigned, approved-requirement-free gap; `// TODO:`
  comment in `src/io/lockfile-store.ts` references it.
