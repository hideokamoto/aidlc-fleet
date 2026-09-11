# Unit Test Instructions — issue #5: plugin add tarball extraction

## Test Framework

`bun:test`（既存テストと同一。`bunfig.toml` が `coverageThreshold = { lines: 0.8, functions: 0.0 }` を設定済み）。追加の設定ファイルは不要。

## How to Run THIS Change's Tests

テストランナーが実行可能であることを最初に確認する（Red の前に必須）:

```bash
bun test src/io/tar-extract.test.ts
```

（tar-extract.test.ts 作成前はファイル不在で失敗するのが正しい Red 状態。ランナー自体の疎通確認は `bun test src/commands/real-deps.test.ts` の既存テストが green で通ることで代える。）

このユニット（issue #5 修正）に対して実行すべき厳密スコープコマンド（プロジェクト全体の `bun test` ではない）:

```bash
bun test src/io/tar-extract.test.ts src/commands/real-deps.test.ts src/orchestration/plugin-manager.test.ts
```

カバレッジ確認（Build and Test 段階でも再実行される）:

```bash
bun test --coverage src/io/tar-extract.test.ts src/commands/real-deps.test.ts src/orchestration/plugin-manager.test.ts
```

## Expected Coverage Targets

- `src/io/tar-extract.ts`: 80% 行カバレッジ以上（bunfig.toml の床）。
- `src/commands/real-deps.ts`（変更箇所 `placeProjection` / `checkWriteAllowed` クロージャ）: 既存カバレッジを落とさず、新規パスをテストで踏む。
- `src/orchestration/plugin-manager.ts`（変更箇所 `pluginDirLabel()`）: 既存 `plugin-manager.test.ts` がポート呼び出しを通じて引き続きカバーする。

## Test Volume (Minimal strategy + bugfix scope floor)

- Minimal: 要件駆動のユニットテスト（要件1件につき1テスト以上）+ コンポーネントごとのハッピーパス床。
- bugfix scope floor: バグ／脆弱性に対する的を絞った回帰テストを、再現に必要な最も狭いレベルで追加する（今回は tar-slip / パストラバーサル防止のための実ファイルシステム統合テストがこれに該当）。
- 合計目安: 9〜12件程度（`tar-extract.test.ts` に6〜7件のユニットテスト＋2〜3件の実ファイルシステム統合テスト、`real-deps.test.ts` に既存1件の更新＋2件の新規実ファイルシステム統合テスト）。

## Mocking / Stubbing Guidance

- `src/io/tar-extract.ts` の `parseTar` / `assertSafeEntry` / `stripWrapperDirectory` はファイル I/O を持たない純粋関数として実装し、モック不要でユニットテストする（テストコード内でバイト列を手組みして tar ヘッダーを構築する）。
- `extractTarGz`（gzip 解凍＋実ファイルシステムへの書き込みを含む）は team.md Mandated 規約により **モックで代替せず、`node:fs/promises` の `mkdtemp` を用いた実ファイルシステム統合テスト**で検証する。既存の `file-ownership-guard.test.ts` / `real-deps.test.ts` の `mkdtemp` パターンに倣う。
- `real-deps.test.ts` の新規統合テストも同様に実ファイルシステム（`mkdtemp`）を使用し、`child_process.spawn`（compose/doctor 呼び出し）と `fetch`（tarball 取得）のみを既存パターン通りモックする。

## Test Data Management

- gzip 化 tar フィクスチャは、テストコード内で `node:zlib` の `gzipSync` と本 PR で実装する `parseTar` の逆処理（手組みの ustar ヘッダー生成ヘルパー）を使って動的に生成する。バイナリフィクスチャファイルは追加しない（既存プロジェクトに `__fixtures__/*.json` はあるが tar バイナリの類はなく、動的生成の方がテストの意図が読みやすいため）。
- 各テスト後は `rm(root, { recursive: true, force: true })` で一時ディレクトリを確実に削除する（既存 `file-ownership-guard.test.ts` / `real-deps.test.ts` と同じ `try/finally` パターン）。
