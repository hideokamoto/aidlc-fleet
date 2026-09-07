# Domain Design — Clarifying Questions

## Sources

- [scope-def] `ideation/scope-definition/scope-document.md`, `intent-backlog.md`
- [intent] `ideation/intent-capture/intent-statement.md`
- [practices] `inception/practices-discovery/team-practices.md`, `discovered-rules.md`

## Note on scope

`requirements-analysis` is SKIP in this workflow's approved grid, so this
stage reads the ideation-phase artifacts (scope-document.md,
intent-backlog.md, intent-statement.md) as its requirements substitute —
this is the accepted fold noted at composer time, not a gap. Per the
user's standing instruction not to re-ask anything the shared v0.1
document already answers, every question below is answered directly from
those artifacts. Only the mandatory consolidated-summary checkpoint is a
live human turn.

## Q1. What are the distinct logical building blocks (components), and why is each its own component rather than folded into another?

Backlog items M1–M8, S1–S3 (`intent-backlog.md`) group into eight
components by distinct responsibility and distinct change rate, following
the team's mandated layer separation (commands / core logic / filesystem
I/O — `team-practices.md` § Code Style):

1. **CommandLayer** — argument parsing and exit-code determination for
   all seven commands (§3). Changes whenever the CLI surface changes;
   contains no business logic.
2. **LockfileStore** — reads/writes `aidlc.lock.json` (channel,
   channel_commit, engine{ref,version,sha256,harness,installed_at},
   engine_origin, plugins[], managed, known_failures[]). Owns the single
   source of on-disk project state.
3. **ChannelClient** — fetches the central channel file (git repo or
   static URL, per §2.1) and engine/plugin tarballs, verifies sha256.
4. **VersionGate** — the origin-record migration-boundary decision logic
   (§4): reject/manual/none classification, `--acknowledge-migration`
   handling. This is the CLI's single most load-bearing decision — it is
   its own component so it can be tested in total isolation from I/O.
5. **FileOwnershipGuard** — enforces the §7 invariants (engine-dir
   replace-with-backup, settings/hooks merge rule, `aidlc/` untouched,
   no symlink writes, no auto-delete) and fails fast on violation
   (Mandated, `discovered-rules.md`). Separate from VersionGate because it
   fires on every mutating command, not just `update`.
6. **EngineInstaller** — wraps upstream `install.ts` (Cursor) or the
   receipt-diff procedure (other harnesses) per §5.1, always followed by
   a compose re-run.
7. **PluginManager** — plugin add/remove, version-mixing guard (P6),
   session-start hook wrapper generation/removal (§5.3, BEGIN/END marker
   merge).
8. **SuccessVerifier** — the four-part success criterion (§6, M2): compose
   exit code, `.drops` `[degraded]` scan, `doctor` wrapping with
   `known_failures` filtering, `plugin sync` exit-1-as-incomplete
   handling.

[Answer]: A. These eight components, as described, with the stated
boundary rationale (distinct responsibility, distinct change rate, and
matching the team's mandated layer separation). [scope-def, practices]

## Q2. Entity ownership — which component owns which entities?

Two persistent entities appear in the backlog's data model (§2 of the
v0.1 doc, carried via `intent-statement.md`'s Initial Scope Signal and
`scope-document.md`'s data-model references):

- **Lockfile** (`aidlc.lock.json` contents) — owned by `LockfileStore`.
  Identifier: project path (one lockfile per project). Attributes:
  channel, channel_commit, engine, engine_origin, plugins, managed,
  known_failures.
- **Channel** (the central declaration file's contents) — owned by
  `ChannelClient`. Identifier: channel name/URL. Attributes: schema,
  channel, engine, migration_boundaries, plugins, settings_overlay,
  mcp_overlay.

`VersionGate` and `SuccessVerifier` operate on data read from these two
entities but do not own persistent state of their own — they are pure
decision components. `FileOwnershipGuard` inspects the filesystem
directly (receipts, engine-owned directories) but does not own a
persistent entity either — it is a checking component.

[Answer]: A. Two owned entities as described (Lockfile → LockfileStore,
Channel → ChannelClient); VersionGate, SuccessVerifier, and
FileOwnershipGuard are stateless decision/checking components with no
entities of their own. [scope-def]

## Q3. Component responsibilities and interactions — which component calls which, and why?

- `CommandLayer` depends on all seven other components (it dispatches to
  whichever the invoked command needs) and owns no business logic itself
  (per the mandated layer separation).
- `EngineInstaller` and `PluginManager` both depend on `ChannelClient`
  (to fetch what to install), `FileOwnershipGuard` (to enforce invariants
  during the write), and `SuccessVerifier` (to confirm the four-part
  criterion after acting) — this matches the backlog's dependency note
  that M1/S1 "depend on the same §6 success-verification contract."
- `EngineInstaller` additionally depends on `LockfileStore` (to read/write
  `engine_origin` and installed-engine metadata) and `VersionGate` (an
  `update` must pass the gate before `EngineInstaller` proceeds — an
  `init` skips the gate on first install).
- `PluginManager` additionally depends on `LockfileStore` (to read/write
  `plugins[]` and `engine_version_at_compose`).
- `VersionGate` depends on `LockfileStore` (reads `engine_origin`) and
  `ChannelClient` (reads `migration_boundaries` from the channel).
- `SuccessVerifier` depends on `LockfileStore` (reads `known_failures`)
  only — it does not call `ChannelClient` or `VersionGate`.
- `FileOwnershipGuard` has no outbound dependencies — it is a leaf
  component that inspects the filesystem and the project's own receipts.

All interactions are synchronous, in-process function calls (this is a
single CLI process, not a distributed system) — no async/event style
applies. [scope-def]

[Answer]: A. Dependency graph as described. [scope-def]

## Q4. Integration approach with existing components (brownfield)?

Not applicable — this is a greenfield project (confirmed at
intent-capture: "Project type: Greenfield"). There is no existing
component inventory to integrate with. [intent]

[Answer]: C. Not applicable — greenfield, no existing components.

## Q5. UI component structure — is there a user-facing UI to design?

No. This is a CLI tool; its only "interface" is command-line arguments,
stdout/stderr text output, and process exit codes. There is no GUI or
web UI. The design perspective for a CLI is: clear, scriptable output
(so `check`/`doctor`/`status` are CI-parseable per §9's
`AIDLC_UNATTENDED=1` unattended-execution requirement) and exit codes as
the primary machine-readable signal (§8). No wireframes or mockups apply
— `rough-mockups`/`refined-mockups` are correctly SKIP in this workflow's
grid. [scope-def]

[Answer]: A. No UI component — CLI output/exit-code design only, no
wireframes needed. [scope-def]

## Assumptions & Open Questions

None.

## Consolidated Summary Confirmation

All five questions above have been answered directly from the ideation
artifacts (scope-document.md, intent-backlog.md, intent-statement.md) and
the affirmed team practices, per the user's explicit instruction not to
re-ask anything already settled. No assumptions remain open.

[Answer]: Looks correct
