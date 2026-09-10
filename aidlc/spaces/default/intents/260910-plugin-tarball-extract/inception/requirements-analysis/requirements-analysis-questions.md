# Requirements Analysis — Clarifying Questions

## Sources

- [desc] Initial description: issue #5: plugin add がダウンロードした tarball を展開しないため、プラグインが使える状態にならない。src/commands/real-deps.ts の placeProjection がtarball展開を行わず生バイト列をそのまま .projection.tar として書き出している。upstream側にも展開処理は存在しない。修正内容: (1) 取得したtarballを展開しupstreamのcomposeが読める形でプラグインルートに配置する (2) removeProjectionが展開後のツリーを完全に削除する（BR4.1のバージョン混在防止） (3) FileOwnershipGuardに渡すパス(pluginDirLabelが返すplugins/<name>)と実書き込み先(.claude/plugins/<name>)を一致させる (4) 実ファイルシステムに対する統合テスト（一時ディレクトリでの実際の展開・配置・削除の検証）を追加する。GitHub issue: https://github.com/hideokamoto/aidlc-fleet/issues/5
- [memory:M4] project.md Mandated/Forbidden — ファイル所有権 invariant（v0.1 §7）: シンボリックリンク書き込み禁止、fail-fast、実ファイルシステム統合テスト必須
- [memory:M8] project.md Mandated — exit-code 契約（v0.1 §8）を全コマンドで一貫して守る
- コードベース調査: `src/commands/real-deps.ts:245-249`（`placeProjection`）、`src/orchestration/plugin-manager.ts:150-152`（`pluginDirLabel`）、`.claude/tools/data/plugin-hooks-template/compose.ts`（`walk()` が実ディレクトリツリーを読む実装）、`package.json`（`dependencies` フィールドなし＝ランタイム依存ゼロ方針）

## Questions

### Q1. tarball 展開の実装方式

`package.json` は `dependencies` を持たず、ランタイム依存ゼロを明示的な設計方針として採用しています（`devDependencies` のみ）。tarball（gzip 圧縮 tar、GitHub codeload 規約 `tar.gz`）を展開するには gzip 解凍 + tar アーカイブ解析の両方が必要ですが、Node.js/bun の標準ライブラリに tar 解析機能は含まれていません。どの方式を採りますか？

A. 標準ライブラリのみで自前実装する（`node:zlib` の `gunzipSync` で解凍し、tar フォーマット（POSIX ustar ヘッダー）を自前でパースする最小実装を `src/io/` に追加する）。ランタイム依存ゼロ方針を維持する。
B. 軽量な tar 展開ライブラリを新規のランタイム依存として追加する（例: `tar-stream` 等）。ランタイム依存ゼロ方針を明示的に撤回する判断として記録する。
C. bun のネイティブ機能（`Bun.file`/`Bun.$` シェルアウト等）で `tar` コマンドをサブプロセス実行して展開する。実行環境に `tar` コマンドの存在を前提とする。
D. 上記の混合（例: 解凍は `node:zlib`、tar 解析のみ軽量ライブラリを追加）。
X. Other (please specify)

[Answer]: A. 標準ライブラリのみで自前実装

### Q2. 展開後プラグインルートのディレクトリ構造

`.claude/tools/data/plugin-hooks-template/compose.ts` の `PLUGIN_ROOT` 解決ロジックは `<harness>-plugin/plugin.json`（例: `.claude-plugin/plugin.json`）をプラグインルート直下から探索します。展開先のディレクトリ構造をどう配置しますか？

A. tarball のトップレベルディレクトリ構造をそのまま `.claude/plugins/<name>/` 配下に展開する（GitHub codeload tarball は通常 `<repo>-<ref>/` という単一ルートディレクトリを持つため、そのラッパーディレクトリを1階層除去（strip-components相当）してから展開する）。
B. tarball の内容をそのままのパスで `.claude/plugins/<name>/` 配下に展開する（ラッパーディレクトリの除去は行わない）。
C. 展開先を `.claude/plugins/<name>/<harness>/` のようにharness別サブディレクトリへ分ける。
X. Other (please specify)

[Answer]: A. ラッパーディレクトリを除去して展開（委任: `compose.ts` の `PLUGIN_ROOT` 解決が `<harness>-plugin/plugin.json` をルート直下から探索するため、GitHub codeload の単一ルートラッパー（`<repo>-<ref>/`）を残したままでは `PLUGIN_ROOT` が誤検出される。strip-components相当の1階層除去が upstream の期待するレイアウトと整合する。）

### Q3. FileOwnershipGuard へ渡すパスの修正箇所

issue #5 は `PluginManager.pluginDirLabel()` が返す `plugins/<name>`（相対パス）と、`real-deps.ts` の実書き込み先 `.claude/plugins/<name>` が不一致であることを指摘しています。`real-deps.ts` 側は `join(config.projectRoot, targetPath)` で `pluginDirLabel()` の返り値をそのまま解決しているため、結果として `<projectRoot>/plugins/<name>` を検査してしまい、実際の書き込み先 `<projectRoot>/.claude/plugins/<name>` を検査していません。どちらを修正しますか？

A. `PluginManager.pluginDirLabel()` の返り値を `.claude/plugins/<name>` に変更する（`plugin-manager.ts` 側の修正）。
B. `real-deps.ts` の `checkWriteAllowed` クロージャで `pluginDirLabel()` の返り値の前に `.claude/` を補完してから解決する（`real-deps.ts` 側の修正）。
C. 両方（`pluginDirLabel()` は論理名のみを返す設計に統一し、`.claude/` プレフィックスの付与は呼び出し側=`real-deps.ts` に一元化する）。
X. Other (please specify)

[Answer]: C. 両方（委任: `EngineInstaller` 側の `placeEngine` も同様に `real-deps.ts` が絶対パスへ解決する構成であり、`pluginDirLabel()` を論理名専用に保ち、実書き込み先パスとの合成を呼び出し側に一元化する方が、team.md のレイヤー分離規約（オーケストレーション層とI/O統合グルー層の責務分離）と整合する。）

### Q4. tarball 内エントリのパス検証（セキュリティ）

展開処理を自前実装する場合、tarball 内の各エントリパスに `../` を含む相対パス（tar-slip / Zip Slip 相当の脆弱性）や絶対パス、シンボリックリンクエントリが含まれていると、展開先ディレクトリの外側へ書き込まれる恐れがあります。project.md の Forbidden 規約（シンボリックリンク書き込み禁止）と整合させるため、この検証をどう扱いますか？

A. 必須要件として明記する：展開前に全エントリのパスを正規化し、展開先ルートの外側を指すエントリ（`../` を含む、絶対パス、シンボリックリンク種別）は拒否してfail-fastする。
B. 対象外とする（upstream 提供元の tarball は信頼できる配布チャネルからのみ取得されるため、パス検証は本 issue のスコープ外とする）。
X. Other (please specify)

[Answer]: A. 必須（推奨）

## Consolidated Summary Confirmation

- Q1（tarball展開方式）: A — `node:zlib` の `gunzipSync` による解凍 + 自前の最小 tar（POSIX ustar）パーサーを `src/io/` に追加する。ランタイム依存ゼロ方針を維持する。
- Q2（展開先ディレクトリ構造）: A — GitHub codeload の単一ルートラッパーディレクトリ（`<repo>-<ref>/`）を1階層除去してから `.claude/plugins/<name>/` 配下に展開する。
- Q3（FileOwnershipGuardパス不一致の修正箇所）: C — `pluginDirLabel()` は論理名（`<name>`）のみを返す設計に変更し、`.claude/plugins/` プレフィックスとの合成は呼び出し側（`real-deps.ts`）に一元化する。
- Q4（tar-slip対策）: A — 展開前に全エントリのパスを正規化し、展開先ルート外を指すエントリ（`../`、絶対パス、シンボリックリンク種別）は拒否してfail-fastする。必須要件とする。

Does this all look correct before I generate the requirements artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
