# Scope Document — aidlc-fleet Distribution CLI

## In Scope

The complete command surface specified in the v0.1 requirements document
(§3), built as one initiative rather than phased across separate builds
[Q2]:

- `init --harness <n> [--channel <c>]` — first-time onboarding: place the
  engine and declared plugins, generate `aidlc.lock.json` [desc]
- `update [--to <ref>]` — follow the central channel to a new version,
  gated by §4's version-gate logic [desc]
- `check` — three-way drift detection (lockfile / channel / disk); CI-usable
  exit codes [desc]
- `plugin add <name>` / `plugin remove <name>` — plugin projection
  placement/removal and hook regeneration [desc]
- `pin <ref>` / `unpin` — per-project pin overriding the channel [desc]
- `status` — version, plugin, and drift summary [desc]
- `doctor` — wraps upstream doctor, applying `known_failures` [desc]

Must-have foundations that every command touching them must respect
(structurally load-bearing per the document's own emphasis, not merely
one command among equals) [Q2]:

- The origin-record version gate (v0.1 §4) — reject/manual/none migration
  boundary handling, `engine_origin` tracking [intent, Q2]
- The four-part success criterion (v0.1 §6, called out in the source
  document as "最重要" / most important) — compose exit 0 is never
  sufficient proof of success on its own [intent, Q2]
- The file-ownership invariants (v0.1 §7) — engine-owned directories,
  settings/hooks merge rules, `aidlc/` untouched except memory seed,
  no symlink writes, no auto-deletion of receipt-external files [intent]

## Out of Scope

Per the v0.1 document's own non-goals (§0) and the workflow's approved scope
grid (`aidlc-distribution-cli`, confirmed `[Q8]` at intent-capture):

- Reimplementing upstream plugin-compose logic [desc]
- Modifying upstream (`awslabs/aidlc-workflows`) files [desc]
- Reading or writing `aidlc/` workspace state, beyond the initial memory
  seed copy [desc]
- Mandatory host plugin-store integration (optional, never required) [desc]
- Arbitrary version-to-version upgrades (the CLI is explicitly not a
  general-purpose upgrader — see the version gate in §4) [desc]
- Market research, team formation, rough/refined mockups, user stories,
  units generation, delivery planning, infrastructure design, and every
  Operation-phase stage (all SKIP in the approved workflow grid — this is
  internal dev-tooling with an already-complete spec and no deployed
  operational surface of its own) [scope]

## Minimum Viable Scope

`init` + `check` + `doctor` is the minimum viable slice that delivers value
on its own: a project can be onboarded to the central declaration (`init`)
and verified (`check`, `doctor`) even before `update`, `plugin add/remove`,
or `pin`/`unpin` exist, because every other command either mutates state
that `init` first establishes or summarizes state that `check`/`doctor`
already expose [Q1]. This is a sequencing observation for internal
build-order judgment, not a reduced-scope proposal — the full seven-command
surface remains the committed target of this initiative [Q2].

## Dependencies Between Capabilities

- `init` is the dependency root: every other command reads or writes the
  lockfile that `init` creates [Q3]
- `update`'s version gate (§4) additionally depends on `engine_origin`,
  which only `init` (or `init --adopt`) writes [Q3]
- `plugin add`/`remove` depend on the same §6 success-verification contract
  that `init`/`update` share [Q3]
- `doctor` and `status` are terminal read-only consumers — nothing depends
  on them [Q3]

## Sequencing Preference

Dependency-first at the command level (`init` before anything else, since
it is the hard dependency root — see above), risk-first within that: the
§6 success-verification contract (the document's own "最重要" section) and
the §7 file-ownership invariants are proven correct inside `init` before
`update`'s §4 version gate is layered on top, since a correct `init` is
what makes `update`'s `engine_origin` check meaningful [Q4].

## Deadlines

None specified in the v0.1 document. The only time-based condition is an
event-triggered sunset — the CLI retires once upstream ships native
distribution (RFC #722 / PR #756) — not a calendar deadline [Q5].

## Assumptions & Open Questions

None.
