# Build Instructions — issue #5: plugin add tarball extraction

## 依存関係のインストール

```bash
bun install
```

`package.json` に `dependencies` フィールドはなく（ランタイム依存ゼロ方針）、`devDependencies`（`@types/bun`, `@typescript-eslint/*`, `eslint`, `prettier`, `typescript`）のみをインストールする。今回の修正（`src/io/tar-extract.ts`）もこの方針を維持しており、`package.json` の変更はない。

## 環境セットアップ

- 環境変数・設定ファイルは不要。`aidlc-fleet-cli` は CLI ツールであり、外部サービス接続を必要としない。
- 実行環境: `bun >= 1.1.0`（`package.json` `engines.bun`）。

## ビルドコマンド

```bash
bun run build
```

実体は `bun build ./bin/aidlc-fleet.ts --outdir ./dist --target bun`。`bin/aidlc-fleet.ts` を単一エントリポイントとしてバンドルする。

## ビルド検証

```bash
bun run build
ls dist/aidlc-fleet.js
```

**実行結果（このステージで実施済み）**:
```
$ bun build ./bin/aidlc-fleet.ts --outdir ./dist --target bun
Bundled 24 modules in 14ms
  aidlc-fleet.js  46.23 KB  (entry point)
```
Exit code 0。`src/io/tar-extract.ts` の新規追加による import 解決エラーやバンドルサイズの異常はない。

## Lint / 型検査

```bash
bun run lint
bunx tsc --noEmit -p .
```

**実行結果（このステージで実施済み）**: いずれも exit code 0、出力なし（警告・エラーともになし）。

## トラブルシューティング

- `Cannot find package '@typescript-eslint/parser'` エラーが出る場合: `bun install` が未実行。`node_modules/` が存在するか確認する。
- `bun build` が `src/io/tar-extract.ts` の `node:zlib`/`node:path/posix` import を解決できない場合: bun のバージョンが `engines.bun` の要求（`>=1.1.0`）を満たしているか確認する（両モジュールとも Node.js 標準ライブラリであり bun がネイティブサポートする）。
