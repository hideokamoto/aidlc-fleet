# Architecture Decision Records — Domain Design

## ADR-001: Nine-component decomposition along distinct-change-rate boundaries

### Context

The v0.1 requirements document specifies a seven-command CLI surface with
three structurally load-bearing cross-cutting concerns (version gate §4,
success criterion §6, file-ownership invariants §7). The team's affirmed
practices (`practices-discovery/team-practices.md`) mandate a layer
separation (commands / core logic / filesystem I/O) so the riskiest logic
can be unit-tested without touching disk, and TDD as the testing
methodology — both of which require clean, independently testable
component boundaries.

### Decision

Decompose the system into nine components: `CommandLayer`,
`LockfileStore`, `ChannelClient`, `VersionGate`, `FileOwnershipGuard`,
`EngineInstaller`, `PluginManager`, `SuccessVerifier`, `DriftDetector` —
see `components.md` for full responsibilities and dependencies. (An
initial draft omitted `DriftDetector` and left `check`/`status` drift
logic unowned inside `CommandLayer`; ADR-004 records the correction.)

### Consequences

**Positive**: `VersionGate`, `FileOwnershipGuard`, and `SuccessVerifier`
— the three highest-risk pieces of logic per the v0.1 document's own
emphasis — are each isolated as pure decision/checking components with no
outbound dependencies of their own, directly satisfying the team's
TDD-without-touching-disk mandate. `LockfileStore` and `ChannelClient`
cleanly separate the two persistent-state concerns (local project state
vs. remote declaration), so a change to the lockfile schema never touches
network-fetch logic and vice versa.

**Negative**: Eight components for what is ultimately a single CLI
process is more decomposition than a minimal script would need — this
adds interface overhead (each component needs a defined contract even
though everything runs in one process, single-threaded, with no network
boundary between components).

**Neutral**: Deployment topology (a single npm package, a single
executable) is unaffected by this decomposition — Units Generation will
decide how these components map to implementable units of work, and this
domain-level split does not itself imply separate packages or processes.

### Alternatives Rejected

**Alternative 1 — Three-layer only (Commands / Core / IO), no further split within Core**:
Description: fold VersionGate, FileOwnershipGuard, SuccessVerifier,
EngineInstaller, and PluginManager into one undifferentiated "Core" module.
Pros: fewer files, less interface ceremony for a small personal-tooling
project. Cons: rejected — it would bury the CLI's three highest-risk
decisions (§4, §6, §7) inside one large module, working directly against
the team's TDD-without-touching-disk mandate and making it harder to
give each concern its own focused real-filesystem integration test suite
(specifically required for FileOwnershipGuard/M4).

**Alternative 2 — Merge EngineInstaller and PluginManager into one Installer component**:
Description: since both share the ChannelClient → FileOwnershipGuard →
SuccessVerifier dependency chain, treat "installing something" (engine or
plugin) as one component. Pros: less duplicated wiring. Cons: rejected —
they have different triggers, different version-mixing rules (P6 applies
only to plugins, never to the engine), and different expected call
frequency (engine install is rare; plugin add/remove is routine) — two
concepts that change for different reasons belong in different
components (DDD heuristic).

## ADR-002: LockfileStore and ChannelClient are separate components, not one "State" component

### Context

Both `LockfileStore` (local `aidlc.lock.json`) and `ChannelClient`
(remote channel declaration) hold structured state that other components
read. A naive design could treat "all state access" as one component.

### Decision

Keep them separate: `LockfileStore` owns only the local, per-project
lockfile; `ChannelClient` owns only the remote channel fetch and its
parsed contents. Neither reads or writes the other's entity.

### Consequences

**Positive**: `VersionGate` explicitly needs both `engine_origin` (from
`LockfileStore`) and `migration_boundaries` (from `ChannelClient`) — the
gate's own domain logic is exactly "compare local state against remote
declaration," a comparison that stays a single, testable data-flow when
each side has its own clearly-owned source. Network-fetch tests
(`ChannelClient`) never require filesystem-lockfile fixtures, and vice
versa.

**Negative**: Any component that needs both pieces of information (only
`VersionGate` does today) must depend on both components rather than one.

**Neutral**: This mirrors the v0.1 document's own §2 split into two
independent JSON schemas (central channel vs. project lockfile) — the
component boundary follows an already-drawn data-model boundary.

### Alternatives Rejected

**Alternative 1 — Single ProjectState component owning both entities**:
Description: one component reads/writes both the local lockfile and the
fetched channel, since "project state" conceptually spans both. Pros:
one fewer component, VersionGate depends on only one thing. Cons:
rejected — local and remote state have entirely different lifecycles
(the lockfile changes on every mutating command; the channel is fetched,
never written by this project) and different failure modes (local I/O
errors vs. network errors), which is exactly the "distinct change rate"
signal for splitting a component per the architecture guide.

**Alternative 2 — Shared read-only StateSnapshot passed by CommandLayer**:
Description: instead of `VersionGate` (and others) depending on both
`LockfileStore` and `ChannelClient` directly, `CommandLayer` would
pre-fetch both and hand a merged, read-only snapshot object into whichever
component needs it — no component would depend on the other two state
components directly. Pros: consumers like `VersionGate` would have a
single input type instead of two dependency edges. Cons: rejected —
this pushes fetch/read orchestration into `CommandLayer`, which the team's
layer-separation mandate reserves for pure argument-parsing and dispatch;
it would also hide the real dependency graph (VersionGate genuinely needs
both entities) behind an indirection that adds a class/type without
removing any actual coupling.

## ADR-003: No deliberate dependency cycles; FileOwnershipGuard is a dependency-free leaf

### Context

`FileOwnershipGuard` is invoked by `CommandLayer`, `EngineInstaller`, and
`PluginManager`, but per the well-formedness rule for `components.md`, the
dependency graph must be acyclic.

### Decision

`FileOwnershipGuard` has zero outbound `depends_on` entries — it inspects
the filesystem and the project's own receipts directly, with no call into
`LockfileStore` or any other component. This keeps it a pure leaf node in
the dependency graph.

### Consequences

**Positive**: `FileOwnershipGuard` can be given the mandated real-filesystem
integration tests (M4) in complete isolation — no other component needs
to be mocked or stubbed to exercise it.

**Negative**: If a future invariant check needs data from the lockfile
(e.g., cross-referencing `managed` marker identifiers), `FileOwnershipGuard`
would need a new dependency, which is deferred rather than pre-built here
speculatively (per the architect's "design for change, not for reuse"
principle).

### Alternatives Rejected

**Alternative 1 — FileOwnershipGuard reads LockfileStore's `managed` field directly**:
Description: give the guard access to the lockfile's `managed` marker
list so it can cross-check receipts against declared managed files.
Pros: potentially more precise invariant checks. Cons: rejected for now
— the v0.1 document's §7 invariants (symlink writes, auto-delete,
engine-directory replacement) do not require the `managed` field to be
enforced; adding the dependency now would be speculative coupling with
no current requirement driving it.

**Alternative 2 — Allow a deliberate, documented cycle between FileOwnershipGuard and LockfileStore**:
Description: instead of keeping `FileOwnershipGuard` dependency-free,
explicitly permit a two-way edge (`FileOwnershipGuard` reads `managed`
from `LockfileStore`; `LockfileStore`'s writes are themselves checked by
`FileOwnershipGuard` before they land) and document it as an intentional
cycle per the stage's own well-formedness escape hatch ("call out any
deliberate cycle in the Rationale"). Pros: would let the guard reason
about declared-managed-file state without waiting for a future
requirement. Cons: rejected — a cycle between "the thing being checked"
and "the checker" makes it impossible to unit-test either component
without a working fake of the other, directly working against the TDD
mandate's without-touching-disk goal; the stage's acyclic default exists
precisely to prevent this class of coupling, and no current requirement
forces the trade-off.

## ADR-004: Extract DriftDetector as its own component; add a pin field to Lockfile

### Context

An initial draft of `components.md` mapped backlog items M6 (`check`'s
three-way lockfile/channel/disk drift detection), S3 (`status`'s
drift/version/plugin summary), and C1 (`pin`/`unpin`) all to
`CommandLayer` — the one component the design explicitly declares to be
a pure, logic-free routing layer. This left three real pieces of business
logic without a genuine owning component, and no entity anywhere carried
the per-project pin override C1 needs to persist. The advisory
architecture review (iteration 1) flagged this as Critical (R-01): a
developer implementing `check`, `status`, or `pin`/`unpin` would have had
to invent ownership themselves.

### Decision

Extract a new `DriftDetector` component that owns the three-way
comparison behind `check` (M6) and the drift portion of `status` (S3),
including the exit-code classification (0/1/2). Add a `pin` attribute to
the `Lockfile` entity (owned by `LockfileStore`), so `pin`/`unpin` (C1)
has a real persistence target, and `VersionGate` now reads that field so
a pin overrides the channel's latest resolved ref during a migration
check.

### Consequences

**Positive**: Every backlog item with real comparison/decision logic
(`M2` in `SuccessVerifier`, `M3`/pin-override in `VersionGate`, `M4` in
`FileOwnershipGuard`, and now `M6`/`S3` in `DriftDetector`) has a
dedicated, independently testable owner, consistent with the team's
TDD/layer-separation mandate. `CommandLayer`'s "no business logic of its
own" claim is now actually true rather than contradicted by
`traceability.json`.

**Negative**: A ninth component adds further interface overhead (per
ADR-001's already-accepted trade-off); `DriftDetector` and `VersionGate`
now both read the same `pin` field from `LockfileStore` for related but
distinct purposes (drift comparison vs. gate-target resolution), which
requires keeping their interpretations of "pin" consistent as the design
matures.

**Neutral**: `status` (S3) now depends on `DriftDetector` for its drift
portion but may still need `CommandLayer`-level assembly to combine drift
data with version/plugin summary data — that composition detail is left
to Functional Design, which specifies command/query flows in full.

### Alternatives Rejected

**Alternative 1 — Rewrite CommandLayer's behaviour text to admit the logic (reviewer's option b)**:
Description: instead of extracting a new component, keep the drift and
pin logic inside `CommandLayer` and simply update its `behaviour` field
to drop the "no business logic" claim, adding `entities`/
`external_dependencies` for the disk state it would now read directly.
Pros: no new component, smaller diff. Cons: rejected — this would make
`CommandLayer` the CLI's biggest component by responsibility count (all
seven commands' argument parsing PLUS drift comparison PLUS pin
resolution), directly undermining the team's mandated layer separation
between the command layer and core logic, and leaving `check`'s riskiest
comparison logic untestable without exercising the full argument-parsing
path.

**Alternative 2 — Fold drift detection into SuccessVerifier**:
Description: since `SuccessVerifier` already reads lockfile state and
performs multi-part comparisons (the four-part success criterion), give
it the three-way drift comparison too. Pros: reuses an existing
comparison-shaped component. Cons: rejected — `SuccessVerifier`'s
comparisons are post-mutation confirmations (did the last `init`/`update`
succeed?), while `DriftDetector`'s comparisons are point-in-time queries
(`check`/`status`) that can run with no mutation happening at all;
merging them would couple two components with different triggers and
different callers (EngineInstaller/PluginManager vs. CommandLayer
directly), the same "distinct change rate" signal ADR-001 already used to
justify keeping `EngineInstaller` and `PluginManager` separate.
