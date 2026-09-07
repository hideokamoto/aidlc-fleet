# Practices Discovery — Interview

## Sources

- [org] `aidlc/spaces/default/memory/org.md` — framework defaults (Way of Working, Walking Skeleton, Testing Posture, Deployment, Code Style)
- [draft] Lead draft: `team-practices.md`, `discovered-rules.md`, `evidence.md`
- [quality] `contributions/aidlc-quality-agent.md`
- [dev] `contributions/aidlc-developer-agent.md`
- [devsecops] `contributions/aidlc-devsecops-agent.md`

This is a greenfield project, so every area below is asked (per the stage
protocol's greenfield path), using the org.md defaults as suggested
answers rather than established facts.

## Q1. How should code get from a feature branch into `main`?

The framework default is trunk-based development: short-lived feature
branches (1-2 days), squash-merged into `main`, one commit per unit of
work. [org]

[Answer]: A. Yes — trunk-based, short-lived branches, squash-merge into
`main`.

## Q2. Build a thin end-to-end slice first? A walking skeleton is a minimal version that runs the whole way through, built first to prove the pieces connect before the real features go in.

The active scope file for this workflow doesn't declare a `skeleton:`
field either way, so there's no framework default to fall back on for
this specific project. [draft] Given the backlog's own dependency-first
sequencing decision (`init` is the hard dependency root that every other
command needs — see `scope-definition/scope-document.md`), a minimal
`init` that writes a lockfile and exits 0 could serve as that first
end-to-end slice before layering the version gate and full success
verification on top.

[Answer]: A. Yes — build a minimal `init` that writes a lockfile first, prove that slice end-to-end, then layer the version gate (M3) and full four-part success verification (M2) on top.

## Q3. Should every unit of work get its own explicit go/no-go check before moving to the next, or should the team move through units continuously and only check in at natural milestones?

This determines whether construction runs autonomously or gates every
Bolt. [org]

[Answer]: B. Gate every Bolt — given the file-ownership and version-gate risk surface this CLI touches (per devsecops's review), each unit gets an explicit check-in before the next begins.

## Q4. What's the testing approach — write tests after the code that they check, or design tests before writing that code?

The framework default is test-after: implement each testable layer, then
write and run that layer's tests. [org] Since the approved scope for this
build is a custom one-off (`aidlc-distribution-cli`), it doesn't match
any of the named scopes org.md lists a coverage floor for (mvp, feature,
etc.) — so there's no applicable floor already on record. [org] The
quality reviewer flagged that this CLI's riskiest logic (the four-part
success-verification contract M2, the version gate M3, and the
file-ownership invariants M4) needs boundary-value/decision-table test
design specifically, and that M4 needs real-filesystem integration tests
because mocks can't catch a missed "no symlink writes" or "no auto-delete"
violation. [quality]

[Answer]: TDD — write a failing test first, then implement to make it pass, per testable layer (overriding the test-after suggestion), with an 80% line-coverage floor plus real-filesystem integration tests specifically for the file-ownership invariants (M4) that a mock-based test cannot verify.

## Q5. Once code merges, does it deploy automatically, or does someone decide when a release goes out?

The framework default is deploy-on-merge to staging, with a separate
manual approval gating production. [org] This project is a distributed
CLI tool, not a deployed service — devsecops's review suggested
translating that same two-step spirit into a release model: an automatic
pre-release publish on merge, then a manual approval before promoting to
a stable release. [devsecops]

[Answer]: The human specified CircleCI as the concrete CI/CD platform,
overriding the suggested generic pre-release/stable split. Confirmed
pipeline: CircleCI runs lint + typecheck + test on every pull request;
merging to `main` re-runs the same checks and then publishes to npm,
gated by a manual-approval CircleCI step before the publish job runs
(same two-step spirit as the framework default, implemented as a CircleCI
workflow approval job rather than a separate pre-release/stable split).

## Q6. Any hard rules on how the code itself should be organized, named, or how errors should be handled — or is deferring to the linter/formatter's own config enough?

The framework default is to defer entirely to project-level linter/
formatter config. [org] The developer reviewer flagged that this draft is
silent on two things a linter can't enforce: layer boundaries (separating
the command layer, core success/gate logic, and filesystem I/O so the
riskiest logic — M2/M3/M4 — can be unit-tested without touching the
disk) and an explicit error-handling policy (the exit-code contract M8
must be honored consistently, and a file-ownership-invariant violation
should fail fast rather than continue). [dev]

[Answer]: A. Yes to both — defer style/formatting to the linter/formatter config (ESLint/Prettier, `tsconfig.json` with `strict: true`), AND mandate the layer separation (commands / core logic / I/O) and fail-fast-on-invariant-violation error handling the developer reviewer proposed, since neither is something a linter enforces on its own.

## Q7. The security reviewer proposed promoting the file-ownership invariants (§7) and the version gate (§4) from "backlog items" to hard Mandated/Forbidden rules, and adding lint-time security scanning (a security-focused ESLint plugin) plus CI-required secret and dependency scanning even at this early greenfield stage. Agree?

[devsecops]

[Answer]: A. Yes — promote file-ownership invariants and the version gate to explicit `## Mandated`/`## Forbidden` rules, and require secret scanning + dependency scanning (e.g. Dependabot or equivalent) in CI from the start; the security-focused lint plugin is a Should Have, not blocking for the MVP slice.

## Assumptions & Open Questions

None.

## Consolidated Summary Confirmation

All seven interview questions above have been answered, incorporating the
framework defaults (org.md), the lead's greenfield draft, and all three
support contributions (quality, developer, devsecops). No assumptions
remain open.

[Answer]: Looks correct
