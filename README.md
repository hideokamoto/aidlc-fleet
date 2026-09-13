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
| `AIDLC_FLEET_DOCTOR_CMD`  | upstream doctor コマンド(空白区切り)                    | なし — 下記「`AIDLC_FLEET_DOCTOR_CMD` の現状」を参照   |

`AIDLC_FLEET_COMPOSE_CMD` のデフォルト値は、このリポジトリのようなセルフホス
ト型 Claude Code インストールで通常そのまま正しい値になる(`.claude/tools/aidlc.ts`
のルーティング表が実際に `compose` をディスパッチする先と同一)。
`AIDLC_FLEET_CHANNEL_URL` はチーム固有の配信URLのため、デフォルトを持たない。
`AIDLC_FLEET_ENGINE_REPO` はエンジンの取得元をChannel宣言ファイル1つに集約す
るための設計(issue #11: `ChannelEngine.repo` — `ChannelPlugin.repo` と同じ形)
により、通常は**設定不要**――フリートオペレータがエンジンをフォーク/ミラー
先へ移す際もChannelファイル1つを更新するだけで全プロジェクトが追従する。こ
の環境変数は、Channelがまだ更新されていないフォークを一時的に試す等の例外的
なプロジェクト単位の上書きにのみ使う。

未設定の変数(通常は `AIDLC_FLEET_CHANNEL_URL`、および下記の理由で
`AIDLC_FLEET_DOCTOR_CMD`)は、毎回シェルにexportし直す代わりに一度だけ答えて
保存できる:

```bash
bun bin/aidlc-fleet.ts config
```

`status`/`doctor` は各変数の解決元(`env` / `local-config` / `default` /
`unset`)を表示する。`AIDLC_FLEET_DOCTOR_CMD` が `unset` のままでも、それ単体
では `doctor` コマンドの失敗にはならない(upstream doctor 検証が単にスキップ
されるだけ)——下記参照。

#### `AIDLC_FLEET_DOCTOR_CMD` の現状(issue #19, Problem 2)

`AIDLC_FLEET_DOCTOR_CMD` には現在、**組み込みデフォルト値が存在しない**。

以前は `bun .claude/tools/aidlc-utility.ts doctor`(`.claude/tools/aidlc.ts`
の `--doctor` ルートが実際にディスパッチする先)をデフォルトにしていたが、こ
れはこのリポジトリ自身のセルフホスト型ワークフロー健全性チェック(Claude Code
セッションを読む人間向けの、色付き複数行レポートを出力するツール)であり、
upstream `awslabs/aidlc-workflows` の `aidlc-doctor.ts`(`--json`/`--quiet` を
持つ、fleet CLI が本来検証対象とすべき「upstream doctor」)とは別物だった。

このリポジトリが vendor している `.claude/tools/`・`.cursor/tools/` は
`aidlc-doctor.ts` を含む upstream の世代よりも古く、`aidlc-doctor.ts` 本体も
その依存先(`aidlc-plugin.ts`・`aidlc-config-diagnostics.ts`・
`aidlc-model-policy.ts`・`aidlc-settings.ts`・`aidlc-update.ts`・
`aidlc-windows-uninstall.ts` ほか、合計で約2万行)もまだ存在しない。これらを
最小限だけ切り出して vendor することは現実的ではなく、実質的には upstream
エンジンの世代を丸ごと引き上げる、本 issue より大きい別種の変更になる
(issue #19 で追跡中)。

`src/commands/real-deps.ts` の `runDoctorCommand()` は(issue #19 Problem 1
の修正により)設定された doctor コマンドへ常に `--json` を強制付与し、
`parseDoctorOutput()` はその標準出力を単一行の JSON として解釈できない場合
に明示的に例外を投げる。旧デフォルトの `aidlc-utility.ts doctor` は
`--json` を一切解釈せず常に人間向けレポートを返すため、これを
`AIDLC_FLEET_DOCTOR_CMD` の既定値のままにしておくと、`doctor` を実行するた
びに必ず例外で落ちることになる——「動かないデフォルト」は「デフォルトが無
い」より悪い。そのため `AIDLC_FLEET_DOCTOR_CMD` は既定で `unset` を返すよう
にし、`doctor` コマンド側もこの1変数が `unset` であること単体では失敗にし
ない(`doctor: not configured — AIDLC_FLEET_DOCTOR_CMD is unset, so no checks
were run.` と表示するだけで exit code は 0)。

`SuccessVerifier` の四条件成功判定のうち upstream doctor による検証(第三条
件)は、この変数を自分のプロジェクトの実際の `--json` 対応 doctor スクリプ
トへ明示的に向けるまでの間、事実上機能しない。vendored engine を
`aidlc-doctor.ts` を含む世代へ更新するまでの既知の制約として、ここに明記す
る。

### Channel ファイル

`AIDLC_FLEET_CHANNEL_URL` が指す先は HTTP(S) で取得できる JSON で、
`schema`・`channel`・`engine`・`migration_boundaries`・`plugins` などの
フィールドを持つ(詳細は [`examples/README.md`](examples/README.md))。
サンプルは [`examples/channel.example.json`](examples/channel.example.json) —
値はすべてダミーなので、自分の配布物に合わせて書き換えて配信すること。
