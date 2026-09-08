# Contract Summary — aidlc-fleet Distribution CLI

This CLI runs as a single in-process unit (nine components, all
synchronous in-process calls per `domain-design/components.md` — no
internal inter-unit network or IPC boundary). Two formal
shared-schema contracts nonetheless cross this unit's own process
boundary and must be pinned before Code Generation: the central channel
declaration (read from outside) and the project lockfile (written for
outside consumers to read).

## Contracts Table

| # | Provider Unit | Consumer | Mechanism | Owner |
|---|----------------|----------|-----------|-------|
| 1 | External: central channel operator | ChannelClient (this CLI) | shared-schema (JSON, fetched from a git repo or static URL) | External (channel operator) |
| 2 | LockfileStore (this CLI) | External: CI scripts / third-party tooling reading `aidlc.lock.json` | shared-schema (JSON, local file) | LockfileStore |

## Contract 1: Channel Declaration

```yaml
shared-schema:
  name: aidlc-fleet-channel
  format: json
  version_field: schema
  current_version: 1
  location: central channel repo (git) or static URL, per project config
  fetched_by: ChannelClient
  authored_by: "External — the channel operator (outside this codebase)"
  integrity: sha256 verification of fetched tarball content; a checksum
    mismatch is a hard failure (v0.1 §5.1) — never silently retried
  schema:
    schema: integer                 # version marker; current = 1
    channel: string                 # e.g. "stable"
    engine:                          # [desc] — external v0.1 doc; not expanded in domain-design-questions.md (unlike Lockfile's engine, see R-02 note below)
      ref: string                   # commit SHA — assumption carried from EngineInstaller/ChannelClient behaviour text (tags mostly absent in upstream releases); not itself stated in any stored intent artifact
      version: string                # display/compare version, e.g. "2.6.124"
      tag: string | null
      sha256: string                 # tarball hash
    migration_boundaries:            # [desc] — external v0.1 doc; not expanded in domain-design-questions.md
      - before: string               # version boundary
        action: "reject" | "manual" | "none"
        note: string                 # single-boundary note
        notes: [string]              # multi-line notes (manual boundaries)
    plugins:
      - name: string
        repo: string
        ref: string                  # commit SHA
        version: string
        sha256: string
    settings_overlay: object         # opaque overlay, passed through
    mcp_overlay: object              # opaque overlay, passed through
  consumers_must:
    - verify sha256 before using fetched content
    - ignore unknown top-level and nested fields (additive evolution)
    - treat schema value increase as "unknown format, do not guess" until VersionGate/ChannelClient is updated to understand it
```

## Contract 2: Project Lockfile (`aidlc.lock.json`)

```yaml
shared-schema:
  name: aidlc-fleet-lockfile
  format: json
  version_field: schema
  current_version: 1
  location: "<project root>/aidlc.lock.json"
  authored_by: LockfileStore
  read_by: "This CLI's own components (LockfileStore, VersionGate, DriftDetector, SuccessVerifier, EngineInstaller, PluginManager), plus External: CI scripts and third-party tooling"
  integrity: no checksum (local, project-owned file); a missing or
    malformed lockfile is a hard failure for every command except `init`
    (which creates it)
  schema:
    schema: integer                  # version marker; current = 1 (new — Contract Design addition for consistency with the Channel contract)
    channel: string
    channel_commit: string
    engine:
      ref: string
      version: string
      sha256: string
      harness: string                # e.g. "cursor", "claude-code"
      installed_at: string           # ISO-8601 timestamp
    engine_origin: string             # the version this CLI first installed — the §4 version-gate anchor
    plugins:
      - name: string
        ref: string
        version: string
        sha256: string
        composed_at: string           # ISO-8601 timestamp
        engine_version_at_compose: string
    managed: [string]                 # marker identifiers for BEGIN/END-managed blocks
    known_failures: [string]          # doctor findings accepted as known
    pin: string | null                # per-project pin override (C1); added during Domain Design (ADR-004)
  consumers_must:
    - ignore unknown fields (additive evolution — e.g. a future field must not break external scripts parsing this file)
    - treat a missing file as "not yet initialized," not malformed
    - never write to this file directly — only this CLI's own commands mutate it (external tooling is read-only by contract)
```

## Contract Ownership Rules

- **Channel schema**: owned externally, outside this codebase. This CLI
  treats it as read-only input; any schema mismatch (an unrecognized
  `schema` version) is treated conservatively — the CLI does not guess
  at an unknown format's meaning; it surfaces the version mismatch to
  the human rather than attempting a best-effort parse.
- **Lockfile schema**: owned and authored solely by `LockfileStore`
  within this CLI. Breaking changes (removing or renaming an existing
  field) require a `schema` version bump and an explicit migration note
  in this file's own change history; additive changes (like the `pin`
  field) do not require a version bump, since external consumers are
  contractually required to ignore unknown fields.
- **Both contracts**: additive-only evolution is the default assumption
  for both; a consumer's silent breakage from an added field is treated
  as a consumer defect (per the "ignore unknown fields" rule), not a
  contract violation on the provider's side.

## Open Questions

| Contract | Question | Blocks |
|----------|----------|--------|
| Channel | Exact network timeout/retry tuning (attempts, backoff) for the tarball fetch — v0.1 does not specify transport-level retry policy | Functional Design (ChannelClient implementation detail, not a contract-shape concern) |

## Revision Note (post Request-Changes)

Per the architecture reviewer's iteration-1 findings (R-01 Major, R-02
Minor) and the human's "Request Changes" decision at the approval gate:

- **R-01 fix**: removed the fabricated `v0.1 §1.4 V1` citation from the
  Channel `engine.ref` comment. The "tags mostly absent" claim is now
  explicitly marked as an assumption carried from Domain Design's
  `EngineInstaller`/`ChannelClient` behaviour text, not attributed to a
  non-existent v0.1 subsection.
- **R-02 fix**: tagged the Channel's `engine` and `migration_boundaries`
  sub-schemas with `[desc]` (drawn from the external v0.1 document shown
  at session start, not from `domain-design-questions.md`), distinguishing
  them from the Lockfile's `engine` sub-object, which remains traceable to
  `domain-design-questions.md` line 31.

## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-09-07T23:49:24Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | `contract-summary.md` > Contract 1 > `engine.ref` comment | Verified fixed. The prior fabricated `v0.1 §1.4 V1` citation is gone; the "tags mostly absent" claim now reads as an assumption carried from Domain Design's `EngineInstaller`/`ChannelClient` behaviour text, with no unresolvable citation anywhere in the live contract text (the one remaining `v0.1 §1.4 V1` string is inside the Revision Note, describing the fix itself, not a live claim). | None — resolved. | Resolved |
| R-02 | Minor | `contract-summary.md` > Contract 1 > `engine`/`migration_boundaries` comments | Verified fixed. Both sub-schemas now carry `[desc]`, correctly distinguishing them from the Lockfile's `engine` sub-object, which traces to `domain-design-questions.md` line 31 (`engine{ref,version,sha256,harness,installed_at}` — confirmed present at that line). | None — resolved. | Resolved |
| R-03 | Minor | `contract-summary.md` > Contract 1 > `engine:` comment (line 34) | The inline schema comment reads "...(unlike Lockfile's engine, see R-02 note below)" — a reviewer finding ID (`R-02`) is embedded directly in the technical schema definition itself, coupling durable contract content to this review cycle's transient finding numbering. A future reader of the contract with no access to this review round will find the parenthetical dangling. | Move the comparison-to-Lockfile rationale into the Revision Note or Contract Ownership Rules prose, and keep the inline schema comment limited to the `[desc]` source tag without a review-ID cross-reference. | New |

### Validation Tool Results

No validation tools were listed as available for this stage; the following was verified by hand:

| Check | Result | Interpretation |
|---|---|---|
| No unresolvable/fabricated citation remains for `engine.ref` | PASS | Only occurrence of the old citation string is inside the Revision Note's description of the fix, not a live claim |
| Channel `engine`/`migration_boundaries` carry a source tag distinct from traceable Domain-Design shapes | PASS | Both tagged `[desc]`; Lockfile's `engine` sub-object left untagged, consistent with it tracing to `domain-design-questions.md` line 31 |
| `domain-design-questions.md` line 31 actually contains the cited `engine{...}` expansion | PASS | Confirmed: `channel_commit, engine{ref,version,sha256,harness,installed_at},` |
| YAML fenced blocks (Contract 1, Contract 2) well-formed | PASS | Consistent 2-space nesting, comments correctly placed, no unclosed structures |
| Contracts Table / Ownership Rules / Open Questions internally consistent with the two contract bodies | PASS | Provider/consumer/mechanism rows match the schema bodies; ownership rules match `[desc]` vs. untagged shapes |
| No contradiction introduced between Revision Note and the live contract text | PASS | Revision Note's claims (both fixes) match what is actually present in the schema bodies above it |

### Summary

Both prior findings are genuinely resolved: the fabricated citation is gone and the Channel's untraceable sub-schemas are now honestly tagged `[desc]` rather than implied domain-traceable. One new, non-blocking Minor issue (R-03) is a documentation-hygiene nit — a review-cycle finding ID leaking into the durable schema comment — that does not affect contract soundness and does not block readiness.
