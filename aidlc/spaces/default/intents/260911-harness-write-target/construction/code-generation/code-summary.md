# Code Generation Summary — harness-write-target-fix (issue #6)

## 作成/変更したファイル

- `src/commands/real-deps.ts`（変更）— 新規エクスポート関数
  `resolveHarnessRoot(harness: string): string` を追加し、5箇所の
  ハードコードされた `.claude` を置き換えた。
- `src/commands/real-deps.test.ts`（変更）— `resolveHarnessRoot` のユニッ
  トテスト3件、`buildRealDeps()` の実ポート経由の統合テスト5件（2種類以
  上の harness を用いた配置検証、未知 harness の明示的失敗検証）を追加。
  既存フィクスチャの `engine.harness: 'claude-code'` を `'claude'` に更
  新（7箇所）。
- `src/orchestration/engine-installer.ts`（変更）— `EngineInstallerPorts.
  checkEngineDirectoryReplace` のオプション型を `{ force: boolean }` か
  ら `{ force: boolean; harness: string }` に拡張し、`install()` 内で
  `options.harness` を実際に渡すよう変更。
- `src/orchestration/engine-installer.test.ts`（変更）— フェイクポートの
  `checkEngineDirectoryReplace` の型を `{ force, harness }` に更新し、
  `checkEngineDirectoryReplace` が `{ force, harness }` 両方を受け取るこ
  とを検証する新規テストを1件追加。
- `src/types/lockfile.ts`（変更）— `LockfileEngine.harness` の JSDoc コ
  メント例を `"claude-code"` から `"claude"` に修正（型・パースロジック
  は無変更）。

## 主な実装判断

### 1. `plugin-targets.json` を静的 JSON import で参照

`resolveHarnessRoot` は `.claude/tools/data/plugin-targets.json`（upstream
が保有する、`claude`/`codex`/`copilot`/`cursor`/`kiro`/`kiro-ide`/
`opencode` の7ハーネス分の `harnessLeaf` 定義を持つ唯一のマッピング）を
`tsconfig.json` の `resolveJsonModule: true` を利用した静的インポートで
参照する。`fs.readFile` によるランタイム読み込みは行わない — CLI がどの
カレントディレクトリから実行されても解決できる静的なハーネス・トポロジ
データであり、プロジェクト状態ではないため。fleet 側では置き場所マッピ
ングを一切再定義していない（issue #6 完了条件2）。

### 2. 未知の harness は明示的に失敗する

`resolveHarnessRoot` は `plugin-targets.json` に存在しない harness 値に
対し、その値を含む明示的なエラーメッセージを投げる。`.claude` へのフォ
ールバックは一切行わない（issue #6 完了条件3）。この関数は
`checkEngineDirectoryReplace`／`placeEngine`（`EngineInstaller` 経由）お
よび `pluginManager` の4つのクロージャすべてから呼ばれるため、5箇所す
べてで同じフェイルファスト挙動が保証される。

### 3. `checkEngineDirectoryReplace` ポートのシグネチャ変更

修正前、`EngineInstallerPorts.checkEngineDirectoryReplace` は `{ force:
boolean }` しか受け取れず、`real-deps.ts` 側のクロージャがハーネス固有
の書き込み先ディレクトリを解決する手段がなかった（`EngineInstaller.
install()` は `checkEngineDirectoryReplace` を `placeEngine(bytes,
harness)` より*前*に呼ぶため、`harness` は `placeEngine` 側にしか渡って
いなかった）。TDD Red で「`{ force, harness }` の両方を受け取って呼ばれ
る」ことを先に失敗するテストとして書き、Green でポート型を `{ force:
boolean; harness: string }` に拡張して `install()` 内で
`options.harness` を実際に渡すよう変更した。`FileOwnershipGuard.
checkEngineDirectoryReplace(targetDir, options)` の第2引数は構造的に
`{ force: boolean }` を要求するのみなので、余剰フィールド `harness` を
含むオブジェクトを渡しても型エラーにはならない。

### 4. `pluginManager` 側4クロージャは Lockfile から harness を解決する

`checkWriteAllowed`／`removeProjection`／`placeProjection`／
`regenerateSessionStartHook` は `PluginManagerPorts` のシグネチャに
harness を追加せず、`real-deps.ts` 自身のスコープに既にある
`lockfileStore` から Lockfile を読み込んで `engine.harness` を取得す
る方式にした（計画の指示どおり — `plugin-manager.ts` および
`plugin-manager.test.ts` は一切変更していない）。4箇所で重複していた
「Lockfile をロードして harness ルートを解決する」処理は Step 9 の
Refactor で `resolveConfiguredHarnessRoot()` という1つのプライベートヘ
ルパーに集約した。

### 5. `"claude-code"` → `"claude"` フィクスチャ変更の理由

修正前は `.claude` が完全にハードコードされていたため、`engine.harness`
の値はステージング用ファイル名（`.engine-${harness}.tar`）にのみ使われ
る無害な文字列で、`"claude-code"` という実在しない harness キーがテス
トで使われていても何の問題も起きなかった。本修正でこの値が実際に
`plugin-targets.json` に対して検証されるようになったため、
`"claude-code"` は「未知の harness」として明示的に失敗するようになる。
これは修正の完了条件3が要求する正しい挙動であり、バグではない。そのた
め `real-deps.test.ts` 内の既存フィクスチャ（happy-path アサーションを
崩さないよう）を実在するキー `"claude"`（`plugin-targets.json` 上で従
来と同じ `.claude` に解決される）に更新した。`engine-installer.test.ts`
のフィクスチャは `"claude-code"` のまま残した — `EngineInstaller` は
`plugin-targets.json` を一切参照せず、フェイクポート経由でハーネス文字
列をそのまま通過させるだけなので、この修正に対して不活性（inert）であ
る。

## テストカバレッジ概要

Minimal 戦略（要件駆動・各要件につき最低1テスト、コンポーネントごとの
ハッピーパス下限）に従い、以下を実装した:

- `resolveHarnessRoot`（純関数）: 既知キー2種（`claude`, `cursor`）の解
  決 + 未知キーの明示的失敗 — 計3テスト。
- `EngineInstaller.install()`: `checkEngineDirectoryReplace` が
  `{ force, harness }` の両方を受け取って呼ばれることを検証する新規テ
  スト1件。
- `buildRealDeps()` 実ポート統合テスト（実ファイルシステム、`spawn`/
  `fetch` はモック）— issue #6 完了条件4（2種類以上の harness）を満た
  す:
  1. `engineInstaller.install()` に `harness: 'cursor'` を渡すと、
     `.cursor/` 配下にエンジンが配置され、`.claude/` には何も書かれな
     い。
  2. `pluginManager.add()` を `engine.harness: 'cursor'` の Lockfile で
     実行すると、プラグイン展開先とセッション開始フックが `.cursor/`
     配下に配置され、`.claude/` には何も書かれない。
  3. `pluginManager.remove()` を `engine.harness: 'cursor'` の Lockfile
     で実行すると、`.cursor/plugins/<name>` から削除される。
  4. `engineInstaller.install()` に未知の harness（`bogus-harness`）を
     渡すと明示的に失敗し、プロジェクトルート直下にドットディレクトリ
     が一切作られない。
  5. `pluginManager.add()` を未知の harness の Lockfile で実行すると明
     示的に失敗し、プロジェクトルート直下にドットディレクトリが一切作
     られない。

全31件の新規/更新テストを含む `src/commands/real-deps.test.ts`（30テス
ト）と `src/orchestration/engine-installer.test.ts`（6テスト）は完全に
green。リポジトリ全体のテストスイート（`bun test src/`）も 173 テスト
全て green（新規追加前は167テスト）。

## `bun run lint`

初回実行時、リポジトリの `node_modules` に ESLint 関連の依存関係
（`@typescript-eslint/parser` など）が未インストールだったため
`ERR_MODULE_NOT_FOUND` で失敗した（本修正とは無関係な既存環境の問題）。
`bun install` で依存関係を解決した後、`bun run lint` はエラーなしで完
了した（本修正が新たな lint エラーを持ち込んでいないことを確認済み）。

## 計画からの逸脱

なし。`code-generation-plan.md` の Step 1〜11 を計画どおりの順序・内容
で実行した。`plugin-manager.ts`／`plugin-manager.test.ts` には一切触れ
ていない（計画の明示的な指示どおり）。
