# Security Test Instructions — aidlc-fleet Distribution CLI

Targets NFR2.1–NFR2.8 from
`construction/nfr-requirements/security-requirements.md`, designed in
`construction/nfr-design/security-design.md`. This CLI has no
authentication surface, no user data store, and no compliance framework
in scope (NFR2.1/2.2/2.8) — security testing here focuses on integrity
verification, secrets hygiene, and file-ownership invariants (the actual
attack surface this CLI has).

## Test Framework Setup

No separate security test framework — these are either already covered
by the existing `bun test` suite (integrity/invariant logic) or are
static checks run directly via shell commands (secret scanning,
dependency review), matching how a real CircleCI security gate would run
them (per team.md's Mandated CircleCI secret-scan/dependency-scan
requirement, which `ci-pipeline` — the next stage — will wire into the
actual pipeline config; this stage validates the checks are meaningful
to run, not the CI YAML itself).

## Existing Security-Relevant Test Coverage (already in the suite)

| NFR | Test file | What it proves |
|---|---|---|
| NFR2.4 (sha256 verify, BR7.1) | `src/io/channel-client.test.ts` | A tarball hash mismatch is a hard failure with no retry |
| NFR2.5 (unrecognized schema, BR7.2) | `src/types/channel.test.ts` | An unrecognized `Channel.schema` is surfaced as an error, never guessed at |
| NFR4.3 (fail-fast invariants, BR2.1–BR2.6) | `src/core/file-ownership-guard.test.ts` | Real-filesystem tests: no write through a symlink, engine-dir replace requires `--force`+backup, `aidlc/` untouched, no receipt-external auto-delete |

Run: `bun test src/io/channel-client.test.ts src/types/channel.test.ts src/core/file-ownership-guard.test.ts`

## New: Static Secret Scan

No secret-scanning tool is installed in this environment (gitleaks/
TruffleHog are the eventual CI-side tools per team.md's Mandated rule,
wired in `ci-pipeline`). This stage runs an equivalent manual pattern
scan across the generated source:

```bash
grep -rniE "(api[_-]?key|secret|password|private[_-]?key|bearer\s+[a-z0-9]|token\s*[:=]\s*['\"][a-z0-9]{16,})" src/ bin/ --include="*.ts" | grep -v "\.test\.ts:"
```

Expected: zero matches outside test files (test fixtures may legitimately
contain the string "token" as a field name without a real credential
value — manually verify any hit).

## New: Dependency Review

```bash
cat package.json | grep -A10 '"dependencies"'
```

Expected: no `"dependencies"` key at all, or an empty object — this CLI
ships zero runtime npm dependencies (only Node/Bun built-ins:
`node:fs`, `node:child_process`, `node:crypto`, `node:path`), so there is
no third-party runtime supply-chain surface to scan. `devDependencies`
(`typescript`, `eslint`, `prettier`, `@typescript-eslint/*`) are
build-time only and never ship in `dist/aidlc-fleet.js`.

## New: `aidlc/` Workspace Isolation Check

```bash
grep -rn "aidlc/spaces\|\.\./aidlc/" src/ bin/
```

Expected: zero matches — confirms no generated code path ever
constructs a literal reference into this repo's own AI-DLC record tree
(project.md's Forbidden rule).

## Expected Coverage Targets

No additional test-count floor — these are targeted checks against the
NFR2.x catalogue's actual attack surface, not a volume-driven suite.

## Mocking/Stubbing Guidance

The static scans above run against real source files with no mocking.
The reused `bun test` files follow their own existing mocking guidance
(`unit-test-instructions.md`).

## Test Data Management

No new test data — reuses existing fixtures under `src/**/__fixtures__/`.
