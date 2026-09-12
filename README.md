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
| `AIDLC_FLEET_ENGINE_REPO` | `init`/`update` で必須 | エンジンの tarball を取得する `owner/name` 形式の GitHub リポジトリ。Channel 自体は `engine.repo` を持たない(チャネル運用者が管理する契約の外)ため、この変数で補う。値の例: `awslabs/aidlc-workflows`(このCLIが配布対象とする upstream 本体そのもの)。 |
| `AIDLC_FLEET_COMPOSE_CMD` | 変更系コマンドで必須 | upstream の compose 処理を呼び出す外部コマンド(スペース区切り)。このCLIは upstream の compose/インストールロジックを再実装しない方針のため、必ず外部コマンドとして設定する。値の例: `bun .claude/tools/data/plugin-hooks-template/compose.ts`(下記参照)。 |
| `AIDLC_FLEET_DOCTOR_CMD` | 任意 | upstream の doctor 検証を呼び出す外部コマンド(スペース区切り)。未設定時は「報告すべき失敗なし」として扱われ、検証が一部弱まるだけでコマンド自体は失敗しない。値の例は下記の既知の懸念を参照。 |

#### `COMPOSE_CMD`/`DOCTOR_CMD` の実体(upstream `awslabs/aidlc-workflows` を実際に確認して裏取り済み)

**COMPOSE_CMD**: upstream の `scripts/plugin-hooks-template/compose.ts` が
`package.ts` のビルドでそのまま `<harnessDir>/tools/data/plugin-hooks-template/compose.ts`
にコピーされて配布される。中身は「新しいファイルをプロジェクトへコピーし、
ステージグラフを再コンパイルする」処理で、`PluginManager`/`EngineInstaller`
の `runCompose` が期待する処理と一致する。`AIDLC_PROJECT_DIR` 環境変数を
読む作りになっており、これはこのCLIが `runCompose` 呼び出し時に自動で
注入する変数名と一致する(`real-deps.ts`)。このリポジトリ自身にも
`.claude/tools/data/plugin-hooks-template/compose.ts` /
`.cursor/tools/data/plugin-hooks-template/compose.ts` として実在するため、
このリポジトリ自身を対象にする場合は以下がそのまま動く値になる:

```bash
export AIDLC_FLEET_COMPOSE_CMD="bun .claude/tools/data/plugin-hooks-template/compose.ts"
```

**DOCTOR_CMD**: upstream の最新版では、統合CLI `aidlc.ts` の `doctor` サブコマンドが
`core/tools/aidlc-doctor.ts` に委譲される(`bun <harnessDir>/tools/aidlc-doctor.ts doctor`)。
**既知の懸念**: `aidlc-doctor.ts` の既定出力は色付きの人間向け複数行レポートで、
`--json`(1行のJSON)・`--quiet`(1行のサマリ文)というモードもあるが、
いずれも `aidlc-fleet-cli` 側の `parseDoctorOutput()`(`src/commands/real-deps.ts`)
が前提にしている「空行と`#`行を除く各行を1件の失敗として扱う」という解釈とは
形式が噛み合わない。加えて、**このリポジトリ自身が現在同梱しているエンジンの
バージョンには `aidlc-doctor.ts` 自体が存在しない**(統合CLI化より前の世代の
ツリーをvendorしている)。したがって、このリポジトリ内で今すぐ動く
`DOCTOR_CMD` の値は無く、`aidlc-doctor.ts` を含む新しいエンジンに更新した上で、
かつ出力形式の不一致を別途解消しない限り、`DOCTOR_CMD` は事実上使えない状態にある
(この不一致は `aidlc-fleet-cli` 側の別issueとして切り出す価値がある)。

### Channel ファイル

`AIDLC_FLEET_CHANNEL_URL` が指す先は HTTP(S) で取得できる JSON で、
`schema`・`channel`・`engine`・`migration_boundaries`・`plugins` などの
フィールドを持つ(詳細は [`examples/README.md`](examples/README.md))。
サンプルは [`examples/channel.example.json`](examples/channel.example.json) —
値はすべてダミーなので、自分の配布物に合わせて書き換えて配信すること。
