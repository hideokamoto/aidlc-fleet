# aidlc-fleet

AI-DLC (AI-Driven Development Life Cycle) 2.0 のワークフロー実装。
[awslabs/aidlc-workflows](https://github.com/awslabs/aidlc-workflows) の配布物を、
このリポジトリで **Claude Code** と **Cursor** の両方から使えるようにセットアップ済み。

## 使い方

どちらのエディタ/CLIでも、プロジェクトルートで `/aidlc` を実行して開始する。

### Claude Code

```bash
claude
/aidlc --doctor                # セットアップ検証
/aidlc <作りたいものの説明>
```

- モデルプロバイダはデフォルトの AWS Bedrock ではなく、Anthropic 直接API/サブスクに変更済み(`.claude/settings.json`)。
- 個人設定を上書きしたい場合は `.claude/settings.local.json.example` を `.claude/settings.local.json` にコピーする(gitignore対象)。

### Cursor

```bash
# Cursor IDE または Cursor CLI (agent) のどちらでも同じ .cursor/ を読む
/aidlc --doctor
/aidlc <作りたいものの説明>
```

Cursor固有のショートカット: `/aidlc-status`, `/aidlc-jump --stage <slug>`, `/aidlc-scope <name>`

## 共通の前提条件

- **bun** が必須(CLIツール・フック用): `curl -fsSL https://bun.sh/install | bash`
- 両ハーネスは `aidlc/` ワークスペース(状態・監査ログ・成果物)を共有する。`.claude/` と `.cursor/` はそれぞれのハーネス固有の薄いシェル。

## ディレクトリ構成

```
.claude/    # Claude Code 用ハーネス(skills, agents, hooks, settings.json)
.cursor/    # Cursor 用ハーネス(skills, agents, hooks, rules)
aidlc/      # 共有ワークスペース(method, state, audit log, 成果物)
AGENTS.md   # Cursor 用プロジェクト説明(インストーラが生成)
.mcp.json   # Claude Code 用 MCPサーバー定義(context7, AWS系。任意)
```

## セットアップ内容の再現・アップグレード

```bash
git clone https://github.com/awslabs/aidlc-workflows
cd aidlc-workflows

# Claude Code
cp -r dist/claude/.claude/ <project>/.claude/
cp -r dist/claude/aidlc/ <project>/aidlc/

# Cursor(インストーラが差分マージしてくれる)
bun dist/cursor/install.ts <project>
```

詳細は本家の [ドキュメント](https://github.com/awslabs/aidlc-workflows/tree/main/docs/guide) を参照。

## 配布CLI (`aidlc-fleet-cli`)

このリポジトリ自体は上記の AI-DLC ワークフロー実装だが、`src/` と `bin/aidlc-fleet.ts`
配下には**別プロダクト**として `aidlc-fleet-cli`(パッケージ名 `aidlc-fleet-cli`)が
同居している。これは、中央の「チャネル宣言」ファイル1つでエンジンバージョンと
プラグイン集合を宣言し、複数プロジェクトをそこへ同期させるための配布用CLIで、
上記の AI-DLC ワークフロー本体(`.claude/`, `.cursor/`, `aidlc/`)とは独立して動く。

### 実行方法

```bash
bun bin/aidlc-fleet.ts <command> [options]
# または
bun install && bun link   # aidlc-fleet コマンドとして使えるようにする場合
```

### コマンド

```
aidlc-fleet init [--adopt] [--harness <name>] [--force]
aidlc-fleet update [--acknowledge-migration]
aidlc-fleet check
aidlc-fleet plugin add <name>
aidlc-fleet plugin remove <name>
aidlc-fleet pin <ref>
aidlc-fleet unpin
aidlc-fleet status
aidlc-fleet doctor
```

- `init`: チャネルが宣言するエンジンを取得し、対象プロジェクトに初期セットアップする。
  既存のエンジン所有ディレクトリ(`.claude/`)を置き換える場合は `--force` が必須
  (置き換え前に自動でバックアップを取る)。`--adopt` は「AI-DLC 管理下に既存プロ
  ジェクトを引き入れる」印を記録し、以後の `update` の前提条件になる。
- `update`: チャネルの最新(または `pin` されたバージョン)へ更新する。バージョン
  ゲート(migration boundary)が `reject`/`manual` と判定した場合は失敗するか
  `--acknowledge-migration` を要求する。
- `check`: ローカルの状態とチャネル宣言のドリフト(差分)を検出する(書き込みは
  行わない)。
- `plugin add` / `plugin remove`: チャネルが宣言するプラグインの projection を
  追加・削除し、sessionStart フックを再生成する。
- `pin` / `unpin`: プロジェクト単位でエンジンバージョンを固定・解除する。
- `status`: チャネル・インストール済みエンジンバージョン・プラグイン一覧・pin
  状態・ドリフト状況を人間可読に要約する(このコマンド自体は失敗しない)。
- `doctor`: アップストリームの `doctor` コマンドをラップし、結果を要約する。

### 環境変数

| 変数                      | 必須/任意                    | 説明                                                                                                                                                                                                 |
| ------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AIDLC_FLEET_CHANNEL_URL` | 必須(全コマンド)             | チャネル宣言ファイルのURL(gitリポジトリのraw URL、または静的URL)。                                                                                                                                   |
| `AIDLC_FLEET_COMPOSE_CMD` | 必須(書き込みを伴うコマンド) | アップストリームの `compose` コマンド。スペース区切り(例: `bun /path/to/compose.ts`)。このCLI自身はアップストリームの `install.ts`/`compose.ts` のロジックを再実装せず、常にこのコマンドへ委譲する。 |
| `AIDLC_FLEET_DOCTOR_CMD`  | 任意                         | アップストリームの `doctor` コマンド。未設定時は「未対処の失敗なし」として扱われる(四条件成功判定の第3項)。                                                                                          |
| `AIDLC_FLEET_ENGINE_REPO` | `init`/`update` に必須       | エンジンの tarball を取得する GitHub リポジトリ(`owner/name` 形式)。チャネル宣言の `engine` エントリはコミットSHA(`ref`)のみを持ち、リポジトリ自体は持たないため、この変数で補う。                   |

`plugin add` で取得するプラグインの tarball は、チャネル宣言の各プラグインエント
リが持つ `repo` フィールドから直接解決される(こちらは環境変数不要)。

### tarball の展開と配置

`init`/`update`/`plugin add` は、対象の GitHub リポジトリ(`AIDLC_FLEET_ENGINE_REPO`
またはプラグインの `repo`)を [codeload](https://codeload.github.com) 経由で
`tar.gz` として取得し、チャネル宣言の `sha256` と一致することを確認したうえで
実ファイルとして展開する(生バイト列のまま `.tar` として書き出すだけの旧実装は
`src/io/tar-extractor.ts` の実装により解消済み)。

- **プラグイン**: 展開先はそのまま `.claude/plugins/<name>/`。プラグインリポジト
  リの内容がそのままプラグインの projection になる想定。
- **エンジン**: `AIDLC_FLEET_ENGINE_REPO` は `awslabs/aidlc-workflows` 全体のモノ
  レポなので、`.claude/` へ直接展開はしない(`dist/<harness>/.claude/` のように
  ネストしており、どのサブツリーをどこへ配置するかはアップストリームの
  `install.ts`/`compose.ts` の責務であり、このCLIでは再実装しない — project.md
  の Forbidden 規約)。代わりにプロジェクト直下の `.aidlc-fleet/engine-src/` へ
  展開し、そのパスを `AIDLC_FLEET_ENGINE_SRC_DIR` 環境変数として
  `AIDLC_FLEET_COMPOSE_CMD` の実行時に渡す。`compose` コマンド側はこの変数を
  読み、必要なサブツリーをプロジェクトへコピーする。

### 開発

```bash
bun install
bun test src/          # ユニット・統合テスト(TDD, 80% ライン・カバレッジ床)
bun test:coverage       # カバレッジ付き
bunx tsc --noEmit       # 型チェック
bun run lint            # ESLint
bun run format          # Prettier
```

exit code は `0`(成功)/`1`(ローカルがチャネルより古い)/`2`(ローカル変更による
ドリフト)/`3`(バージョンゲート拒否)/`4`(compose degraded/インストール未完了)の
5値契約(M8)に従う。コマンドごとの詳細は
`aidlc/spaces/default/intents/260907-distribution-cli/construction/functional-design/functional-spec.md`
を参照。
