# Reliability Design — aidlc-fleet Distribution CLI

## Sources

- [nfr] `construction/nfr-requirements/reliability-requirements.md` (NFR4.1–NFR4.7)
- [functional] `construction/functional-design/rules.md` (BR2.6, BR3.3, BR5.2, BR8.1)
- [domain] `inception/domain-design/components.md`
- [nfr-design] `construction/nfr-design/nfr-design-questions.md` Q4

## Design Solution: NFR4.1 (atomic Lockfile writes)

`LockfileStore` writes via a **write-to-temp-then-atomic-rename** pattern:

```
1. serialize Lockfile to JSON
2. write to aidlc.lock.json.tmp
3. fsync the temp file
4. rename(aidlc.lock.json.tmp, aidlc.lock.json)   // atomic on POSIX and NTFS
```

The `rename()` step is the all-or-nothing boundary: any process reading
`aidlc.lock.json` mid-write either sees the fully-old or fully-new content,
never a partial write. A crash between steps 2–3 leaves an orphaned `.tmp`
file and the original `aidlc.lock.json` untouched — no corruption risk,
just a stale temp file that the next successful write overwrites. The
concrete rename-and-fsync mechanics are a Code Generation implementation
detail; this stage fixes the pattern itself as the design solution.

## Design Solution: NFR4.2 / NFR4.3 (missing/malformed lockfile, fail-fast invariant enforcement)

No additional pattern beyond what `rules.md` already specifies:
`CommandLayer` enforces both checks **at the command-entry boundary**,
before dispatching to any owning component (BR8.1 for missing/malformed
lockfile classification, BR2.6 for the fail-fast invariant). This placement
decision — boundary check before dispatch, not scattered per-component
checks — keeps the fail-fast Mandated rule (`project.md`) enforceable in
one place rather than duplicated across `EngineInstaller`, `PluginManager`,
and `FileOwnershipGuard`.

## Design Solution: NFR4.4 (engine-directory backup)

`EngineInstaller`, via `FileOwnershipGuard`, uses a **copy-before-replace**
pattern for any engine-owned directory replacement under `--force`: the
existing directory is copied to a sibling backup path before the new
content is written, not a versioned/snapshot backup system. A single
most-recent backup is sufficient for a local single-machine CLI — a
multi-generation backup history would be over-engineering for a directory
that is trivially re-fetched from the channel if the backup itself is ever
needed and found insufficient.

## Design Solution: NFR4.5 (Lockfile backup) — Open Gap, Carried Forward

No design pattern is proposed here. `reliability-requirements.md` already
flags this as an explicit, undesigned gap: no approved artifact establishes
a requirement to *back up* the Lockfile itself, only to write it atomically
(NFR4.1, above). Proposing a backup mechanism at the design stage without
an approved requirement behind it would be scope creep beyond what NFR
Requirements authorized. This gap is carried into `traceability.json`
below as `N/A` (documented gap, not a design failure).

## Design Solution: NFR4.6 / NFR4.7 (graceful degradation for plugin-sync-incomplete and drift reporting)

No additional pattern required — both are **classification logic**,
already fully specified in `rules.md` (BR3.3: plugin-sync exit 1 →
"installation incomplete", not failure; BR5.2: drift classification into
the 0/1/2 exit-code contract). `SuccessVerifier` and `DriftDetector` are
the owning components (`components.md`); this design stage does not
introduce a new resilience pattern (circuit breaker, retry, fallback) for
either, because neither is a remote-call failure mode — they are local
classification of an already-completed operation's outcome.

## Explicitly Out of Scope

- Circuit breakers, bulkheads, timeouts on remote calls — a single-shot
  CLI invocation has one external call chain (`ChannelClient`'s fetch), not
  a mesh of service-to-service calls where cascading failure needs
  containment.
- Health checks / readiness probes — no long-running process exists to
  probe.
- Data replication, failover — no replicated datastore exists; the single
  local Lockfile has no replica.

## Reliability Coverage Summary

| ID | Design solution | Status |
|---|---|---|
| NFR4.1 | write-temp + fsync + atomic rename | Designed |
| NFR4.2 | `CommandLayer` boundary check (BR8.1) | Designed (no new pattern needed) |
| NFR4.3 | `CommandLayer` boundary check (BR2.6) | Designed (no new pattern needed) |
| NFR4.4 | copy-before-replace backup | Designed |
| NFR4.5 | — | Open gap (no requirement authorizes a design) |
| NFR4.6 | `SuccessVerifier` classification (BR3.3) | Designed (no new pattern needed) |
| NFR4.7 | `DriftDetector` classification (BR5.2) | Designed (no new pattern needed) |
