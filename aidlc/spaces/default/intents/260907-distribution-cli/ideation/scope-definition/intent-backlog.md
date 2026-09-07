# Intent Backlog — aidlc-fleet Distribution CLI

Prioritized using MoSCoW (preferred for this MVP-style internal-tooling
definition, per `product-guide.md`). Each item is a proto-Unit — a candidate
input for Units Generation (2.7), not yet formally decomposed.

## Must Have

| ID | Capability | Rationale | Source |
|----|------------|-----------|--------|
| M1 | `init --harness <n> [--channel <c>]`: place engine + declared plugins, write `aidlc.lock.json` (with `engine_origin`) | Dependency root — every other command needs the lockfile this creates [Q1] [Q3] | v0.1 §3, §5 |
| M2 | Four-part success-verification contract (compose exit 0 + no `[degraded]` in `.drops` + doctor failed count (minus known_failures) is 0 + `plugin sync` exit 1 surfaced as "incomplete") | Called out as "最重要" in the source document; without it `init`/`update`/`plugin add` cannot be trusted | v0.1 §6 |
| M3 | Origin-record version gate (`engine_origin` tracking, reject/manual/none migration-boundary handling, `--acknowledge-migration`) | The CLI's defining constraint — it explicitly cannot be a general upgrader; `update` is unsafe without it | v0.1 §4 |
| M4 | File-ownership invariants (engine-owned dirs replaceable with `--force` + backup; settings/hooks merge rule; `aidlc/` untouched except memory seed; no symlink writes; no auto-delete of receipt-external files) | Data-loss/corruption prevention across every mutating command | v0.1 §7 |
| M5 | `update [--to <ref>]`: follow channel, gated by M3 | Second command in the dependency chain after `init` | v0.1 §3, §5.1 |
| M6 | `check`: three-way lockfile/channel/disk drift detection with CI exit codes | Part of the MVP slice (Q1) — verification without mutation | v0.1 §3, §8 |
| M7 | `doctor`: wraps upstream doctor, applies `known_failures` | Part of the MVP slice (Q1); required for the M2 success contract's doctor check | v0.1 §3, §6 |
| M8 | Exit-code contract (0/1/2/3/4 per §8) | Cross-cutting contract every command's exit status must honor | v0.1 §8 |

## Should Have

| ID | Capability | Rationale | Source |
|----|------------|-----------|--------|
| S1 | `plugin add <name>` / `plugin remove <name>`: projection placement/removal, hook regeneration, version-mixing guard | Depends on M1+M2; needed for the full command surface but not the MVP slice | v0.1 §3, §5.2 |
| S2 | sessionStart hook: single wrapper iterating `lockfile.plugins[]`, BEGIN/END marker merge/removal, first in sessionStart | Named "採用" (adopted) in the source document; auto-repairs compose damage between sessions | v0.1 §5.3 |
| S3 | `status`: version/plugin/drift summary | Read-only convenience once `init`/`update`/`plugin` exist | v0.1 §3 |

## Could Have

| ID | Capability | Rationale | Source |
|----|------------|-----------|--------|
| C1 | `pin <ref>` / `unpin`: per-project pin overriding the channel | Lowest blast radius if any internal sequencing trade-off is needed (Q2) | v0.1 §3 |
| C2 | Unattended execution support (`AIDLC_UNATTENDED=1` recognition for `check`/`doctor`/`status`) | CI convenience; the CLI itself never handles approval gates | v0.1 §9 |

## Won't Have (this initiative)

| ID | Item | Rationale | Source |
|----|------|-----------|--------|
| W1 | Reimplementing upstream plugin-compose logic | Explicit non-goal | v0.1 §0 |
| W2 | Modifying upstream files | Explicit non-goal | v0.1 §0 |
| W3 | Arbitrary version-to-version upgrades | Explicit non-goal — the version gate (M3) exists specifically to prevent this | v0.1 §0, §4 |
| W4 | Mandatory host plugin-store integration | Explicit non-goal (optional, never required) | v0.1 §0 |
| W5 | Rust reimplementation | Deferred per §10 until a specific trigger (runtime independence, single-binary CI distribution, or no-bun bootstrapping) occurs — not currently needed | v0.1 §10 |

## Dependency Notes

M1 blocks M3, M5, S1, C1 (all read/write the lockfile `init` creates).
M2 is consumed by M1, M5, S1 (the shared success-verification contract).
M6/M7 (part of the MVP slice) have no downstream dependents — they are
terminal read-only consumers.

## Assumptions & Open Questions

None.
