# Requirements — issue #5: `plugin add` が tarball を展開しない

## Sources

- [desc] Initial description: issue #5: plugin add がダウンロードした tarball を展開しないため、プラグインが使える状態にならない。GitHub issue: https://github.com/hideokamoto/aidlc-fleet/issues/5
- [Q1]〜[Q4] `requirements-analysis-questions.md` の回答（すべて対話形式で確認済み）
- [memory:M4] project.md Mandated/Forbidden — ファイル所有権 invariant（v0.1 §7）
- [memory:M8] project.md Mandated — exit-code 契約（v0.1 §8）
- コードベース調査: `src/commands/real-deps.ts`, `src/orchestration/plugin-manager.ts`, `src/core/file-ownership-guard.ts`, `.claude/tools/data/plugin-hooks-template/compose.ts`, `package.json`

## Intent Analysis

`aidlc-fleet-cli` の中核ユースケースである「プラグインをプロジェクトに配布する」（`plugin add <name>`）が、実装上は tarball を展開しないために事実上機能していない。ユーザー（AI-DLC 採用チーム）が達成したいことは、`plugin add` を実行した結果として upstream の compose ロジックが読めるファイルツリーが `.claude/plugins/<name>/` 配下に実在する状態にすることであり、単に「exit code 0 で終わる」ことではない。副次的に、ファイル所有権検査（M4）が実際の書き込み先を検査していないというギャップも解消する必要がある。

## Functional Requirements

### FR1. tarball 展開

- **FR1.1**: `PluginManager.add()` が `fetchPluginTarball` で取得した検証済み tarball バイト列（gzip 圧縮 tar、GitHub codeload 規約）を、`placeProjection` 内で実際に展開しなければならない。生バイト列をそのままファイルとして書き出す現行実装（`.projection.tar`）を置き換える。
- **FR1.2**: 展開は `node:zlib` の `gunzipSync`（解凍）と、自前実装した最小 tar（POSIX ustar ヘッダー）パーサー（アーカイブ解析）の組み合わせで行う。新規のランタイム `dependencies` は追加しない（`package.json` の既存ゼロ依存方針を維持する）。
- **FR1.3**: tarball のトップレベルに存在する単一ラッパーディレクトリ（GitHub codeload 規約 `<repo>-<ref>/`）は、展開時に1階層除去（strip-components 相当）した上で `.claude/plugins/<name>/` 配下に配置する。
- **FR1.4**: 展開後のファイルツリーは、`.claude/tools/data/plugin-hooks-template/compose.ts` の `PLUGIN_ROOT` 解決ロジック（`<harness>-plugin/plugin.json` をルート直下から探索）が想定するレイアウトと一致していなければならない。

### FR2. バージョン混在防止（BR4.1）

- **FR2.1**: `removeProjection(name)` は、`placeProjection` が展開したファイルツリー全体（旧バージョンのすべてのファイル・サブディレクトリ）を完全に削除しなければならない。展開先ディレクトリの再帰削除（`rm -rf` 相当）で、部分的な残留を許さない。
- **FR2.2**: `PluginManager.add()` の既存バージョン混在防止フロー（既存プラグインがある場合に `removeProjection` → `placeProjection` の順で実行する BR4.1 の順序）は変更しない。

### FR3. ファイル所有権パス整合性

- **FR3.1**: `PluginManager.pluginDirLabel(pluginName)` は、プラグインの論理名（`<name>`）のみを返す設計に変更する。物理的な書き込み先パス（`.claude/plugins/<name>`）との合成は行わない。
- **FR3.2**: `real-deps.ts`（`buildRealDeps()` の統合グルー層）は、`checkWriteAllowed` クロージャ内で `pluginDirLabel()` が返す論理名の前に `.claude/plugins/` プレフィックスを補完してから `FileOwnershipGuard.checkWriteAllowed()` に渡さなければならない。これにより `FileOwnershipGuard` が実際の書き込み先（`<projectRoot>/.claude/plugins/<name>`）に対してシンボリックリンク検査（M4, BR2.4）を行う。
- **FR3.3**: この修正は `plugin add` と `plugin remove` の両方の呼び出し経路（`PluginManager.add()` / `PluginManager.remove()` がそれぞれ `checkWriteAllowed(this.pluginDirLabel(...))` を呼ぶ箇所）に一貫して適用する。

### FR4. tar-slip（パストラバーサル）対策

- **FR4.1**: tar パーサーは、展開前に全エントリのパスを検証し、以下のいずれかに該当するエントリは拒否して fail-fast しなければならない（M4 の Forbidden 規約「シンボリックリンク書き込み禁止」と整合）:
  - 正規化後のパスが展開先ルートディレクトリの外側を指すもの（`../` を含む相対パスによる脱出）
  - 絶対パスとして解釈されるエントリ
  - シンボリックリンク種別（tar のリンクフラグ）のエントリ
- **FR4.2**: FR4.1 の違反を検知した場合、警告に留めず即座に例外を投げて展開処理全体を中断する（project.md Forbidden 規約「ファイル所有権 invariant 違反を警告のみで処理しない」との整合）。部分的に展開済みのファイルを残さないよう、失敗時のクリーンアップを行う。

### FR5. 既存フローとの整合

- **FR5.1**: `PluginManager.add()` / `remove()` の呼び出しシーケンス（`fetchPluginTarball` → `checkWriteAllowed`/`removeProjection` → `checkWriteAllowed`/`placeProjection` → `regenerateSessionStartHook` → `runCompose` → `SuccessVerifier.verify` → `saveLockfile`）自体は変更しない。今回の修正は `placeProjection`/`removeProjection` の実装差し替えと `pluginDirLabel` 呼び出し経路の修正に限定する。
- **FR5.2**: `EngineInstaller.placeEngine`（エンジン側のステージング書き込みのみに留める設計）は本 issue のスコープ外であり、変更しない。

## Non-Functional Requirements

- **NFR1（可搬性）**: tar 展開実装は `node:zlib` と `node:fs/promises` のみに依存し、bun 環境（`engines.bun >= 1.1.0`）上で動作する。プラットフォーム固有のネイティブバイナリや外部コマンド（`tar` コマンド等）への依存を持たない。
- **NFR2（フェイルファスト）**: 展開失敗（不正な tar フォーマット、gzip 解凍エラー、FR4.1 のパス検証違反）は即座に例外として送出し、`plugin add`/`plugin remove` は M8 の exit-code 契約（0–4）に従って異常終了する。
- **NFR3（テスト可能性）**: tar 展開ロジックは team.md のレイヤー分離規約に従い、`src/io/` 配下にファイル I/O を最小限に抑えた形で実装し、ユニットテスト（既知の tar バイト列フィクスチャに対する展開結果検証）を可能にする。
- **NFR4（統合テスト、team.md Mandated）**: `placeProjection`/`removeProjection` の実際の展開・配置・削除、および FR3 のパス整合性修正について、`node:fs/promises` の一時ディレクトリ（`mkdtemp` 相当）を用いた実ファイルシステム統合テストを追加する。モックのみのテストでは代替しない。最低限、以下のシナリオをカバーする:
  - 正常系: 単一ラッパーディレクトリを持つ tarball を展開し、期待するファイルツリーが実際に存在することを検証する。
  - バージョン更新: 既存プラグインがある状態で `add` を再実行し、`removeProjection` が旧ファイルを完全に削除してから新ファイルが配置されることを検証する。
  - パストラバーサル: `../` を含むエントリまたはシンボリックリンクエントリを含む tarball が拒否されることを検証する。
  - パス整合性: `FileOwnershipGuard.checkWriteAllowed` が実際の書き込み先（`.claude/plugins/<name>`）に対して呼ばれることを検証する（symlink 化した `.claude/plugins/<name>` への書き込みが拒否されることを含む）。

## Constraints

- ランタイム依存ゼロ方針（`package.json` に `dependencies` フィールドを追加しない）を維持する（Q1 回答）。
- team.md のレイヤー分離規約（コマンド層 / コアロジック層 / ファイルシステム I/O 層の3層分離）を維持する。tar 展開ロジックは I/O 層（`src/io/`）に置く。
- project.md Forbidden 規約により、シンボリックリンクへの書き込みは一切許可しない。
- project.md Forbidden 規約により、upstream（`awslabs/aidlc-workflows`）の plugin-compose ロジックを再実装しない。本修正は tarball の展開・配置までを担い、`runCompose` 以降（upstream の compose 呼び出し）には手を入れない。

## Assumptions

- **A1**: プラグイン配布 tarball は GitHub codeload 規約（`https://codeload.github.com/${repo}/tar.gz/${ref}`）に従って取得され、標準的な gzip 圧縮 POSIX tar フォーマットであり、単一のトップレベルラッパーディレクトリ（`<repo>-<ref>/`）を持つ。（根拠: `ChannelClient.fetchTarball`/`buildTarballUrl` の既存実装、architecture.md のデータフロー記述）
- **A2**: 展開対象の tarball は `verifySha256` によるダウンロード時の整合性検証を通過済みであり、改ざんされていない配布元からのものである。ただし FR4 のパス検証はこの前提の有無にかかわらず適用する（多層防御として）。
- **A3**: `EngineInstaller.placeEngine`（エンジン tarball のステージング書き込みのみ）は、コード内コメントで明示されている通り「展開は upstream の compose の仕事」という設計が意図的であり、本修正では変更しない。

## Out of Scope

- `EngineInstaller.placeEngine`（エンジンの tarball 配置ロジック）の変更。
- upstream の `compose` コマンド自体のロジック変更・再実装。
- gzip 圧縮以外の圧縮形式（例: zstd）のサポート。
- Windows ネイティブ環境（非 WSL）でのパス区切り文字対応の網羅的検証（既存コードベースの `node:path` 利用パターンに準拠する前提とする）。

## Open Questions

- なし（Q1〜Q4 の確認質問ですべての論点が解決済み）。

## Review

**Verdict:** READY
**Reviewer:** aidlc-product-lead-agent
**Date:** 2026-09-10T13:30:11Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action |
|---|---|---|---|---|
| R-01 | Major | requirements.md > FR4.2, NFR4 | FR4.2 は「失敗時のクリーンアップ（部分的に展開済みのファイルを残さない）」を要件化しているが、NFR4 が列挙する必須統合テストシナリオ（正常系／バージョン更新／パストラバーサル／パス整合性）のどれも「拒否・失敗後にディレクトリへ部分ファイルが残っていないこと」を検証しない。パストラバーサルのシナリオは「エントリが拒否されること」しか確認していない。QA はこの記述だけでは FR4.2 の合否判定基準を作れない。 | NFR4 のパストラバーサル・シナリオ（またはこれに続く新シナリオ）に「拒否後、展開先ディレクトリに部分ファイルが一切残っていないこと」を明示的な検証項目として追加する。 |
| R-02 | Minor | requirements.md > FR3.1 | `pluginDirLabel()` の返り値を「論理名のみ」に変更する破壊的変更について、`checkWriteAllowed` 呼び出し（FR3.2/FR3.3）以外に同関数を参照している箇所（ロックファイルのキー生成やログ出力など）が存在しないことを upstream codekb（architecture.md / code-structure.md）は明示的に確認していない。他の呼び出し元がある場合、返り値フォーマット変更で暗黙的に壊れる可能性がある。 | 実装着手前に `pluginDirLabel()` の全呼び出し箇所を機械的に確認し（例: `grep -rn "pluginDirLabel("`）、影響範囲を FR3.3 に明記するか、コードジェネレーション段階の確認事項として明示的に引き継ぐ。 |
| R-03 | Minor | requirements.md > Non-Functional Requirements | 展開対象 tarball のサイズ上限やメモリ上限に関する NFR が存在しない（`gunzipSync` は同期・オンメモリ処理のため、極端に大きい tarball では実行時にメモリを圧迫し得る）。bugfix スコープでは必須ではないが、明示的な「対象外」宣言もないため境界が曖昧。 | Out of Scope セクションに「tarball サイズ上限の検証は対象外」等、境界を明示する一文を追加する。 |

### Summary

要件は issue #5 の実装箇所（`real-deps.ts` の `placeProjection`、`plugin-manager.ts` の `pluginDirLabel`）およびアーキテクチャ上の設計意図（`EngineInstaller` との非対称性、ランタイム依存ゼロ方針）を codekb と正確に整合させて記述しており、FR/NFR の ID も一貫して付与されている。人間の Q1〜Q4 回答も Consolidated Summary Confirmation を経て正確に requirements へ反映されている。唯一の Major 指摘（R-01）はクリーンアップ要件に対応するテストシナリオの欠落であり、実装着手前に NFR4 へ 1 シナリオ追加すれば解消できる軽微なギャップのため、READY と判定する。
