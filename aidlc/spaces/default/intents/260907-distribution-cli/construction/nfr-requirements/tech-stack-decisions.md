# Tech Stack Decisions — aidlc-fleet Distribution CLI

NFR6 records the confirmed technology selections and rationale (Q6,
`nfr-requirements-questions.md`), already fully specified in the initial
project description and Domain Design.

## Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| NFR6.1 | **Language/runtime**: TypeScript on bun. | Stated directly in the project's own initial description (`project-description.json`) and consistent with this repository's own `aidlc-fleet` tooling precedent (the `.claude/tools/*.ts` scripts already run on bun). |
| NFR6.2 | **Persistence**: no database. `aidlc.lock.json` is the sole persisted state — a local JSON file, not a managed data store. | `contract-summary.md` Contract 2; `entities.md`'s `Lockfile` entity has no database-backed identifier, only "project path (one lockfile per project)." |
| NFR6.3 | **Application framework**: none — pure CLI, no web/HTTP framework. | This CLI has no server component (`intent-statement.md`); a web framework would be a category error for this shape. |
| NFR6.4 | **Argument-parsing library**: left as a Code Generation implementation choice. | Not specified by any approved artifact; `components.md`'s `CommandLayer` describes the responsibility ("CLI argument parsing and validation") but not a specific library. |
| NFR6.5 | **CI/CD platform**: CircleCI. | Team's affirmed Deployment practice (`team.md`): PR runs lint+typecheck+test; merge to `main` re-runs checks then gates npm publish behind a manual-approval CircleCI workflow step. |
| NFR6.6 | **Distribution**: npm package. | Implied by `team.md`'s Deployment practice ("npm への公開") and `intent-statement.md`'s framing of this CLI as an installable distribution tool. |

## Explicitly Not Selected

- **No database** (NFR6.2) — ruled out, not merely unaddressed; the
  Lockfile's shared-schema contract design (`contract-summary.md`)
  presumes a single local file, not a queryable store.
- **No web framework** (NFR6.3) — ruled out for the same reason as
  above.
- **No ORM / query builder** — follows from NFR6.2; there is no
  relational or document store to query.

## Open Tech-Stack Items (deferred to Code Generation)

| Item | Why deferred |
|------|--------------|
| Argument-parsing library choice (NFR6.4) | Implementation detail, not specified by any upstream artifact |
| HTTP client library for `ChannelClient`'s tarball fetches | Not specified; Code Generation selects one consistent with bun's runtime |
| Test framework / assertion library specifics | Governed by `team.md`'s TDD/coverage mandates (see `practices-discovery/team-practices.md`), but the specific library (bun's built-in test runner vs. an external one) is a Code Generation choice |
