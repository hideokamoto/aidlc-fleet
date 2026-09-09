# Observability Requirements — aidlc-fleet Distribution CLI

NFR5 adapts observability to a CLI shape: no long-running process to
monitor, no on-call rotation to alert. Observability here means what
the CLI prints to the human/CI invoking it, and in what form, so a CI
pipeline can act on `check`'s exit code and a human can debug a failure
(Q5, `nfr-requirements-questions.md`).

## Primary Signal: Exit-Code Contract

| ID | Requirement | Source |
|----|-------------|--------|
| NFR5.1 | The canonical 0/1/2/3/4 exit-code contract (`intent-statement.md`, v0.1 §8, M8) is this CLI's primary machine-readable observability signal for CI consumption — no separate metrics endpoint or dashboard infrastructure is needed for a short-lived CLI process. | `intent-statement.md`; `functional-design/functional-spec.md` (post-review exit-code mapping) |

## Logging

| ID | Requirement | Notes |
|----|-------------|-------|
| NFR5.2 | Structured, human-readable output to stdout for normal progress/results; errors and warnings to stderr, per standard CLI convention. | No specific structured-log format (JSON lines, etc.) is mandated by any approved artifact — left as a Code Generation implementation choice |
| NFR5.3 | The CLI does not persist its own log files or retention policy — each invocation's stdout/stderr is the responsibility of the invoking shell or CI system to capture, not this CLI's. | Derived from the CLI's short-lived-process shape; no v0.1 section states otherwise |
| NFR5.4 | No secrets (credentials, tokens) are ever written to stdout/stderr, consistent with NFR2.3's "no secrets in Lockfile/channel config." | Construction phase guardrail (`phases/construction.md` § Security: "Never hardcode credentials... Validate and sanitize all inputs") |

## Health Check Analogue

| ID | Requirement | Source |
|----|-------------|--------|
| NFR5.5 | `doctor`'s `known_failures`-filtered output (BR3.4) is the CLI's closest analogue to a health-check endpoint — it wraps upstream `doctor` and reports the CLI's install-health state on demand. | BR3.4, `functional-design/rules.md` |

## Tracing / Metrics / Dashboards / Alerting

Not applicable. This CLI has no distributed request flow to trace, no
persistent metrics to retain across invocations, and no on-call rotation
to page — all standard observability infrastructure (distributed
tracing, dashboards, alert thresholds) assumes a hosted service, which
this CLI is not (`intent-statement.md`). No v0.1 section or approved
artifact establishes a need for any of these; they are deliberately
excluded rather than force-fitted into this NFR category.

## Observability Anti-Patterns Avoided

- Not building a metrics/dashboard system nobody would query for a
  process that runs for seconds and exits.
- Not alerting on causes without symptoms — irrelevant here since there
  is no alerting surface at all.
- Not logging sensitive data (NFR5.4).
