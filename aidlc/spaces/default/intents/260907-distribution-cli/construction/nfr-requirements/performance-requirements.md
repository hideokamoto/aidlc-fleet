# Performance Requirements — aidlc-fleet Distribution CLI

NFR1 covers per-command execution-time budgets — the CLI-appropriate
analogue of "response time" for a locally invoked, short-lived process
with no server and no concurrent-user load (Q1,
`nfr-requirements-questions.md`).

## Requirements

| ID | Requirement | Target | Percentile | Load Condition | Measurement Method |
|----|-------------|--------|------------|-----------------|---------------------|
| NFR1.1 | `init`/`update`/`plugin add`/`plugin remove` execution time (network-bound: channel fetch + tarball download + integrity verification + placement) | < 10s | p95 | Single invocation, typical channel + single-plugin tarball size, broadband connection, excluding retry/backoff time | Wall-clock time from process start to exit, measured in Build and Test / Performance Validation |
| NFR1.2 | `check`/`status`/`pin`/`unpin`/`doctor` execution time (local-only, or a single small channel fetch for `check`/`status`) | < 2s | p95 | Single invocation | Wall-clock time from process start to exit |

## Source and Status

Both targets are this stage's own **assumption** (`[assumption]`, per
Q1) — the v0.1 document states no numeric performance target for any
command. They exist so Code Generation and Build and Test have a
concrete, testable budget rather than the anti-requirement "the CLI
should be fast." If real-world measurement during Build and Test shows
these targets are unrealistic (e.g., large plugin sets, slow upstream
tarball hosts), they should be revised there with measured data, not
left as an untested assumption indefinitely.

## Anti-Requirements (explicitly excluded)

- "The CLI should be fast" — not measurable, replaced by NFR1.1/NFR1.2.
- Any throughput/RPS target — this CLI has no concept of concurrent
  request volume; each invocation is one process serving one project.
- Any target for the retry/backoff timing itself — explicitly deferred
  to Code Generation (`contract-summary.md`'s Open Question), since
  Contract Design already scoped retry tuning out of this stage.

## Resource Utilization

No CPU/memory ceiling is specified — a CLI of this shape (JSON parsing,
tarball extraction, file I/O) is not expected to be resource-intensive
enough to warrant one, and no approved artifact states otherwise. If
Build and Test measurement surfaces unexpected resource pressure, that
is new information to feed back into this document, not something to
invent here.
