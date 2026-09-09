# Security Requirements — aidlc-fleet Distribution CLI

NFR2 covers this CLI's most substantive NFR category (Q2,
`nfr-requirements-questions.md`). There is no user-facing authentication
in this CLI — it runs as the invoking developer/CI identity — so
"security" here is almost entirely about verifying the *content* fetched
and installed, not verifying a *user*.

## Authentication

| ID | Requirement |
|----|-------------|
| NFR2.1 | No user authentication model applies. The CLI executes with the invoking process's own identity (developer's local shell, or the CI job's identity) and performs no login, session, or credential-issuance flow of its own. |

## Authorization

| ID | Requirement |
|----|-------------|
| NFR2.2 | No role/permission model applies within the CLI itself — file-system permissions of the invoking identity are the sole access-control boundary, inherited from the OS/CI environment, not implemented by this CLI. |

## Data Protection

| ID | Requirement | Source |
|----|-------------|--------|
| NFR2.3 | `aidlc.lock.json` and the channel configuration must never contain credentials, API keys, or other secrets. | practices-discovery Forbidden rule, `project.md`: "NEVER `aidlc.lock.json` やチャネル設定ファイルに認証情報・APIキー等の秘密情報をハードコードしない" |
| NFR2.4 | Every fetched tarball (engine and plugin) is sha256-verified against the channel's declared hash before use; a mismatch is a hard failure — never silently retried. | BR7.1, `functional-design/rules.md`; `contract-summary.md` Contract 1 |
| NFR2.5 | An unrecognized Channel `schema` version is surfaced to the human rather than parsed with a best-effort guess. | BR7.2, `functional-design/rules.md` |

## Supply-Chain Integrity

| ID | Requirement |
|----|-------------|
| NFR2.6 | Engine and plugin sources are pinned by commit SHA, not by floating tags or branches (`Channel.engine.ref`, `Channel.plugins[].ref` — `entities.md`). A compromised upstream ref cannot silently substitute content post-fetch without failing NFR2.4's sha256 check. |
| NFR2.7 | This CLI never reimplements or modifies upstream `install.ts`/`compose.ts` logic (`components.md` EngineInstaller rationale; practices-discovery Forbidden rule) — it wraps/diffs against upstream's own vetted logic rather than maintaining a parallel implementation that could drift out of security parity. |

## STRIDE Threat Summary

| Threat | Applicability | Mitigation |
|--------|---------------|------------|
| Spoofing | Low — no user identity to spoof; a malicious channel operator could spoof the channel's content | NFR2.4 (sha256), NFR2.6 (commit-SHA pinning) |
| Tampering | The primary threat — a fetched tarball or channel declaration tampered in transit or at the source | NFR2.4, NFR2.6 |
| Repudiation | Not applicable — no multi-user audit trail requirement stated in any approved artifact | — |
| Information Disclosure | NFR2.3 (no secrets in Lockfile/channel config) covers the CLI's own data; upstream channel content itself is not this CLI's confidentiality concern | NFR2.3 |
| Denial of Service | Low — a malicious/broken channel could cause repeated failed fetches, but no rate-limiting/availability SLA applies to a locally invoked CLI | Not addressed — no approved artifact specifies DoS mitigation for this CLI shape |
| Elevation of Privilege | Not applicable — no privilege levels within the CLI (NFR2.2) | — |

## Compliance

| ID | Requirement |
|----|-------------|
| NFR2.8 | No regulatory compliance framework (GDPR, HIPAA, SOC2, PCI-DSS) applies. This is an internal developer tool with no PII/PCI/HIPAA data flow — `intent-statement.md` and `intent-backlog.md` describe no such data handling, and no approved artifact establishes one. |

## Security Anti-Requirements (explicitly excluded)

- "The system should be secure" — not measurable; replaced by NFR2.1–NFR2.8.
- "No vulnerabilities" — impossible to guarantee; addressed instead at
  the pipeline level (CircleCI secret scanning and dependency scanning,
  per `team.md`'s affirmed Deployment practice, covered in
  `tech-stack-decisions.md` and the `ci-pipeline` stage, not duplicated
  here).
- User authentication/authorization requirements (MFA, session
  management, RBAC) — do not apply; this CLI has no user-facing login
  surface (NFR2.1).

## Revision Note (post iteration-1 findings)

Per the architecture reviewer's iteration-1 findings (R-01 Major,
R-02/R-03 Minor):

- **R-01 fix**: NFR2.3 (this file) and NFR4.3 (`reliability-requirements.md`)
  now correctly cite `project.md`'s `## Forbidden` section instead of
  mislabeling it "Mandated" — matching NFR2.7's already-correct labeling
  two lines below.
- **R-02 fix**: `scalability-requirements.md`'s NFR3.1 "tens of plugins"
  baseline is now explicitly tagged `[assumption]`, matching the pattern
  `performance-requirements.md` already used for its own unsourced
  numeric targets.
- **R-03 fix**: `performance-requirements.md`'s NFR1.1 no longer cites a
  "Performance Validation" stage, which is not in this workflow's
  approved scope grid; it now states plainly that no later stage owns
  re-measuring the target.

## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-09-09T00:31:42Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | security-requirements.md > NFR2.3; reliability-requirements.md > NFR4.3 | Both citations mislabeled a `project.md` `## Forbidden` rule as "Mandated." | Cite `## Forbidden`, matching NFR2.7's existing correct labeling. | Resolved |
| R-02 | Minor | scalability-requirements.md > NFR3.1 | "Tens of plugins" baseline lacked an `[assumption]` tag. | Add the `[assumption]` tag. | Resolved |
| R-03 | Minor | performance-requirements.md > NFR1.1 | Cited a "Performance Validation" stage not in this workflow's approved scope grid. | Remove the citation; state plainly no later stage re-measures the target. | Resolved |

No new findings survived verification. Re-checked areas: the revision-note claims against the two source-of-truth files, and a fresh scan of the touched sections and their immediate neighbors for defects the edits themselves might have introduced.

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| Manual cross-check: `project.md` `## Forbidden` vs `## Mandated` | Confirmed — the secrets rule ("NEVER `aidlc.lock.json` やチャネル設定ファイルに認証情報・APIキー等の秘密情報をハードコードしない") and the fail-fast rule ("NEVER ファイル所有権 invariant 違反を警告のみで処理し、処理を継続しない") both live under `## Forbidden`, not `## Mandated`. | NFR2.3 and NFR4.3 now cite the correct section; R-01 verified fixed at the source, not just re-worded. |
| Manual cross-check: `[assumption]` tagging in `scalability-requirements.md` NFR3.1 | Confirmed — the "tens of plugins" baseline is now tagged `[assumption]`, matching the pattern already used in `performance-requirements.md`. | R-02 verified fixed. |
| Manual cross-check: workflow scope grid in `intent-statement.md` > Initial Scope Signal | Confirmed — the approved 15-of-33-stage grid (intent-capture, scope-definition, approval-handoff, practices-discovery, domain-design, contract-design, functional-design, nfr-requirements, nfr-design, code-generation, build-and-test, ci-pipeline, plus the three initialization stages) contains no Performance Validation stage. | NFR1.1's claim "this workflow's approved scope grid has no Performance Validation stage" is accurate; R-03 verified fixed. |
| Traceability cross-check: `traceability.json` | NFR4's `target` list omits NFR4.5, which appears instead in the `reverse` block as `N/A` (documented open gap). | Pre-existing, deliberate asymmetry unrelated to the three fixes — not a defect introduced by this revision. |

### Summary

All three prior findings (R-01 Major, R-02/R-03 Minor) are verified fixed against their actual source artifacts, not merely re-worded: the `project.md` section citations now match the real `## Forbidden`/`## Mandated` split, the scalability baseline carries its `[assumption]` tag, and the performance target no longer cites a non-existent scope-grid stage. A fresh scan of the edited sections and their immediate context found no new defects introduced by the revision.
