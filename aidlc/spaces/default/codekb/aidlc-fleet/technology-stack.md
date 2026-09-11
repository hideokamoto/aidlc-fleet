# 技術スタック

## 言語・ランタイム

| 技術 | バージョン | 用途 |
|---|---|---|
| TypeScript | `^5.5.0`（devDependency） | 静的型付け実装言語。`tsconfig.json` は `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `module: ESNext` / `moduleResolution: bundler`, `noEmit: true` |
| bun | `>=1.1.0`（`engines` フィールド、`@types/bun ^1.1.0`） | ランタイム／テストランナー（`bun test`）／バンドラー（`bun build`） |

## ビルド・品質ツール

| 技術 | バージョン | 用途 |
|---|---|---|
| ESLint | `^8.57.0` + `@typescript-eslint/eslint-plugin`/`parser` `^7.0.0` | リンティング（flat config, `@typescript-eslint/recommended` ベース） |
| Prettier | `^3.3.0` | フォーマッタ（semi/singleQuote/trailingComma=all/printWidth=100/tabWidth=2） |

## CI/CD

- **CircleCI**（`.circleci/config.yml`, `version: 2.1`） — team.md
  Deployment セクションと一致するパイプライン: `lint` →
  `typecheck`（`tsc --noEmit`） → `test`（`bun test src/` +
  `bun test --coverage src/`） → `build`（`bun build`） →
  `secret-scan`（gitleaks, pinned v8.18.4） →
  `dependency-scan`（`bun audit`, advisory `|| true`） →
  `publish-approval-gate`（手動承認ジョブ） → `publish`

## ランタイム依存

**ゼロ**。`package.json` に `dependencies` フィールド自体が存在しない
（`devDependencies` のみ）。`ChannelClient` は bun 組み込みの
グローバル `fetch` を使用し、追加の HTTP クライアントライブラリは
導入していない。

tarball 展開・gzip 解凍・アーカイブ処理を行うライブラリ
（例: `tar`, `tar-stream`, gzip ラッパー等）は `dependencies` にも
`devDependencies` にも `bun.lock` にも存在せず、Node.js 組み込み
`node:zlib` を使った手書き実装も `src/` 内に見当たらない。issue #5
の修正はこの領域に新たな技術選定（組み込みモジュール活用 or
新規依存追加）を要する可能性が高い。

## テストスタック

| 技術 | 用途 |
|---|---|
| `bun:test`（組み込みテストランナー） | `describe`/`test`/`expect` API |
| `bunfig.toml` `[test].coverageThreshold` | `{ lines = 0.8, functions = 0.0 }`。80% ラインカバレッジ床の CI 強制設定。`functions = 0.0` は「省略すると bun 1.3.11 で常に非ゼロ終了する」という確認済みの回避策 |

## 配布形態

npm パッケージ（`private: true`、CircleCI 経由での手動承認ゲート付き
publish）。単一 bin エントリ `aidlc-fleet`（`./bin/aidlc-fleet.ts`）。
`type: module`（ESM）。
