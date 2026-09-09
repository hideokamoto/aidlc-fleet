# Contract Design — Clarifying Questions

## Sources

- [domain] `inception/domain-design/components.md`, `decisions.md`
- [scope-def] `ideation/scope-definition/scope-document.md`, `intent-backlog.md`
- [intent] `ideation/intent-capture/intent-statement.md`

## Note on scope

`units-generation` is SKIP in this workflow's approved grid (single
cohesive deliverable, no multi-unit decomposition — see
`intent-backlog.md`'s own rationale), so `unit-of-work.md` and
`unit-of-work-dependency.md` do not exist; this is expected by scope
design, not a gap. This workflow's own composer proposal explicitly kept
`contract-design` as EXECUTE specifically because two JSON schemas —
the central channel declaration and the project lockfile — are formal
contracts consumed outside this single unit's own process boundary, even
though there are no internal inter-unit edges (all nine components from
Domain Design run in one process). Per the user's standing instruction
not to re-ask anything the v0.1 document already answers, every question
below is answered directly from that document (§2) and the approved
Domain Design artifacts.

## Q1. What is the public/external API surface — which boundaries are consumed outside this system, and what is their shape?

Two boundaries qualify, both already fully shaped in the v0.1 document
§2 and refined by Domain Design's entity model:

1. **Channel contract** — the central channel declaration file (JSON),
   authored and maintained OUTSIDE this CLI's own process (by whoever
   operates the central channel — a git repo or static URL, per §2.1).
   This CLI's `ChannelClient` component is the consumer; the channel
   maintainer is the external provider. [domain]
2. **Lockfile contract** — `aidlc.lock.json` (JSON), written by this
   CLI's `LockfileStore` component but read by external actors: CI
   scripts invoking `check`/`status`/`doctor`, and potentially other
   tooling a team builds around the lockfile's declared schema. The
   provider is `LockfileStore`; the consumer is `External: CI scripts /
   third-party tooling that parses the lockfile`. [domain]

Both schemas are already exhaustively specified in v0.1 §2 (fields,
types implied by example values) and refined by Domain Design's Entity
Ownership table (`Channel` owned by `ChannelClient`; `Lockfile` owned by
`LockfileStore`, including the `pin` field added during Domain Design's
revision). [desc, domain]

[Answer]: A. Two contracts — Channel (external provider → ChannelClient)
and Lockfile (LockfileStore → external consumers) — both already fully
shaped by v0.1 §2 and the Domain Design entity model. [desc, domain]

## Q2. What is the integration mechanism per boundary?

Both are **shared-schema** contracts (a JSON document read/written
directly), not synchronous REST/HTTP, async event/message, or gRPC — the
v0.1 document never describes a network API surface for either; both are
files on disk or fetched as static content. [desc]

[Answer]: A. shared-schema for both the Channel and Lockfile contracts —
no REST/event/gRPC mechanism applies. [desc]

## Q3. Contract ownership — which unit owns each spec?

Per Domain Design's Entity Ownership table: `ChannelClient` owns reading
(not authoring) the Channel schema — the schema itself is owned by
whoever operates the central channel, external to this codebase.
`LockfileStore` owns authoring the Lockfile schema — this CLI is the
sole writer of `aidlc.lock.json`. [domain]

[Answer]: A. Channel schema is externally owned (read-only from this
codebase's perspective, via `ChannelClient`); Lockfile schema is owned
and authored by `LockfileStore`. [domain]

## Q4. Versioning and breaking-change policy?

The v0.1 document specifies this explicitly for the Channel schema: a
top-level `"schema": 1` integer field (§2.1) is the version marker. No
equivalent explicit version field is specified for the Lockfile schema
in v0.1 §2.2, but the same pattern (an explicit schema version field)
is the natural consistent choice, and additive fields (like the `pin`
field Domain Design added) must not break older readers — consumers
should ignore unknown fields per standard shared-schema practice. [desc]

[Answer]: A. Channel schema versions via its existing `"schema": 1`
field (v0.1 §2.1, already specified); apply the same explicit
schema-version-field pattern to the Lockfile for consistency, with
additive-only evolution (new fields ignored by older readers) as the
breaking-change avoidance policy for both. [desc]

## Q5. Error, timeout, and retry behaviour at each boundary?

For the Channel contract (network fetch): the v0.1 document specifies
sha256 verification of the fetched tarball/content (§5.1) — a checksum
mismatch is a hard failure, not a retry condition (integrity failures
must not be silently retried past). No explicit network-timeout/retry
policy is specified in the v0.1 document; this is left as an open
question for Functional Design (implementation-level HTTP client
behavior), not a Contract Design concern, since Contract Design pins the
schema's shape and integrity contract, not transport-layer retry tuning.
For the Lockfile contract (local file read/write): a missing or
malformed lockfile is a hard failure for any command except `init`
(which creates it); `FileOwnershipGuard`'s fail-fast mandate (per
`practices-discovery/discovered-rules.md`) applies to any lockfile
write that would violate file-ownership invariants. [desc, domain]

[Answer]: A. Channel: sha256 mismatch is a hard failure (no silent
retry); transport-level retry/timeout tuning deferred to Functional
Design. Lockfile: missing/malformed file is a hard failure outside
`init`; writes are fail-fast per the affirmed `FileOwnershipGuard`
mandate. [desc, domain]

## Assumptions & Open Questions

None.

## Consolidated Summary Confirmation

All five questions above have been answered directly from the v0.1
document (§2, §5.1) and the approved Domain Design artifacts, per the
user's explicit instruction not to re-ask anything already settled. No
assumptions remain open.

[Answer]: Looks correct
