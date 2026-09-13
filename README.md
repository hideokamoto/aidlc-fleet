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

## aidlc-fleet CLI (`bin/aidlc-fleet.ts`)

`bin/aidlc-fleet.ts` と `src/` は、このリポジトリ自身が AI-DLC で開発している
別プロダクト — `aidlc-fleet-cli`。エンジンとプラグインの配布を1つの
**Channel** 宣言ファイルに集約し、`update`/`check` でプロジェクトをそれに
同期させる配布用CLI(上記の `/aidlc` ワークフロー実行そのものとは別物)。

```bash
bun bin/aidlc-fleet.ts --help
```

`init`/`update`/`plugin add|remove` 等の変更系コマンドは、以下の4つの環境変数を
参照する。優先順位は **環境変数 > プロジェクトローカルの `.aidlc-fleet.local.json`
(gitignore対象) > 組み込みデフォルト値 > 未設定** の順(issue #18)。

| 変数                      | 用途                                                    | デフォルト値                                          |
| ------------------------- | ------------------------------------------------------- | ----------------------------------------------------- |
| `AIDLC_FLEET_CHANNEL_URL` | Channel宣言のURL(必須)                                  | なし — チーム固有の配信URLのため                      |
| `AIDLC_FLEET_ENGINE_REPO` | エンジンtarball取得元 `owner/name` の**上書き**(任意・issue #11) | なし — 通常はChannel自身の `engine.repo` を使う       |
| `AIDLC_FLEET_COMPOSE_CMD` | upstream compose コマンド(空白区切り)                   | `bun .claude/tools/aidlc-orchestrate.ts next compose` |
| `AIDLC_FLEET_DOCTOR_CMD`  | upstream doctor コマンド(空白区切り)                    | `bun .claude/tools/aidlc-utility.ts doctor`           |

`AIDLC_FLEET_COMPOSE_CMD`/`AIDLC_FLEET_DOCTOR_CMD` のデフォルト値は、このリポジ
トリのようなセルフホスト型 Claude Code インストールで通常そのまま正しい値にな
る(`.claude/tools/aidlc.ts` のルーティング表が実際に `compose`/`doctor` をディ
スパッチする先と同一)。`AIDLC_FLEET_CHANNEL_URL` はチーム固有の配信URLのため、
デフォルトを持たない。`AIDLC_FLEET_ENGINE_REPO` はエンジンの取得元をChannel宣
言ファイル1つに集約するための設計(issue #11: `ChannelEngine.repo` — `ChannelPlugin.repo`
と同じ形)により、通常は**設定不要**――フリートオペレータがエンジンをフォーク/
ミラー先へ移す際もChannelファイル1つを更新するだけで全プロジェクトが追従する。
この環境変数は、Channelがまだ更新されていないフォークを一時的に試す等の例外的
なプロジェクト単位の上書きにのみ使う。

未設定の変数(通常は `AIDLC_FLEET_CHANNEL_URL` のみ)は、毎回シェルにexportし
直す代わりに一度だけ答えて保存できる:

```bash
bun bin/aidlc-fleet.ts config
```

`status`/`doctor` は各変数の解決元(`env` / `local-config` / `default` /
`unset`)を表示する。

既知の懸念: `AIDLC_FLEET_DOCTOR_CMD` の既定値が呼ぶ
`.claude/tools/aidlc-utility.ts` の `doctor` は、成功/失敗の各チェックを
`✓`/`✗` 付きの人間向け複数行で出力する。`aidlc-fleet-cli` 側の
`parseDoctorOutput()`(`src/commands/real-deps.ts`)は「空行と`#`行を除く
各行を1件の失敗として扱う」という前提のため、成功行まで失敗として誤カウント
される可能性がある(詳細は issue #19)。

### Channel ファイル

`AIDLC_FLEET_CHANNEL_URL` が指す先は HTTP(S) で取得できる JSON で、
`schema`・`channel`・`engine`・`migration_boundaries`・`plugins` などの
フィールドを持つ(詳細は [`examples/README.md`](examples/README.md))。
サンプルは [`examples/channel.example.json`](examples/channel.example.json) —
値はすべてダミーなので、自分の配布物に合わせて書き換えて配信すること。
