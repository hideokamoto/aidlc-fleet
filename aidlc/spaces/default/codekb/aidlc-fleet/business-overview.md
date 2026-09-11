# ビジネス概要

## ドメインとパーパス

`aidlc-fleet-cli`（npm パッケージ名 `aidlc-fleet-cli`、単一 bin エントリ
`aidlc-fleet`）は、AI-DLC フレームワークの「フリート配布」層を担う
TypeScript / bun 製 CLI である。中央の **channel ファイル**（エンジンの
バージョンと有効化するプラグイン集合を宣言する単一の真実源）を起点に、
個々のプロジェクトの `.claude/` エンジンディレクトリとプラグイン群を
その宣言へ同期させる。対象ユーザーは AI-DLC を採用する開発チームであり、
「複数プロジェクトに配布されたエンジン/プラグインのバージョンをどう
揃えるか」という運用上の課題を解決する。

## 主要機能

- **`init`** — 新規プロジェクトへエンジンを初期導入する（`--adopt` で
  既存導入を引き継ぐ、`--force` で既存ディレクトリを上書き）。
- **`update`** — channel が宣言する最新のエンジン/プラグイン集合へ
  同期する。バージョンゲート（M3, v0.1 §4）のマイグレーション境界判定
  （reject/manual/none）を経由し、`--acknowledge-migration` との相互作用
  を一貫して守る。
- **`check`** — 現在のインストール状態が channel の宣言からドリフト
  していないか検査する（`DriftDetector`）。
- **`plugin add <name>` / `plugin remove <name>`** — 個々のプラグインの
  導入・削除。プラグインは tarball として配布され、プロジェクトの
  `.claude/plugins/<name>/` に配置されることが期待される。
- **`pin <ref>` / `unpin`** — エンジンバージョンを特定の ref に固定/解除。
- **`status`** — 現在のロックファイル状態を表示。
- **`doctor`** — 導入済みエンジン/プラグインの健全性診断。

いずれのコマンドも exit code 0–4 の契約（M8, v0.1 §8）を一貫して守る
（`src/core/exit-code.ts`）。

## 今回のインテントとの関係

Issue #5「`plugin add` がダウンロードした tarball を展開しないため、
プラグインが使える状態にならない」は、上記 `plugin add` 機能の核心的な
欠陥である。`placeProjection`（`src/commands/real-deps.ts`）がダウンロード
した tarball のバイト列をそのまま `.claude/plugins/<name>/.projection.tar`
へ書き込むのみで展開せず、upstream 側にも展開処理が存在しないため、
プラグインを導入してもそのファイルツリーがプロジェクトに現れない。
これは配布 CLI の中核ユースケース（プラグインをチームに配る）が事実上
機能しないというビジネス影響を持つ。加えて、`pluginDirLabel()`
（`src/orchestration/plugin-manager.ts`）が返すラベルパスと実際の書き込み
先パスの不一致により、ファイル所有権 invariant（M4, v0.1 §7 —
シンボリックリンク書き込み禁止）の検査が実際の書き込み先を検査していない
という副次的なギャップも存在する。詳細は `code-quality-assessment.md`
の Technical Debt を参照。

## ランタイム依存方針

`package.json` に `dependencies` フィールドが存在しない — ランタイム
依存ゼロを明示的な設計方針として採用している（`devDependencies` のみ）。
本 issue の修正がこの方針とどう両立するか（tarball 展開に
`node:zlib` 等の Node.js 組み込みモジュールを使うか、限定的な
devDependency を導入するか）は次段階（requirements-analysis / 設計）で
判断が必要な論点である。
