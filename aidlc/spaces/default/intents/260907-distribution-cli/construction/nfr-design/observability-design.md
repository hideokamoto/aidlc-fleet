# Observability Design — aidlc-fleet Distribution CLI

## Sources

- [nfr] `construction/nfr-requirements/observability-requirements.md` (NFR5.1–NFR5.5)
- [nfr-design] `construction/nfr-design/nfr-design-questions.md` Q5

## Design Solution: Output Channel Split (NFR5.2)

`CommandLayer` is the single owner of process-level stdout/stderr
discipline for all seven commands:

- **stdout**: human-readable progress and result text (e.g. "Fetching
  channel...", "Plugin 'x' updated to v2.1.0").
- **stderr**: errors and warnings (e.g. drift detected, version-gate
  rejection reason, sha256 mismatch).
- **exit code**: the sole machine-readable signal (NFR5.1) — the canonical
  0/1/2/3/4 contract already fixed in `functional-spec.md`. No
  structured JSON-lines log format is mandated by any approved artifact;
  a machine caller (e.g. a CI script) is expected to branch on exit code,
  not parse stdout/stderr text. The exact stdout/stderr message wording is
  a Code Generation implementation choice, consistent with NFR5.2's own
  note in `observability-requirements.md`.

## No Metrics / Tracing / Dashboard Architecture

Confirmed by NFR5's reframing: there is no fleet of running instances to
emit CloudWatch/Prometheus metrics from, no request to trace across
services (`components.md`'s dependency graph is intra-process function
calls, not network hops), and no dashboard to specify — a dashboard implies
a persistent operational surface this CLI does not have. This section is
intentionally empty of a metrics-collection or tracing design.

## No Correlation-ID Propagation

A correlation ID exists to stitch together log lines from multiple
services handling one logical request. This CLI has one process handling
one command in one call stack — there is nothing to correlate across, so
no correlation-ID design is produced.

## `doctor`'s known_failures Filtering as the Health-Check Analogue (NFR5.3, NFR5.5)

`SuccessVerifier` wraps upstream `doctor` and filters its output against
`Lockfile.known_failures[]` (`components.md`) — this is the closest
analogue to a health-check endpoint in this CLI's shape, and no additional
design is layered on top of it: `doctor`'s existing wrap-and-filter
behaviour, already specified in the component catalogue, is the complete
solution.

## No Persisted Logs (NFR5.4)

No log-retention tiering (hot/warm/cold), log-shipping, or log-aggregation
design is produced — the CLI does not persist logs beyond the current
process's stdout/stderr stream, and no approved artifact establishes a
requirement to do so.

## No Secrets in Output (carried from NFR5, cross-checked against NFR2.3)

`CommandLayer`'s stdout/stderr text is generated from typed fields already
established (NFR2.3) to contain no secret-bearing data — no additional
redaction/masking design is required, since the underlying data model
never carries a secret to leak.

## Observability Coverage Summary

| ID | Design solution | Status |
|---|---|---|
| NFR5.1 | exit code as sole machine signal | Designed |
| NFR5.2 | stdout/stderr split, owned by `CommandLayer` | Designed |
| NFR5.3 | `SuccessVerifier` known_failures filtering | Designed (existing component behaviour) |
| NFR5.4 | — | No design needed (no persistence requirement) |
| NFR5.5 | `SuccessVerifier` doctor wrap | Designed (existing component behaviour) |
