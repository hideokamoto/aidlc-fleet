# API ドキュメント

## 外部 API — CLI コマンド

エントリポイント: `bin/aidlc-fleet.ts`。すべてのコマンドは exit code
0–4 の契約（M8, `src/core/exit-code.ts`）に従う。

| コマンド | 実装 | 概要 |
|---|---|---|
| `init [--adopt] [--harness <name>] [--force]` | `src/commands/init.ts` (`runInit`) | 新規プロジェクトへエンジンを初期導入。`--adopt` で既存導入引き継ぎ、`--force` で既存ディレクトリ上書き |
| `update [--acknowledge-migration]` | `src/commands/update.ts` (`runUpdate`) | channel 宣言へ同期。`VersionGate` のマイグレーション境界判定（reject/manual/none）を経由 |
| `check` | `src/commands/check.ts` (`runCheck`) | インストール状態のドリフト検査（`DriftDetector`） |
| `plugin add <name>` | `src/commands/plugin.ts` (`runPluginAdd`) | プラグイン導入。`PluginManager.add()` を呼び出す。**issue #5 の対象コマンド** |
| `plugin remove <name>` | `src/commands/plugin.ts` (`runPluginRemove`) | プラグイン削除。`PluginManager.remove()` を呼び出す |
| `pin <ref>` | `src/commands/pin.ts` (`runPin`) | エンジンバージョンを ref に固定 |
| `unpin` | `src/commands/pin.ts` (`runUnpin`) | ピン固定を解除 |
| `status` | `src/commands/status.ts` (`runStatus`) | ロックファイル状態を表示 |
| `doctor` | `src/commands/doctor.ts` (`runDoctor`) | 導入済みエンジン/プラグインの健全性診断 |

### 環境変数（`bin/aidlc-fleet.ts` 31-35行目のヘルプテキストで文書化）

| 変数 | 必須性 | 用途 |
|---|---|---|
| `AIDLC_FLEET_CHANNEL_URL` | 必須 | channel 宣言の URL |
| `AIDLC_FLEET_COMPOSE_CMD` | mutating コマンドで必須 | upstream compose コマンド（空白区切り） |
| `AIDLC_FLEET_DOCTOR_CMD` | 任意 | upstream doctor コマンド（空白区切り）。未設定時は「未対応の失敗なし」扱い |
| `AIDLC_FLEET_ENGINE_REPO` | init/update で必須 | エンジン tarball の取得元 `owner/name` |

## 外部 API 呼び出し（本 CLI がクライアントとなる）

- `ChannelClient.fetchChannel(channelUrl: string): Promise<Channel>`
  （`src/io/channel-client.ts`） — channel 宣言を HTTP GET で取得し
  `parseChannel` でスキーマ検証。
- `ChannelClient.fetchTarball(url: string, expectedSha256: string): Promise<Uint8Array>`
  （同上） — tarball を HTTP GET で取得し、`verifySha256` で整合性を
  同期的に検証してから返す（不一致は `TarballIntegrityError`、リトライ
  なし）。
- `buildTarballUrl(repo, ref)`（`real-deps.ts`） — GitHub codeload
  アーカイブ規約 `https://codeload.github.com/${repo}/tar.gz/${ref}` で
  URL を構築する内部ヘルパー。

## 内部ポートインターフェース（外部公開 API ではなく、テストのモック境界を兼ねる内部契約）

### `PluginManagerPorts`（`src/orchestration/plugin-manager.ts`）

| メソッド | シグネチャ | 備考 |
|---|---|---|
| `fetchPluginTarball` | `(plugin: ChannelPlugin) => Promise<Uint8Array>` | `ChannelClient.fetchTarball` へ委譲 |
| `checkWriteAllowed` | `(targetPath: string) => Promise<void>` | `FileOwnershipGuard.checkWriteAllowed` へ委譲。**issue #5 (2): `pluginDirLabel()` が渡す `targetPath` が実書き込み先と不一致** |
| `loadLockfile` / `saveLockfile` | `() => Promise<Lockfile>` / `(lockfile: Lockfile) => Promise<void>` | `LockfileStore` へ委譲 |
| `removeProjection` | `(pluginName: string) => Promise<void>` | `.claude/plugins/<name>` を `rm -rf` |
| `placeProjection` | `(pluginName: string, bytes: Uint8Array) => Promise<void>` | **issue #5 (1) の核心**: 型注釈上は「配置」を示唆するが、実装は生バイトを `.projection.tar` として書き込むのみで展開しない |
| `runCompose` | `(env: Record<string,string>) => Promise<ComposeResult>` | upstream compose をサブプロセス実行 |
| `regenerateSessionStartHook` | `(pluginNames: string[]) => Promise<void>` | セッション開始フックの BEGIN/END マーカーブロックを再生成 |
| `doctorFailures` | `() => Promise<string[]>` | `SuccessVerifier` 第三条件の入力 |

### `EngineInstaller` のポート群（`src/orchestration/engine-installer.ts` から `real-deps.ts` に注入される実装）

`checkEngineDirectoryReplace` / `placeEngine` / `runCompose` /
`doctorFailures` / `loadLockfile` / `saveLockfile` /
`fetchEngineTarball`。`placeEngine` はプラグイン側と対称的に生バイトを
`.engine-${harness}.tar` としてステージング書き込みするのみだが、
コード内コメントで「実際の tarball 展開/install.ts ラップは upstream の
仕事」と明記されており、これは設計上の意図として一貫している（プラグ
イン側の非対称性は `code-quality-assessment.md` Technical Debt 参照）。

### `CommandDeps`（`src/commands/types.ts`）

全 9 コマンド関数が受け取る依存性注入コンテナ。`real-deps.ts` の
`buildRealDeps()` が本番用の実装を組み立てる。テストでは
`__fixtures__/test-deps.ts` のモックが注入される。

## 契約と失敗モード

- exit code 契約（M8）: 全コマンドが `src/core/exit-code.ts` の
  マッピングに従い 0–4 のいずれかを返す。
- `ChannelFetchError` / `TarballIntegrityError`（`channel-client.ts`,
  `integrity.ts`） — ネットワーク/整合性検証の失敗。
- `FileOwnershipViolation`（`file-ownership-guard.ts`） — M4 invariant
  違反時に即座に throw（fail fast, warn-and-continue しない）。
