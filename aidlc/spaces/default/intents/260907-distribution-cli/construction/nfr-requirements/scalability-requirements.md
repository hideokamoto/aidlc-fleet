# Scalability Requirements — aidlc-fleet Distribution CLI

NFR3 adapts "scalability" to what actually varies for this CLI: the
size of a channel's plugin set and the number of projects a channel
serves — not concurrent-request throughput, since there is no shared
runtime and no concurrent access to a single CLI invocation (Q3,
`nfr-requirements-questions.md`).

## Requirements

| ID | Requirement | Current Baseline | Growth Model | Scaling Mechanism |
|----|-------------|-------------------|---------------|---------------------|
| NFR3.1 | `Channel.plugins[]` and `Lockfile.plugins[]` comparison (used by `VersionGate`, `DriftDetector`, `PluginManager`) must run in linear time relative to plugin count — no quadratic blowup as the plugin set grows. | Tens of plugins per channel (typical) | Linear, driven by team adoption of more plugins over time | Algorithmic requirement only — no infrastructure scaling applies to a local CLI process |
| NFR3.2 | Multi-project fan-out (many projects independently following one channel) is the CLI's whole stated purpose (`intent-statement.md`), but each project's `init`/`update`/`check` invocation is fully independent — no shared runtime state, no coordination between projects. | N/A — not a per-invocation concern | N/A | Each invocation is a fresh, isolated process; scaling to more projects requires zero CLI-side change |

## Explicitly Not a Scalability Concern Here

- **Concurrent users / requests per second**: this CLI has no server
  component (v0.1, `intent-statement.md`); there is no load to measure
  in RPS terms.
- **Data volume growth**: `aidlc.lock.json` and the channel declaration
  are both small, bounded JSON documents (field counts fixed by
  `contract-summary.md`'s schema, only `plugins[]` grows) — no
  partitioning/sharding concern applies.
- **Numeric growth targets** (6-month/12-month capacity targets, cost
  ceilings): no v0.1 section or approved artifact specifies these; not
  invented here per the phase guardrail against inventing missing
  artifact content.

## Scalability Anti-Requirements (explicitly excluded)

- "Handle unlimited plugins" — not measurable; NFR3.1's linear-time
  requirement is the testable substitute.
- Any auto-scaling/horizontal-scaling requirement — meaningless for a
  process with no persistent runtime to scale.
