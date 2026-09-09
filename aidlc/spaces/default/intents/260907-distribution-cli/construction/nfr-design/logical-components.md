# Logical Components — aidlc-fleet Distribution CLI

## Sources

- [domain] `inception/domain-design/components.md`
- [nfr-design] `construction/nfr-design/nfr-design-questions.md` Q6

## Note on Scope

This CLI has no infrastructure-level services to isolate — no server
process, no VPC, no separately deployed units. "Logical component
boundaries" here map directly onto the 9 approved components in
`components.md`, and this artifact's role is to overlay the NFR patterns
designed in the other five documents onto that existing catalogue, not to
invent new infrastructure boundaries.

## Component Inventory (mapped from `components.md`)

| Component | Failure domain | Blast radius | NFR patterns applied here |
|---|---|---|---|
| CommandLayer | This invocation only | This one command's exit code / stdout-stderr output | NFR5.1/5.2 (observability) |
| LockfileStore | This project's `aidlc.lock.json` | This project's install state | NFR4.1 (atomic write), NFR4.2 (absent/malformed classification on load) |
| ChannelClient | This invocation's network call | This one command's fetch/verify outcome | NFR1.1 (performance budget), NFR2.4/2.6 (integrity, pinning) |
| VersionGate | This invocation's update decision | This one `update` command's proceed/reject outcome | — (pure decision logic, no NFR pattern of its own beyond correctness) |
| FileOwnershipGuard | Any mutating write in this invocation | The specific path being written | NFR4.3 (fail-fast invariant check at write time, BR2.6), NFR4.4 (backup-before-replace) |
| EngineInstaller | This project's engine directory | This project's engine install state | NFR4.4 (backup), NFR1.1 (budget) |
| PluginManager | This project's plugin projections | This project's plugin set + sessionStart hook | NFR3.1 (linear-time comparison), NFR1.1 (budget) |
| SuccessVerifier | This invocation's success evaluation | The four-part verdict for this one command | NFR4.6 (plugin-sync-incomplete classification), NFR5.3/5.5 (doctor wrap) |
| DriftDetector | This invocation's comparison | The drift classification for `check`/`status` | NFR3.1 (linear-time comparison), NFR4.7 (drift classification) |

## Failure-Domain / Blast-Radius Framing

The framework's default failure-domain framing (service isolation,
regional blast radius, cascading-failure containment across a service
mesh) does not apply — there is no mesh. The applicable framing here is at
the **command** level, not a service level:

- A failed `init`/`update`/`plugin add` invocation's blast radius is **this
  one project's install state** — bounded by NFR4.1's atomic Lockfile write
  and NFR4.4's engine-directory backup-before-replace. A partial failure
  can never leave the Lockfile in a half-written state; it either commits
  cleanly or the prior state remains untouched.
- Blast radius is **never cross-project** — NFR3.2's process-isolation
  design (`scalability-design.md`) already guarantees each invocation is a
  fresh OS process with no shared in-memory state, so a failure in one
  project's `update` cannot corrupt a sibling project's Lockfile.
- Blast radius is **never cross-machine** — no shared infrastructure exists
  between two developers' or two CI runners' invocations of this CLI; each
  is fully isolated by the underlying OS process model.

## Shared-Resource Contention

None applies. No shared database, cache, message queue, or other
infrastructure exists between invocations — each of the 9 components is
instantiated fresh within a single process and torn down when that process
exits. The only persistent shared resource is the project's own
`aidlc.lock.json` file on disk, and concurrent-write safety for that single
file is already covered by NFR4.1's atomic rename pattern
(`reliability-design.md`), not a distributed-locking or contention-management
design.

## Bridge to Infrastructure Design

This workflow's approved scope grid marks `infrastructure-design` as SKIP
(no cloud infrastructure exists to design). This artifact therefore has no
downstream Infrastructure Design stage to bridge to in practice; it is
produced per the stage's standard `produces` contract so the component
mapping is on record if a future scope change (e.g. a hosted channel
service) ever introduces one.
