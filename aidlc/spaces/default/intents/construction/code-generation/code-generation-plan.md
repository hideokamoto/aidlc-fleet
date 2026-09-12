# Code Generation Plan — Issue #18: env config persistence

Zero-Unit directive (no active intent / Unit DAG). Scope: brownfield change to
`aidlc-fleet-cli` implementing GitHub issue #18 — collect the 4 required
`AIDLC_FLEET_*` environment variables interactively and persist them to a
project-local config file, with env vars taking priority over the local file,
and `doctor`/`status` reporting each value's source.

Traceability source: GitHub issue #18 (hideokamoto/aidlc-fleet), consumed
directly — no upstream `requirements.md` / `unit-of-work.md` exist for this
ad-hoc single-stage run (`consumes_absent` on the run-stage directive confirms
both are expected absent). Requirement IDs below (`ISS18-*`) are minted from
the issue body for traceability purposes.

## Requirement IDs (from issue #18, refined per human feedback 2026-09-12)

- `ISS18-1`: Resolve each of the 4 vars (`AIDLC_FLEET_CHANNEL_URL`,
  `AIDLC_FLEET_ENGINE_REPO`, `AIDLC_FLEET_COMPOSE_CMD`,
  `AIDLC_FLEET_DOCTOR_CMD`) in priority order: environment variable >
  project-local config file > built-in default (where one exists) > unset.
- `ISS18-6` (added per human feedback): 3 of the 4 variables have one fixed,
  correct value for an ordinary self-hosted AI-DLC install and should ship a
  built-in default so a normal setup never has to answer for them —
  confirmed against this repo's own source, not invented:
  - `AIDLC_FLEET_ENGINE_REPO` → `awslabs/aidlc-workflows` — the canonical
    upstream engine repo this project's own Forbidden rule already names
    (`project.md`: "NEVER upstream（`awslabs/aidlc-workflows`）のファイルを
    変更しない").
  - `AIDLC_FLEET_COMPOSE_CMD` → `bun .claude/tools/aidlc-orchestrate.ts next
    compose` — the exact command `.claude/tools/aidlc.ts`'s own `top-compose`
    route table entry dispatches `compose` to (`prefix: ["next", "compose"]`,
    `tool: TOOLS.orchestrate`).
  - `AIDLC_FLEET_DOCTOR_CMD` → `bun .claude/tools/aidlc-utility.ts doctor` —
    likewise the exact command `aidlc.ts`'s `top-passthrough` route table
    entry dispatches `doctor` to (`tool: TOOLS.utility`).
  - `AIDLC_FLEET_CHANNEL_URL` gets **no built-in default** — it names a
    team's own hosted Channel distribution (no canonical value exists
    anywhere in this repo or its docs to default to); it remains
    required-with-no-fallback, same as today.
- `ISS18-2`: Persist collected values to a CLI-owned local file only (never
  `aidlc/` workspace state, never an upstream file).
- `ISS18-3`: Provide a `config` subcommand that interactively prompts for any
  currently-unset variable and saves answers to the local file.
- `ISS18-4`: `doctor` and `status` report each variable's source (`env`,
  `local-config`, or `unset`).
- `ISS18-5`: The local config file is excluded from version control
  (`.gitignore`) since it may carry values a team does not want committed.

## Testing Contract

```json
{
  "version": 1,
  "methodology": "tdd",
  "source": "team",
  "ordering": "各テスト対象レイヤーについて、まず失敗するテストを書き、それ",
  "scope": "feature",
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
      "Meet an 80% line-coverage floor.",
      "Run the selected tests in CI before merge."
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
  "input_sha256": "sha256:6cca9f63b9022f5e3b1c6056ed83344df5240b47ad2ab2fa30a22d80e453fcd1",
  "contract_sha256": "sha256:dd7b5bcde3f9806068913ae28fb0f54c2011fca6ebc235289d878b915e571b18"
}
```

### Layer mapping for this unit

This CLI has no database or frontend. "Data model / database behavior" and
"Frontend behavior" are inapplicable and omitted per the contract's own
allowance ("adapting names and omitting genuinely inapplicable layers without
changing the methodology"). The three applicable layers, matching this
project's mandated command/core-logic/I-O separation
(`team.md` § Code Style):

| Contract layer | This unit's layer | Component |
|---|---|---|
| Repository / data access | I/O layer | `src/io/local-config-store.ts` |
| Business logic | Core logic layer | `src/core/env-config-resolver.ts` |
| API / endpoint | Command layer | `src/commands/config.ts`, `doctor.ts`, `status.ts`, `bin/aidlc-fleet.ts` |

## Plan Steps

- [x] Step 1: Bootstrap — confirm the existing test runner works unit-scoped
  (`bun test <file>`); no new runner/config needed (`bun test` already
  configured project-wide). (Runner-ready-before-first-test obligation.)
- [x] Step 2: I/O layer — Red: write `src/io/local-config-store.test.ts`
  covering read of an absent file, read of a valid file, read of a malformed
  file, and write-then-read round trip. Run and confirm failing
  (`Cannot find module`/`ReferenceError`). — `ISS18-2`
- [x] Step 3: I/O layer — Green: implement `src/io/local-config-store.ts`
  (`LocalConfigStore`: `load()` / `save()` against
  `.aidlc-fleet.local.json` in `projectRoot`, mirroring `LockfileStore`'s
  shape). Run tests green.
- [x] Step 4: I/O layer — Refactor: align error handling/typing with
  `LockfileStore`'s conventions; keep tests green.
- [x] Step 5: Core logic layer — Red: write
  `src/core/env-config-resolver.test.ts` covering the 4-level priority
  (env only, local-config only, both, neither → default when one exists,
  neither → `unset` when no default exists) for each of the 4 variables,
  asserting both the resolved value and its `source`
  (`env`/`local-config`/`default`/`unset`). Confirm failing. — `ISS18-1`,
  `ISS18-6`
- [x] Step 6: Core logic layer — Green: implement
  `src/core/env-config-resolver.ts` (pure function, no I/O, no `spawn` —
  matches `team.md`'s layer-separation mandate), including the
  `ENV_CONFIG_DEFAULTS` map for `AIDLC_FLEET_ENGINE_REPO` /
  `AIDLC_FLEET_COMPOSE_CMD` / `AIDLC_FLEET_DOCTOR_CMD` (no entry for
  `AIDLC_FLEET_CHANNEL_URL`). Run tests green.
- [x] Step 7: Core logic layer — Refactor: extract the 4-variable list as a
  single source of truth reused by the command layer; keep tests green.
- [x] Step 8: Command layer — Red: write `src/commands/config.test.ts`
  covering: prompts only for variables whose source is `unset` (mocked
  stdin), writes answers via the injected `LocalConfigStore`-shaped port,
  and does NOT prompt for a variable already resolved from env, local
  config, or a built-in default. Confirm failing. — `ISS18-3`, `ISS18-6`
- [x] Step 9: Command layer — Green: implement `src/commands/config.ts`
  (mirrors the `CommandDeps` pattern of `init.ts`/`status.ts`; the readline
  prompt port lives in `CommandDeps` so it is injectable/testable, per this
  project's I/O-boundary mandate).
- [x] Step 10: Command layer — Red: extend `src/commands/doctor.test.ts` and
  `src/commands/status.test.ts` with cases asserting each variable's line
  shows `(env)`, `(local-config)`, `(default)`, or `(unset)`. Confirm
  failing. — `ISS18-4`
- [x] Step 11: Command layer — Green: extend `doctor.ts`/`status.ts` output
  and `CommandDeps` with the resolved-config summary; wire `bin/aidlc-fleet.ts`
  and `src/commands/real-deps.ts` to build the 4 values through
  `env-config-resolver` + `local-config-store` instead of reading
  `process.env` directly, and add the `config` case to the command switch.
  Run the full existing suite (`bun test src/`) to confirm no regression.
- [x] Step 12: Command layer — Refactor: keep `bin/aidlc-fleet.ts` a thin
  dispatcher (no branching logic beyond argv routing), consistent with its
  existing style.
- [x] Step 13: Environment/build configuration — add
  `.aidlc-fleet.local.json` to `.gitignore`. — `ISS18-5`
- [x] Step 14: Documentation and traceability — update the "aidlc-fleet CLI"
  README section (added by PR #17) with the `config` subcommand and the
  env-over-local-config priority rule; write `code-summary.md`,
  `source-manifest.json`, and `traceability.json`.

## Test files (mandatory, per Testing Contract obligations)

- `src/io/local-config-store.test.ts` (new)
- `src/core/env-config-resolver.test.ts` (new)
- `src/commands/config.test.ts` (new)
- `src/commands/doctor.test.ts` (extended)
- `src/commands/status.test.ts` (extended)

## Test configuration

No new test configuration needed — `bunfig.toml` / `package.json`'s
`test`/`test:coverage` scripts already cover `src/`; new files are picked up
automatically by `bun test src/`.
