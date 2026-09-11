# コード構造

## パッケージ/モジュール構成

```
bin/
  aidlc-fleet.ts          — CLI エントリポイント（argv ルーティング）
src/
  commands/                — コマンド層（引数パース・exit code 決定のみ）
    argv.ts                 — argv パースユーティリティ（hasFlag/positionals/readOption）
    types.ts                — CommandDeps（依存性注入コンテナ）型定義
    real-deps.ts             — 統合グルー層。buildRealDeps() が実 I/O クロージャを結線する
    init.ts / update.ts / check.ts / plugin.ts / pin.ts / status.ts / doctor.ts
                             — 各サブコマンドの実装（9 コマンド関数）
    __fixtures__/test-deps.ts — テスト用フィクスチャ（モック CommandDeps）
  core/                     — コアロジック層（原則ファイル I/O なし）
    version-gate.ts          — バージョンゲート判定（M3, v0.1 §4）
    success-verifier.ts       — 四条件成功判定（M2, v0.1 §6）
    drift-detector.ts         — インストール状態のドリフト検出
    file-ownership-guard.ts   — ファイル所有権 invariant 検査（M4, v0.1 §7）。
                                唯一 core 層で実ファイルシステム I/O を直接行う
    exit-code.ts              — exit code 0–4 マッピング（M8, v0.1 §8）
  io/                       — I/O 層
    channel-client.ts         — 唯一のネットワーク I/O 所有者（channel/tarball フェッチ）
    integrity.ts               — sha256 検証（verifySha256）
    lockfile-store.ts          — ロックファイルの読み書き
  orchestration/            — オーケストレーション層
    engine-installer.ts        — エンジン導入フロー（EngineInstaller）
    plugin-manager.ts           — プラグイン導入/削除フロー（PluginManager）
  types/                    — 型定義のみ（実装ロジックなし）
    channel.ts / lockfile.ts / errors.ts
    __fixtures__/*.json       — 型検証用フィクスチャ
```

各実装ファイルに対応する `*.test.ts` が同一ディレクトリに co-locate
されている（専用の `test/`／`__tests__/` ディレクトリはない）。

## ファイル分類

| 分類 | 該当パス | 特徴 |
|---|---|---|
| エントリポイント | `bin/aidlc-fleet.ts` | argv ルーティングのみ、ロジックを持たない |
| コマンド層 | `src/commands/*.ts`（`real-deps.ts` を除く） | 引数パース + exit code 決定 |
| 統合グルー層 | `src/commands/real-deps.ts` | 3 層を実クロージャで結線。issue #5 の該当箇所（245–249行目）を含む |
| コアロジック層 | `src/core/*.ts` | 判定ロジック中心。`file-ownership-guard.ts` のみ実 I/O を持つ例外 |
| I/O 層 | `src/io/*.ts` | ネットワーク/ファイルシステムの低レベル操作 |
| オーケストレーション層 | `src/orchestration/*.ts` | ポートインターフェース経由で I/O を注入され、業務フローを組み立てる。issue #5 のもう一つの該当箇所（`plugin-manager.ts` 150–152行目の `pluginDirLabel()`）を含む |
| 型定義 | `src/types/*.ts` | ロジックを持たない、`Channel`/`Lockfile`/エラー型 |
| テスト | `**/*.test.ts` | 実装ファイルと同一ディレクトリに co-locate |
| フィクスチャ | `src/commands/__fixtures__/`, `src/types/__fixtures__/` | テスト用モックデータ |

## コードパターン

- **依存性注入によるポートインターフェース分離**: `PluginManagerPorts`
  （`plugin-manager.ts`）や `EngineInstaller` の同種インターフェースが、
  コアオーケストレーションクラスを具体的な I/O 実装から切り離している。
  実装（具体的なクロージャ）は `real-deps.ts` の `buildRealDeps()` に
  集約される。
- **JSDoc スタイルの構造化コメント**: 各モジュール冒頭に担当コンポーネント
  名・関連ドキュメント名（`components.md` 等）・設計根拠を明記する記法が
  一貫している。
- **エラークラスは `Error` を継承し `Object.setPrototypeOf` で prototype
  chain を明示的に修復**する記法が `ChannelFetchError`（`channel-client.ts`）
  や `FileOwnershipViolation`（`file-ownership-guard.ts`）で共通して
  使われている（TypeScript が `class extends Error` で prototype chain を
  壊す既知の挙動への対処）。
- **不変条件をコード内コメントで明示的に記録** — 「なぜその実装選択を
  したか」（例: `buildTarballUrl` のバグ修正経緯、`bunfig.toml` の
  `functions = 0.0` の理由）が随所にコメントとして残されている。
