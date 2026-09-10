# コンポーネントインベントリ

## CommandLayer

- **パス**: `bin/aidlc-fleet.ts`, `src/commands/*.ts`（`real-deps.ts` を除く）
- **責務**: argv パース、コマンドディスパッチ、exit code の決定
- **依存**: `src/commands/argv.ts`, `src/commands/types.ts`（`CommandDeps`）、
  `src/commands/real-deps.ts`（`buildRealDeps`）
- **依存元**: なし（最上位層）
- **備考**: ロジックを持たず、`CommandDeps` へ処理を委譲する薄い層。

## RealDepsAssembly

- **パス**: `src/commands/real-deps.ts`
- **責務**: コマンド層・コアロジック層・I/O 層を実クロージャで結線する
  統合グルー層。`buildRealDeps()` が `CommandDeps` を組み立てる。
  `checkWriteAllowed`/`placeProjection`/`removeProjection` などプラグイン
  配置に関わる I/O クロージャの実装をここで持つ。
- **依存**: `ChannelClient`, `LockfileStore`, `VersionGate`,
  `SuccessVerifier`, `DriftDetector`, `FileOwnershipGuard`,
  `EngineInstaller`, `PluginManager`
- **依存元**: `bin/aidlc-fleet.ts`
- **備考**: **issue #5 (1) の直接の所在地** — 245–249行目
  `placeProjection` が tarball を展開せず生バイトを書き込む。

## VersionGate（M3）

- **パス**: `src/core/version-gate.ts`
- **責務**: origin-record version gate（v0.1 §4）— マイグレーション境界
  判定（reject/manual/none）
- **依存**: なし（コアロジックのみ、I/O なし）
- **依存元**: `RealDepsAssembly`（`update` コマンド経由）

## SuccessVerifier（M2）

- **パス**: `src/core/success-verifier.ts`
- **責務**: 四条件成功判定契約（v0.1 §6）。compose exit code、drops
  ファイル内容、doctor 失敗、既知失敗リストから成功/失敗を判定する。
  `classifyPluginSyncExit` メソッドも提供。
- **依存**: なし
- **依存元**: `PluginManager`, `EngineInstaller`, `RealDepsAssembly`

## DriftDetector

- **パス**: `src/core/drift-detector.ts`
- **責務**: インストール済み状態と channel 宣言のドリフト検出
- **依存**: なし
- **依存元**: `RealDepsAssembly`（`check`/`doctor` コマンド経由）

## FileOwnershipGuard（M4）

- **パス**: `src/core/file-ownership-guard.ts`
- **責務**: ファイル所有権 invariant（v0.1 §7）の実ファイルシステム検査
  — エンジン所有ディレクトリ置換の `--force`+バックアップ要求、
  settings/hooks のマージ規則、`aidlc/` 不可侵、シンボリックリンク
  書き込み禁止。違反検知時は即座に `FileOwnershipViolation` を throw
  （fail fast）。
- **依存**: `node:fs/promises`（`cp`/`lstat`/`mkdir`/`realpath`/`rm`）
- **依存元**: `PluginManager`, `EngineInstaller`（`checkWriteAllowed`
  ポート経由、`RealDepsAssembly` がラップして注入）
- **備考**: **issue #5 (2) に関連** — `PluginManager.add()`/`.remove()`
  が渡す `targetPath`（`pluginDirLabel()` の戻り値 `plugins/<name>`）が
  実書き込み先 `.claude/plugins/<name>` と一致していないため、この
  コンポーネントの `assertNoSymlinkInPath` 検査が誤ったパスを検査する。

## ExitCode（M8）

- **パス**: `src/core/exit-code.ts`
- **責務**: exit code 0–4 契約のマッピング
- **依存**: なし
- **依存元**: 全 9 コマンド関数

## ChannelClient

- **パス**: `src/io/channel-client.ts`
- **責務**: 唯一のネットワーク I/O 所有者。channel 宣言の取得
  （`fetchChannel`）と tarball の取得+sha256 検証（`fetchTarball`）
- **依存**: `src/io/integrity.ts`（`verifySha256`）、
  `src/types/channel.ts`（`parseChannel`）、bun 組み込み `fetch`
- **依存元**: `RealDepsAssembly`
- **備考**: 検証済みバイト列（`Uint8Array`）を返すのみで、tarball の
  展開責務は持たない — 展開は呼び出し側（`EngineInstaller`/
  `PluginManager` に注入される I/O クロージャ）の責務だが、プラグイン側
  では未実装。

## Integrity

- **パス**: `src/io/integrity.ts`
- **責務**: sha256 検証（`verifySha256`）、`TarballIntegrityError`
- **依存**: なし
- **依存元**: `ChannelClient`

## LockfileStore

- **パス**: `src/io/lockfile-store.ts`
- **責務**: ロックファイル（`aidlc.lock.json` 相当）の読み書き
- **依存**: 実ファイルシステム
- **依存元**: `RealDepsAssembly`, `PluginManager`, `EngineInstaller`

## EngineInstaller

- **パス**: `src/orchestration/engine-installer.ts`
- **責務**: エンジン tarball の取得・配置（ステージング書き込み）・
  compose 実行のオーケストレーション。ポートインターフェース経由で
  I/O を注入される。
- **依存**: `SuccessVerifier`
- **依存元**: `RealDepsAssembly`（`init`/`update` コマンド経由）
- **備考**: `placeEngine` は「tarball 展開は upstream の仕事」という
  設計意図がコメントで明示されており、issue #5 の対象外だが、同じ
  「生バイト書き込み」パターンを踏襲する参考コンポーネント。

## PluginManager

- **パス**: `src/orchestration/plugin-manager.ts`
- **責務**: プラグイン projection の配置/削除、セッション開始フックの
  再生成、compose 実行のオーケストレーション（`add()`/`remove()`）
- **依存**: `SuccessVerifier`, `ChannelPlugin`/`Lockfile`/`LockfilePlugin`
  型のみ（I/O は `PluginManagerPorts` 経由で注入）
- **依存元**: `RealDepsAssembly`（`plugin add`/`plugin remove` コマンド経由）
- **備考**: **issue #5 の両方の問題の起点** — `add()`/`remove()` が
  `pluginDirLabel()`（150–152行目、`` `plugins/${pluginName}` `` を返す）
  を `checkWriteAllowed` に渡す一方、実際の I/O クロージャ
  （`RealDepsAssembly` 側）は `.claude/plugins/<name>` に生バイトを
  書き込む。展開ロジック自体は `PluginManager` の外（`RealDepsAssembly`
  の `placeProjection` クロージャ）にあるため、`PluginManager` 自体は
  「展開されたバイト列を受け取る」契約を型注釈上仮定しているが、実際に
  そうなっている保証がない。

## Channel / Lockfile / Errors（型定義）

- **パス**: `src/types/channel.ts`, `src/types/lockfile.ts`,
  `src/types/errors.ts`
- **責務**: `Channel`/`ChannelPlugin`/`Lockfile`/`LockfilePlugin` 等の
  型定義とスキーマパース（`parseChannel`）。ロジックを持たない。
- **依存**: なし
- **依存元**: ほぼ全コンポーネント（型のみの依存）
