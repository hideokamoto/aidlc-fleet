# コード品質評価

## テストカバレッジ

- 専用の `test/`／`__tests__/` ディレクトリはなく、各実装ファイルに
  対応する `*.test.ts` が同一ディレクトリに co-locate（例:
  `src/commands/real-deps.ts` ↔ `src/commands/real-deps.test.ts`）。
  フィクスチャは `src/commands/__fixtures__/test-deps.ts`、
  `src/types/__fixtures__/*.json`。
- テストフレームワーク: `bun test`（`bun:test` 組み込みランナー、
  `describe`/`test`/`expect` API）。
- カバレッジ設定: `bunfig.toml` の
  `[test].coverageThreshold = { lines = 0.8, functions = 0.0 }`
  （team.md Testing Posture の 80% ラインカバレッジ床を CI 上で強制する
  明示設定。`functions = 0.0` は bun 1.3.11 の既知の挙動への確認済み
  回避策としてコメントで明記）。
- テスト総数: `test(` 呼び出しが `src/` 全体で約 147 箇所（issue 記載の
  「約146」とほぼ一致。文字列カウントであり厳密値ではないが大枠は整合）。
- 実ファイルシステムに触れる統合テスト: `src/commands/real-deps.test.ts`、
  `src/core/file-ownership-guard.test.ts`、`src/io/lockfile-store.test.ts`
  の 3 ファイルが `node:fs/promises` の `mkdtemp` + `node:os` の
  `tmpdir` を使い、実際の書き込み・読み込みを行う統合テストを含む
  （team.md Mandated の M4 統合テスト要件に対応）。ただしこれらは
  `FileOwnershipGuard`／`LockfileStore`／`real-deps.ts` の配線ロジック
  の検証であり、`PluginManager.add`/`.remove` 自体の単体テスト
  （`src/orchestration/plugin-manager.test.ts`）はすべてモックポート
  経由で実ファイルシステムに一切触れていない。
- `real-deps.test.ts` に `placeProjection`/`removeProjection` の実装
  そのもの（`.claude/plugins/<name>/.projection.tar` への生バイト
  書き込み）を検証するテストケースの有無は developer scan では確認
  できていない — tarball を実際に展開してファイルツリーを検証する
  テストは存在しない（`grep -rn "untar|extract"` が `src/` 内でヒット
  なしと整合）。

## リンティング・フォーマット

- ESLint flat config（`eslint.config.js`）、`@typescript-eslint/recommended`
  ベース、CircleCI `lint` ジョブ（`bun run lint`）でマージ前に強制。
- Prettier（`.prettierrc`）でフォーマット統一。
- `tsconfig.json` は `strict: true` を採用（team.md Code Style の
  明示要件）。

## CI/CD

- `.circleci/config.yml`（CircleCI, `version: 2.1`）— `lint` →
  `typecheck`（`tsc --noEmit`） → `test`（`bun test src/` +
  `bun test --coverage src/`） → `build`（`bun build`） →
  `secret-scan`（gitleaks, pinned v8.18.4） →
  `dependency-scan`（`bun audit`, advisory `|| true`） →
  `publish-approval-gate`（手動承認ジョブ） → `publish`。
- team.md Deployment セクション（CircleCI ベース、PR ごとの
  lint+typecheck+test、`main` マージ後の手動承認ゲート）と一致。

## ドキュメンテーション

- `README.md`（2.3KB、簡潔な概要）、`AGENTS.md`（19KB、詳細な運用
  ガイド）。
- 各モジュール冒頭に構造化された JSDoc スタイルのコメント（担当
  コンポーネント名・関連ドキュメント名・設計根拠を明記する記法が
  一貫）。
- コード内コメントの質は高く、「なぜその実装選択をしたか」（例:
  `buildTarballUrl` のバグ修正経緯、`functions = 0.0` の理由）が
  随所に記録されている。

## 技術的負債（issue #5 に直結）

### 1. `placeProjection` が tarball を展開しない（`real-deps.ts` 245–249行目）

プラグイン tarball のバイト列を展開せず、
`.claude/plugins/<name>/.projection.tar` へ生のまま書き込んでいる。
`PluginManager.add()`（`plugin-manager.ts` 66–112行目）はこれを
「配置完了」として扱い、以降 `runCompose`（upstream の compose フック）
を実行するが、compose フックが読むべきプラグインのファイルツリーが
存在しないため、upstream の compose 処理は実質的に空振りする可能性が
高い。**issue #5 の core bug。**

### 2. `removeProjection` の対称性の限界（`real-deps.ts` 239–244行目）

削除対象は `.claude/plugins/<name>` ディレクトリ全体を `rm -rf` する
のみ。`placeProjection` が単一 `.projection.tar` ファイルしか書いて
いない現状ではこの実装でも動作するが、`placeProjection` を展開実装に
直した場合に生成される多階層ファイルツリーを正しく削除できるかは、
展開実装と対で見直す必要がある（BR4.1 のバージョン混在防止の観点）。

### 3. `pluginDirLabel()` と実書き込み先の不一致（`plugin-manager.ts` 150–152行目）

`pluginDirLabel()` は `` `plugins/${pluginName}` `` を返すが、実際の
書き込み先（`real-deps.ts` の `checkWriteAllowed`/`placeProjection`/
`removeProjection` 呼び出し）は一貫して
`join(config.projectRoot, '.claude', 'plugins', name)`。`add()`/
`remove()` は `checkWriteAllowed(this.pluginDirLabel(pluginName))` と
いう相対パスラベルを `FileOwnershipGuard.checkWriteAllowed` に渡して
おり、`real-deps.ts` 側の `checkWriteAllowed` ラッパー（227–231行目）
が `join(config.projectRoot, targetPath, ...)` で絶対化する。結果、
`FileOwnershipGuard` が実際に検査する対象パスは
`<projectRoot>/plugins/<name>` であり、真の書き込み先
`<projectRoot>/.claude/plugins/<name>` とは異なるディレクトリになって
いる。`FileOwnershipGuard.assertNoSymlinkInPath`（`file-ownership-guard.ts`
134–158行目）は指定パスの祖先ディレクトリ鎖を辿ってシンボリックリンク
を検査するため、`.claude/plugins/<name>` が実際にシンボリックリンクを
含んでいても `plugins/<name>` という別パスを検査している限り検出
されない — **M4（ファイル所有権 invariant, v0.1 §7）の「いかなる状況
でもシンボリックリンクへの書き込みを許可しない」という project.md
Forbidden 規約に対するギャップ**。ただし `isUnderAidlcWorkspace`
判定（`aidlc/` 配下保護）は `.claude/` パスとは無関係のため、この経路
のチェックには影響しない。

`plugin-manager.test.ts` の `PluginManagerPorts` モックは、渡された
パス文字列をそのまま記録・比較するだけで実際の `.claude/plugins/`
ディレクトリ構造とは突き合わせないため、上記のパス不一致は単体テスト
からは検出できない。

### 4. エンジン側との非対称性（`real-deps.ts` 190–197行目, `EngineInstaller.placeEngine`）

エンジン側は「実際の tarball 展開/install.ts ラップは upstream の仕事」
という明示コメントがあり、生バイトのステージング書き込みが設計上の
意図であることが分かる。一方プラグイン側の `placeProjection`/
`removeProjection` にはこの種の注記が一切なく、実装者がプラグインに
ついても同じ「upstream が展開する」前提を踏襲したのか、単に見落とした
のかが記録から判別できない。この非対称なコメント密度自体が技術的負債の
シグナルであり、今回のバグの由来を示唆している。

## 品質面での強み

- 3 層分離（コマンド/コアロジック/I/O）が一貫しており、最もリスクの
  高いロジック（M2/M3/M4）をディスクに触れずに単体テストできる設計。
- fail-fast なエラーハンドリング方針（M4 違反即座に throw）がコード
  全体で一貫。
- exit code 契約（M8）が全コマンドで統一的にマッピングされている。
- 実ファイルシステム統合テストの前例（`mkdtemp` パターン）が既に
  複数箇所に存在し、issue #5 の修正で必要になる新規統合テストの
  ひな形として再利用できる。
