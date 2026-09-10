# Code Summary — issue #5: plugin add tarball extraction

## 作成/変更したファイル

- **新規**: `src/io/tar-extract.ts` — tarball 展開の実装本体。
- **新規**: `src/io/tar-extract.test.ts` — ユニットテスト6件（純粋関数）+
  実ファイルシステム統合テスト5件。
- **変更**: `src/commands/real-deps.ts` — `placeProjection` を
  `extractTarGz` 呼び出しに置き換え、`pluginManager.checkWriteAllowed`
  クロージャが `.claude/plugins/` プレフィックスを補完するよう修正。
  `removeProjection` にも FR2.1 を明示するコメントを追加。
- **変更**: `src/commands/real-deps.test.ts` — 既存の
  `pluginManager.add() drives placeProjection/regenerateSessionStartHook
  end-to-end` テストを実際の展開結果を検証するよう書き換え、バージョン
  更新シナリオとパス整合性シナリオの新規統合テストを2件追加。
- **変更**: `src/orchestration/plugin-manager.ts` — `pluginDirLabel()` を
  プラグイン論理名のみを返す実装に変更。

## 主な実装判断

1. **2パス設計（FR4.2, レビュー指摘 R-01）**: `extractTarGz` は
   `stripWrapperDirectory` 後の全エントリに対して `assertSafeEntry` を
   完了してから、初めて書き込みループに入る。これにより「一部書き込ん
   だ後に違反エントリが見つかる」状態が構造的に発生せず、別途クリーン
   アップ処理を持つ必要がない（書き込み前検証のみで FR4.2 を満たす）。
   R-01 で要求された「拒否後、展開先ディレクトリに部分ファイルが一切
   残っていない」ことは `tar-extract.test.ts` と `real-deps.test.ts` の
   統合テストで、パストラバーサル・シンボリックリンクの両シナリオに
   ついて `readdir` が空配列であることを検証している。

2. **ustar パーサーは `node:zlib`/`node:path` のみに依存**（NFR1,
   FR1.2）。ランタイム `dependencies` は追加していない
   （`package.json` は変更なし、devDependencies のみのゼロ依存方針を
   維持）。`prefix` フィールド（155バイト長パス名）にも対応する完全な
   ustar パーサーとして実装した。

3. **`pluginDirLabel()` の呼び出し箇所は3箇所のみ**（`add()` 2箇所,
   `remove()` 1箇所）であることを実装着手前に `grep -rn
   "pluginDirLabel("` で確認済み（レビュー指摘 R-02 対応）。他の呼び出し
   元は存在しないため、返り値フォーマット変更（`plugins/<name>` →
   `<name>`）による暗黙の破壊はない。

4. **パス整合性の修正場所**: `pluginDirLabel()` 自体（コアロジック層）
   ではなく、`real-deps.ts` の `checkWriteAllowed` クロージャ（統合グ
   ルー層）で論理名から物理パスへの合成を行う設計を維持した
   （FR3.2）。これは `PluginManager` を「実際のファイルシステムレイア
   ウトを知らない」ポート境界に保つ既存の設計方針
   （`plugin-manager.ts` の冒頭コメント）と整合する。

5. **`stripWrapperDirectory` は安全側に倒す**: 全エントリの先頭セグメン
   トが単一のラッパーディレクトリに揃っていない場合（GitHub codeload
   規約から外れる異常な tarball）は、何も除去せず元のエントリをそのま
   ま返す。これにより、想定外の tarball 形状で誤ったパスに書き込む事故
   を防ぐ。

6. **`assertSafeEntry` は `node:path/posix` を使用**: tar エントリ名は
   常に `/` 区切り（POSIX ustar 規約）であり、プラットフォーム依存の
   `node:path`（Windows では `\` を扱う）ではなく `node:path/posix` で
   正規化・絶対パス判定を行う。

## テストカバレッジ概要

`bun test --coverage src/` 実行結果（抜粋、対象3ファイル）:

| ファイル | Lines | Funcs |
|---|---|---|
| `src/io/tar-extract.ts` | 98.96% | 100.00% |
| `src/commands/real-deps.ts` | 99.45% | 93.44% |
| `src/orchestration/plugin-manager.ts` | 100.00% | 100.00% |

`bunfig.toml` の 80% ライン・カバレッジ床（`coverageThreshold.lines =
0.8`）を全ファイルとも満たしており、`bun test --coverage src/` は exit
code 0 で完了する（実行済み・確認済み）。

`bun test src/io/tar-extract.test.ts src/commands/real-deps.test.ts
src/orchestration/plugin-manager.test.ts`: 43 pass / 0 fail / 86
expect() calls。

`bun test src/`（プロジェクト全体の既存スイート）: 163 pass / 0 fail /
277 expect() calls。既存テストは全て green のまま。

## 計画からの逸脱

なし。`code-generation-plan.md` の Step 1〜15 を計画通りに実施した。
Step 15 の「ドキュメント/コメント整理」は `placeProjection` に加えて
`removeProjection` 近傍にも FR2.1 を明示するコメントを追加した（計画本
文が `placeProjection`/`removeProjection` 両方の近傍コメント整理を指示
していたため）。
