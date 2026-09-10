# Code Generation Plan — issue #5: plugin add tarball extraction

## Sources

- `aidlc/spaces/default/intents/260910-plugin-tarball-extract/inception/requirements-analysis/requirements.md`（FR1〜FR5, NFR1〜NFR4）
- コードベース: `src/commands/real-deps.ts`, `src/orchestration/plugin-manager.ts`, `src/core/file-ownership-guard.ts`

## Testing Contract

```json
{
  "version": 1,
  "methodology": "tdd",
  "source": "team",
  "ordering": "各テスト対象レイヤーについて、まず失敗するテストを書き、それ",
  "scope": "bugfix",
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
      "Include a targeted regression for the bug or vulnerability.",
      "Keep the existing test suite green."
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
  "input_sha256": "sha256:0b489fd2069454984f9a6cd6bfaf7224c75e8962a811de6758c8c69892eeeabe",
  "contract_sha256": "sha256:1cd543aafdb9dd30691a112168de58997cb5e945cf6118da9f586fb813415c08"
}
```

**このユニットに適用するレイヤー**: tar 展開は純粋なビジネスロジック（tar パース・パス検証・ラッパーディレクトリ除去）＋ファイルシステム I/O（展開先への書き込み）のみで構成される。Data model/API/Frontend レイヤーは本 bugfix には存在しないため適用外とする（契約の `plan_profile.steps` から該当ステップを省略し、メソドロジー自体は変更しない）。適用するのは「Business logic」（tar パース・パス検証）と「Repository / data access」（実ファイルシステムへの展開・配置）の2層。

## Implementation Steps

- [ ] **Step 1**: 既存テストランナーの確認と実行コマンドの記録（`bun test src/io/tar-extract.test.ts`, `bun test src/commands/real-deps.test.ts`）。`unit-test-instructions.md` に記載する。
- [ ] **Step 2**: [Business logic — Red] `src/io/tar-extract.test.ts` を新規作成し、以下の失敗するテストを書く（FR1.2, FR4.1 対応）:
  - `parseTar`: 単一ファイルエントリを持つ最小 tar バイト列を正しくパースする
  - `parseTar`: ディレクトリエントリを正しくパースする
  - `parseTar`: シンボリックリンクエントリ（typeflag `2`）を `type: 'symlink'` として検出する
  - パス検証: `../` を含むエントリを拒否する（`TarPathViolationError`）
  - パス検証: 絶対パスエントリを拒否する
  - パス検証: シンボリックリンク種別のエントリを拒否する
- [ ] **Step 3**: [Business logic — Green] `src/io/tar-extract.ts` に `parseTar`（POSIX ustar パーサー）、`TarPathViolationError`、`assertSafeEntry`（パス検証: `../` 脱出・絶対パス・シンボリックリンク種別を拒否）、`stripWrapperDirectory`（GitHub codeload の単一ラッパーディレクトリを1階層除去）を実装し、Step 2 のテストを通す（FR1.2, FR1.3, FR4.1）。
- [ ] **Step 4**: [Business logic — Refactor] 型・命名を整理。テストは green のまま。
- [ ] **Step 5**: [Repository/data access — Red] `src/io/tar-extract.test.ts` に `extractTarGz`（gzip解凍＋tar展開の統合エントリポイント）の実ファイルシステム統合テストを追加する（`mkdtemp` 使用、team.md Mandated — モックでは代替しない）:
  - 正常系: ラッパーディレクトリ付き gzip tar を展開し、期待するファイルツリーが実際に存在する（FR1.1〜FR1.4）
  - パストラバーサル: `../` エントリを含む tar を展開しようとすると拒否され、**展開先ディレクトリに部分ファイルが一切残っていない**こと（FR4.1, FR4.2、レビュー指摘 R-01 反映）
  - シンボリックリンクエントリを含む tar を展開しようとすると拒否され、部分ファイルが残っていないこと（FR4.1, FR4.2）
- [ ] **Step 6**: [Repository/data access — Green] `extractTarGz(gzipBytes, destDir)` を実装する: `node:zlib` の `gunzipSync` で解凍 → `parseTar` → `stripWrapperDirectory` → **全エントリのパス検証を先に完了してから**書き込みを開始する（2パス設計により、書き込み開始後に検証違反が見つかることがなく、FR4.2 の「失敗時に部分ファイルを残さない」を構造的に満たす）。Step 5 のテストを通す。
- [ ] **Step 7**: [Repository/data access — Refactor] エラーメッセージ・ディレクトリ作成処理を整理。テストは green のまま。
- [ ] **Step 8**: `src/commands/real-deps.ts` の `placeProjection` を書き換え、`extractTarGz` を呼び出すようにする（生バイト列の `.projection.tar` 書き込みを廃止）（FR1.1）。
- [ ] **Step 9**: `src/commands/real-deps.ts` の `pluginManager` ポート実装の `checkWriteAllowed` クロージャを修正し、`PluginManager.pluginDirLabel()` が返す論理名の前に `.claude/plugins/` を補完してから `FileOwnershipGuard.checkWriteAllowed()` へ渡すようにする（FR3.2）。
- [ ] **Step 10**: `src/orchestration/plugin-manager.ts` の `pluginDirLabel()` を「プラグイン論理名のみを返す」実装に変更する（FR3.1, FR3.3）。
- [ ] **Step 11**: [統合テスト更新] `src/commands/real-deps.test.ts` の既存テスト `pluginManager.add() drives placeProjection/regenerateSessionStartHook end-to-end` を更新し、実際の gzip 化 tar フィクスチャ（ラッパーディレクトリ付き）を使って展開後のファイルが実際に存在することを検証するよう書き換える（旧 `.projection.tar` 生書き込みアサーションを置き換え）。
- [ ] **Step 12**: [新規統合テスト] `src/commands/real-deps.test.ts` に以下を追加する（team.md Mandated 実ファイルシステム統合テスト、NFR4 対応）:
  - バージョン更新シナリオ: 異なる内容の tarball で `add()` を2回実行し、`removeProjection` が旧ファイルを完全に削除してから新ファイルが配置されることを実ファイルシステムで検証する（FR2.1, FR2.2）
  - パス整合性シナリオ: `.claude/plugins/<name>` を事前にシンボリックリンクとして作成した状態で `add()` を実行し、`FileOwnershipGuard` が実際の書き込み先に対してシンボリックリンク違反を検出して拒否することを検証する（FR3.2, FR3.3 — 修正前はこの検査が誤ったパスに対して行われていたため検出できなかった）
- [ ] **Step 13**: `bun test src/io/tar-extract.test.ts src/commands/real-deps.test.ts src/orchestration/plugin-manager.test.ts` を実行し、全テストが green であることを確認する。
- [ ] **Step 14**: `bun test --coverage src/` を実行し、`src/io/tar-extract.ts` と変更した `src/commands/real-deps.ts` / `src/orchestration/plugin-manager.ts` が 80% ライン・カバレッジ床（bunfig.toml）を満たすことを確認する。
- [ ] **Step 15**: ドキュメント/コメント整理（`real-deps.ts` の `placeProjection`/`removeProjection` 近傍コメントを、issue #5 修正後の実際の挙動に合わせて更新する）とトレーサビリティ（`traceability.json`）の作成。

## Story-to-Code Traceability

| Plan Step | Requirement ID |
|---|---|
| Step 2, 3, 6 | FR1.1, FR1.2, FR1.3, FR1.4 |
| Step 12 (バージョン更新シナリオ) | FR2.1, FR2.2 |
| Step 9, 10, 12（パス整合性シナリオ） | FR3.1, FR3.2, FR3.3 |
| Step 2, 3, 5, 6 | FR4.1, FR4.2 |
| Step 8〜15（変更範囲の限定） | FR5.1, FR5.2 |
| Step 6, 8 | NFR1, NFR2 |
| Step 2〜7 | NFR3 |
| Step 12 | NFR4 |

## Files to Create/Modify

- **新規**: `src/io/tar-extract.ts`
- **新規**: `src/io/tar-extract.test.ts`
- **変更**: `src/commands/real-deps.ts`（`placeProjection`, `pluginManager.checkWriteAllowed` クロージャ）
- **変更**: `src/commands/real-deps.test.ts`（既存テスト更新 + 新規統合テスト2件）
- **変更**: `src/orchestration/plugin-manager.ts`（`pluginDirLabel()`）

## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-09-10T13:54:34Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Minor | `src/io/tar-extract.ts` > `assertSafeEntry` / `extractTarGz` | typeflag `'1'`（hardlink）や未知の typeflag は `type: 'other'` に分類され、`assertSafeEntry` はこれを拒否しない（symlink・絶対パス・`../` のみ検査）。`extractTarGz` の第2パスでは `'other'` エントリを書き込みスキップしているため実害はないが、`assertSafeEntry` という「パス検証」関数の責務としては hardlink 種別を明示的に許可/拒否する意図がコード上に書かれておらず、将来 `'other'` の扱いが変わった際に検証漏れとなるリスクがある。GitHub codeload 由来の tarball では hardlink はほぼ出現しないため実運用上の緊急性は低い。 | `assertSafeEntry` のコメントに「`'other'`（hardlink 等）はスコープ外として書き込み自体をスキップするため経路検証不要」という設計意図を明記するか、`typeflagToType` で hardlink (`'1'`) を独立した種別として区別し、テストで hardlink エントリも安全にスキップされることを明示的に検証する。 | New |
| R-02 | Minor | `aidlc/.../code-generation-plan.md` Files to Create/Modify | ファイル一覧に `package.json` が明示的に「変更なし（ゼロ依存維持の確認対象）」として記載されていない。実際には `package.json` は変更されておらず（`dependencies` 追加なし、確認済み）、FR1.2/NFR1 の制約は満たされているが、プラン上に「変更しないことを確認した」という記述がないため、レビュー時に別途 `package.json` を読みに行かないと制約遵守が確認できない。 | 今後同種の「ゼロ依存維持」が要件にあるプランでは、Files to Create/Modify または実装判断セクションに「`package.json`: 変更なし（確認済み）」を明記する。 | New |

### Validation Tool Results

このステージ定義に紐づく自動検証ツールの指定はなし（手動でのソース照合・カバレッジ数値の突合を実施）。

| 確認項目 | 結果 | 解釈 |
|---|---|---|
| `package.json` に新規 `dependencies` なし | 確認済み（`devDependencies` のみ、`dependencies` フィールド自体が存在しない） | FR1.2/NFR1 の「ランタイム依存ゼロ」制約を満たす |
| `pluginDirLabel()` の全呼び出し箇所（3箇所） | `add()` に2箇所、`remove()` に1箇所、いずれも `checkWriteAllowed(this.pluginDirLabel(...))` の形で論理名を渡し、`real-deps.ts` 側で `.claude/plugins/` プレフィックスを補完 | FR3.1〜FR3.3 を一貫して満たす |
| `traceability.json` の全 FR/NFR → 実在ファイル | FR1.1〜FR5.2, NFR1〜NFR4 のすべてが `src/io/tar-extract.ts` / `src/commands/real-deps.ts` / `src/commands/real-deps.test.ts` / `src/orchestration/plugin-manager.ts` のいずれかを指し、全て実在を確認 | 破断リンクなし |
| `source-manifest.json` の5ファイル | 全て実在し、`git status` 上もこの5ファイルのみが変更/新規（構築フェーズ外の意図しない変更なし） | スコープ逸脱なし |
| 2パス設計（検証→書き込み） | `extractTarGz` は `for (const entry of entries) assertSafeEntry(entry)` を完全に終えてから第2の書き込みループへ進む実装になっており、途中で例外が起きても書き込みは一切始まっていない（構造的に部分書き込みが発生し得ない） | FR4.2・レビュー指摘R-01（requirements.md側）の「部分ファイルを残さない」要求を設計として妥当に満たす |
| 旧バグテストの書き換え | `real-deps.test.ts` の該当テストが `.projection.tar` の生バイト列アサーションから、実際の展開結果ディレクトリ検証（かつ `.projection.tar` が存在しないことの否定アサーション付き）へ書き換え済み | 旧バグを再現しない形に修正されている |
| team.md Mandated の実ファイルシステム統合テスト | バージョン更新シナリオ（`mkdtemp` + 2回 `add()` + `readdir` 検証）、symlink パス整合性シナリオ（`mkdtemp` + `symlink` + 拒否検証 + `readdir` で被害ゼロ確認）の両方が実在し、モックを使っていない | NFR4・team.md Mandated を満たす |

### Summary

2パス（全エントリ検証→書き込み）設計は実装と一致しており、tar-slip 対策（`../`、絶対パス、symlink 種別の拒否）も `node:path/posix` を用いた妥当な実装。`pluginDirLabel()`/`real-deps.ts` のパス合成修正は3呼び出し箇所すべてに一貫して適用され、`traceability.json` の全 ID が実在ファイルを指している。`package.json` にも新規 `dependencies` はなく、team.md が必須とする実ファイルシステム統合テスト（バージョン更新・symlink パス整合性）も実装済み。Minor 指摘2件（hardlink種別の検証意図の明文化不足、`package.json` 不変更の記録漏れ）はいずれも実害のない記録・コメント改善レベルであり、READY と判定する。
