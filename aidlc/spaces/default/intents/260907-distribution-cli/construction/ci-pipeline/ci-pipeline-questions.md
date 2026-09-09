# CI Pipeline — Clarifying Questions

## Sources

- [scope] `team.md` § Deployment — CircleCI-based CI/CD, explicitly affirmed
- [scope] `project.md` § Mandated — secret scan, dependency scan, PR gate, manual approval before npm publish, all explicitly affirmed
- [nfr] `construction/nfr-requirements/tech-stack-decisions.md` NFR6.5/NFR6.6 — CircleCI, npm distribution
- [nfr] `construction/build-and-test/build-and-test-summary.md` — the exact commands (`bun install`, `bunx tsc --noEmit`, `bun run lint`, `bun test src/`, `bun run build`) this pipeline must run

## Note on scope

`summary_confirmation: required`, no `for_each` — this stage runs as a
single implicit unit (not per-Unit), consistent with every other
Construction stage in this zero-Unit workflow. All four questions below
are answered directly from already-affirmed team/project practices, per
the user's standing instruction not to re-ask anything already settled.

## Q1. What CI tool is in use?

[Answer]: A. **CircleCI** — explicitly affirmed in `team.md`'s Deployment
section (Interview Q5) and locked as NFR6.5 in `tech-stack-decisions.md`.
No other CI tool is in scope; this was a deliberate override of the
draft's generic "pre-release auto-publish → stable manual promotion"
proposal. [scope, nfr]

## Q2. What is the branch strategy?

[Answer]: A. **Trunk-based development** — `org.md`'s default, confirmed
unchanged by the team at Interview Q1 (`team.md` § Way of Working): all
work merges to `main` via short-lived feature branches, squash-merged.
The CircleCI pipeline therefore triggers on every push (PR branches) and
re-runs on merge to `main` — no `develop`/`release/*` branches exist to
configure separate triggers for. [scope]

## Q3. What quality gates are required before merge?

[Answer]: A. Per `team.md` § Deployment and `project.md` § Mandated,
explicitly:
- **Per pull request**: lint + typecheck + test, must be green to merge.
- **On merge to `main`**: the same checks re-run; if green, proceed to
  the npm publish job.
- **Secret scanning** (e.g. gitleaks, GitHub Secret Scanning, TruffleHog)
  — Mandated as a required pipeline step.
- **Dependency scanning** (e.g. Dependabot or equivalent) — Mandated as
  a required pipeline step.
- **Manual approval** — a CircleCI workflow approval job gates npm
  publish; it never runs unattended.
The exact commands these gates run come from `build-and-test-summary.md`:
`bun install`, `bunx tsc --noEmit`, `bun run lint`, `bun test src/`
(coverage floor 80%, actual 98.03%), `bun run build`. [scope, nfr]

## Q4. What artifact repositories are used?

[Answer]: A. **npm** (public registry) — NFR6.6, `tech-stack-decisions.md`.
No container registry, no S3 artifact bucket, no CodeArtifact — this CLI
distributes as a single npm package (`aidlc-fleet-cli`, per
`package.json`), not a container or cloud-deployed service. Package
version follows the `version` field in `package.json` (currently `0.1.0`,
semver). [nfr]

## Assumptions & Open Questions

None.

## Consolidated Summary Confirmation

All four questions above are answered directly from already-affirmed
team/project practices (`team.md`, `project.md`, `tech-stack-decisions.md`)
and the concrete commands already validated in `build-and-test-summary.md`.
The pipeline to generate: a CircleCI config (`.circleci/config.yml`) with
a PR workflow (lint/typecheck/test/secret-scan/dependency-scan, all
blocking) and a `main`-branch workflow that re-runs the same checks then
gates npm publish behind a manual approval job — no new decisions are
being introduced, only translated into pipeline-as-code.

[Answer]: Looks correct
