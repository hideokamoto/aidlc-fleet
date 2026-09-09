# Scope Definition — Clarifying Questions

## Sources

- [desc] Initial description: the aidlc-fleet distribution CLI v0.1 requirements document (§0–§12), shared in full at intent-creation time.
- [intent] `aidlc/spaces/default/intents/260907-distribution-cli/ideation/intent-capture/intent-statement.md`

## Note on scope

Per the user's standing instruction not to re-ask anything the shared v0.1
document already answers, every question below is answered directly from
that document. Only the mandatory consolidated-summary checkpoint is
presented to the human as a live turn. `feasibility-assessment` and
`constraint-register` are absent by scope design (the `feasibility` stage
is SKIP in this workflow's grid) — both are optional `consumes` and their
absence is expected, not a gap.

## Q1. What is the minimum viable scope that delivers value?

Per v0.1 §3 (Commands) and §6 (成功判定), the minimum viable scope is:
`init` (place the engine + declared plugins per §5.1–5.2 and produce a
lockfile), `check` (three-way drift detection so a human can see whether a
project is in sync), and `doctor` (wraps upstream doctor, applying
`known_failures`). Without these three, a project cannot be onboarded to
central declaration or verified — every other command either mutates state
`init` first established (`update`, `plugin add/remove`, `pin`/`unpin`) or
summarizes it (`status`). [desc]

[Answer]: A. `init` + `check` + `doctor` is the minimum viable scope — a
project can be onboarded and verified even before `update`/`plugin`/`pin`
exist. [desc]

## Q2. What capabilities are must-have vs. nice-to-have?

The v0.1 document does not itself rank commands by priority — it specifies
all seven (`init`, `update`, `check`, `plugin add/remove`, `pin`/`unpin`,
`status`, `doctor`) as the command surface (§3), and the approved workflow
scope (`aidlc-distribution-cli`, confirmed at intent-capture `[Q8]`) already
commits to building the complete command surface in this initiative — there
is no partial-surface MVP option on the table for this workflow. What the
document does rank as structurally load-bearing, independent of command
completeness, are the invariants every command surface must respect:
the version gate (§4, "配布 CLI は任意版間のアップグレーダーになれない" —
explicitly load-bearing, not optional), the four-part success criterion
(§6, "compose の exit 0 を成功の証拠にしてはならない" — explicitly the most
important section per the doc's own heading "最重要"), and the file-ownership
invariants (§7, "不変条件"). These three are must-have for every command that
touches them; `pin`/`unpin` and `status` are the commands with the smallest
blast radius if deferred within a single build, since they read or override
existing lockfile state rather than establishing it. [desc]

[Answer]: A. All seven commands are in scope for this initiative (per the
approved workflow scope); the version gate (§4), the four-part success
criterion (§6), and the file-ownership invariants (§7) are must-have
foundations under every command. `pin`/`unpin` and `status` are the
lowest-blast-radius commands if any internal sequencing trade-off is needed
during design. [desc]

## Q3. What are the dependencies between capabilities?

Per v0.1's own command table (§3) and procedures (§5): `init` must exist
before `update`, `check`, `plugin add/remove`, `pin`/`unpin`, or `status`
can act (they all read/write the lockfile `init` creates). `update`'s
version-gate logic (§4) depends on `engine_origin` being recorded, which
only `init` (or `init --adopt`) writes. `plugin add`/`remove` depend on the
same success-verification logic (§6) that `init`/`update` use — the doc
describes them as sharing procedure §5.2 and the §6 verification contract.
`doctor` and `status` are read-only summarizers with no capability
depending on them. [desc]

[Answer]: A. `init` is the foundational dependency for every other command;
`update` additionally depends on `engine_origin` (written by `init`); `plugin
add`/`remove` depend on the same §6 success-verification contract as
`init`/`update`; `doctor`/`status` are terminal read-only consumers with
nothing depending on them. [desc]

## Q4. What is the sequencing preference (risk-first, value-first, dependency-first)?

The document's own structure argues for risk-first within a dependency-first
skeleton: §1 ("検証で確定した事実") documents that the riskiest, most
failure-prone behavior is P5 — compose returning exit 0 while silently
degrading a stage — which directly motivates §6's four-part success
criterion being called out as "最重要" (most important). The version gate
(§4) is the second-riskiest area, since a wrong migration-boundary judgment
either corrupts a project or blocks it. Given `init` is also the hard
dependency root (Q3), the natural sequencing is dependency-first at the
command level (`init` before anything else) with risk-first prioritization
within that: get the §6 success-verification contract and the §7
file-ownership invariants right in `init` before layering `update`'s §4
version gate on top, since a correct `init` is what makes `update`'s
`engine_origin` check meaningful. [desc]

[Answer]: A. Dependency-first at the command level (`init` first, since
everything else depends on it), risk-first within that — the §6
success-verification contract and §7 file-ownership invariants are proven
correct in `init` before `update`'s §4 version gate is layered on top. [desc]

## Q5. Are there hard deadlines tied to specific capabilities?

Not addressed anywhere in the v0.1 document. §12 ("未検証のまま残るもの") and
§11 ("未決事項") list open items but none carry a date or deadline; §0
positions the CLI as retiring once upstream ships RFC #722 / PR #756, which
is an event-based sunset condition, not a calendar deadline. [desc]

[Answer]: C. No hard deadlines are specified; the only time-based condition
in the document is the event-triggered sunset (retire once upstream ships
native distribution), not a delivery deadline. [desc]

## Assumptions & Open Questions

None.

## Consolidated Summary Confirmation

All five clarifying questions above have been answered directly from the
v0.1 requirements document and the approved intent statement, per the
user's explicit instruction not to re-ask anything the document already
settles. No assumptions remain open.

[Answer]: Looks correct
