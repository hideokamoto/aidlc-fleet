# Business Rules — aidlc-fleet Distribution CLI

Rules grouped by owning component, each tracing to its MoSCoW backlog ID
(`intent-backlog.md`) and the v0.1 section that specifies it, per Q3 of
`functional-design-questions.md`.

## Rules (machine-readable)

```yaml
rules:
  - id: BR1.1
    statement: A version transition classified "reject" always fails the update, unconditionally.
    category: authorization
    applies_to: VersionGate
    trigger: update command invoked, target version crosses a migration boundary
    logic: "IF migration_boundaries entry for the crossed boundary has action=reject THEN fail the update, regardless of any flag"
    violation_behaviour: update command exits non-zero (exit-code contract, M8); no engine placement is attempted
    source: M3 / v0.1 §4

  - id: BR1.2
    statement: A version transition classified "manual" requires the human to pass --acknowledge-migration to proceed.
    category: authorization
    applies_to: VersionGate
    trigger: update command invoked, target version crosses a "manual" migration boundary
    logic: "IF migration_boundaries entry has action=manual AND --acknowledge-migration is absent THEN fail; IF present THEN proceed to EngineInstaller"
    violation_behaviour: update command exits non-zero with the boundary's note/notes surfaced to the human
    source: M3 / v0.1 §4

  - id: BR1.3
    statement: A version transition classified "none" proceeds without any acknowledgment flag.
    category: authorization
    applies_to: VersionGate
    trigger: update command invoked, target version crosses a "none" migration boundary (or crosses no boundary at all)
    logic: "IF migration_boundaries entry has action=none, or no boundary is crossed, THEN proceed to EngineInstaller unconditionally"
    violation_behaviour: n/a (default-permit path)
    source: M3 / v0.1 §4

  - id: BR1.4
    statement: A per-project pin overrides the channel's resolved latest target for gate classification.
    category: calculation
    applies_to: VersionGate
    trigger: update command invoked, Lockfile.pin is non-null
    logic: "IF Lockfile.pin is set THEN classify the transition against the pinned ref instead of the channel's latest resolved ref"
    violation_behaviour: n/a (routing rule, not a failure path)
    source: C1 / ADR-004 (Domain Design revision)

  - id: BR1.5
    statement: An adopted (brownfield) project's first update requires init --adopt to have run first.
    category: authorization
    applies_to: VersionGate
    trigger: update command invoked on a project with no prior CLI-managed engine_origin
    logic: "IF engine_origin is absent/unset AND init --adopt has not been recorded THEN fail update with a message directing the human to init --adopt"
    violation_behaviour: update command exits non-zero
    source: M3 / v0.1 §4

  - id: BR2.1
    statement: Replacing an engine-owned directory requires --force and creates a backup first.
    category: constraint
    applies_to: FileOwnershipGuard
    trigger: any mutating command about to overwrite an engine-owned directory
    logic: "IF target path is engine-owned AND (--force absent OR backup step fails) THEN fail fast before any write"
    violation_behaviour: command exits non-zero immediately; no partial write occurs
    source: M4 / v0.1 §7

  - id: BR2.2
    statement: settings.json/hooks.json merge per the defined precedence — engine wins on hooks/statusLine, project wins elsewhere.
    category: constraint
    applies_to: FileOwnershipGuard
    trigger: engine placement or plugin placement touching settings.json or hooks.json
    logic: "IF key is under hooks or statusLine THEN engine value wins; ELSE project value wins on conflict"
    violation_behaviour: a merge that cannot resolve deterministically fails fast rather than guessing
    source: M4 / v0.1 §7

  - id: BR2.3
    statement: The aidlc/ workspace tree is never touched by any mutating command except the initial memory-seed copy.
    category: constraint
    applies_to: FileOwnershipGuard
    trigger: any mutating command
    logic: "IF target path is under aidlc/ AND operation is not the one-time initial memory-seed copy THEN refuse"
    violation_behaviour: fail fast; no exception
    source: M4 / v0.1 §7

  - id: BR2.4
    statement: No write ever passes through a symlink.
    category: constraint
    applies_to: FileOwnershipGuard
    trigger: any file write
    logic: "IF resolved target path traverses a symlink THEN refuse the write"
    violation_behaviour: fail fast
    source: M4 / v0.1 §7

  - id: BR2.5
    statement: Files outside the managed receipt are never auto-deleted.
    category: constraint
    applies_to: FileOwnershipGuard
    trigger: any cleanup/removal step during placement
    logic: "IF a candidate-for-deletion path is not listed in the current receipt THEN leave it untouched"
    violation_behaviour: n/a (default-preserve path)
    source: M4 / v0.1 §7

  - id: BR2.6
    statement: Any detected file-ownership invariant violation fails immediately rather than continuing with a warning.
    category: policy
    applies_to: FileOwnershipGuard
    trigger: any of BR2.1–BR2.5 detects a violation
    logic: "IF a violation is detected THEN raise immediately and abort the current command; never log-and-continue"
    violation_behaviour: command aborts with a non-zero exit code before any further mutation
    source: M4 / practices-discovery discovered-rules.md (Mandated, fail-fast)

  - id: BR3.1
    statement: Success requires all three boolean checks of the criterion to hold together — no single check is sufficient alone. A plugin-sync exit 1 (BR3.3) is a separate classification layered on top, not a fourth boolean conjunct.
    category: validation
    applies_to: SuccessVerifier
    trigger: after any engine or plugin placement
    logic: "IF (compose exited 0) AND (no [degraded] line in the relevant .drops file) AND (doctor failed-count minus known_failures == 0) THEN success ELSE not success; independently, if the placement was a plugin sync, apply BR3.3 to reclassify a plugin-sync exit 1 as incomplete rather than failure"
    violation_behaviour: the failing part(s) are reported to the human; the command's own exit code reflects failure per M8
    source: M2 / v0.1 §6 (the document's own most-emphasized section)

  - id: BR3.2
    statement: A compose exit code of 0 alone never counts as success.
    category: validation
    applies_to: SuccessVerifier
    trigger: compose process completes
    logic: "IF compose exited 0 THEN this satisfies only one of the four BR3.1 conditions, never the whole criterion"
    violation_behaviour: n/a (this rule only narrows what "success" means; see BR3.1 for the failure path)
    source: M2 / v0.1 §6

  - id: BR3.3
    statement: A plugin-sync exit code of 1 is classified "installation incomplete," not treated as a hard failure.
    category: calculation
    applies_to: SuccessVerifier
    trigger: plugin sync step returns exit 1
    logic: "IF plugin sync exits 1 THEN classify as installation-incomplete (a distinct, non-fatal status) rather than folding it into a generic failure"
    violation_behaviour: n/a (classification rule)
    source: M2 / v0.1 §6

  - id: BR3.4
    statement: Doctor output is filtered by known_failures before contributing to the success determination.
    category: calculation
    applies_to: SuccessVerifier
    trigger: doctor wrap step runs as part of BR3.1's third condition
    logic: "effective_failed_count = doctor.failed_count - count(doctor.failures INTERSECT Lockfile.known_failures)"
    violation_behaviour: n/a (calculation feeding BR3.1)
    source: M2 / v0.1 §6

  - id: BR4.1
    statement: A plugin's prior projection is fully removed before a new version's projection is placed — versions are never mixed.
    category: constraint
    applies_to: PluginManager
    trigger: plugin add for a plugin that already has a placed projection
    logic: "IF a prior projection for this plugin exists THEN remove it completely BEFORE placing the new one; never leave files from two versions coexisting"
    violation_behaviour: fail fast if removal cannot be completed cleanly before placement
    source: P6 (v0.1 non-goal/principle register, referenced by components.md)

  - id: BR5.1
    statement: check and the drift portion of status compare three sources — lockfile-declared, channel-declared, and on-disk-actual — not just two.
    category: calculation
    applies_to: DriftDetector
    trigger: check or status command invoked
    logic: "compare (Lockfile.channel_commit/engine/plugins) vs (Channel's current declaration) vs (what is actually installed on disk)"
    violation_behaviour: n/a (read-only comparison, never writes)
    source: M6, S3 / v0.1 (check/status commands)

  - id: BR5.2
    statement: The three-way comparison outcome maps to exit codes 0 (in sync), 1 (behind channel), or 2 (local modification drift).
    category: calculation
    applies_to: DriftDetector
    trigger: check command's comparison completes
    logic: "IF all three sources agree THEN 0; ELIF lockfile/disk agree but channel has moved ahead THEN 1; ELIF disk disagrees with lockfile THEN 2"
    violation_behaviour: n/a (this rule IS the exit-code contract for check, M8)
    source: M6 / v0.1 §8 (exit-code contract)

  - id: BR5.3
    statement: When a pin is set, the comparison uses the pinned ref in place of the channel's latest, consistent with VersionGate's BR1.4.
    category: calculation
    applies_to: DriftDetector
    trigger: Lockfile.pin is non-null during a check/status comparison
    logic: "IF Lockfile.pin is set THEN substitute the pinned ref for 'channel's latest' in the three-way comparison"
    violation_behaviour: n/a (routing rule)
    source: C1 / ADR-004

  - id: BR6.1
    statement: pin persists a per-project override into the Lockfile; unpin clears it.
    category: policy
    applies_to: LockfileStore
    trigger: pin or unpin command invoked
    logic: "pin <ref>: set Lockfile.pin = <ref>; unpin: set Lockfile.pin = null"
    violation_behaviour: an invalid ref format is rejected before the write (validated at the CommandLayer boundary, per Code Generation phase guardrail on boundary validation)
    source: C1

  - id: BR7.1
    statement: A sha256 mismatch on any fetched tarball is a hard failure, never silently retried.
    category: validation
    applies_to: ChannelClient
    trigger: engine or plugin tarball download completes
    logic: "IF computed sha256 != Channel-declared sha256 THEN fail the current command immediately; do not retry the download automatically"
    violation_behaviour: command exits non-zero; no partial install proceeds
    source: v0.1 §5.1 / contract-summary.md Contract 1

  - id: BR7.2
    statement: An unrecognized Channel schema version is surfaced to the human rather than guessed at.
    category: validation
    applies_to: ChannelClient
    trigger: fetched Channel content has a schema value this CLI's ChannelClient/VersionGate does not understand
    logic: "IF Channel.schema > highest version this build understands THEN report the mismatch and stop, rather than attempting a best-effort parse"
    violation_behaviour: command exits non-zero with a clear "unknown channel format" message
    source: contract-summary.md Contract 1 (consumers_must)

  - id: BR8.1
    statement: A missing or malformed Lockfile is a hard failure for every command except init.
    category: validation
    applies_to: LockfileStore
    trigger: any command other than init reads the Lockfile
    logic: "IF aidlc.lock.json is absent or fails to parse AND command != init THEN fail fast, treating 'not yet initialized' and 'malformed' as distinct, both fatal outside init"
    violation_behaviour: command exits non-zero, directing the human to run init
    source: contract-summary.md Contract 2
```

## Rules Summary

| ID | Owning Component | Category | One-line statement |
|----|-------------------|----------|---------------------|
| BR1.1 | VersionGate | authorization | "reject" boundary always fails the update |
| BR1.2 | VersionGate | authorization | "manual" boundary requires `--acknowledge-migration` |
| BR1.3 | VersionGate | authorization | "none" boundary proceeds unconditionally |
| BR1.4 | VersionGate | calculation | pin overrides channel's latest for gate classification |
| BR1.5 | VersionGate | authorization | adopted project needs `init --adopt` before first update |
| BR2.1 | FileOwnershipGuard | constraint | engine-dir replace needs `--force` + backup |
| BR2.2 | FileOwnershipGuard | constraint | settings/hooks merge precedence |
| BR2.3 | FileOwnershipGuard | constraint | `aidlc/` never touched (except seed copy) |
| BR2.4 | FileOwnershipGuard | constraint | no write through a symlink |
| BR2.5 | FileOwnershipGuard | constraint | no receipt-external auto-delete |
| BR2.6 | FileOwnershipGuard | policy | fail fast on any invariant violation |
| BR3.1 | SuccessVerifier | validation | three-part boolean success criterion (BR3.3 layered on top) |
| BR3.2 | SuccessVerifier | validation | compose exit 0 alone is insufficient |
| BR3.3 | SuccessVerifier | calculation | plugin-sync exit 1 = incomplete, not failure |
| BR3.4 | SuccessVerifier | calculation | doctor failures filtered by `known_failures` |
| BR4.1 | PluginManager | constraint | never mix plugin versions |
| BR5.1 | DriftDetector | calculation | three-way comparison (lockfile/channel/disk) |
| BR5.2 | DriftDetector | calculation | exit-code classification 0/1/2 |
| BR5.3 | DriftDetector | calculation | pin substitutes for channel's latest in comparison |
| BR6.1 | LockfileStore | policy | pin/unpin persistence |
| BR7.1 | ChannelClient | validation | sha256 mismatch is a hard failure, no retry |
| BR7.2 | ChannelClient | validation | unrecognized schema is surfaced, not guessed |
| BR8.1 | LockfileStore | validation | missing/malformed lockfile is a hard failure outside `init` |
