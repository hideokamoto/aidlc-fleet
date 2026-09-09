# Reliability Requirements — aidlc-fleet Distribution CLI

NFR4 adapts "reliability" away from the SRE uptime/SLA framing — there
is no long-running service to keep "up." Reliability here means: does a
failed or interrupted invocation leave the project in a safe,
recoverable state? (Q4, `nfr-requirements-questions.md`)

## Fault Tolerance

| ID | Requirement | Source |
|----|-------------|--------|
| NFR4.1 | A failed `init`/`update`/`plugin add`/`plugin remove` must never leave `aidlc.lock.json` partially written — the write is all-or-nothing per command invocation. The exact mechanism (temp-file-plus-rename, write-ahead journal, etc.) is a Code Generation implementation choice, not specified here. | This stage's own requirement, derived from BR8.1 (`functional-design/rules.md`) and the exit-code contract's implicit assumption that a failed command leaves no half-applied state |
| NFR4.2 | A missing or malformed `aidlc.lock.json` is a hard failure for every command except `init` (which creates it) — the CLI never guesses at a partial/corrupt lockfile's intended state. | BR8.1, `functional-design/rules.md`; `contract-summary.md` Contract 2 |
| NFR4.3 | Any detected file-ownership invariant violation (BR2.1–BR2.6) fails immediately, before any further mutation — fail-fast, never a partial apply followed by a warning. | BR2.6, `functional-design/rules.md`; practices-discovery Forbidden rule, `project.md`: "NEVER ファイル所有権 invariant 違反を警告のみで処理し、処理を継続しない" |

## Durability

| ID | Requirement | Status |
|----|-------------|--------|
| NFR4.4 | Engine-owned directories are backed up before a `--force` replace (BR2.1). | Covered — `functional-design/rules.md` |
| NFR4.5 | The Lockfile itself (`aidlc.lock.json`) has **no built-in backup mechanism**. BR2.1's backup-before-force-replace covers only engine-owned directories, not the lockfile. | **Open gap**, carried forward from `functional-design/functional-spec.md`'s Open Questions — not resolved by this stage either, since no v0.1 section or approved artifact specifies a lockfile backup/recovery mechanism. Flagged here rather than silently closed. |

## Graceful Degradation

| ID | Requirement | Source |
|----|-------------|--------|
| NFR4.6 | A `plugin sync` exit code of 1 is classified "installation incomplete," not folded into a generic hard failure — this is the CLI's one explicit degraded-but-recoverable state. | BR3.3, `functional-design/rules.md` (M2, v0.1 §6) |
| NFR4.7 | `check`/`status` never mutate state and never fail on drift alone — drift is reported content (exit 1/2 for `check`), not a crash condition. | BR5.1/BR5.2, `functional-design/rules.md` |

## Availability / SLA / SLO

No numeric availability target (e.g., "99.9% uptime") applies — there
is no persistently running service whose uptime could be measured. This
is a deliberate scope exclusion, not an oversight: the framework's
default NFR templates assume a hosted service, and this CLI has no
server component (`intent-statement.md`).

## Open Reliability Gaps (carried forward, not resolved here)

| Gap | Why unresolved | Owner for resolution |
|-----|-----------------|------------------------|
| Concurrent-invocation file locking for `aidlc.lock.json` (two CLI processes racing on the same project) | No v0.1 section or approved artifact addresses file locking | Code Generation |
| Atomic/transactional Lockfile write semantics under interruption (NFR4.1's mechanism) | Implementation detail, not specified at design level | Code Generation |
| Lockfile backup/recovery (NFR4.5) | No approved artifact specifies a mechanism | Code Generation, or an explicit human decision to accept the gap |

These three gaps were first surfaced in `functional-design/functional-spec.md`'s Open Questions and remain open after this stage's review — they are reliability-relevant but design-level artifacts cannot invent their resolution without a stated source.
