# Security Design — aidlc-fleet Distribution CLI

## Sources

- [nfr] `construction/nfr-requirements/security-requirements.md` (NFR2.1–NFR2.8)
- [functional] `construction/functional-design/functional-spec.md`, `rules.md` (BR7.1)
- [domain] `inception/domain-design/components.md`
- [nfr-design] `construction/nfr-design/nfr-design-questions.md` Q2

## No Authentication / Authorization Model

NFR2.1/NFR2.2 already established there is no user authentication or
authorization surface — the CLI runs with the invoking user's own local
filesystem and network permissions, no login, no session, no role model.
This design section is intentionally empty of an auth architecture; adding
one would contradict the approved requirement.

## Integrity Verification Placement (NFR2.4)

`ChannelClient` performs sha256 verification **synchronously, immediately
after each tarball download and before handing bytes to any other
component** (BR7.1). This is a deliberate ordering decision:

```
download tarball bytes
  -> compute sha256(bytes)
  -> compare against channel-declared hash
       match    -> hand bytes to EngineInstaller / PluginManager
       mismatch -> reject; no partial/unverified write ever occurs
```

- **Not deferred, not batched**: verification happens per-tarball, in the
  same synchronous call chain as the download — never queued for a later
  bulk-verify pass, which would create a window where unverified bytes
  could reach `FileOwnershipGuard`'s write path.
- **Fail-closed**: a hash mismatch is a fatal error for that command
  invocation (consistent with the fail-fast Mandated rule in `project.md`);
  no fallback to an unverified install exists.

## Secrets Handling (NFR2.3)

NFR2.3 is a **non-write** guarantee, not a runtime scan: `LockfileStore`
and `ChannelClient` never serialize a secret-bearing field into
`aidlc.lock.json` or channel config in the first place, because no such
field exists in the `Lockfile`/`Channel` entity shapes (`components.md`).
`FileOwnershipGuard` is invoked before any write that touches a path that
*could* carry a secret-bearing file (e.g. an engine-owned config being
replaced), as a structural backstop consistent with its existing
pre-write invariant-check responsibility — it does not scan file contents
for secret patterns, since no approved artifact requires that.

## Commit-SHA Pinning (NFR2.6)

`ChannelClient` resolves the channel's declared engine/plugin source to an
immutable commit SHA before download (not a mutable branch/tag ref); this
is a data-shape decision on the `Channel` entity's `engine`/`plugins`
fields, not new component behaviour — `Channel.engine` and each plugin
entry already carry a pinned ref per the approved entity shape.

## No Encryption-at-Rest Design

NFR6.2 (tech-stack-decisions.md) already established `aidlc.lock.json` is
a plain local JSON file — not a managed data store with an encryption
option. `LockfileStore` writes plaintext JSON; encryption-at-rest is out
of scope because there is no managed storage layer to configure one on,
and the file contains no secrets (NFR2.3) to protect.

## STRIDE Summary (carried from security-requirements.md, design-level placement only)

| Threat | Component boundary | Design control |
|---|---|---|
| Tampering (tarball) | `ChannelClient` → `EngineInstaller`/`PluginManager` | Synchronous sha256 verify before handoff (above) |
| Tampering (lockfile) | `LockfileStore` | Atomic write (NFR4.1, see `reliability-design.md`) — a partial write can never look like a valid tampered state |
| Information Disclosure | `LockfileStore`, `ChannelClient` | No secret-bearing fields in either entity shape (NFR2.3) |
| Elevation of Privilege | `FileOwnershipGuard` | Engine-owned directory writes require `--force` + backup; no implicit privilege escalation path |

## No Compliance Framework Applies

Confirmed by NFR2.8 (security-requirements.md) — no PCI/HIPAA/SOC2 scope
for a locally-run open-source CLI with no user data store. No compliance
control design is produced here.
