# Security Test Instructions — issue #5: plugin add tarball extraction

Minimal test strategy では追加テストファイルの生成を要求しないが、本 issue は
tarball 展開という「外部から取得したアーカイブを実ファイルシステムに書き込
む」経路にパストラバーサル（tar-slip）対策を新規に追加するセキュリティ関連
の変更であるため、stage-protocol.md の例示（「Minimal な security-patch は
security test instructions を要することがある」）に倣い、最小限のセキュリ
ティテスト方針をここに明記する。新規テストファイルは追加しない — すべて
Code Generation で `src/io/tar-extract.test.ts` / `src/commands/real-deps.test.ts`
に実装済みの実ファイルシステム統合テストを指す。

## 脅威モデル（該当分のみ）

- **Tampering / パストラバーサル**: 悪意ある（または壊れた）tarball が
  `../` を含む相対パスエントリを持ち、展開先ディレクトリの外側にファイル
  を書き込もうとする。
- **Tampering / シンボリックリンク経由の書き込み**: tarball が symlink 種
  別のエントリを含み、展開先ディレクトリ外への書き込み経路を作ろうとする。
- **Elevation of Privilege 相当**: `FileOwnershipGuard` の検査対象パスが
  実際の書き込み先と一致していないことで、symlink 化された
  `.claude/plugins/<name>` への書き込みが検査をすり抜ける（issue #5 の
  副次バグ）。

## テストコマンド（実装済み、Code Generation で実行・green 確認済み）

```bash
bun test src/io/tar-extract.test.ts
bun test src/commands/real-deps.test.ts
```

## 検証項目と実施済みテスト

| 脅威 | 検証内容 | テストファイル | 結果 |
|---|---|---|---|
| パストラバーサル | `../` を含むエントリを拒否し、展開先に部分ファイルが一切残らない | `src/io/tar-extract.test.ts` | 実装済み・green |
| シンボリックリンクエントリ | symlink 種別のエントリを拒否し、部分ファイルが残らない | `src/io/tar-extract.test.ts` | 実装済み・green |
| 絶対パスエントリ | 絶対パスのエントリを拒否する | `src/io/tar-extract.test.ts` | 実装済み・green |
| FileOwnershipGuard パス整合性 | `.claude/plugins/<name>` を事前に symlink 化した状態で `plugin add` を実行し、実際の書き込み先に対して symlink 違反が検出され拒否される | `src/commands/real-deps.test.ts` | 実装済み・green |

## 対象外（Out of Scope、requirements.md と整合）

- gzip 圧縮以外の圧縮形式への攻撃面。
- tarball サイズ／メモリ上限に起因する DoS（`gunzipSync` の同期・オンメモリ処理に伴うリスク。requirements.md の Out of Scope として明示されるべき点であり、本ステージのレビュー指摘 R-03 として引き継ぎ済み）。
- SAST/DAST/依存関係スキャンなどパイプライン全体のセキュリティゲート（`ci-pipeline` 等の別ステージの責務）。
