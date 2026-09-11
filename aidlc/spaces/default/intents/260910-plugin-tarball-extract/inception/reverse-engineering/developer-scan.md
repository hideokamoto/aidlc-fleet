## Developer Code Scan Results

### Scan Coverage
- **Analyzed deeply**: ./
  - `package.json`, `tsconfig.json`, `bunfig.toml`, `eslint.config.js`, `.prettierrc`
  - `.circleci/config.yml`
  - `bin/aidlc-fleet.ts`
  - `src/commands/` 全ファイル（`real-deps.ts`/`real-deps.test.ts` は特に精読、他の `*.ts`/`*.test.ts` も一読）
  - `src/orchestration/plugin-manager.ts` / `plugin-manager.test.ts` / `engine-installer.ts` / `engine-installer.test.ts`
  - `src/core/file-ownership-guard.ts` / `file-ownership-guard.test.ts` / `version-gate.ts` / `success-verifier.ts` / `drift-detector.ts` / `exit-code.ts`（各 `.test.ts` 含む）
  - `src/io/channel-client.ts` / `integrity.ts` / `lockfile-store.ts`（各 `.test.ts` 含む）
  - `src/types/channel.ts` / `lockfile.ts` / `errors.ts`（各 `.test.ts` 含む）
  - `src/commands/__fixtures__/test-deps.ts`、`src/types/__fixtures__/*.json`
- **Skimmed only**: なし（リポジトリ全体をディレクトリ粒度以上で精読済み。`aidlc/` ワークスペース配下・`.claude/`・`.cursor/` はスキャン対象外 — project.md の Forbidden「`aidlc/` ワークスペース状態を読み書きしない」に基づき、コード資産としてではなくフレームワークの管理領域として除外した）

### Packages Found
- `aidlc-fleet-cli` — CLI（npm package, private） — TypeScript（bun runtime, ESM） — `aidlc-fleet.ts` を単一 bin エントリとして公開する配布 CLI。中央の channel ファイルにエンジンバージョンとプラグイン集合を宣言し、`init`/`update`/`check`/`plugin add|remove`/`pin`/`unpin`/`status`/`doctor` の 7 系統のサブコマンド（実装は `init`/`update`/`check`/`plugin add`/`plugin remove`/`pin`/`unpin`/`status`/`doctor` の 9 コマンド関数）でプロジェクトを同期させる。ランタイム依存ゼロ（`package.json` に `dependencies` フィールドなし、`devDependencies` のみ）。

### Build System
- **Type**: bun（ビルド・テスト・型検査すべて bun ツールチェーン経由）
- **Config Files**: `package.json`（scripts: `test`, `test:coverage`, `build`, `lint`, `format`）、`tsconfig.json`（`strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `module: ESNext` / `moduleResolution: bundler`, `noEmit: true`）、`bunfig.toml`（`[test].coverageThreshold = { lines = 0.8, functions = 0.0 }` — team.md の 80% ラインカバレッジ床を CI で強制するための明示的な bun 側設定）、`eslint.config.js`（flat config, `@typescript-eslint` recommended + `no-unused-vars` warn + `explicit-module-boundary-types` off）、`.prettierrc`（semi/singleQuote/trailingComma=all/printWidth=100/tabWidth=2）
- **Build Dependencies**（内部パッケージ間の依存関係、`components.md` の層構成に対応）:
  - `bin/aidlc-fleet.ts` → `src/commands/*`（各コマンド関数） + `src/commands/real-deps.ts`（`buildRealDeps`） + `src/commands/argv.ts`
  - `src/commands/real-deps.ts`（統合グルー層） → `src/io/channel-client.ts`, `src/io/lockfile-store.ts`, `src/core/version-gate.ts`, `src/core/success-verifier.ts`, `src/core/drift-detector.ts`, `src/core/file-ownership-guard.ts`, `src/orchestration/engine-installer.ts`, `src/orchestration/plugin-manager.ts`
  - `src/orchestration/plugin-manager.ts` → `src/core/success-verifier.ts`（`SuccessVerifier`）、`src/types/channel.ts`/`src/types/lockfile.ts`（型のみ）。ファイル I/O・ネットワーク I/O は一切直接行わず、`PluginManagerPorts` インターフェース経由で `real-deps.ts` から注入される（`fetchPluginTarball`/`checkWriteAllowed`/`placeProjection`/`removeProjection`/`runCompose`/`regenerateSessionStartHook`/`doctorFailures`）
  - `src/core/file-ownership-guard.ts` → 実ファイルシステム I/O（`node:fs/promises`）に直接依存する唯一のコアロジック層コンポーネント（コメントで明示: 「no I/O」というコア層の原則は `VersionGate`/`SuccessVerifier`/`DriftDetector` を指し、本コンポーネントは対象外）
  - `src/io/channel-client.ts` → `src/io/integrity.ts`（`verifySha256`）, `src/types/channel.ts`（`parseChannel`）。唯一のネットワーク I/O 所有者
  - team.md「レイヤー分離」規約どおり、コマンド層（`src/commands/*.ts`、引数パースと exit code 決定のみ）／コアロジック層（`src/core/*.ts`）／ファイルシステム I/O・ネットワーク I/O 層（`src/io/*.ts`, `src/orchestration/*.ts` の一部）に分離されている

### APIs Discovered
- CLI コマンド API — `bin/aidlc-fleet.ts`（argv ルーティング） — 9 コマンド（`init`, `update`, `check`, `plugin add`, `plugin remove`, `pin`, `unpin`, `status`, `doctor`）、いずれも exit code 0–4 の契約（M8, `src/core/exit-code.ts`）を返す
- 内部ポートインターフェース（外部 API ではなく、テスト時のモック境界を兼ねる内部契約）:
  - `PluginManagerPorts`（`src/orchestration/plugin-manager.ts`）— 7 メソッド。**本 issue の核心**: `placeProjection(pluginName, bytes): Promise<void>` は「tarball を展開してディレクトリツリーとして配置する」契約を型注釈上は示唆しない生の `Uint8Array` 受け渡し口であり、実装（`real-deps.ts`）はそれを未展開のまま書き込んでいる
  - `EngineInstaller` のポート群（`checkEngineDirectoryReplace`/`placeEngine`/`runCompose`/`doctorFailures`/`loadLockfile`/`saveLockfile`/`fetchEngineTarball`）— `placeEngine` も同様に生バイトを `.engine-${harness}.tar` としてステージング書き込みするのみで、展開はしない（ただしこちらはコメントで「実際の tarball 展開/install.ts ラップはアップストリームの仕事」と明記されており、後続の compose 呼び出し（アップストリーム側）が処理する設計として一貫している。対して `placeProjection`/`removeProjection` にはこの注記がなく、非対称になっている）
  - `CommandDeps`（`src/commands/types.ts`）— 全コマンドが受け取る依存性注入コンテナ
- 外部 API 呼び出し — `ChannelClient.fetchChannel(url)` / `ChannelClient.fetchTarball(url, sha256)`（`src/io/channel-client.ts`）— channel 宣言および engine/plugin tarball の HTTP フェッチ。`buildTarballUrl`（`real-deps.ts`）は GitHub の codeload アーカイブ規約（`https://codeload.github.com/${repo}/tar.gz/${ref}`）で URL を構築する

### Frameworks & Libraries
- TypeScript — `^5.5.0`（devDependency） — 静的型付け、`strict: true`
- bun — `>=1.1.0`（`engines` フィールド、`@types/bun ^1.1.0`） — ランタイム／テストランナー／バンドラー（`bun build`）
- ESLint — `^8.57.0` + `@typescript-eslint/eslint-plugin`/`parser` `^7.0.0` — リンティング
- Prettier — `^3.3.0` — フォーマッタ
- ランタイム依存は **ゼロ**（`dependencies` フィールド自体が `package.json` に存在しない）。tarball 展開・gzip 解凍・アーカイブ処理を行うライブラリ（例: `tar`, `tar-stream`, `zlib` ラッパー等）は依存関係にも `bun.lock` にも存在しない — Node.js 組み込み `node:zlib`/手書き tar パーサーのいずれも `src/` 内に実装が見当たらない

### Test Coverage
- **Test Directories**: 専用の `test/`／`__tests__/` ディレクトリはなく、各実装ファイルに対応する `*.test.ts` が同一ディレクトリに co-locate（例: `src/commands/real-deps.ts` ↔ `src/commands/real-deps.test.ts`）。フィクスチャは `src/commands/__fixtures__/test-deps.ts`、`src/types/__fixtures__/*.json`
- **Test Frameworks**: `bun test`（`bun:test` 組み込みランナー、`describe`/`test`/`expect` API）
- **Coverage Config**: 存在する — `bunfig.toml` の `[test].coverageThreshold = { lines = 0.8, functions = 0.0 }`（team.md Testing Posture の 80% ラインカバレッジ床を CI 上で強制する明示設定。`functions = 0.0` は「省略すると bun 1.3.11 で常に非ゼロ終了する」という確認済みの回避策としてコメントで明記）
- **テスト総数**: `test(` 呼び出しが `src/` 全体で **147 箇所**（issue 記載の「約146」とほぼ一致。`grep -c "test("` は文字列カウントであり、`describe` 内のネストや文字列リテラル一致を含み得るため厳密値ではないが、大枠は issue の主張と整合）
- **実ファイルシステムに触れるテスト**: `src/commands/real-deps.test.ts`、`src/core/file-ownership-guard.test.ts`、`src/io/lockfile-store.test.ts` の 3 ファイルが `node:fs/promises` の `mkdtemp` + `node:os` の `tmpdir` を使い、一時ディレクトリに対する実際の書き込み・読み込みを行う統合テストを含む（team.md Mandated の M4 統合テスト要件に対応）。ただし **これらは `FileOwnershipGuard`／`LockfileStore`／`real-deps.ts` の配線ロジック（`buildRealDeps` が生成する I/O クロージャ、`runComposeCommand`/`runDoctorCommand` のプロセス起動、`readInstalledState`/`writeInstalledState` 等）を検証するものであり、`PluginManager.add`/`.remove` 自体の単体テスト（`src/orchestration/plugin-manager.test.ts`）はすべてモックポート（`PluginManagerPorts` を満たす fake オブジェクト）経由 — 実ファイルシステムに一切触れていないことを確認した。issue の「既存テストは全てポート注入によるユニットテストで、実ファイルシステムに触れるものはない」という記述は `plugin-manager.test.ts` に限れば正確**
- `real-deps.test.ts` に `mkdtemp` を使う統合テストはあるが、`placeProjection`/`removeProjection` の実装そのもの（`.claude/plugins/<name>/.projection.tar` への生バイト書き込み）を検証するテストケースの有無は確認できず（tarball を実際に展開してファイルツリーを検証するテストは存在しない — `grep -rn "untar|extract"` が `src/` 内でヒットしないことと整合）

### Code Quality Indicators
- **Linting**: ESLint flat config（`eslint.config.js`）、`@typescript-eslint/recommended` ベース、CircleCI `lint` ジョブ（`bun run lint`）でマージ前に強制
- **CI/CD**: `.circleci/config.yml`（CircleCI, `version: 2.1`）— `lint` → `typecheck`（`tsc --noEmit`） → `test`（`bun test src/` + `bun test --coverage src/`） → `build`（`bun build`） → `secret-scan`（gitleaks, pinned v8.18.4） → `dependency-scan`（`bun audit`, advisory `|| true`） → `publish-approval-gate`（手動承認ジョブ） → `publish`。team.md Deployment セクション（CircleCI ベース、PR ごとの lint+typecheck+test、`main` マージ後の手動承認ゲート）と一致
- **Documentation**: `README.md`（2.3KB、簡潔な概要）、`AGENTS.md`（19KB、詳細な運用ガイド）、各モジュール冒頭に構造化された JSDoc スタイルのコメント（担当コンポーネント名・関連ドキュメント名・設計根拠を明記する記法が一貫）。コード内コメントの質は高く、"なぜその実装選択をしたか"（例: `buildTarballUrl` のバグ修正経緯、`functions = 0.0` の理由）が随所に記録されている

### Technical Debt Signals
- **`src/commands/real-deps.ts` 245–249行目（`placeProjection`）**: プラグイン tarball のバイト列を展開せず、`.claude/plugins/<name>/.projection.tar` へ生のまま書き込んでいる。`PluginManager`（呼び出し元、`src/orchestration/plugin-manager.ts` 66–112行目の `add()`）はこれを「配置完了」として扱い、以降 `runCompose`（アップストリームの compose フック）を実行するが、compose フックが読むべきプラグインのファイルツリーは存在しないため、アップストリームの compose 処理は実質的に空振りする可能性が高い（issue #5 の core bug）
- **`src/commands/real-deps.ts` 239–244行目（`removeProjection`）**: 対称的に、削除対象も `.claude/plugins/<name>` ディレクトリ全体を `rm -rf` するのみ。`placeProjection` が単一 `.projection.tar` ファイルしか書いていない現状ではこの実装でも動作はするが、`placeProjection` を展開実装に直した場合に生成されるであろう多階層ファイルツリーを正しく削除できるかどうかは、展開実装と対で見直す必要がある
- **`src/orchestration/plugin-manager.ts` 150–152行目（`pluginDirLabel`）**: `` `plugins/${pluginName}` `` を返すが、実際の書き込み先（`real-deps.ts` の `checkWriteAllowed`/`placeProjection`/`removeProjection` 呼び出し）は一貫して `join(config.projectRoot, '.claude', 'plugins', name)`。`add()`/`remove()` は `checkWriteAllowed(this.pluginDirLabel(pluginName))` という**相対パスラベル**を `FileOwnershipGuard.checkWriteAllowed` に渡しており、`real-deps.ts` 側の `checkWriteAllowed` ラッパー（227–231行目）が `join(config.projectRoot, targetPath, ...)` で絶対化している。この結果、`FileOwnershipGuard` が実際にシンボリックリンクチェック等を行う対象パスは `<projectRoot>/plugins/<name>` であり、真の書き込み先 `<projectRoot>/.claude/plugins/<name>` とは異なるディレクトリになっている。`FileOwnershipGuard.assertNoSymlinkInPath`（`src/core/file-ownership-guard.ts` 134–158行目）は指定パスの祖先ディレクトリ鎖を辿ってシンボリックリンクを検査するため、`.claude/plugins/<name>` が実際にシンボリックリンクを含んでいても `plugins/<name>` という別パスを検査している限り検出されない — M4（ファイル所有権 invariant, v0.1 §7）の「いかなる状況でもシンボリックリンクへの書き込みを許可しない」という project.md Forbidden 規約に対するギャップ。ただし `isUnderAidlcWorkspace` 判定（`aidlc/` 配下保護）は `.claude/` パスとは無関係のため、この経路のチェックには影響しない
- **`src/orchestration/plugin-manager.test.ts`**: `PluginManagerPorts` はモックのため、上記のパス不一致は単体テストからは検出できない（`checkWriteAllowed` の引数がモック内でそのまま記録・比較されるだけで、実際の `.claude/plugins/` ディレクトリ構造とは突き合わせない）。`real-deps.test.ts` の統合テストが `mkdtemp` で実ファイルシステムを使うものの、`buildRealDeps` が組み立てた `pluginManager` の `add()`/`remove()` を通しで実行し `.claude/plugins/` 配下の実ファイルを検証するケースがあるかどうかは要確認（本スキャンでは該当テストケースの有無までは断定していない — architect/quality 側での追加確認を推奨）
- **`src/commands/real-deps.ts` 190–197行目（`EngineInstaller.placeEngine`）との非対称性**: エンジン側は「実際の tarball 展開/install.ts ラップはアップストリームの仕事」という明示コメントがあり、生バイトのステージング書き込みが設計上の意図であることが分かる。一方プラグイン側の `placeProjection`/`removeProjection` にはこの種の注記が一切なく、実装者がプラグインについても同じ「アップストリームが展開する」前提を踏襲したのか、単に見落としたのかが記録から判別できない — この非対称なコメント密度自体が技術的負債のシグナル（今回のバグの由来を示唆する）

## Handoff Summary
- **Intent-relevant finding**: issue #5 の2つの主張はいずれもコードで確認された。(1) `src/commands/real-deps.ts:245-249` の `placeProjection` はプラグイン tarball のバイト列を展開せず `.claude/plugins/<name>/.projection.tar` に生保存するのみで、`src/` 全体を通じて tarball 展開ロジック（`untar`/`extract`/`gunzip`/`zlib` 等）は一切存在しない（`grep -rn "untar|extract"` は `src/` 内で実装ヒットなし、コメント中の1件のみ）。(2) `src/orchestration/plugin-manager.ts:150-152` の `pluginDirLabel()` は `` `plugins/${name}` `` を返すが、`real-deps.ts` の実際の書き込み・削除先は `.claude/plugins/<name>`（227-231行目, 239-249行目）であり、`FileOwnershipGuard.checkWriteAllowed`（`add()`/`remove()` 内で `pluginDirLabel()` の戻り値を渡して呼ばれる）は誤ったパスに対してシンボリックリンクチェック等の M4 invariant を実行している。
- **Risks / follow-up**:
  1. `placeProjection`/`removeProjection` の修正は tarball 展開ライブラリ（現状ランタイム依存ゼロ）の追加を要する可能性が高く、team.md/project.md の「ゼロランタイム依存」方針（NFR6.6, tech-stack-decisions.md 参照 — 本スキャンでは未読だが `.circleci/config.yml` のコメントで言及あり）と衝突しないか、次段階（architect/quality）で確認が必要。Node.js 組み込み `node:zlib`（gunzip）と手書き tar パーサー、または devDependency 限定でバンドルする選択肢がある。
  2. `pluginDirLabel()` の修正（`.claude/plugins/${name}` への統一）は `FileOwnershipGuard` が実際に正しいディレクトリを検査するようになる一方、`plugin-manager.test.ts` のモック前提（渡されるパス文字列のアサーション）を更新する必要がある。
  3. `EngineInstaller.placeEngine`（`.claude` 直下への `.engine-${harness}.tar` ステージング）は本 issue のスコープ外だが、同じ「生バイト書き込み」パターンを踏襲しているコンポーネントとして、修正時の設計判断（展開責務をどのレイヤーが持つか）の参考になる。
  4. `real-deps.test.ts`/`file-ownership-guard.test.ts` に実ファイルシステム統合テストの前例（`mkdtemp` パターン）があり、team.md Mandated の M4 統合テスト要件を満たす新規テストはこのパターンを踏襲できる。
