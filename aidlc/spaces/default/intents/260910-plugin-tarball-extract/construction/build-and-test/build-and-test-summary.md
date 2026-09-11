# Build and Test Summary — issue #5: plugin add tarball extraction

## ビルド状況

**成功**（exit code 0）。`bun run build` で `dist/aidlc-fleet.js`（46.23 KB）を生成。新規モジュール `src/io/tar-extract.ts` の import 解決・バンドルに問題なし。

前提: `bun install`（`node_modules/` が未作成の状態だったため、このステージで初回実行し、`devDependencies`（eslint, typescript, @typescript-eslint/* 等）を導入した。`dependencies` フィールドは存在せず、今回のインストールでもランタイム依存は追加されていない）。

## テストタイプ一覧（生成した内容）

| テストタイプ | 生成有無 | 理由 |
|---|---|---|
| ユニット / 実ファイルシステム統合テスト | Code Generation で実装済み（本ステージでは新規生成なし） | Minimal test strategy のユニットテスト床は Code Generation の責務 |
| ビルド手順書（`build-instructions.md`） | 生成 | Step 2 必須 |
| 統合テスト手順書（`integration-test-instructions.md`） | **生成しない** | Minimal test strategy は追加のテスト手順ファイルを生成しない（stage-protocol §8）。クロスユニット境界も本 issue は zero-Unit のため対象なし |
| 性能テスト手順書（`performance-test-instructions.md`） | **生成しない** | NFR performance 要件なし（requirements.md に該当 NFR なし） |
| セキュリティテスト手順書（`security-test-instructions.md`） | 生成（判断による例外） | 本 issue はパストラバーサル対策を新規追加するセキュリティ関連の変更であり、stage-protocol の「Minimal な security-patch は security test instructions を要することがある」という例外に倣った |

## カバレッジ期待値

`bunfig.toml` の 80% ライン・カバレッジ床（プロジェクト全体、ファイル単位）。今回変更/新規のファイルはすべて床を上回る（下記 Target Verification Matrix参照）。

## Target Verification Matrix

| Target ID | Source | Expected | Actual | Evidence | Owning Stage | Verdict |
|---|---|---|---|---|---|---|
| FR1.1 | requirements.md FR1.1 | `placeProjection` が tarball を実際に展開する | 展開実装済み、生バイト書き込みを置換 | `src/commands/real-deps.ts` (placeProjection), `src/commands/real-deps.test.ts` extraction assertions | build-and-test | Met |
| FR1.2 | requirements.md FR1.2 | node:zlib + 自前 tar パーサー、ランタイム依存ゼロ維持 | 実装通り、`package.json` 変更なし（`dependencies` フィールド自体なし） | `src/io/tar-extract.ts`, `package.json`（目視確認） | build-and-test | Met |
| FR1.3 | requirements.md FR1.3 | ラッパーディレクトリを1階層除去して展開 | `stripWrapperDirectory` 実装、テストで検証 | `src/io/tar-extract.ts`, `src/io/tar-extract.test.ts` | build-and-test | Met |
| FR1.4 | requirements.md FR1.4 | compose.ts の `PLUGIN_ROOT` 解決レイアウトと一致 | アーキテクチャレビュー（Code Generation ゲート）で確認済み。FR1.3 と同一実装 | `src/io/tar-extract.ts`, code-generation-plan.md `## Review`（READY） | build-and-test | Met |
| FR2.1 | requirements.md FR2.1 | `removeProjection` が旧ファイルツリーを完全削除 | 既存実装（`rm(recursive:true, force:true)`）が要件を満たすことを実ファイルシステムテストで新規検証 | `src/commands/real-deps.test.ts`（バージョン更新シナリオ） | build-and-test | Met |
| FR2.2 | requirements.md FR2.2 | BR4.1 の既存順序（remove→place）を変更しない | コード変更なし、既存テストが継続 green | `src/orchestration/plugin-manager.test.ts`（BR4.1 テスト、既存） | build-and-test | Met |
| FR3.1 | requirements.md FR3.1 | `pluginDirLabel()` は論理名のみを返す | 実装済み | `src/orchestration/plugin-manager.ts` | build-and-test | Met |
| FR3.2 | requirements.md FR3.2 | `real-deps.ts` が `.claude/plugins/` プレフィックスを合成してから `FileOwnershipGuard` に渡す | 実装済み、symlink 検出が実際に機能することを新規統合テストで確認 | `src/commands/real-deps.ts`, `src/commands/real-deps.test.ts`（パス整合性シナリオ） | build-and-test | Met |
| FR3.3 | requirements.md FR3.3 | `add`/`remove` 両方の呼び出し経路に一貫適用 | 3箇所すべて確認済み（`grep -rn "pluginDirLabel("` によるコード監査、code-summary.md 記載） | `src/orchestration/plugin-manager.ts` | build-and-test | Met |
| FR4.1 | requirements.md FR4.1 | `../`・絶対パス・symlink エントリを拒否 | `assertSafeEntry` 実装、3種別それぞれテストで検証 | `src/io/tar-extract.ts`, `src/io/tar-extract.test.ts` | build-and-test | Met |
| FR4.2 | requirements.md FR4.2 | 拒否時 fail-fast、部分ファイルを残さない | 2パス設計により構造的に満たす。パストラバーサル/symlink 双方で `readdir` 空配列を検証 | `src/io/tar-extract.ts`, `src/io/tar-extract.test.ts`, `src/commands/real-deps.test.ts` | build-and-test | Met |
| FR5.1 | requirements.md FR5.1 | `PluginManager.add()/remove()` の呼び出しシーケンス不変 | コード変更なし。既存シーケンステストが継続 green | `src/orchestration/plugin-manager.test.ts`（既存） | build-and-test | Met |
| FR5.2 | requirements.md FR5.2 | `EngineInstaller.placeEngine` 変更なし | ファイル変更なし。既存テストが継続 green | `src/orchestration/engine-installer.test.ts`（既存、無変更） | build-and-test | Met |
| NFR1 | requirements.md NFR1 | node:zlib/node:fs のみに依存、外部コマンド不使用 | 実装確認済み（import 一覧に外部バイナリなし） | `src/io/tar-extract.ts` | build-and-test | Met |
| NFR2 | requirements.md NFR2 | 展開失敗は即例外送出、M8 exit-code 契約に従う | `bin/aidlc-fleet.ts` の `main().catch()` が未捕捉例外を exit code 1 にマッピングする既存機構を通じて成立。`tar-extract.test.ts` は例外送出そのものを検証 | `bin/aidlc-fleet.ts`（L128-137）, `src/io/tar-extract.test.ts` | build-and-test | Met |
| NFR3 | requirements.md NFR3 | `src/io/` に配置、ユニットテスト可能な設計 | `parseTar`/`assertSafeEntry`/`stripWrapperDirectory` は純粋関数として実装、モック不要でテスト済み | `src/io/tar-extract.ts`, `src/io/tar-extract.test.ts` | build-and-test | Met |
| NFR4 | requirements.md NFR4 | 実ファイルシステム統合テスト必須（正常系/バージョン更新/パストラバーサル/パス整合性） | 4シナリオすべて実装・green（`mkdtemp` 使用、モックなし） | `src/io/tar-extract.test.ts`, `src/commands/real-deps.test.ts` | build-and-test | Met |
| BUILD | build-and-test (この段) | `bun run build` が成功する | 成功、exit code 0 | 本ステージの実行ログ（上記） | build-and-test | Met |
| LINT | build-and-test (この段) | `bun run lint` が警告・エラーなしで完了する | 成功、出力なし | 本ステージの実行ログ | build-and-test | Met |
| TYPECHECK | build-and-test (この段) | `tsc --noEmit` がエラーなしで完了する | 成功、出力なし | 本ステージの実行ログ | build-and-test | Met |
| COVERAGE-80 | bunfig.toml (`coverageThreshold.lines=0.8`) | 変更/新規ファイルすべてがファイル単位で行カバレッジ80%以上 | `tar-extract.ts` 98.96%, `real-deps.ts` 99.45%, `plugin-manager.ts` 100% | 本ステージの `bun test --coverage src/` 実行ログ | build-and-test | Met |

## 準備状況評価

- **build-ready**: Yes（ビルド成功、lint/typecheck エラーなし）
- **test-ready**: Yes（163 テスト全 pass、対象3ファイルすべて 80% カバレッジ床を上回る）
- **deployment-ready**: このステージの範囲では該当なし（本 bugfix intent は `deployment-pipeline`/`deployment-execution` を EXECUTE 対象とするが、その判断は当該ステージの責務）

## 既知の制約・持ち越し事項

- レビュー指摘 R-03（requirements-analysis, Minor）: tarball サイズ/メモリ上限の明示的な境界宣言が requirements.md の Out of Scope に未記載。本 issue の機能には影響しないが、将来の要件更新時に検討する。
- レビュー指摘（code-generation, Minor 2件）: hardlink エントリ種別の設計意図明文化不足、`package.json` 不変更のプラン上明記漏れ。いずれも実害なし、コードの動作には影響しない。
