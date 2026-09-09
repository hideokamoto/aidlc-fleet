# NFR Requirements — Clarifying Questions

## Sources

- [functional] `construction/functional-design/functional-spec.md`, `rules.md`, `entities.md`
- [contract] `inception/contract-design/contract-summary.md`
- [domain] `inception/domain-design/components.md`
- [scope-def] `ideation/scope-definition/scope-document.md`, `intent-backlog.md`
- [desc] the v0.1 requirements document shared at session start

## Note on scope

`requirements-analysis` is SKIP in this workflow's approved grid, so no
`requirements.md` exists and no inception `NFR{n}` IDs were minted
upstream. Per Step 5's ID convention ("every detailed requirement
inherits its inception NFR ID and appends a sub-number"), this stage
mints the top-level `NFR{n}` category IDs itself — NFR1 (Performance)
through NFR6 (Tech Stack Decisions) — since there is no earlier stage
that could have minted them, the same situation Functional Design faced
for `BRx.y` IDs. `units-generation` is SKIP too, so — as in Functional
Design — this stage runs as a single implicit unit; there is no
per-unit directory.

This CLI's NFR profile is unusual for this framework's default templates
(mostly written for hosted web services): `aidlc-fleet` is a locally
invoked, short-lived CLI process with no server, no concurrent-user
load, and no uptime SLA. Every question below adapts the framework's NFR
categories to that reality rather than forcing web-service framing
(p95 latency under concurrent load, multi-AZ availability, etc.) onto a
tool that has neither users-online concept.

## Q1. Performance — what are the response-time/throughput targets?

Per-command execution-time budgets are the CLI-appropriate analogue of
"response time." The dominant cost in every command is network I/O
(`ChannelClient` fetching the channel declaration and tarballs,
`components.md`), not local computation. No v0.1 section states a hard
performance target; a conservative default target is set here so
Code Generation has something concrete to build against, explicitly
labeled as this stage's own assumption rather than a v0.1 citation.

[Answer]: A. `init`/`update`/`plugin add`/`plugin remove` (network-bound):
target under 10s at p95 for a typical channel+single-plugin tarball
size on a broadband connection, excluding retry/backoff time (deferred
to Code Generation per `contract-summary.md`'s Open Question).
`check`/`status`/`pin`/`unpin`/`doctor` (local-only or single small
channel fetch): target under 2s at p95. These are this stage's own
assumption (no v0.1 citation), flagged as such. [assumption]

## Q2. Security — what are the authentication/authorization/data-protection requirements?

This is the CLI's most substantive NFR category, and it is already
heavily specified by approved upstream artifacts: `contract-summary.md`
(Contract 1's sha256 integrity requirement, BR7.1/BR7.2 in
`rules.md`), `practices-discovery/discovered-rules.md` (file-ownership
invariants, M4), and the v0.1 document's non-goal register (never
reimplement upstream install/compose logic, never touch `aidlc/`
workspace state). There is no user-facing authentication in this CLI —
it runs as the invoking developer/CI identity — so "authentication" here
means verifying the *content* it fetches and installs, not verifying a
*user*. [contract, domain, scope-def]

[Answer]: A. No user auth (CLI runs as invoking identity). Content
integrity: sha256 verification of every fetched tarball is mandatory
and non-bypassable (BR7.1). Data protection: `aidlc.lock.json` and
channel config must never contain credentials/API keys/secrets
(practices-discovery Mandated rule, `project.md`). Supply-chain: engine
and plugin sources are pinned by commit SHA, not floating tags/branches,
so a compromised upstream ref cannot silently substitute content
post-fetch without failing the sha256 check. Compliance: none — this is
an internal developer tool with no PII/PCI/HIPAA data flow ([desc], no
regulated-data category applies). [contract, domain, scope-def]

## Q3. Scalability — what are the load/growth projections?

"Scalability" for a CLI means the channel's plugin-set size and the
project count a single channel serves growing over time, not
concurrent-request throughput (there is no concurrent access to a single
CLI invocation — each invocation is one process, one project). [scope-def, desc]

[Answer]: A. The channel's `plugins[]` array and a project's own
`Lockfile.plugins[]` array must both remain performant to parse/compare
at realistic scale (tens of plugins, not thousands) — no NFR target
beyond "linear-time comparison, no quadratic blowup" since v0.1 states
no numeric growth target. Multi-project fan-out (many projects following
one channel) is explicitly the CLI's whole purpose (`intent-statement.md`)
but imposes no scalability requirement on any single CLI invocation,
since each project's `check`/`update` runs independently with no shared
runtime state between projects. [desc, domain]

## Q4. Reliability — what are the availability/fault-tolerance/durability requirements?

No SLA/SLO in the SRE sense applies — there is no long-running service
to keep "up." Reliability here means: does a failed/interrupted
invocation leave the project in a safe, recoverable state? This maps
directly to BR2.1 (backup-before-force-replace) and the two Open
Questions Functional Design carried forward (concurrent-invocation
locking, atomic/transactional Lockfile writes) — both still open, not
resolved by this stage either, since neither v0.1 nor any approved
artifact specifies a concrete mechanism. [functional, domain]

[Answer]: A. Fault tolerance: a failed `init`/`update`/`plugin add` must
never leave `aidlc.lock.json` partially written (all-or-nothing per
command invocation) — the exact write mechanism (temp-file-plus-rename,
etc.) is a Code Generation implementation detail, not specified here.
Durability: the Lockfile itself has no built-in backup; `BR2.1`'s
backup-before-force-replace covers only engine-owned directories, not
the lockfile — this is a genuine reliability gap carried forward, not
silently resolved. No specific numeric availability target applies (no
service to measure uptime against). [functional, domain]

## Q5. Observability — what are the monitoring/logging/alerting requirements?

A CLI has no long-running process to monitor and no on-call rotation to
alert — "observability" here means: what does the CLI print to the
human/CI invoking it, and in what format, so a CI pipeline can act on
`check`'s exit code and a human can debug a failure. [functional, scope-def]

[Answer]: A. Structured, human-readable stdout/stderr for interactive
use; the exit-code contract (M8, `intent-statement.md`) is itself the
primary machine-readable signal for CI consumption — no separate
metrics/tracing/dashboard infrastructure applies to a short-lived CLI
process. `doctor`'s `known_failures`-filtered output (BR3.4) is the
CLI's closest analogue to a health-check endpoint. No log retention
policy applies since the CLI does not persist its own logs (each
invocation's stdout/stderr is the CI/terminal's responsibility to
capture, not this CLI's). [functional, scope-def]

## Q6. Tech Stack — what are the confirmed technology selections?

Already fully specified in the initial project description and Domain
Design: TypeScript running on bun. No database (the Lockfile is the
only persisted state, as a JSON file). No web framework (this is a CLI,
not a service). [desc, domain]

[Answer]: A. Language/runtime: TypeScript on bun (per the project's own
description and `aidlc-fleet`'s own tooling precedent in this
repository). No database — `aidlc.lock.json` is the sole persisted
state (a local JSON file, per `contract-summary.md` Contract 2). No web
framework — pure CLI, argument-parsing library left as a Code Generation
implementation choice (not specified in any approved artifact). CI/CD:
CircleCI, per the team's affirmed Deployment practice
(`team.md`). [desc, domain]

## Assumptions & Open Questions

None beyond what is already carried forward and explicitly flagged
above (Q1's assumption-labeled performance targets; Q4's Lockfile
backup gap).

## Consolidated Summary Confirmation

All six questions above have been answered directly from the approved
upstream artifacts and the v0.1 document, adapting the framework's
service-oriented NFR templates to this CLI's actual shape (no server, no
concurrent load, no uptime SLA), per the user's standing instruction not
to re-ask anything already settled. One performance target (Q1) is
explicitly labeled as this stage's own assumption rather than a v0.1
citation, since v0.1 states no numeric performance target.

[Answer]: Looks correct
