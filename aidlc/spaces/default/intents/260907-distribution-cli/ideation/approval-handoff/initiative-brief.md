# Initiative Brief — aidlc-fleet Distribution CLI

## Intent and Problem Statement

Individuals and teams running AI-DLC across multiple projects have no
central way to declare which engine version and plugin set every project
should run, and no mechanized way for a project to follow that declaration
over time. `git submodule` is explicitly rejected as the distribution
mechanism. Naive file-copy engine upgrades corrupt already-composed plugin
surfaces, and the plugin compose process can silently degrade a stage while
still exiting 0 — success cannot be inferred from exit code alone. [intent]

## Target Customer

Internal: the same individual or team operating multiple AI-DLC-enabled
projects across several harnesses (Cursor, Kiro, Codex, opencode,
Copilot — explicitly not Claude-Code-only). They experience version/plugin
drift across projects and lack a safe, harness-agnostic update path.
[intent]

## Market Validation Summary

Not applicable — `market-research` is SKIP in the approved workflow grid.
This is internal fleet-distribution tooling, not a market-facing product;
there is no external market to validate. [Q5]

## Feasibility and Risk Highlights

`feasibility` is SKIP in the approved workflow grid — the v0.1 document's
own extensively-verified facts (E1–E6, P1–P8, H1–H4, V1–V6, all reproduced
across "両環境": both a Linux sandbox and the author's Mac) already
establish the approach's viability, so a separate feasibility pass would
duplicate that evidence rather than add new information.

The two highest-severity risks and their mitigations, both already
captured as Must-Have backlog items:

- **P5** — compose can exit 0 while silently degrading a stage → mitigated
  by the four-part success-verification contract (backlog M2, v0.1 §6,
  called out in the source document as "最重要" / most important)
- **P6** — mixing plugin projection versions causes degraded state →
  mitigated by never mixing versions in `init`/`plugin add` (backlog M1/S1,
  v0.1 §5.2)
- The version-gate risk (an arbitrary upgrade corrupting or blocking a
  project) → mitigated by the origin-record version gate (backlog M3, v0.1
  §4)
- Data loss / corruption from naive engine replacement → mitigated by the
  file-ownership invariants (backlog M4, v0.1 §7)

[scope-def]

## Scope Boundary

In scope: the full seven-command surface (`init`, `update`, `check`,
`plugin add/remove`, `pin`/`unpin`, `status`, `doctor`) plus the three
structurally load-bearing foundations every command must respect — the
origin-record version gate (§4), the four-part success criterion (§6, the
document's own "最重要" section), and the file-ownership invariants (§7).

Out of scope: reimplementing upstream plugin-compose logic, modifying
upstream files, reading/writing `aidlc/` workspace state beyond the initial
memory seed copy, mandatory host plugin-store integration, and arbitrary
version-to-version upgrades.

Minimum viable slice: `init` + `check` + `doctor` — a project can be
onboarded and verified even before `update`/`plugin`/`pin` exist.

Full detail: `../scope-definition/scope-document.md`. [scope-def]

## Concept Visuals

Not applicable — `rough-mockups` is SKIP in the approved workflow grid.
This is a pure CLI tool with no visual/UX surface to mock up. [Q4]

## Team Plan

Not applicable — `team-formation` is SKIP in the approved workflow grid.
The stakeholder map names a single decision-maker/operator; construction
proceeds without a formal mob-staffing step. [Q6]

## Go/No-Go Recommendation

**Go.** All stakeholders (the single decision-maker/operator) have already
confirmed intent and scope at their respective gates (intent-capture `[Q8]`,
scope-definition approval); every risk documented in the source v0.1 §1
verified-facts table traces to a Must-Have mitigation already captured in
`intent-backlog.md`; and the resource commitment (the operator's own time)
is already the document's own framing for this build, with no external
budget or headcount decision blocking it. Proceed to Inception.
