# CI Pipeline Configuration — aidlc-fleet Distribution CLI

## Sources

- [scope] `team.md` § Deployment (CircleCI, PR/main gates, manual approval)
- [scope] `project.md` § Mandated (secret scan, dependency scan)
- [nfr] `construction/nfr-requirements/tech-stack-decisions.md` NFR6.5/NFR6.6
- [nfr] `construction/build-and-test/build-and-test-summary.md` (exact commands)

## Pipeline File

`.circleci/config.yml` (workspace root) — validated via CircleCI's own
config compiler (`valid: true`, zero errors).

## Executor

`oven/bun:1.1` Docker image for all jobs that run the CLI's own
build/test/lint tooling (`lint`, `typecheck`, `test`, `build`,
`dependency-scan`, `publish`). `cimg/base:2024.01` for `secret-scan`
(gitleaks is a standalone binary, no bun runtime needed) and the
approval gate job.

## Jobs

| Job | Command(s) | Source |
|---|---|---|
| `lint` | `bun run lint` (`eslint .`) | `build-instructions.md` |
| `typecheck` | `bunx tsc --noEmit` | `build-instructions.md` |
| `test` | `bun test src/`, `bun test --coverage src/` | `unit-test-instructions.md`, verified 136/136 pass, 98.03% coverage |
| `build` | `bun run build` | `build-instructions.md`, verified 42.0 KB bundle |
| `secret-scan` | `gitleaks detect --source . --no-git -v` | project.md Mandated |
| `dependency-scan` | `bun audit` (advisory — zero runtime deps ship) | project.md Mandated |
| `publish-approval-gate` | `type: approval` (CircleCI native approval job) | team.md Mandated |
| `publish` | `bun run build` + `npm publish --access public` | NFR6.6 |

## Triggers / Branch Strategy

Trunk-based development (team.md § Way of Working, unchanged from
org.md's default):
- **`pull-request` workflow**: fires on any branch except `main` (i.e.
  every feature-branch push, which is what a PR is built from). Runs
  `lint`, `typecheck`, `test`, `build`, `secret-scan`, `dependency-scan`
  — all blocking; a red job blocks the PR merge.
- **`main-and-publish` workflow**: fires only on `main` (post squash-merge).
  Re-runs the identical six checks, then a native CircleCI
  `type: approval` job gates the `publish` job — npm publish never runs
  unattended.

No `develop`/`release/*`/`feature/*`-specific triggers exist, matching
trunk-based development's single-branch-of-record shape.

## Artifact Repository

**npm** (public registry, `registry.npmjs.org`) — the only artifact
repository in scope (NFR6.6). No ECR, no S3, no CodeArtifact: this CLI
ships one thing, an npm package, not a container or cloud-deployed
service. `NPM_TOKEN` is read from a CircleCI project environment
variable (never committed) — the pipeline itself never hardcodes a
credential, consistent with construction.md's Security guardrail and
project.md's Forbidden secrets rule.

## Caching

Not configured in this pass — `bun install`'s own lockfile-based caching
(`bun.lock`) already makes repeat installs fast within a single
CircleCI job run; a dedicated CircleCI `save_cache`/`restore_cache` step
was judged unnecessary given `bun install`'s own speed (single-digit
seconds even cold, per `test-results.md`'s observed `bun install` timing)
and the project's zero-runtime-dependency footprint. Revisit if the
dependency count grows materially.
