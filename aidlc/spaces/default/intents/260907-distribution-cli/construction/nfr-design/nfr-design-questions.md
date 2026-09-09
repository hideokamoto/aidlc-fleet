# NFR Design — Clarifying Questions

## Sources

- [nfr] `construction/nfr-requirements/performance-requirements.md`, `security-requirements.md`, `scalability-requirements.md`, `reliability-requirements.md`, `observability-requirements.md`, `tech-stack-decisions.md`
- [functional] `construction/functional-design/functional-spec.md`, `rules.md`, `entities.md`
- [contract] `inception/contract-design/contract-summary.md`
- [domain] `inception/domain-design/components.md`
- [desc] the v0.1 requirements document shared at session start

## Note on scope

`units-generation` is SKIP, so this stage runs as a single implicit unit
(no per-unit directory), consistent with Functional Design and NFR
Requirements. This CLI has **no cloud infrastructure of any kind** — no
server, no AWS deployment, no VPC/IAM/database (`tech-stack-decisions.md`
NFR6.2/6.3) — it distributes as an npm package that runs locally or in
CI. Every design question below is answered from the approved NFR
Requirements and Functional Design artifacts, adapted to that reality
rather than the framework's default service-oriented NFR Design
templates (AWS service selection, CDK constructs, multi-AZ, Well-
Architected pillars — all inapplicable here per the aws-platform-agent
knowledge base's own scope, which this stage explicitly does not need).

## Q1. Performance design — what concrete optimization strategies satisfy NFR1.1/NFR1.2?

`ChannelClient`'s network fetch dominates NFR1.1's 10s budget
(`components.md`). No caching layer, CDN, or connection pooling in the
service-oriented sense applies — this is a single-shot CLI invocation,
not a long-running process with a warm cache to benefit from. [nfr, domain]

[Answer]: A. The design solution for NFR1.1/NFR1.2 is: minimize network
round-trips (single channel fetch + parallel-fetchable tarballs where
BR4.1's version-mixing guard allows it), and keep all local JSON
parsing/comparison (BR5.1's plugin-array comparison) synchronous and
in-memory — no disk-based caching, since a fresh CLI process has no prior
state to reuse beyond the Lockfile itself. [nfr, domain]

## Q2. Security design — what concrete architecture satisfies NFR2.1–NFR2.8?

Already substantially specified: sha256 verification (NFR2.4), no
secrets in Lockfile/channel config (NFR2.3), commit-SHA pinning (NFR2.6).
The design-level question is *where in the code* these checks are
enforced and in what order. [nfr, functional]

[Answer]: A. `ChannelClient` performs sha256 verification synchronously
immediately after each tarball download and before handing bytes to any
other component (BR7.1) — verification is not deferred or batched.
`FileOwnershipGuard` is invoked before any write that could expose a
secret-bearing path (though NFR2.3's actual enforcement — never writing
secrets in the first place — is a `LockfileStore`/`ChannelClient`
serialization concern, not a runtime scan). No encryption-at-rest design
applies (NFR6.2: `aidlc.lock.json` is a plain local JSON file, not a
managed data store with encryption options). [nfr, functional, domain]

## Q3. Scalability design — what concrete architecture satisfies NFR3.1/NFR3.2?

No horizontal/vertical scaling, load balancing, or partitioning applies
— NFR3's own reframing already established this (Q3,
`nfr-requirements-questions.md`). The only design-level decision is the
data structure for `plugins[]` comparison. [nfr]

[Answer]: A. `Channel.plugins[]` and `Lockfile.plugins[]` are compared
using a name-keyed lookup (e.g., a Map/object keyed by plugin name)
rather than nested-loop comparison, satisfying NFR3.1's linear-time
requirement in a single pass. No other scalability design applies —
NFR3.2's multi-project fan-out requires zero CLI-side design since each
invocation is already a fresh, isolated process. [nfr]

## Q4. Reliability design — what concrete patterns satisfy NFR4.1–NFR4.7?

Circuit breakers, retry-with-backoff, and health-check patterns from the
framework's default NFR Design guide are largely inapplicable to a
single-shot CLI invocation with one external dependency call chain, not
a service mesh. The applicable pattern is safe, atomic local file
writes. [nfr, functional]

[Answer]: A. NFR4.1 (all-or-nothing Lockfile writes) is satisfied by a
write-to-temp-file-then-atomic-rename pattern (write `aidlc.lock.json.tmp`,
fsync, then `rename()` over the final path) — this is a Code Generation
implementation detail, but the *pattern* is fixed here as the design
solution. NFR4.2/NFR4.3 (missing/malformed lockfile, fail-fast on
invariant violation) require no additional pattern beyond what BR8.1/BR2.6
already specify — the design solution is "enforce at the `CommandLayer`
boundary before any component runs." NFR4.4 (engine-directory backup)
uses a copy-before-replace pattern, not a snapshot/versioned-backup
system (over-engineering for a single local directory). NFR4.5 (Lockfile
backup) remains an explicit, undesigned gap — no pattern is proposed here
since no approved artifact establishes a requirement to backup the
Lockfile itself, only to write it atomically (NFR4.1). NFR4.6/NFR4.7
(graceful degradation for plugin-sync-incomplete and drift reporting)
require no additional pattern — they are classification logic already
specified in `rules.md` (BR3.3, BR5.2). [nfr, functional]

## Q5. Observability design — what concrete architecture satisfies NFR5.1–NFR5.5?

No metrics collection, distributed tracing, or dashboard architecture
applies (NFR5's own reframing). The design-level decision is the
structured-output format for stdout/stderr. [nfr]

[Answer]: A. stdout carries human-readable progress/result text; stderr
carries errors/warnings; the exit code (NFR5.1) is the sole
machine-readable signal — no structured JSON-lines logging format is
mandated by any approved artifact, so this remains a Code Generation
implementation choice (consistent with NFR5.2's own note). No
correlation-ID propagation design applies — there is no multi-service
request to correlate across. [nfr]

## Q6. Logical component boundaries — service isolation, failure domains, blast radius

This CLI has no infrastructure-level services to isolate — its "logical
components" are the same 9 code components already decomposed in Domain
Design (`components.md`), and NFR Design's role here is to map NFR
patterns onto that existing catalogue, not invent new service
boundaries. [domain, nfr]

[Answer]: A. `logical-components.md` maps directly onto the 9 approved
`components.md` components (CommandLayer, LockfileStore, ChannelClient,
VersionGate, FileOwnershipGuard, EngineInstaller, PluginManager,
SuccessVerifier, DriftDetector) rather than defining new infrastructure
boundaries. The failure-domain/blast-radius framing applies at the
*command* level, not a service level: a failed `init`/`update` blast
radius is "this one project's install state" (contained by NFR4.1's
atomic write), never cross-project (NFR3.2's process isolation already
guarantees this). No shared-resource contention applies — no shared
database, cache, or infrastructure exists between invocations. [domain, nfr]

## Assumptions & Open Questions

None beyond the reliability gap already carried forward (NFR4.5,
Q4 above).

## Consolidated Summary Confirmation

All six questions above have been answered directly from the approved
NFR Requirements and Functional Design artifacts, adapting the
framework's default service-oriented NFR Design templates (AWS
infrastructure, distributed tracing, horizontal scaling) to this CLI's
actual shape — a locally invoked process with no server and no cloud
infrastructure — per the user's standing instruction not to re-ask
anything already settled.

[Answer]: Looks correct
