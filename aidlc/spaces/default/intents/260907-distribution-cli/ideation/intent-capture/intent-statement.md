# Intent Statement — aidlc-fleet Distribution CLI

## Problem Statement

Individuals and teams running AI-DLC across multiple projects have no
central way to declare "which engine version and which plugin set" every
project should run, and no mechanized way for a project to follow that
declaration over time. `git submodule` is explicitly rejected as the
distribution mechanism. Naive file-copy engine upgrades corrupt already-
composed plugin surfaces [Q2], and the plugin compose process can silently
degrade a stage while still exiting 0 — success cannot be inferred from exit
code alone. [Q1] [Q3]

## Target Customer

Internal: the same individual or team operating multiple AI-DLC-enabled
projects across several harnesses (Cursor, Kiro, Codex, opencode, Copilot —
explicitly not Claude-Code-only). They experience version/plugin drift
across projects and lack a safe, harness-agnostic update path. [Q2]

## Success Metrics

`init` / `update` / `plugin add` are judged successful only when **all**
of the following hold simultaneously:

1. The compose process exits 0.
2. No `[degraded]` line appears in the relevant `.drops` file.
3. `doctor`'s failed count, minus `known_failures`, is 0.
4. A `plugin sync` exit 1 is surfaced to the human as "installation
   incomplete" rather than silently treated as failure.

Exit-code-0 from compose alone is explicitly disqualified as proof of
success. The CLI's exit-code contract is: `0` = lockfile/channel/disk in
sync, `1` = behind channel (resolvable via `update`), `2` = local
modification drift, `3` = version-gate rejection, `4` = compose
degraded or engine install incomplete. [Q3]

## Initiative Trigger

Upstream `awslabs/aidlc-workflows` has not yet shipped native multi-project
distribution (tracked upstream as RFC #722 / PR #756: `aidlc update`,
project pin). This CLI is explicitly positioned as a thin, temporary
distribution layer intended to retire once upstream ships that capability —
it does not reimplement upstream's plugin-compose logic and does not modify
upstream files. [Q4] [desc]

## Initial Scope Signal

- **Workflow-selected scope** (composer-proposed, human-approved before this
  stage began): `aidlc-distribution-cli` — a custom 15-of-33-stage grid
  (intent-capture, scope-definition, approval-handoff, practices-discovery,
  domain-design, contract-design, functional-design, nfr-requirements,
  nfr-design, code-generation, build-and-test, ci-pipeline, plus the three
  initialization stages). [scope]
- **User-confirmed product boundary**: confirmed as matching the intended
  scope — command surface (`init`, `update`, `check`, `plugin add/remove`,
  `pin`/`unpin`, `status`, `doctor`), the channel/lockfile data model, the
  origin-record version gate, the sessionStart hook, the four-part success
  criterion, and the file-ownership invariants, all as specified in the
  shared v0.1 requirements document. [Q8]

## Assumptions & Open Questions

None.

## Review

**Verdict:** READY
**Reviewer:** aidlc-product-lead-agent
**Date:** 2026-09-07T14:47:00Z
**Iteration:** 1
**Request Challenge:** review:c8d1950aeeb13c06d5fccb1ad2a82935

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Critical | intent-statement.md > Initial Scope Signal | Unsourced ARS score and exclusion rationale asserted alongside the [Q8]-sourced scope confirmation | Trim to only [Q8]/[scope]-sourced claims | Resolved |
| R-02 | Critical | stakeholder-map.md / intent-capture-questions.md | Unresolved assumption bypassed the required Assumption Confirmation gate | Run the gate, obtain human confirmation, propagate to both artifacts | Resolved |
| R-03 | Major | intent-statement.md > Problem Statement | Q2-sourced sentence lacked a [Q2] tag | Add [Q2] tag | Resolved |
| R-04 | Minor | intent-statement.md > Initiative Trigger | Detail tagged [Q4] only, but content is drawn from [desc] | Add [desc] tag alongside [Q4] | Resolved |

### Summary

All three prior Critical/Major findings (plus one self-identified Minor) are verified resolved against the current file contents: the Initial Scope Signal now states only [Q8]/[scope]-sourced facts, the Assumption Confirmation gate was run with the human answering "A. Accept assumptions" and both `stakeholder-map.md` and `intent-capture-questions.md` reflect `None.` accordingly, the Q2-sourced sentence carries `[Q2]`, and the Initiative Trigger sentence carries `[desc]` alongside `[Q4]`. No new unsourced claims or missing required sections were found. Ready to proceed to the approval gate.
