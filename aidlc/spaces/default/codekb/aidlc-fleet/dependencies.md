# 依存関係

## 外部依存

- **ランタイム依存: ゼロ**（`package.json` に `dependencies` フィールド
  なし）。
- **devDependencies**: `@types/bun ^1.1.0`, `@typescript-eslint/eslint-plugin
  ^7.0.0`, `@typescript-eslint/parser ^7.0.0`, `eslint ^8.57.0`,
  `prettier ^3.3.0`, `typescript ^5.5.0`。
- **外部サービス依存**: channel 宣言 URL（`AIDLC_FLEET_CHANNEL_URL`）、
  GitHub codeload アーカイブ（`https://codeload.github.com/${repo}/tar.gz/${ref}`）
  — エンジン/プラグイン tarball の取得元。いずれも `ChannelClient`
  経由の HTTP フェッチのみで、SDK 等の依存ライブラリは使わない。
- **CI/CD 外部ツール**（依存関係ではなくパイプライン内ツール）:
  gitleaks（pinned v8.18.4, secret-scan）、`bun audit`
  （dependency-scan, advisory）。

## 内部クロスパッケージ依存（コンポーネント間、`components.md` の層構成に対応）

```
bin/aidlc-fleet.ts
  → src/commands/*（9 コマンド関数）
  → src/commands/real-deps.ts（buildRealDeps）
  → src/commands/argv.ts

src/commands/real-deps.ts（統合グルー層）
  → src/io/channel-client.ts
  → src/io/lockfile-store.ts
  → src/core/version-gate.ts
  → src/core/success-verifier.ts
  → src/core/drift-detector.ts
  → src/core/file-ownership-guard.ts
  → src/orchestration/engine-installer.ts
  → src/orchestration/plugin-manager.ts

src/orchestration/plugin-manager.ts
  → src/core/success-verifier.ts（SuccessVerifier）
  → src/types/channel.ts, src/types/lockfile.ts（型のみ）
  ※ ファイル I/O・ネットワーク I/O は一切直接行わない。
    PluginManagerPorts インターフェース経由で real-deps.ts から注入される
    （fetchPluginTarball/checkWriteAllowed/placeProjection/removeProjection/
    runCompose/regenerateSessionStartHook/doctorFailures）

src/orchestration/engine-installer.ts
  → src/core/success-verifier.ts（同様のポート注入パターン）

src/core/file-ownership-guard.ts
  → node:fs/promises（cp/lstat/mkdir/realpath/rm）
  ※ core 層で唯一、実ファイルシステム I/O に直接依存するコンポーネント

src/io/channel-client.ts
  → src/io/integrity.ts（verifySha256）
  → src/types/channel.ts（parseChannel）
  → グローバル fetch（bun 組み込み）
  ※ 唯一のネットワーク I/O 所有者
```

## 依存方向の原則（レイヤー分離規約, team.md）

コマンド層 → 統合グルー層（`real-deps.ts`） → コアロジック層 / I/O 層 /
オーケストレーション層、という一方向の依存になっており、コアロジック層
（`version-gate.ts`, `success-verifier.ts`, `drift-detector.ts`）は原則
ファイル I/O を持たず、下位のポートインターフェースを通じてのみ
オーケストレーション層（`plugin-manager.ts`, `engine-installer.ts`）に
接続される。これにより最もリスクの高いロジック（M2/M3/M4）をディスク
に触れずにユニットテストできる状態を保つ設計になっている
（`file-ownership-guard.ts` はこの原則の意図的な例外）。

## Issue #5 との関連

`pluginDirLabel()`（`plugin-manager.ts`）が返す論理パス `plugins/<name>`
と、`real-deps.ts` が実際に I/O を行う物理パス `.claude/plugins/<name>`
との間に暗黙の依存（文字列としてのパス一致が本来必要だが保証されていない）
があり、これが `FileOwnershipGuard` への検査対象パス不一致という
技術的負債を生んでいる。詳細は `code-quality-assessment.md` を参照。
