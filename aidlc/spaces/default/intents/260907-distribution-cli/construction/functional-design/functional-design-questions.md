# Functional Design — Clarifying Questions

## Sources

- [domain] `inception/domain-design/components.md`, `decisions.md`, `traceability.json`
- [contract] `inception/contract-design/contract-summary.md`
- [scope-def] `ideation/scope-definition/scope-document.md`, `intent-backlog.md`
- [desc] the v0.1 requirements document shared at session start

## Note on scope

`units-generation` and `requirements-analysis` are both SKIP in this
workflow's approved grid (single cohesive deliverable, no multi-unit
decomposition, no separate requirements-analysis stage — see
`intent-backlog.md`'s own rationale). Per Step 1's guidance for this case,
this stage works from what the scope does provide: the MoSCoW backlog
(`intent-backlog.md`, M1–M8/S1–S3/C1–C2), the domain model
(`components.md`), and the two shared-schema contracts
(`contract-summary.md`). There is no per-unit directory — the engine
resolved this as a single implicit unit, so all functional-design
artifacts live directly under `construction/functional-design/`. Per the
user's standing instruction not to re-ask anything the v0.1 document
already answers, every question below is answered directly from that
document and the approved upstream artifacts.

## Q1. Business logic workflows and algorithms — what are the command-level workflows?

Seven commands, each with a distinct workflow already implied by
`components.md`'s dependency chains and the v0.1 document's per-command
description: `init` (first-time engine placement — fetch channel, no
version-gate check, install engine + plugins, verify success, write
lockfile), `update` (gate-checked re-placement — fetch channel, check
version gate against `engine_origin`/pin, on pass re-install engine +
recompose, verify success, update lockfile), `check` (drift-only, no
writes — three-way comparison, exit 0/1/2), `plugin add`/`plugin remove`
(place/remove one plugin projection, refuse version-mixing, recompose,
verify, update lockfile `plugins[]`), `pin`/`unpin` (persist/clear the
per-project pin override in the lockfile, no network or engine I/O),
`status` (read-only summary: lockfile state + drift, S3), `doctor` (wrap
upstream doctor, filter `known_failures`). [domain, desc]

[Answer]: A. Seven command workflows as summarized above, each mapped to
its owning/dependent components per `components.md`'s `depends_on` edges.
[domain, desc]

## Q2. Domain models and entity relationships — what are the entities and how do they relate?

Two entities already fully shaped by Contract Design: `Lockfile` (owned
by `LockfileStore`, one per project, fields per `contract-summary.md`
Contract 2) and `Channel` (owned by `ChannelClient`, read-only from this
codebase, fields per Contract 1). No relationship/foreign-key exists
between them at the data level — `Lockfile.channel` is a plain string
name, not a reference — but `VersionGate` and `DriftDetector` both
consume fields from both entities to make decisions, so the *behavioural*
relationship is comparison, not reference. `Lockfile.plugins[]` and
`Channel.plugins[]` are structurally similar (both lists of
name/ref/version/sha256) but are two independent lists compared
element-by-element, not a shared collection. [domain, contract]

[Answer]: A. `Lockfile` and `Channel` are independent entities (no FK
relationship); `VersionGate`/`DriftDetector` compare their fields without
either entity referencing the other. [domain, contract]

## Q3. Business rules, constraints, and validation logic — what are the numbered rules?

Derived directly from the MoSCoW backlog (`intent-backlog.md`) and the
v0.1 sections it cites, grouped by owning component: `VersionGate`
(migration-boundary classification: reject/manual/none, `--acknowledge-migration`
requirement, pin-override precedence, `init --adopt` requirement — v0.1
§4, M3), `FileOwnershipGuard` (engine-directory `--force`+backup rule,
settings/hooks merge rule, `aidlc/` inviolability, no symlink writes, no
receipt-external auto-delete — v0.1 §7, M4), `SuccessVerifier` (the
four-part success criterion and its "compose exit 0 alone is
insufficient" rule, plugin-sync-exit-1-as-incomplete — v0.1 §6, M2),
`PluginManager` (never mix plugin versions, P6), `LockfileStore`
(pin/unpin persistence, C1), `DriftDetector` (three-way comparison
exit-code classification 0/1/2, M6/S3). Every rule traces to a backlog ID
already approved in Ideation. [scope-def, domain, desc]

[Answer]: A. Rules grouped by owning component as summarized, each
tracing to its backlog ID (M2/M3/M4/M6/S3/C1) and v0.1 section. [scope-def,
domain, desc]

## Q4. Data flow, transformations, integration points, error handling and edge cases

Data flow follows `components.md`'s dependency graph: `CommandLayer` →
owning component → (for network-touching paths) `ChannelClient` →
integrity-verified bytes → `EngineInstaller`/`PluginManager` →
`FileOwnershipGuard`-checked write → `LockfileStore` persistence →
`SuccessVerifier` confirmation. Error handling is already fully specified
by Contract Design: a Channel sha256 mismatch is a hard failure (no
silent retry); a missing/malformed Lockfile is a hard failure for every
command except `init`; a `FileOwnershipGuard` violation fails fast
(Mandated, `discovered-rules.md`). No other integration points exist
beyond the two contracts (Channel fetch, Lockfile read/write) and the two
external tool wrappers (`install.ts`/`compose.ts`, upstream `doctor`),
both explicitly out of scope for reimplementation (W-items,
`intent-backlog.md`). [contract, domain, scope-def]

[Answer]: A. Data flow and error handling as summarized, fully sourced
from Contract Design's integrity/failure rules and Domain Design's
dependency graph; no new integration points beyond the two established
contracts. [contract, domain, scope-def]

## Q5. Frontend components / Business scenarios

Not applicable — this is a CLI with no UI surface (`produces_kinds` for
this stage maps `frontend-components` to `[ui]` only, and this unit is
`service`/`spec`-shaped, not `ui`). Business scenarios (end-to-end command
invocations, happy/unhappy paths) are captured instead as workflow step
sequences in `functional-spec.md`, per that artifact's role as source of
truth for ordered behaviour. [scope-def]

[Answer]: A. N/A — no `frontend-components.md` is produced; workflows and
edge cases are captured in `functional-spec.md` instead. [scope-def]

## Assumptions & Open Questions

None.

## Consolidated Summary Confirmation

All five questions above have been answered directly from the approved
Domain Design and Contract Design artifacts, the MoSCoW backlog, and the
v0.1 document shared at session start, per the user's explicit
instruction not to re-ask anything already settled. No assumptions
remain open.

[Answer]: Looks correct
