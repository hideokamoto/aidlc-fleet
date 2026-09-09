# Security Design — aidlc-fleet Distribution CLI

## Sources

- [nfr] `construction/nfr-requirements/security-requirements.md` (NFR2.1–NFR2.8)
- [functional] `construction/functional-design/functional-spec.md`, `rules.md` (BR7.1)
- [domain] `inception/domain-design/components.md`
- [nfr-design] `construction/nfr-design/nfr-design-questions.md` Q2

## No Authentication / Authorization Model

NFR2.1/NFR2.2 already established there is no user authentication or
authorization surface — the CLI runs with the invoking user's own local
filesystem and network permissions, no login, no session, no role model.
This design section is intentionally empty of an auth architecture; adding
one would contradict the approved requirement.

## Integrity Verification Placement (NFR2.4)

`ChannelClient` performs sha256 verification **synchronously, immediately
after each tarball download and before handing bytes to any other
component** (BR7.1). This is a deliberate ordering decision:

```
download tarball bytes
  -> compute sha256(bytes)
  -> compare against channel-declared hash
       match    -> hand bytes to EngineInstaller / PluginManager
       mismatch -> reject; no partial/unverified write ever occurs
```

- **Not deferred, not batched**: verification happens per-tarball, in the
  same synchronous call chain as the download — never queued for a later
  bulk-verify pass, which would create a window where unverified bytes
  could reach `FileOwnershipGuard`'s write path.
- **Fail-closed**: a hash mismatch is a fatal error for that command
  invocation (consistent with the fail-fast Mandated rule in `project.md`);
  no fallback to an unverified install exists.

## Secrets Handling (NFR2.3)

NFR2.3 is a **non-write** guarantee, not a runtime scan: `LockfileStore`
and `ChannelClient` never serialize a secret-bearing field into
`aidlc.lock.json` or channel config in the first place, because no such
field exists in the `Lockfile`/`Channel` entity shapes (`components.md`).
`FileOwnershipGuard` is invoked before any write that touches a path that
*could* carry a secret-bearing file (e.g. an engine-owned config being
replaced), as a structural backstop consistent with its existing
pre-write invariant-check responsibility — it does not scan file contents
for secret patterns, since no approved artifact requires that.

## Commit-SHA Pinning (NFR2.6)

`ChannelClient` resolves the channel's declared engine/plugin source to an
immutable commit SHA before download (not a mutable branch/tag ref); this
is a data-shape decision on the `Channel` entity's `engine`/`plugins`
fields, not new component behaviour — `Channel.engine` and each plugin
entry already carry a pinned ref per the approved entity shape.

## No Encryption-at-Rest Design

NFR6.2 (tech-stack-decisions.md) already established `aidlc.lock.json` is
a plain local JSON file — not a managed data store with an encryption
option. `LockfileStore` writes plaintext JSON; encryption-at-rest is out
of scope because there is no managed storage layer to configure one on,
and the file contains no secrets (NFR2.3) to protect.

## STRIDE Summary (carried from security-requirements.md, design-level placement only)

| Threat | Component boundary | Design control |
|---|---|---|
| Tampering (tarball) | `ChannelClient` → `EngineInstaller`/`PluginManager` | Synchronous sha256 verify before handoff (above) |
| Tampering (lockfile) | `LockfileStore` | Atomic write (NFR4.1, see `reliability-design.md`) — a partial write can never look like a valid tampered state |
| Information Disclosure | `LockfileStore`, `ChannelClient` | No secret-bearing fields in either entity shape (NFR2.3) |
| Elevation of Privilege | `FileOwnershipGuard` | Engine-owned directory writes require `--force` + backup; no implicit privilege escalation path |

## No Compliance Framework Applies

Confirmed by NFR2.8 (security-requirements.md) — no PCI/HIPAA/SOC2 scope
for a locally-run open-source CLI with no user data store. No compliance
control design is produced here.

## Unrecognized Channel Schema Version (NFR2.5)

`ChannelClient` validates `Channel.schema` immediately after parsing the
fetched channel declaration, before any other field is read. An
unrecognized/unsupported schema version is surfaced to the caller as an
explicit error (BR7.2) rather than guessed at or silently coerced to the
nearest known version — this is a read-time validation gate on
`ChannelClient`'s own parse path, not a new component or a pattern beyond
"validate before use." No further design is needed beyond fixing this
placement, since the classification and error surfacing are already fully
specified by BR7.2 in `rules.md`.

## No Reimplementation of Upstream Install/Compose Logic (NFR2.7)

Confirmed, not redesigned: `components.md` already establishes that
`EngineInstaller` wraps upstream `install.ts`/`compose.ts` (Cursor) or
performs the receipt-diff procedure for other harnesses, and always
re-runs the canonical `compose` afterward rather than reimplementing its
plugin-composition logic (the `EngineInstaller` external-dependency entry:
"canonical engine install and plugin-compose logic, never reimplemented,
per §0 non-goal"). No new security design is required here — the security
property NFR2.7 protects (no divergent, unreviewed reimplementation of a
security-relevant upstream process) is already satisfied by this
component boundary as designed in Domain Design.

## Revision Note (post iteration-1 NOT-READY)

Both findings from iteration 1 have been fixed:

- **R-01 (Critical)** — `reliability-design.md`'s NFR4.2/NFR4.3 section is
  split: NFR4.2 (BR8.1, missing/malformed lockfile) stays a `CommandLayer`
  boundary check; NFR4.3 (BR2.6, fail-fast invariant) is re-attributed to
  `FileOwnershipGuard`, invoked by `CommandLayer` around each mutating
  operation but enforced at write time — matching `rules.md`'s
  `BR2.6.applies_to: FileOwnershipGuard` and `components.md`'s ownership.
  `logical-components.md`'s Component Inventory table moved NFR4.3 off the
  `CommandLayer` row onto the `FileOwnershipGuard` row.
- **R-02 (Major)** — Added two new design sections to this file,
  "Unrecognized Channel Schema Version (NFR2.5)" and "No Reimplementation
  of Upstream Install/Compose Logic (NFR2.7)," each grounding its
  requirement in the actual upstream artifact (BR7.2, `components.md`'s
  `EngineInstaller` entry) rather than the unrelated STRIDE table.
  `traceability.json`'s NFR2.5/NFR2.7 coverage entries now point to these
  new sections instead of the STRIDE table.

## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-09-09T01:03:18Z
**Iteration:** 2

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Critical | `construction/nfr-design/reliability-design.md` > "Design Solution: NFR4.3", `construction/nfr-design/logical-components.md` > Component Inventory, `construction/nfr-design/traceability.json` > NFR4.3 | Verified fixed. NFR4.3 (BR2.6) is now correctly attributed to `FileOwnershipGuard`, invoked by `CommandLayer` around each mutating operation but enforced at write time — matching `rules.md`'s `BR2.6.applies_to: FileOwnershipGuard` and `components.md`'s "no business logic of its own" characterization of `CommandLayer`. All three artifacts (`reliability-design.md`'s section text and Coverage Summary table, `logical-components.md`'s Component Inventory row, `traceability.json`'s NFR4.3 target string) are mutually consistent, and no other artifact in the reviewed set still cites the old CommandLayer/BR2.6 attribution. | None — resolved. | Resolved |
| R-02 | Major | `construction/nfr-design/security-design.md` > "Unrecognized Channel Schema Version (NFR2.5)" and "No Reimplementation of Upstream Install/Compose Logic (NFR2.7)", `construction/nfr-design/traceability.json` > NFR2.5/NFR2.7 | Verified fixed. Both sections now cite genuine, checkable grounding — NFR2.5 traces to `rules.md`'s BR7.2 (`applies_to: ChannelClient`, confirmed by direct read of `rules.md`), and NFR2.7 traces to `components.md`'s `EngineInstaller` external-dependency entry ("Canonical engine install and plugin-compose logic, never reimplemented, per §0 non-goal", confirmed by direct read of `components.md`). `traceability.json`'s NFR2.5/NFR2.7 targets now point at these new sections instead of the STRIDE table, and the STRIDE table itself is unchanged (correctly, since it was never meant to cover these two IDs). | None — resolved. | Resolved |
| R-03 | Critical | `construction/nfr-design/reliability-design.md` > "Design Solution: NFR4.2" (lines 29-37), `construction/nfr-design/logical-components.md` > Component Inventory (`CommandLayer` row), `construction/nfr-design/traceability.json` > NFR4.2 | New defect, same class as the now-fixed R-01, in a section the R-01 fix did not touch. `rules.md` states `BR8.1.applies_to: LockfileStore` (confirmed by direct read — "`\| BR8.1 \| LockfileStore \| validation \| missing/malformed lockfile is a hard failure outside \`init\` \|`"), and `functional-spec.md` independently confirms this ownership ("LockfileStore (2, the `pin` rule BR6.1 and BR8.1)"). Yet `reliability-design.md`'s NFR4.2 section states "`CommandLayer` enforces this check at the command-entry boundary... (BR8.1 — missing/malformed lockfile classification)" and frames CommandLayer, not LockfileStore, as performing the classification. This repeats exactly the reasoning error R-01 corrected for NFR4.3/BR2.6 — validation/classification business logic (rules.md category: `validation`) is attributed to `CommandLayer`, contradicting `components.md`'s characterization of `CommandLayer` as "no business logic of its own — a pure routing/exit-code layer" that the R-01 fix itself invokes two paragraphs later in the same file. `logical-components.md`'s Component Inventory lists NFR4.2 under the `CommandLayer` row (not `LockfileStore`), and `traceability.json`'s NFR4.2 target reads "`CommandLayer boundary check before dispatch (BR8.1)`" — both propagate the same misattribution. A developer building from this document would place BR8.1's hard-failure classification logic in the routing layer, mirroring the exact rework risk R-01 was raised to prevent. | Re-attribute NFR4.2/BR8.1 to `LockfileStore` (the classification/validation logic) with `CommandLayer` only invoking the check and mapping its result to an exit code — the same pattern the fixed NFR4.3 section now uses for `FileOwnershipGuard`. Update `reliability-design.md`'s NFR4.2 section and Coverage Summary row, `logical-components.md`'s Component Inventory (move NFR4.2 off the `CommandLayer` row onto the `LockfileStore` row), and `traceability.json`'s NFR4.2 target string accordingly. | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| Manual cross-reference: `reliability-design.md`/`logical-components.md`/`traceability.json` NFR4.3 attribution vs. `rules.md` BR2.6.applies_to | PASS | Confirms R-01 is genuinely resolved, not cosmetic — all three artifacts agree with `rules.md` and with each other |
| Manual cross-reference: `security-design.md`/`traceability.json` NFR2.5/NFR2.7 vs. `rules.md` BR7.2 and `components.md` EngineInstaller entry | PASS | Confirms R-02 is genuinely resolved — new sections cite real, existing upstream artifacts, not the STRIDE table |
| Manual cross-reference: `reliability-design.md`/`logical-components.md`/`traceability.json` NFR4.2 attribution vs. `rules.md` BR8.1.applies_to and `functional-spec.md`'s rule-count note | FAIL | Confirms R-03 — `LockfileStore` owns BR8.1 per two independent upstream artifacts, but all three NFR4.2 references attribute the check to `CommandLayer` |
| Repo-wide grep for stale `CommandLayer`+`BR2.6`/invariant-enforcement phrasing across `construction/nfr-design/` | PASS (no stale references) | Every remaining `BR2.6` reference correctly names `FileOwnershipGuard` as the owner; the fix was applied consistently for this specific rule ID |

### Summary

R-01 and R-02 are both genuinely fixed, not cosmetic — the corrected attributions and new sections are internally consistent across `reliability-design.md`, `logical-components.md`, `security-design.md`, and `traceability.json`, and each grounds its claim in a real upstream artifact rather than an unrelated one. However, the fix for R-01 was narrowly scoped to the one BR2.6/NFR4.3 location the iteration-1 review named: the adjacent NFR4.2 section still commits the identical misattribution error (business-logic classification credited to `CommandLayer` instead of the rules.md-designated owner, here `LockfileStore` per BR8.1) that R-01 was raised to fix for BR2.6/`FileOwnershipGuard`. This is a new Critical finding (R-03) that blocks READY.

## Revision Note (post iteration-2 NOT-READY)

R-03 has been fixed, applying the identical pattern already verified for
R-01: `reliability-design.md`'s NFR4.2 section now attributes BR8.1's
absent/malformed classification to `LockfileStore` (per `rules.md`'s
`BR8.1.applies_to: LockfileStore`), with `CommandLayer` only invoking the
load and mapping the result to an exit code — never inspecting or
classifying the file itself. `reliability-design.md`'s Coverage Summary
table, `logical-components.md`'s Component Inventory (NFR4.2 moved off the
`CommandLayer` row onto the `LockfileStore` row), and `traceability.json`'s
NFR4.2 target string are all updated to match.

`reviewer_max_iterations` for this stage is 2, both of which have now run;
this fix has not been re-verified by an automated reviewer pass. It is
presented at the human approval gate for review, applying the same
verified R-01 correction pattern the iteration-2 review itself confirmed
was genuine and consistent across all three artifacts.

## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-09-09T01:14:08Z
**Iteration:** 3

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Critical | `construction/nfr-design/reliability-design.md` > "Design Solution: NFR4.3", `construction/nfr-design/logical-components.md` > Component Inventory, `construction/nfr-design/traceability.json` > NFR4.3 | Verified fixed. NFR4.3 (BR2.6) is now correctly attributed to `FileOwnershipGuard`, invoked by `CommandLayer` around each mutating operation but enforced at write time — matching `rules.md`'s `BR2.6.applies_to: FileOwnershipGuard` and `components.md`'s "no business logic of its own" characterization of `CommandLayer`. All three artifacts (`reliability-design.md`'s section text and Coverage Summary table, `logical-components.md`'s Component Inventory row, `traceability.json`'s NFR4.3 target string) are mutually consistent, and no other artifact in the reviewed set still cites the old CommandLayer/BR2.6 attribution. | None — resolved. | Resolved |
| R-02 | Major | `construction/nfr-design/security-design.md` > "Unrecognized Channel Schema Version (NFR2.5)" and "No Reimplementation of Upstream Install/Compose Logic (NFR2.7)", `construction/nfr-design/traceability.json` > NFR2.5/NFR2.7 | Verified fixed. Both sections now cite genuine, checkable grounding — NFR2.5 traces to `rules.md`'s BR7.2 (`applies_to: ChannelClient`, confirmed by direct read of `rules.md`), and NFR2.7 traces to `components.md`'s `EngineInstaller` external-dependency entry ("Canonical engine install and plugin-compose logic, never reimplemented, per §0 non-goal", confirmed by direct read of `components.md`). `traceability.json`'s NFR2.5/NFR2.7 targets now point at these new sections instead of the STRIDE table, and the STRIDE table itself is unchanged (correctly, since it was never meant to cover these two IDs). | None — resolved. | Resolved |
| R-03 | Critical | `construction/nfr-design/reliability-design.md` > "Design Solution: NFR4.2" (lines 29-40), `construction/nfr-design/logical-components.md` > Component Inventory (`LockfileStore` row), `construction/nfr-design/traceability.json` > NFR4.2 | Verified fixed. `reliability-design.md`'s NFR4.2 section now states "`rules.md` attributes BR8.1 to `LockfileStore`, not `CommandLayer`" and describes `LockfileStore` itself classifying "absent" vs. "fails to parse" on load, with `CommandLayer` only invoking the load and dispatching on the result — explicitly not inspecting the file or deciding absent/malformed. This matches `rules.md`'s `BR8.1.applies_to: LockfileStore` and mirrors the already-verified R-01/NFR4.3 pattern. The Coverage Summary table row for NFR4.2 now reads "`LockfileStore` classifies absent/malformed on load, `CommandLayer` maps result to exit code (BR8.1)". `logical-components.md`'s Component Inventory now lists NFR4.2 under the `LockfileStore` row ("NFR4.1 (atomic write), NFR4.2 (absent/malformed classification on load)") and no longer under `CommandLayer`. `traceability.json`'s NFR4.2 target string now reads "`reliability-design.md: LockfileStore classifies absent/malformed lockfile on load, CommandLayer maps result to exit code (BR8.1)`". All three artifacts are mutually consistent and agree with `rules.md`. | None — resolved. | Resolved |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| Manual cross-reference: `reliability-design.md`/`logical-components.md`/`traceability.json` NFR4.3 attribution vs. `rules.md` BR2.6.applies_to | PASS | Confirms R-01 remains resolved — all three artifacts still agree with `rules.md` and with each other |
| Manual cross-reference: `security-design.md`/`traceability.json` NFR2.5/NFR2.7 vs. `rules.md` BR7.2 and `components.md` EngineInstaller entry | PASS | Confirms R-02 remains resolved |
| Manual cross-reference: `reliability-design.md`/`logical-components.md`/`traceability.json` NFR4.2 attribution vs. `rules.md` BR8.1.applies_to | PASS | Confirms R-03 is genuinely fixed — all three artifacts now attribute BR8.1's classification to `LockfileStore`, with `CommandLayer` limited to invoking the load and mapping the result to an exit code |
| Repo-wide grep for stale `CommandLayer`-owns-BR8.1 / `CommandLayer`-owns-BR2.6 phrasing across `construction/nfr-design/*.md` and `traceability.json` | PASS (no live stale references) | Every current NFR4.2/BR8.1 and NFR4.3/BR2.6 reference in `reliability-design.md`, `logical-components.md`, and `traceability.json` names `LockfileStore`/`FileOwnershipGuard` respectively. The only remaining "`CommandLayer` ... BR8.1" text is inside `security-design.md`'s own "Revision Note (post iteration-1 NOT-READY)" section (lines 112-114), which is a historical record of the pre-R-03-fix state, superseded three paragraphs later by the "Revision Note (post iteration-2 NOT-READY)" section — not a live claim, and consistent with the audit-trail convention already used elsewhere in this file |

### Summary

This is a recovery-review pass verifying the post-iteration-2 fix for R-03. All three findings (R-01, R-02, R-03) are now genuinely resolved and mutually consistent across `reliability-design.md`, `logical-components.md`, `security-design.md`, and `traceability.json`, each grounded in the correct upstream artifact (`rules.md`'s `applies_to` fields, `components.md`'s component descriptions). The repo-wide sanity sweep found no remaining live misattribution of BR8.1 or BR2.6 to `CommandLayer`. Zero Critical, zero Major findings outstanding — READY.
