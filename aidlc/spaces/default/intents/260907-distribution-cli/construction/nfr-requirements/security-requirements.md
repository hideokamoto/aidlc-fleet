# Security Requirements — aidlc-fleet Distribution CLI

NFR2 covers this CLI's most substantive NFR category (Q2,
`nfr-requirements-questions.md`). There is no user-facing authentication
in this CLI — it runs as the invoking developer/CI identity — so
"security" here is almost entirely about verifying the *content* fetched
and installed, not verifying a *user*.

## Authentication

| ID | Requirement |
|----|-------------|
| NFR2.1 | No user authentication model applies. The CLI executes with the invoking process's own identity (developer's local shell, or the CI job's identity) and performs no login, session, or credential-issuance flow of its own. |

## Authorization

| ID | Requirement |
|----|-------------|
| NFR2.2 | No role/permission model applies within the CLI itself — file-system permissions of the invoking identity are the sole access-control boundary, inherited from the OS/CI environment, not implemented by this CLI. |

## Data Protection

| ID | Requirement | Source |
|----|-------------|--------|
| NFR2.3 | `aidlc.lock.json` and the channel configuration must never contain credentials, API keys, or other secrets. | practices-discovery Mandated rule, `project.md`: "NEVER `aidlc.lock.json` やチャネル設定ファイルに認証情報・APIキー等の秘密情報をハードコードしない" |
| NFR2.4 | Every fetched tarball (engine and plugin) is sha256-verified against the channel's declared hash before use; a mismatch is a hard failure — never silently retried. | BR7.1, `functional-design/rules.md`; `contract-summary.md` Contract 1 |
| NFR2.5 | An unrecognized Channel `schema` version is surfaced to the human rather than parsed with a best-effort guess. | BR7.2, `functional-design/rules.md` |

## Supply-Chain Integrity

| ID | Requirement |
|----|-------------|
| NFR2.6 | Engine and plugin sources are pinned by commit SHA, not by floating tags or branches (`Channel.engine.ref`, `Channel.plugins[].ref` — `entities.md`). A compromised upstream ref cannot silently substitute content post-fetch without failing NFR2.4's sha256 check. |
| NFR2.7 | This CLI never reimplements or modifies upstream `install.ts`/`compose.ts` logic (`components.md` EngineInstaller rationale; practices-discovery Forbidden rule) — it wraps/diffs against upstream's own vetted logic rather than maintaining a parallel implementation that could drift out of security parity. |

## STRIDE Threat Summary

| Threat | Applicability | Mitigation |
|--------|---------------|------------|
| Spoofing | Low — no user identity to spoof; a malicious channel operator could spoof the channel's content | NFR2.4 (sha256), NFR2.6 (commit-SHA pinning) |
| Tampering | The primary threat — a fetched tarball or channel declaration tampered in transit or at the source | NFR2.4, NFR2.6 |
| Repudiation | Not applicable — no multi-user audit trail requirement stated in any approved artifact | — |
| Information Disclosure | NFR2.3 (no secrets in Lockfile/channel config) covers the CLI's own data; upstream channel content itself is not this CLI's confidentiality concern | NFR2.3 |
| Denial of Service | Low — a malicious/broken channel could cause repeated failed fetches, but no rate-limiting/availability SLA applies to a locally invoked CLI | Not addressed — no approved artifact specifies DoS mitigation for this CLI shape |
| Elevation of Privilege | Not applicable — no privilege levels within the CLI (NFR2.2) | — |

## Compliance

| ID | Requirement |
|----|-------------|
| NFR2.8 | No regulatory compliance framework (GDPR, HIPAA, SOC2, PCI-DSS) applies. This is an internal developer tool with no PII/PCI/HIPAA data flow — `intent-statement.md` and `intent-backlog.md` describe no such data handling, and no approved artifact establishes one. |

## Security Anti-Requirements (explicitly excluded)

- "The system should be secure" — not measurable; replaced by NFR2.1–NFR2.8.
- "No vulnerabilities" — impossible to guarantee; addressed instead at
  the pipeline level (CircleCI secret scanning and dependency scanning,
  per `team.md`'s affirmed Deployment practice, covered in
  `tech-stack-decisions.md` and the `ci-pipeline` stage, not duplicated
  here).
- User authentication/authorization requirements (MFA, session
  management, RBAC) — do not apply; this CLI has no user-facing login
  surface (NFR2.1).
