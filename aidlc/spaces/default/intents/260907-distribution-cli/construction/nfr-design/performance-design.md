# Performance Design — aidlc-fleet Distribution CLI

## Sources

- [nfr] `construction/nfr-requirements/performance-requirements.md` (NFR1.1, NFR1.2)
- [functional] `construction/functional-design/functional-spec.md`
- [domain] `inception/domain-design/components.md`
- [nfr-design] `construction/nfr-design/nfr-design-questions.md` Q1

## Design Solution: NFR1.1 (`<10s` p95, network-bound commands)

`init`/`update`/`plugin add` cross the network exactly once per invocation
via `ChannelClient` (single channel fetch + tarball downloads). No CDN,
reverse proxy cache, or connection-pooling middleware applies — this is a
single-shot process, not a service handling repeated requests from many
callers. The design decisions that bound the 10s budget:

- **Minimize round-trips**: `ChannelClient` performs one channel-declaration
  fetch, then fetches only the tarballs the command actually needs (the
  engine tarball for `init`/`update`, the plugin projection tarball for
  `plugin add`) — never a bulk/speculative fetch of unrelated tarballs.
- **Parallel-fetchable tarballs where safe**: when a command needs more than
  one tarball (e.g. `init` with `--plugin` pre-selecting plugins), tarball
  downloads run concurrently, bounded by BR4.1's version-mixing guard — two
  tarballs for the *same* plugin at different versions are never fetched
  concurrently, since only one can be valid.
- **No retry-with-backoff loop inside the budget**: a single fetch attempt
  either succeeds within budget or fails; NFR4's reliability design (not
  performance) owns what happens on failure. Retrying inside the 10s budget
  would only make a slow network look slower.

## Design Solution: NFR1.2 (`<2s` p95, local-only commands)

`status`/`check`/`doctor`/`pin`/`unpin` never call `ChannelClient` for their
core comparison (see `DriftDetector`, which reads `LockfileStore` and, for
`check`, the last-fetched channel state already resident from the same
invocation — it does not re-fetch). The design decisions:

- **Synchronous, in-memory comparison**: `DriftDetector`'s three-way
  comparison and `SuccessVerifier`'s four-part check operate on parsed JSON
  already loaded into memory by `LockfileStore` — no intermediate disk
  round-trip, no subprocess spawn beyond what upstream `doctor` itself
  requires.
- **No caching layer**: a fresh CLI process starts with nothing warm to
  reuse besides the Lockfile itself (NFR1's own reframing, carried from
  `performance-requirements.md`) — introducing a cross-invocation cache
  would need its own invalidation design for a budget already met without
  one, so it is deliberately not designed here.

## Performance Budget Summary

| Command class | Budget (p95) | Bound by | Design lever |
|---|---|---|---|
| `init`, `update`, `plugin add` | <10s | `ChannelClient` fetch + verify | single-pass fetch, safe parallelism |
| `status`, `check`, `doctor`, `pin`, `unpin` | <2s | `LockfileStore` read + in-memory compare | no network call, no cache-invalidation overhead |

## Explicitly Out of Scope

- Caching tiers (Redis/ElastiCache-style), CDN, and connection pooling in
  the service sense — no long-running process exists to hold a warm
  connection or cache between invocations.
- Load testing at concurrent-user scale — NFR3's scalability reframing
  already establishes there is no concurrent-user model to load-test
  against; each invocation is measured in isolation.
