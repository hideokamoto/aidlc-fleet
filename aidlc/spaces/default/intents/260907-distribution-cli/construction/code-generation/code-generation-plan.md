# Code Generation Plan — aidlc-fleet Distribution CLI

Zero-Unit directive (units-generation was SKIP for this scope). Scope is
the whole CLI in one pass: 7 commands, 2 entities, 9 components, 23
business rules, per the approved Functional Design / NFR Design.

## Story-to-Code-Step Traceability

Since `requirements-analysis` was SKIP, upstream IDs are the MoSCoW
backlog items from `ideation/intent-capture/intent-backlog.md` (M1–M8,
S1–S3, C1–C2) and the `BRx.y` business rules from
`construction/functional-design/rules.md`. Each plan step below states
which backlog item(s) and business rule(s) it implements.

| Backlog ID | One-line | Implementing step(s) |
|---|---|---|
| M1 | Central channel declaration format | Step 3 (Channel type), Step 6 (ChannelClient) |
| M2 | Four-part success criterion | Step 9 (SuccessVerifier) |
| M3 | Version gate (migration boundaries) | Step 9 (VersionGate) |
| M4 | File-ownership invariants | Step 9 (FileOwnershipGuard) |
| M5 | `update` command, gated by M3 | Step 9 (VersionGate), Step 12 (CommandLayer update) |
| M6 | `check` command (drift) | Step 9 (DriftDetector), Step 12 (CommandLayer check) |
| M7 | `plugin add`/`remove` | Step 9 (PluginManager), Step 12 (CommandLayer plugin) |
| M8 | Exit-code contract 0/1/2/3/4 | Step 12 (CommandLayer, all commands) |
| S1 | `status` command | Step 12 (CommandLayer status) |
| S2 | `doctor` wrap + known_failures | Step 9 (SuccessVerifier doctor wrap), Step 12 (CommandLayer doctor) |
| S3 | Drift summary in `status` | Step 9 (DriftDetector), Step 12 (CommandLayer status) |
| C1 | Per-project pin/unpin override | Step 4 (Lockfile.pin), Step 9 (VersionGate/DriftDetector pin), Step 12 (CommandLayer pin/unpin) |
| C2 | (deferred/GAP per domain-design traceability) | Not implemented this pass — carried-forward gap |

## Testing Contract

```json
{
  "version": 1,
  "methodology": "tdd",
  "source": "team",
  "ordering": "各テスト対象レイヤーについて、まず失敗するテストを書き、それ",
  "scope": "aidlc-distribution-cli",
  "test_strategy": "standard",
  "project_type": "greenfield",
  "applicable_notes": [
    {
      "layer": "org",
      "text": "We treat tests as a first-class deliverable in every Bolt. The specific\nmethodology (TDD, BDD, ATDD, or classic test-after) is affirmed at\npractices-discovery and recorded in `team.md` under this heading with explicit\n`Methodology` and `Ordering` fields; Code Generation resolves those fields\nindependently from coverage, tooling, and scope notes.\n\nWhen no posture has been affirmed, our default per scope is:\n- **Methodology**: test-after\n- **Ordering**: implement each applicable testable layer, then write and run\n  that layer's tests.\n- `mvp`, `enterprise`, `feature`, `infra`, `classic` add an 80% line-coverage\n  floor and CI execution before merge.\n- `bugfix`, `security-patch` add a targeted regression for the specific\n  bug/vulnerability and require the existing suite to remain green.\n- `express` uses the Minimal strategy: requirement-driven unit tests (one per\n  requirement, with a happy-path floor per component); existing tests remain\n  green.\n- `poc`, `refactor`, `workshop` add no extra new-test floor and require the\n  existing suite to remain green.\n\nThe active `Test Strategy` still applies in every scope and determines test\nvolume/types. Scope floors are additive; they never reduce or replace the\nselected strategy.\n\nBuild and Test verifies defined coverage floors and affirmed quality targets;\nthey may not be weakened to make a step pass.\n\nAffirm a stricter posture in `team.md` if the team commits to one."
    },
    {
      "layer": "team",
      "text": "- **Methodology**: tdd\n- **Ordering**: 各テスト対象レイヤーについて、まず失敗するテストを書き、それ\n  を通す最小の実装を書く、という順序を全レイヤーで徹底する（テストファース\n  ト。org.md 既定の test-after をこのプロジェクトでは明示的に上書きする）。\n  - 80% ライン・カバレッジ床を CI で必須化し、マージ前に green であることを\n    要求する。\n  - 加えて、ファイル所有権 invariant（M4: engine 所有ディレクトリの `--force`\n    + バックアップ、settings/hooks のマージ規則、`aidlc/` 不可侵、シンボリッ\n    クリンク書き込み禁止、レシート外ファイルの自動削除禁止）については、モ\n    ックでは検出できない不変条件があるため、**実ファイルシステムに対する統\n    合テスト**（一時ディレクトリを用いた実際の書き込み・マージ・削除の検証）\n    を必須とする。\n\n*根拠*: quality エージェントのレビューにより、M2（四条件成功判定契約）・M3\n（version gate）・M4（file-ownership invariants）がこの CLI の最重要ロジック\nであり、境界値・組み合わせテストと実ファイルシステム統合テストが必要と指摘さ\nれた。人間はこれを受けて、ドラフトが提案した test-after ではなく **TDD**\n（テストファースト）を明示的に選択した — これはドラフトの既定提案を上書きす\nる決定であり、エビデンス不足による妥協ではない（詳細は `evidence.md` 参照）。\n\n（インタビュー Q4 で確定。）"
    }
  ],
  "obligations": {
    "strategy": "standard",
    "strategy_volume": [
      "Five to eight tests per component.",
      "Unit tests plus integration tests for key boundaries.",
      "Add E2E, performance, or security tests when requirements demand them."
    ],
    "scope_floor": [
      "Keep the existing test suite green.",
      "This scope adds no extra new-test floor beyond the selected test strategy."
    ],
    "combination_rule": "Apply every selected-strategy obligation and every scope-floor obligation; neither replaces the other, and a targeted scope regression may add the narrowest necessary test type beyond the strategy default."
  },
  "plan_profile": {
    "methodology": "tdd",
    "runner_step": "Bootstrap the minimal test runner/configuration and record the exact unit-scoped command.",
    "runner_ready_before_first_test": true,
    "testable_layers": [
      "Data model / database behavior",
      "Repository / data access",
      "Business logic",
      "API / endpoint",
      "Frontend behavior"
    ],
    "steps": [
      "Project structure and production configuration skeleton.",
      "Bootstrap the minimal test runner/configuration and record the exact unit-scoped command.",
      "Data model / database behavior - Red: write the failing tests and record the failing command output.",
      "Data model / database behavior - Green: implement only enough behavior to pass.",
      "Data model / database behavior - Refactor: improve the implementation while tests stay green.",
      "Repository / data access - Red: write the failing tests and record the failing command output.",
      "Repository / data access - Green: implement only enough behavior to pass.",
      "Repository / data access - Refactor: improve the implementation while tests stay green.",
      "Business logic - Red: write the failing tests and record the failing command output.",
      "Business logic - Green: implement only enough behavior to pass.",
      "Business logic - Refactor: improve the implementation while tests stay green.",
      "API / endpoint - Red: write the failing tests and record the failing command output.",
      "API / endpoint - Green: implement only enough behavior to pass.",
      "API / endpoint - Refactor: improve the implementation while tests stay green.",
      "Frontend behavior - Red: write the failing tests and record the failing command output.",
      "Frontend behavior - Green: implement only enough behavior to pass.",
      "Frontend behavior - Refactor: improve the implementation while tests stay green.",
      "Environment/build configuration.",
      "Documentation and traceability."
    ]
  },
  "input_sha256": "sha256:7b14f07dc337bb88fa25537787c149d3df868958dc9e1d51c87a29c2d8e6802f",
  "contract_sha256": "sha256:4f590762ae78e2816bdc26d95fbc6159a70a3ba2cfe09ffde9e7f0d40a7095cd"
}
```

**Layer mapping for this CLI** (no database, no frontend — adapted per
the contract's own "adapt names, omit inapplicable layers" instruction):

| Contract layer | This CLI's analog | Owning component(s) |
|---|---|---|
| Data model / database behavior | Lockfile persistence | `LockfileStore` |
| Repository / data access | External fetch + integrity verification | `ChannelClient` |
| Business logic | Core decision/orchestration logic | `VersionGate`, `FileOwnershipGuard`, `SuccessVerifier`, `DriftDetector`, `PluginManager`, `EngineInstaller` |
| API / endpoint | CLI command surface | `CommandLayer` |
| Frontend behavior | N/A — no UI | Omitted |

## Plan Steps

- [ ] **Step 1: Project structure and production configuration skeleton**
  `package.json` (bun, TypeScript, `type: module`), `tsconfig.json`
  (`strict: true` per team.md Code Style), `.prettierrc`, `.eslintrc`
  (or flat config), directory layout: `src/commands/` (CommandLayer),
  `src/core/` (VersionGate, FileOwnershipGuard, SuccessVerifier,
  DriftDetector — pure logic, no I/O, per team.md's mandated 3-layer
  separation), `src/io/` (LockfileStore, ChannelClient — filesystem/network
  I/O), `src/orchestration/` (EngineInstaller, PluginManager — wrap
  upstream `install.ts`/`compose.ts` via child_process, never reimplement
  per project.md's Forbidden rule), `src/types/` (Lockfile, Channel entity
  types from `entities.md`), `bin/aidlc-fleet.ts` (CLI entrypoint).

- [ ] **Step 2: Bootstrap the minimal test runner**
  Configure `bun test` (bun's built-in test runner — no separate
  vitest/jest dependency needed). Record the exact unit-scoped command in
  `unit-test-instructions.md` before any Red step. Verify with a
  throwaway smoke test that `bun test src/types/lockfile.test.ts` runs
  and reports 0/0 before deletion.

- [ ] **Step 3: Data model — Red** (`Lockfile`/`Channel` types + parse/validate)
  Write failing tests for: `Lockfile` schema validation (BR8.1's
  absent/malformed distinction), `Channel` schema validation (BR7.2's
  unrecognized-schema surfacing), and the two entities' field shapes from
  `entities.md`. Record the failing command output.

- [ ] **Step 4: Data model — Green**
  Implement `src/types/lockfile.ts`, `src/types/channel.ts` (types +
  parse/validate functions) to pass Step 3's tests. Additive-only field
  reading per `entities.md`'s entity_constraints (unknown fields ignored).

- [ ] **Step 5: Data model — Refactor**
  Extract shared parse-error shape; keep tests green.

- [ ] **Step 6: Repository/data access (ChannelClient) — Red**
  Write failing tests for `ChannelClient`: channel-declaration fetch,
  tarball download + sha256 verification (BR7.1 — mismatch is a hard
  failure, no retry), unrecognized schema surfacing (BR7.2).

- [ ] **Step 7: Repository/data access (ChannelClient) — Green**
  Implement `src/io/channel-client.ts` to pass Step 6's tests.

- [ ] **Step 8: Repository/data access (ChannelClient) — Refactor**
  Extract the sha256-verify-before-handoff helper (security-design.md's
  synchronous ordering decision) for reuse by `EngineInstaller`/`PluginManager`.

- [ ] **Step 9: Business logic — Red** (VersionGate, FileOwnershipGuard,
  SuccessVerifier, DriftDetector, PluginManager, EngineInstaller)
  Write failing tests per component, covering every applicable `BRx.y`:
  - `VersionGate`: BR1.1 (reject), BR1.2 (manual + `--acknowledge-migration`),
    BR1.3 (none), BR1.4 (pin override), BR1.5 (adoption precondition)
  - `FileOwnershipGuard`: BR2.1 (`--force`+backup), BR2.2 (settings/hooks
    merge precedence), BR2.3 (`aidlc/` untouched), BR2.4 (no symlink
    writes), BR2.5 (no receipt-external delete), BR2.6 (fail-fast) — **as
    real-filesystem integration tests in a temp directory**, per team.md's
    explicit mandate that mocks cannot verify these invariants
  - `SuccessVerifier`: BR3.1 (3-predicate AND), BR3.2 (compose-0-alone
    insufficient), BR3.3 (plugin-sync-exit-1 reclassification), BR3.4
    (known_failures filtering)
  - `DriftDetector`: BR5.1 (three-way comparison), BR5.2 (0/1/2
    classification), BR5.3 (pin substitution)
  - `PluginManager`: BR4.1 (never mix plugin versions)
  - `EngineInstaller`/`LockfileStore`: BR6.1 (pin/unpin), BR8.1
    (missing/malformed lockfile hard failure outside `init`)
  Record each failing command's output before implementing.

- [ ] **Step 10: Business logic — Green**
  Implement `src/core/version-gate.ts`, `src/core/file-ownership-guard.ts`,
  `src/core/success-verifier.ts`, `src/core/drift-detector.ts`,
  `src/orchestration/plugin-manager.ts`,
  `src/orchestration/engine-installer.ts`,
  `src/io/lockfile-store.ts` to pass Step 9's tests. `EngineInstaller`/
  `PluginManager` invoke upstream `install.ts`/`compose.ts` via
  `child_process` — never reimplement upstream's plugin-compose logic
  (project.md Forbidden rule).

- [ ] **Step 11: Business logic — Refactor**
  Extract the shared exit-code-classification helper (BR5.2/BR1.1-1.3/
  BR3.1 all resolve to the canonical 0/1/2/3/4 contract) into
  `src/core/exit-code.ts` so `CommandLayer` has one source of truth.

- [ ] **Step 12: API/endpoint (CommandLayer) — Red**
  Write failing tests for each of the 7 commands' argv parsing, dispatch,
  and exit-code mapping (M8): `init`, `update`, `check`, `plugin add`,
  `plugin remove`, `pin`/`unpin`, `status`, `doctor`. Per team.md's
  mandated layer separation, these tests assert CommandLayer contains no
  business logic — only parsing, dispatch, and exit-code mapping over an
  injected/mocked core-logic layer.

- [ ] **Step 13: API/endpoint (CommandLayer) — Green**
  Implement `src/commands/init.ts`, `update.ts`, `check.ts`, `plugin.ts`,
  `pin.ts`, `status.ts`, `doctor.ts`, and `bin/aidlc-fleet.ts` (argv
  routing) to pass Step 12's tests, following the exact workflow step
  sequences in `functional-spec.md`.

- [ ] **Step 14: API/endpoint (CommandLayer) — Refactor**
  Extract shared argv-parsing helpers across commands; keep tests green.

- [ ] **Step 15: Environment/build configuration**
  `.gitignore` (node_modules, dist, `aidlc.lock.json` test fixtures),
  `package.json` `bin` entry, build script (`bun build` or `tsc` per
  tech-stack-decisions.md), CircleCI config placeholder deferred to the
  `ci-pipeline` stage (out of this stage's scope — NFR6 tech-stack
  decisions already fixed CircleCI as the CI/CD platform).

- [ ] **Step 16: Documentation and traceability**
  Inline JSDoc on public functions; `code-summary.md`,
  `source-manifest.json`, `traceability.json` (this stage's own required
  outputs, produced in Step 5/Step 6 of the stage protocol, not part of
  the numbered implementation steps above).

## Notes on Scope

- **Frontend behavior**: omitted — this is a CLI with no UI layer.
- **Concurrent-invocation file locking** and **atomic/transactional
  Lockfile writes under interruption**: both flagged as open items in
  `functional-spec.md`'s Edge Cases section, explicitly deferred to this
  stage. `reliability-design.md`'s NFR4.1 design (write-temp + fsync +
  atomic rename) resolves the atomic-write item; Step 10 implements that
  pattern in `LockfileStore`. Concurrent-invocation locking remains an
  open gap — no approved artifact specifies a locking strategy, so none is
  invented here (per the phase guardrail against inventing missing
  artifact content); this is called out in `code-summary.md`.
- **NFR4.5** (Lockfile backup): still an open, undesigned gap per
  `reliability-design.md` — not implemented this pass.
