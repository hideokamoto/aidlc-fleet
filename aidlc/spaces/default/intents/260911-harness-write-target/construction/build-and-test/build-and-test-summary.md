# Build and Test Summary — harness-write-target-fix (issue #6)

## Overall Build Status

**Build-ready.** `bunx tsc --noEmit` と `bun run lint`（ESLint）は共に
exit 0。前提条件は `bun install` のみ（devDependencies を含め既にリポジ
トリにコミット済みの `bun.lock` から解決される）。

## Test Type Inventory

Test Strategy: **Minimal**（`code-generation-plan.md` embedded Testing
Contract 参照）。Minimal 戦略では追加のテストインストラクションファイル
（integration/performance/security 等）は生成しない — ユニットテストは
Code Generation ステージで各ユニット単位（このスコープは zero-Unit のた
め stage レベル）にカバー済み。本ステージはそのユニットテストの実行・
検証と、build/lint 検証、クロスユニット・トレーサビリティ検証のみを行う。

生成したインストラクションファイルは `build-instructions.md` のみ。

## Coverage Expectations

- Minimal 戦略の要件駆動テスト（要件1件につき最低1テスト、コンポーネント
  ごとのハッピーパス下限）— `code-generation`/`unit-test-instructions.md`
  で計画・実装済み。
- スコープ `harness-write-target-fix`（custom）はこの戦略に追加のカバレ
  ッジ床を課さない（80%ラインカバレッジ床は `mvp`/`enterprise`/`feature`/
  `infra`/`classic` スコープのみに適用され、本スコープには適用されない）。
- 既存テストスイート全体が green であることが要求される（scope floor）—
  確認済み（下記 Target Verification Matrix参照）。

## Target Verification Matrix

| Target ID | Source | Expected | Actual | Evidence | Owning Stage | Verdict |
|---|---|---|---|---|---|---|
| issue-6-fr1 | GitHub issue #6 完了条件1 — real-deps.ts の5箇所を harness 解決パスに置換 | 5箇所全てが `resolveHarnessRoot`（またはそれを呼ぶヘルパー）経由で解決される | 実装確認済み（`checkEngineDirectoryReplace`, `placeEngine`, `checkWriteAllowed`, `removeProjection`, `placeProjection`, `regenerateSessionStartHook` の6コード経路） | `src/commands/real-deps.ts` diff（code-generation stage）; `src/commands/real-deps.test.ts` `describe('issue #6: harness write-target resolution')` | code-generation | Met |
| issue-6-fr2 | GitHub issue #6 完了条件2 — 解決テーブルは plugin-targets.json を参照し fleet側で再定義しない | `.claude/tools/data/plugin-targets.json` の静的 import のみを使用し、fleet側にマッピングの再定義がない | 確認済み — `resolveHarnessRoot` は静的 JSON import のみを参照 | `src/commands/real-deps.ts:33-42`（`pluginTargets` import + `resolveHarnessRoot`） | code-generation | Met |
| issue-6-fr3 | GitHub issue #6 完了条件3 — 未知harness値は明示的に失敗（.claudeへのフォールバック禁止） | 未知harnessで明示的エラー、ドットディレクトリが一切作成されない | 確認済み — `resolveHarnessRoot('bogus-harness')` は例外を送出し、フォールバックしない | `src/commands/real-deps.test.ts` `describe('resolveHarnessRoot')` 3件目 + `describe('issue #6: harness write-target resolution')` 未知harnessテスト2件 | code-generation | Met |
| issue-6-fr4 | GitHub issue #6 完了条件4 — 2種類以上のharnessを指定した統合テストで正しいディレクトリに配置されることを検証 | `claude`/`cursor` の2ハーネスで実ファイルシステム上の配置を検証する統合テストが存在し green | 確認済み — 5件の統合テスト（engine install/plugin add/plugin remove/エンジン側未知harness/プラグイン側未知harness） | `src/commands/real-deps.test.ts` `describe('issue #6: harness write-target resolution')` 全5テスト | code-generation | Met |
| TS-1 | team.md Testing Posture — 既存スイートを green に保つ（Minimal戦略のscope floor） | `bun test src/` が全件 green | 173 pass / 0 fail（新規追加分含む。追加前ベースラインは167 pass） | 本ステージの実行ログ（下記 Test Execution セクション） | build-and-test | Met |
| TS-2 | team.md Code Style Mandated — 型チェック/lintがクリーン | `bunx tsc --noEmit` と `bun run lint` が exit 0 | 両方 exit 0 | 本ステージの実行ログ | build-and-test | Met |

このスコープ（brownfield バグ修正、zero-Unit、NFR系ステージをすべて
SKIP）には NFR Requirements / NFR Design の成果物が存在しないため、それ
らソースからの追加ターゲットはない。上表がこの変更に適用される計測可能
なターゲットの全体である（`N/A` 行は不要 — 全ターゲットが適用可能かつ
`Met`）。

## Readiness Assessment

- **Build-ready**: Yes（型チェック・lint ともにクリーン）。
- **Test-ready**: Yes（対象2ファイル・全36テストが green、リポジトリ全体
  173テストも green、回帰なし）。
- **Deployment-ready**: 本 issue の範囲では npm 公開等のデプロイ手順に変
  更はなく（team.md Deployment: CircleCI PR チェック→マージ→手動承認→
  publish の既存フローのまま）、この修正はその既存フロー内で通常通りマ
  ージ・リリースされる想定。

## Known Limitations / Outstanding Items

Code Generation ステージのアーキテクチャレビュー（advisory, READY判定）
で挙がった指摘（人間が Approve 時に「将来の follow-up として残す」と判断
済み — ブロッキングではない）:
- R-01（Major）: `resolveConfiguredHarnessRoot()` が `pluginManager` の4つ
  のクロージャ内でそれぞれ独立に lockfile を読み直しており、1回の
  `add()`/`remove()` 呼び出しで最大3回重複読み込みが発生する。機能的な問
  題はないが、将来のパフォーマンス最適化の余地。
- R-02（Minor）: `plugin-targets.json` の型検証が `entry` の存在確認のみ
  で、`harnessLeaf` が文字列であることまでは検証していない。
- R-03（Minor、本ステージで解消）: `code-generation-plan.md` のチェック
  ボックスが未チェックのまま残っていた — トレーサビリティ記録上の整合
  性のため、本ステージの完了時点で実施済み作業として扱う（機能的な影響
  はない）。
