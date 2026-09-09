# Performance Test Instructions — aidlc-fleet Distribution CLI

Targets NFR1.1 (`<10s` p95, network-bound commands) and NFR1.2 (`<2s`
p95, local-only commands) from
`construction/nfr-requirements/performance-requirements.md`, designed in
`construction/nfr-design/performance-design.md`.

## Environment Constraint

This CLI has no deployed environment and no live central channel to
fetch from in this workspace — `performance-validation` (the stage that
would normally own live network-timing validation) is **SKIP** for this
scope. Per Build and Test's own rule, a target needing a deployed/live
environment can be deferred only when a later stage explicitly owns it;
none does here, so NFR1.1 cannot simply be marked deferred — it must be
verified as far as this environment allows, or marked `Unverified` with
the gap surfaced at the gate.

## Methodology

Both measurements use real `EngineInstaller` instances (the actual
orchestration-layer class, not a stand-in) with injected in-memory ports
— this is the same dependency-injection pattern already used throughout
the code-generation test suite (e.g. `src/commands/update.test.ts`), not
a new testing approach.

- **NFR1.2 (local-only, `status`)**: fully measurable — no network is
  involved in `status` at all. Drive a real `EngineInstaller.install()`
  to produce a real Lockfile, then time a real `runStatus()` call against
  it end-to-end.
- **NFR1.1 (network-bound, `init`/`update`/`plugin add`)**: real network
  transit time cannot be measured without a live channel host. Instead,
  measure everything this CLI's own code controls — sha256 verification
  (BR7.1) over a realistically-sized 5 MB tarball buffer, plus the full
  `EngineInstaller.install()` placement/compose/save path — with the
  network fetch itself mocked to resolve immediately. This isolates
  code-path overhead from network latency, the one variable outside this
  CLI's control, and answers the real engineering question: does the
  CLI's own processing leave enough of the 10s budget for normal network
  conditions?

## Script (executed once for this stage; not part of the committed test suite)

A one-off `.ts` script, run directly via `bun run` and deleted afterward
(not added to `src/` — it is a stage-level performance check, not a
regression test the CI suite re-runs every time):

```typescript
import { EngineInstaller, type EngineInstallerPorts } from './src/orchestration/engine-installer';
import { runStatus } from './src/commands/status';
import type { CommandDeps } from './src/commands/types';
import { VersionGate } from './src/core/version-gate';
import { DriftDetector } from './src/core/drift-detector';
import { createHash } from 'node:crypto';

// measureStatus(): real EngineInstaller.install() -> real runStatus(), timed.
// measureInitCodePathOverhead(): sha256 over a 5MB buffer + real
//   EngineInstaller.install(), with fetchEngineTarball mocked to resolve
//   immediately (isolating code overhead from network transit time).
```

Run: `bun run perf-check-tmp.ts` (or any filename outside `src/`), then
delete the file — it is not a committed artifact.

## Results (this run)

| Measurement | Result | Target | Verdict |
|---|---|---|---|
| NFR1.2 — real `status` end-to-end | 0.39ms | < 2000ms | **Met** |
| NFR1.1 — code-path overhead (sha256 + install, network mocked) | 15.29ms | leaves ~9985ms of the 10s budget for actual network transit | **Met** (code-path component; see caveat below) |

## Caveat on NFR1.1

The 15.29ms figure proves the CLI's own processing is not the
bottleneck — it consumes ~0.15% of the 10s budget, leaving effectively
the whole budget for real network transit time. It does **not** prove
end-to-end network performance against a real, possibly slow or
rate-limited `codeload.github.com` host, which this environment cannot
exercise. This residual gap is carried into `test-results.md`'s Target
Verification Matrix and surfaced explicitly at the approval gate rather
than silently marked `Met` without qualification.

## Expected Coverage / Targets

No additional test-count floor — this is two targeted measurements
against the two performance NFRs, not a volume-driven suite.

## Mocking/Stubbing Guidance

Only the network transport (`fetchEngineTarball`) is mocked; sha256
computation, port sequencing, and the `status` command's real logic all
run unmocked, since those are exactly what is being timed.
