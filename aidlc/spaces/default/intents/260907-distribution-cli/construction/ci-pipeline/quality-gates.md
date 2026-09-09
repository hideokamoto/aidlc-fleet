# Quality Gates — aidlc-fleet Distribution CLI

## Sources

- [scope] `team.md` § Deployment, `project.md` § Mandated
- [nfr] `construction/build-and-test/build-and-test-summary.md` Target Verification Matrix

## Gate 1: Pull Request (blocking, before merge)

| Gate | Criteria | Blocking? |
|---|---|---|
| Lint | `bun run lint` exits 0 | Yes |
| Typecheck | `bunx tsc --noEmit` exits 0 (`strict: true`) | Yes |
| Unit + integration tests | `bun test src/` — 100% pass rate | Yes |
| Coverage | `bun test --coverage src/` — line coverage ≥ 80% (team.md Testing Posture) | Yes |
| Build | `bun run build` produces `dist/aidlc-fleet.js` | Yes |
| Secret scan | `gitleaks detect` — zero findings | Yes (project.md Mandated) |
| Dependency scan | `bun audit` — advisory (zero runtime deps ship; see `ci-config.md` rationale) | Advisory |

A red gate blocks the merge — no override path exists in this pipeline
configuration (team.md never affirmed an override mechanism, so none is
invented here).

## Gate 2: Merge to `main` (before npm publish)

Same six checks as Gate 1, re-run against the squash-merged `main` HEAD
(never assumed green from the PR run — `main`'s own state after the
squash commit is what matters). If green, the pipeline proceeds to:

| Gate | Criteria | Blocking? |
|---|---|---|
| Manual approval | A human clicks "Approve" on the CircleCI `publish-approval-gate` job | Yes (team.md Mandated — npm publish never runs unattended) |

## Gate 3: Publish (informational — not a CI gate, a release-record concern)

No additional automated gate after publish; `npm publish --access public`
either succeeds or fails as reported by npm itself. Post-publish
smoke-testing (e.g. `npm view aidlc-fleet-cli version` confirming the
new version is live) is not configured in this pass — no approved
artifact establishes a requirement for it, and this CLI has no deployed
runtime environment to smoke-test against (it is a locally-invoked tool,
not a service).

## Coverage Floor Enforcement

80% line coverage (team.md Testing Posture) is checked via `bun test
--coverage src/`'s own report, read manually in this pass — `bun test`
does not natively fail the process on a coverage-threshold breach the
way `nyc`/`c8`'s `--check-coverage` flag does. **This is a known gap**:
the CI job as configured reports coverage but does not currently *fail*
the build if coverage regresses below 80%. Carried forward as a residual
item (see `build-and-test-summary.md` § Known Limitations analog) — no
approved artifact specifies which coverage-enforcement tool to add, and
inventing one here would exceed this stage's Q&A-answered scope (Q3's
answer covers the *existence* of the gate, not the exact enforcement
mechanism). A future iteration should either add `bun test`'s
`--coverage-threshold` flag (bun ≥1.1 may support this natively — verify
against the pinned bun version) or a coverage-diff action.

## Traceability to Build and Test's Own Verified Commands

Every command in Gate 1/Gate 2 above is copied verbatim from
`construction/build-and-test/build-instructions.md` and
`unit-test-instructions.md` — this stage does not invent new commands,
it wires the already-verified ones (per `test-results.md`: all passing,
98.03% coverage, clean build/typecheck/lint) into CircleCI triggers and
gating logic.
