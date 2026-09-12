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

## aidlc-fleet CLI

`bin/aidlc-fleet.ts` と `src/` は、このリポジトリ自身が AI-DLC で開発している
別プロダクト — `aidlc-fleet-cli`。エンジンとプラグインの配布を1つの
**Channel** 宣言ファイルに集約し、`update`/`check` でプロジェクトをそれに
同期させる配布用CLI(上記の `/aidlc` ワークフロー実行そのものとは別物)。

```bash
bun bin/aidlc-fleet.ts --help
```

### 環境変数

`init`/`update`/`plugin add`/`plugin remove` などの変更系コマンドは、
起動時に以下の環境変数を読む:

| 変数 | 必須 | 説明 |
|---|---|---|
| `AIDLC_FLEET_CHANNEL_URL` | ✅ 全コマンド共通 | Channel 宣言を取得する URL。未設定だと `init` を含むすべてのコマンドがその場で失敗する。スキーマは [`examples/README.md`](examples/README.md)、実装は `src/types/channel.ts` の `parseChannel()` を参照。サンプルは [`examples/channel.example.json`](examples/channel.example.json)。 |
| `AIDLC_FLEET_ENGINE_REPO` | `init`/`update` で必須 | エンジンの tarball を取得する `owner/name` 形式の GitHub リポジトリ。Channel 自体は `engine.repo` を持たない(チャネル運用者が管理する契約の外)ため、この変数で補う。 |
| `AIDLC_FLEET_COMPOSE_CMD` | 変更系コマンドで必須 | upstream の compose 処理を呼び出す外部コマンド(スペース区切り、例: `bun /path/to/compose.ts`)。このCLIは upstream の compose/インストールロジックを再実装しない方針のため、必ず外部コマンドとして設定する。 |
| `AIDLC_FLEET_DOCTOR_CMD` | 任意 | upstream の doctor 検証を呼び出す外部コマンド(スペース区切り)。未設定時は「報告すべき失敗なし」として扱われ、検証が一部弱まるだけでコマンド自体は失敗しない。 |

`AIDLC_FLEET_COMPOSE_CMD` / `AIDLC_FLEET_DOCTOR_CMD` が指すべきスクリプトの実体は、
**このCLIが対象とするプロジェクトに実際にインストールされた AI-DLC エンジン
(upstream [`awslabs/aidlc-workflows`](https://github.com/awslabs/aidlc-workflows) の配布物)
が提供するもの** であり、この `aidlc-fleet-cli` 自身が同梱するものではない。
具体的には、対象プロジェクトのハーネスディレクトリ(`init --harness` で選んだ
ハーネスに対応する `.claude/tools/` や `.cursor/tools/` など)配下にある
compose/doctor 相当のスクリプトを `bun` 経由で呼び出すコマンドを設定する。
正確なファイル名・パスは upstream のバージョンやハーネスによって変わりうるため、
固定パスを前提にせず、対象プロジェクトの実際のツリーを確認して設定すること
(このリポジトリ自身の `.claude/tools/`・`.cursor/tools/` が、その一例)。

### Channel ファイル

`AIDLC_FLEET_CHANNEL_URL` が指す先は HTTP(S) で取得できる JSON で、
`schema`・`channel`・`engine`・`migration_boundaries`・`plugins` などの
フィールドを持つ(詳細は [`examples/README.md`](examples/README.md))。
サンプルは [`examples/channel.example.json`](examples/channel.example.json) —
値はすべてダミーなので、自分の配布物に合わせて書き換えて配信すること。
