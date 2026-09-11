# Build Instructions — harness-write-target-fix

## Dependency Installation

```bash
bun install
```

`bun.lock` は既存でコミット済み。`node_modules` が既にセットアップ済みの
環境ではこのステップは冪等（差分なし）。

## Environment Setup

追加の環境変数・設定ファイルは不要。このリポジトリは TypeScript/bun 製の
CLI であり、外部サービスやローカルデーモンへの依存を持たない。

## Build Commands

このプロジェクトは `"noEmit": true`（`tsconfig.json`）の型チェック専用
構成であり、実行時は `bun` が TypeScript を直接実行する。「ビルド」は
型チェックと lint を指す:

```bash
bunx tsc --noEmit
bun run lint
```

配布用バンドルが必要な場合のみ（本ステージでは実行しない、任意）:

```bash
bun run build
```

## Build Verification Steps

1. `bunx tsc --noEmit` が非ゼロ終了しないこと（型エラーなし）。
2. `bun run lint`（ESLint）が非ゼロ終了しないこと。

## Troubleshooting Common Build Issues

- `bun run lint` が `ERR_MODULE_NOT_FOUND`（`@typescript-eslint/parser` 等）
  で失敗する場合: `node_modules` に ESLint 関連の devDependencies が未インス
  トール。`bun install` を再実行する（Code Generation ステージで実際に発生
  し、`bun install` で解消済み — 本修正とは無関係な既存環境の問題）。
- `bunx tsc --noEmit` が `resolveJsonModule` 関連のエラーを出す場合:
  `tsconfig.json` の `resolveJsonModule: true` が意図せず外れていないか確認
  する（本修正の `resolveHarnessRoot` は `.claude/tools/data/plugin-targets.json`
  の静的 JSON import に依存している）。
