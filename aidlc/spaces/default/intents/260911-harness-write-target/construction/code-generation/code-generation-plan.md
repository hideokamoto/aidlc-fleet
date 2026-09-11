# Code Generation Plan — harness-write-target-fix

Zero-Unit stage-level implementation (scope `harness-write-target-fix` skips
Units Generation and Requirements Analysis by design; this plan is scoped
directly from GitHub issue #6 and a direct read of `src/commands/real-deps.ts`).

## Story-to-Code Traceability

| Plan Step | Issue Acceptance Criterion (issue #6) |
|---|---|
| Step 3-6 | 「real-deps.ts の5箇所を、lockfileのharnessから解決したパスに置き換える」 |
| Step 3, 5 | 「解決テーブルは plugin-targets.json を参照し、fleet側で再定義しない」 |
| Step 4, 7 | 「未知のharness値は明示的に失敗させる（.claudeへのフォールバックをしない）」 |
| Step 9 | 「2種類以上のharnessを指定した統合テストで、それぞれ正しいディレクトリに配置されることを検証する」 |

## Design Decision (recorded here; also in memory.md)

`plugin-targets.json`'s keys (`claude`, `codex`, `copilot`, `cursor`, `kiro`,
`kiro-ide`, `opencode`) are the only valid harness identifiers going forward.
The pre-existing test fixtures used the ad-hoc value `"claude-code"` for
`engine.harness`/`EngineInstallOptions.harness`, which was never validated
before (because `.claude` was hardcoded and `harness` was used only inside a
staging filename). Fixing the bug necessarily makes that string load-bearing:
`"claude-code"` is not a key in `plugin-targets.json`, so it must become an
explicit failure under this fix's own acceptance criterion. Fixtures inside
`src/commands/real-deps.test.ts` that exercise `buildRealDeps()`'s real ports
are updated to the valid key `"claude"` (which resolves to the same
`harnessLeaf` `.claude` as before, so their other assertions are unchanged).
No other test file is touched: `engine-installer.test.ts` and
`plugin-manager.test.ts` exercise `EngineInstaller`/`PluginManager` against
fake ports that never look up `plugin-targets.json`, so the literal harness
string they pass through is inert to this fix except where the interface
itself gains a field (see Step 2).

`plugin-targets.json` is bundled into the CLI via a static, tsconfig
`resolveJsonModule` import (same convention already used for the `__fixtures__`
JSON fixtures elsewhere in this codebase), not a runtime `fs.readFile` against
an unpredictable cwd — it is static harness-topology data, not project state.

## Steps

- [x] Step 1: Verify the existing test runner/configuration and record the exact
      unit-scoped command (`bun test src/commands/real-deps.test.ts`).
- [x] Step 2 (Business logic — Red): `EngineInstallerPorts.checkEngineDirectoryReplace`
      cannot resolve a harness-specific target directory today — it receives only
      `{ force: boolean }`, called by `EngineInstaller.install()` *before*
      `placeEngine(bytes, harness)`. Add a failing expectation in
      `engine-installer.test.ts` that `checkEngineDirectoryReplace` is called with
      `{ force, harness }` (both fields).
- [x] Step 3 (Business logic — Green): widen `EngineInstallerPorts.checkEngineDirectoryReplace`'s
      options type to `{ force: boolean; harness: string }` and thread
      `options.harness` through in `EngineInstaller.install()`.
- [x] Step 4 (Business logic — Refactor): none needed beyond the above (single call site).
- [x] Step 5 (Repository/data-access-equivalent — Red, `real-deps.ts` glue layer):
      add failing tests in `real-deps.test.ts` for a new exported
      `resolveHarnessRoot(harness: string): string` pure function: known harness
      keys (`claude`, `cursor`) resolve to their `plugin-targets.json`
      `harnessLeaf`; an unknown harness throws an explicit error (no `.claude`
      fallback).
- [x] Step 6 (Repository/data-access-equivalent — Green): implement
      `resolveHarnessRoot` in `real-deps.ts` via a static import of
      `.claude/tools/data/plugin-targets.json`.
- [x] Step 7 (Repository/data-access-equivalent — Red): add failing integration
      tests in `real-deps.test.ts` driving `buildRealDeps()`'s real ports (not
      the pure function) for the 5 write-target call sites:
      1. `engineInstaller.install()` with `harness: 'cursor'` places the engine
         under `.cursor/`, not `.claude/`.
      2. `pluginManager.add()` with lockfile `engine.harness: 'cursor'` places
         the plugin projection and session-start hook under `.cursor/`.
      3. `pluginManager.remove()` with lockfile `engine.harness: 'cursor'`
         removes from `.cursor/plugins/<name>`.
      4. `engineInstaller.install()` with an unknown lockfile-adjacent harness
         value (e.g. `"bogus-harness"`) rejects explicitly and writes nothing
         under any `.` directory.
      5. `pluginManager.add()` with an unknown harness value in the seeded
         lockfile rejects explicitly and writes nothing.
- [x] Step 8 (Green): replace the 5 hardcoded `.claude` locations in
      `real-deps.ts`:
      - `checkEngineDirectoryReplace` closure — resolve via `opts.harness`.
      - `placeEngine` closure — resolve via its existing `harness` parameter.
      - `pluginManager.checkWriteAllowed` closure — load the lockfile (already
        in scope via `lockfileStore`) to read `engine.harness`.
      - `pluginManager.removeProjection` closure — same lockfile lookup.
      - `pluginManager.placeProjection` closure — same lockfile lookup.
      - `pluginManager.regenerateSessionStartHook` closure — same lockfile
        lookup.
      Update existing `real-deps.test.ts` fixtures' `engine.harness` from
      `"claude-code"` to `"claude"` (Design Decision above) so pre-existing
      happy-path tests keep passing unchanged in behavior.
- [x] Step 9 (Refactor): factor the "load lockfile, resolve harness root" pair
      used by the four `pluginManager` closures into one small private helper
      inside `real-deps.ts` to avoid repeating the same two lines four times.
- [x] Step 10: Update the misleading example in `src/types/lockfile.ts`'s
      `LockfileEngine.harness` doc comment (`e.g. "cursor", "claude-code"` →
      `e.g. "cursor", "claude"`) so it matches the now-enforced
      `plugin-targets.json` keys.
- [x] Step 11: Documentation/traceability — write `code-summary.md`,
      `traceability.json`, `source-manifest.json`.

## Testing Contract

```json
{
  "version": 1,
  "methodology": "tdd",
  "source": "team",
  "ordering": "各テスト対象レイヤーについて、まず失敗するテストを書き、それ",
  "scope": "harness-write-target-fix",
  "test_strategy": "minimal",
  "project_type": "brownfield",
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
    "strategy": "minimal",
    "strategy_volume": [
      "One verifiable test per requirement at the narrowest effective level.",
      "At least one happy-path unit test per component.",
      "Unit tests are the default; a bugfix/security scope floor may require an integration or E2E regression when that is the narrowest level that reproduces the defect."
    ],
    "scope_floor": [
      "Keep the existing test suite green.",
      "This scope adds no extra new-test floor beyond the selected test strategy."
    ],
    "combination_rule": "Apply every selected-strategy obligation and every scope-floor obligation; neither replaces the other, and a targeted scope regression may add the narrowest necessary test type beyond the strategy default."
  },
  "plan_profile": {
    "methodology": "tdd",
    "runner_step": "Verify the existing test runner/configuration and record the exact unit-scoped command.",
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
      "Verify the existing test runner/configuration and record the exact unit-scoped command.",
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
  "input_sha256": "sha256:00b7c794e7cfadb6d3bbf0d495f57e2eb36eb0e445b8feed1b9b5462507e4bcd",
  "contract_sha256": "sha256:d2056f55c60f2b4a6e788966ae8e8460c0498084a1edc9a59d3b5624e72dd58e"
}
```

Note on applying the contract: this change has no "Data model / database",
"API / endpoint", or "Frontend behavior" testable layer — it is internal
CLI orchestration glue with no schema, no HTTP surface, and no UI. Per the
stage protocol's "adapting names and omitting genuinely inapplicable layers
without changing the methodology," Steps 2-9 above apply the TDD
Red/Green/Refactor ordering to the two layers that genuinely exist here:
"Business logic" (the `EngineInstallerPorts` interface change +
`resolveHarnessRoot`) and the "Repository / data access" equivalent (the
`real-deps.ts` filesystem-glue closures, verified through real-filesystem
integration tests per team.md's Mandated M4 rule).

## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-09-11T15:45:58Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | `src/commands/real-deps.ts:203-214` (`resolveConfiguredHarnessRoot`) と 4クロージャ（`checkWriteAllowed`/`removeProjection`/`placeProjection`/`regenerateSessionStartHook`、各々 L265-352 付近）の呼び出し箇所 | `PluginManager.add()` は `checkWriteAllowed` → `placeProjection` → `regenerateSessionStartHook` の3つの port を順に呼ぶ（`src/orchestration/plugin-manager.ts:86-90`）。各 closure は独立に `resolveConfiguredHarnessRoot()` を呼び、その都度 `lockfileStore.load()`（`aidlc.lock.json` の実ファイル読み込み + JSON パース）を実行する。結果として `add()` 1回の論理操作で lockfile が最大3回、`remove()` でも3回、ディスクから再読み込みされる。Step 9 の「Refactor」は2行の重複コードを1関数呼び出しに集約しただけで、I/O 自体の重複は解消していない。`PluginManagerPorts` を harness 引数で拡張しない設計判断（`plugin-manager.ts`/`plugin-manager.test.ts` に触れない）自体は project.md の Forbidden ルール（upstream の plugin-compose ロジックを再実装しない）に反しないための妥当な選択だが、その代償として real-deps.ts 内で同一ファイルの多重読み込みという設計上の臭いが生じている。 | 機能的には正しく、既存テストも green（`bun test src/` 173 pass 確認済み）のためブロッキングではないが、`buildRealDeps()` のクロージャ生成時点（`add()`/`remove()` 呼び出し前）に一度だけ lockfile をロードしてキャッシュする、あるいは `PluginManager.add()`/`remove()` の1呼び出しの間だけ有効な軽量メモ化を導入することを検討し、人間承認前にコメントとして残すか、フォローアップ issue 化することを推奨する。 | New |
| R-02 | Minor | `src/commands/real-deps.ts:43-53`（`HARNESS_TARGETS`/`resolveHarnessRoot`） | `pluginTargets as Record<string, PluginTargetEntry>` は実行時検証なしの型アサーションであり、`resolveHarnessRoot` は `entry` の**存在**のみを `if (!entry)` でチェックし、`entry.harnessLeaf` の**形**は検証しない。`plugin-targets.json`（upstream 保有、tsconfig 静的 import）のエントリが将来 `harnessLeaf` を欠いた形に変わった場合、`resolveHarnessRoot` は `undefined` を返し、呼び出し側の `join(config.projectRoot, undefined)` が `TypeError [ERR_INVALID_ARG_TYPE]` を投げる — これは issue #6 完了条件3が求める「harness 名を含む明示的な失敗」ではなく、由来の分かりにくいランタイムエラーになる。現在の `plugin-targets.json` の内容は整形式であるため今は顕在化しないが、防御が甘い。 | `resolveHarnessRoot` 内で `entry?.harnessLeaf` が `string` であることも検証し、欠けていた場合は harness 名を含む同種の明示的エラーを投げるよう1行追加することを推奨（ブロッキングではない）。 | New |
| R-03 | Minor | `code-generation-plan.md` Steps 1-11 のチェックボックス（本ファイル L42-98） | 全ステップが `- [ ] Step N` のまま未チェックで残っている。`code-summary.md`（「計画からの逸脱: なし」）および実テスト実行結果（173 pass, 新規テスト31件を含む）から実装自体は完了していることが確認できるため実装上の欠落ではないが、計画書のトレーサビリティとしては不整合。 | 次回以降、実装完了後にステップのチェックボックスを `[x]` に更新することを推奨（ブロッキングではない）。 | Resolved — build-and-test ステージで Steps 1-11 を全て `[x]` に更新済み（PR #8 CodeRabbit レビュー指摘、2026-09-11）。 |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| `bun test src/orchestration/engine-installer.test.ts src/commands/real-deps.test.ts` | 36 pass / 0 fail | このユニットに新規追加された全テスト（engine-installer +1, real-deps +7件+フィクスチャ更新）が green。issue #6 完了条件4（2種以上のharnessでの配置検証）と条件3（未知harnessの明示的失敗）を実際にカバーしていることを実行で確認。 |
| `bun test src/` | 173 pass / 0 fail（コード要約記載の「新規追加前167テスト」と整合） | 既存スイート全体が green のまま。scope floor（既存スイートを green に保つ）を満たす。 |
| `bunx tsc --noEmit -p tsconfig.json` | エラーなし | `EngineInstallerPorts.checkEngineDirectoryReplace` のシグネチャ変更、`pluginTargets` の型アサーション、`real-deps.ts`/`engine-installer.ts`/`lockfile.ts` の変更いずれも型エラーを持ち込んでいない。 |
| `git diff --stat`（対象5ファイル） | `src/commands/real-deps.ts` +67/-21、`real-deps.test.ts` +297、`engine-installer.ts` +6/-6、`engine-installer.test.ts` +15/-2、`lockfile.ts` +2/-2 | `source-manifest.json` に列挙された5ファイルと実差分が一致。範囲外の変更なし。`plugin-manager.ts`/`plugin-manager.test.ts` は無変更（`git diff --stat` 空）— 計画・要約の「触れていない」という主張どおり。 |

### 完了条件（issue #6）への到達確認

1. **5箇所の `.claude` ハードコード解消**: 確認済み。`checkEngineDirectoryReplace`（L225）、`placeEngine`（L229）、`checkWriteAllowed`（L278-280）、`removeProjection`（L300-301）、`placeProjection`（L329-330）、`regenerateSessionStartHook`（L350-351）の6箇所すべてが `resolveHarnessRoot`/`resolveConfiguredHarnessRoot` 経由になっている（issue記載の「5箇所」は `pluginManager` 側4クロージャを1グループとして数えた可能性が高く、実装は engine 側2 + plugin 側4 = 6コードパスを正しく網羅）。コメント文字列以外に `.claude` の残存ハードコードなし（`grep` で確認）。
2. **解決テーブルは `plugin-targets.json` を fleet 側で再定義しない**: 確認済み。静的 JSON import のみで、`real-deps.ts` は `harnessLeaf` 以外のマッピングを持たない。
3. **未知 harness の明示的失敗（`.claude` フォールバックなし）**: 確認済み。`resolveHarnessRoot` の存在チェックに加え、統合テストで `engineInstaller.install()`/`pluginManager.add()` 双方について「ドットディレクトリが一切作られない」ことまで検証している（R-02 で指摘した形状未検証のエッジケースを除く）。
4. **2種類以上のharnessを配置する統合テスト**: 確認済み。`claude`（既存フィクスチャ更新）と `cursor`（新規）の2harnessが実ファイルシステム経由で検証されている。

### Summary

実装は issue #6 の4つの完了条件をすべて満たしており、対象5ファイルの実差分は `source-manifest.json`/`code-summary.md` の記述と一致、全173テストと型チェックが green。`EngineInstallerPorts.checkEngineDirectoryReplace` へのharness追加は最小かつ正しく配線されており、`plugin-manager.ts` を触らない設計判断も project.md の Forbidden ルール（upstream ロジックの非再実装）に整合する。唯一の実質的な懸念（R-01）は `add()`/`remove()` 1回あたり最大3回の lockfile 再読み込みという性能・設計上の重複で、正しさを損なわないため Major ではあるが単独でブロッキングにはならない。R-02/R-03 は軽微な堅牢性・トレーサビリティの改善余地であり、人間承認の判断材料として報告する。
