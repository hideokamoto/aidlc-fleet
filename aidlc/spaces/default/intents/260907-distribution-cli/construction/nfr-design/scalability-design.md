# Scalability Design — aidlc-fleet Distribution CLI

## Sources

- [nfr] `construction/nfr-requirements/scalability-requirements.md` (NFR3.1, NFR3.2)
- [domain] `inception/domain-design/components.md`
- [nfr-design] `construction/nfr-design/nfr-design-questions.md` Q3

## Design Solution: NFR3.1 (linear-time plugin-array comparison)

`DriftDetector`'s and `PluginManager`'s comparisons between
`Channel.plugins[]` and `Lockfile.plugins[]` use a **name-keyed lookup**
(a `Map`/object keyed by plugin name) built once from one side, then probed
by the other side — O(n) construction + O(m) probing, never a nested-loop
O(n×m) comparison:

```
pluginsByName = new Map(lockfile.plugins.map(p => [p.name, p]))
for (const channelPlugin of channel.plugins) {
  const local = pluginsByName.get(channelPlugin.name)
  // classify: missing / version-mismatch / in-sync
}
```

This satisfies the `[assumption]`-tagged "tens of plugins" baseline in
`scalability-requirements.md` NFR3.1 with headroom well past that scale,
since the lookup itself is O(1) amortized per plugin regardless of count.

## Design Solution: NFR3.2 (multi-project isolation)

No design artifact is required here beyond what already exists: each CLI
invocation is a fresh OS process with its own memory space, working
directory, and `aidlc.lock.json` target path — there is no shared
in-process cache, singleton, or global mutable state in the component
catalogue (`components.md`) that could leak between two concurrently
running invocations against different projects. `LockfileStore` opens and
closes its file handle within a single invocation's lifetime; two
invocations targeting different projects never contend for the same file,
and two invocations targeting the *same* project's Lockfile concurrently
are a filesystem-level concern handled by NFR4.1's atomic write (a
concurrent writer either wins the rename or loses cleanly — never
produces a corrupt merge).

## Explicitly Out of Scope

- Horizontal/vertical scaling, load balancers, auto-scaling groups — no
  server process exists to scale.
- Data partitioning/sharding, queue-based decoupling — no shared datastore
  or message queue exists between invocations.
- Capacity thresholds / auto-scaling rules — not applicable to a
  process-per-invocation CLI.
