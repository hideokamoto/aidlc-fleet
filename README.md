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
| `AIDLC_FLEET_DOCTOR_CMD`  | upstream doctor コマンド(空白区切り)。**既定値は現状 実際には機能しない — issue #19、下記「既知の制約」参照** | `bun .claude/tools/aidlc-utility.ts doctor` |

`AIDLC_FLEET_COMPOSE_CMD` のデフォルト値は、このリポジトリのようなセルフホス
ト型 Claude Code インストールで通常そのまま正しい値になる — `.claude/tools/`
配下に実体として存在し、実際に `compose` をディスパッチできる。
`AIDLC_FLEET_DOCTOR_CMD` のデフォルト値は**現状 実際には機能しない**(下記
「既知の制約」参照)。`AIDLC_FLEET_CHANNEL_URL` はチーム固有の配信URLのため、
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

#### 既知の制約: `AIDLC_FLEET_DOCTOR_CMD` に現状 実際に機能する値が無い(issue #19)

このリポジトリが `.claude/tools/`・`.cursor/tools/` に vendor しているエンジ
ンは、統合CLI `aidlc.ts`(および `aidlc-doctor.ts` を含むその世代)より**前**
の世代であり、`aidlc.ts` 自体がこのリポジトリには存在しない。

`AIDLC_FLEET_DOCTOR_CMD` の既定値 `bun .claude/tools/aidlc-utility.ts doctor`
は、この vendored エンジンが実際に持っている唯一の doctor 相当コマンドだが、
`--json`/`--quiet` を一切解釈しない(常に `✓`/`✗` 付きの人間向け複数行レポー
トを出力する)。実測(2026-09-13, 本リポジトリの `main` 上): `bun
.claude/tools/aidlc-utility.ts doctor --json` を実行しても `--json` は無視さ
れ、通常の複数行レポートがそのまま出力される。

一方、`src/commands/real-deps.ts` の `runDoctorCommand()`/`parseDoctorOutput()`
は #39(issue #19 の問題1)で「doctor コマンドに強制的に `--json` を付与し、
stdout を単一行 JSON として `JSON.parse` して `data.failed` を取り出す。JSON
として解釈できなければ例外を投げる」という契約に変更済み。

この2つを組み合わせると、**このリポジトリを対象に `AIDLC_FLEET_DOCTOR_CMD` を
未設定のまま(=既定値のまま)`doctor` 検証(`SuccessVerifier` の第三条件)を
実行すると、必ず例外が投げられる**(誤カウントではなく、明示的なエラーとして
失敗する — #39 が意図した「サイレントな誤カウントより、呼び出し不整合を明示
的に失敗させる」という設計どおりの挙動ではあるが、結果として doctor 検証その
ものが常に機能しない)。

回避策:
- 暫定的には `AIDLC_FLEET_DOCTOR_CMD` を明示的に空文字列に設定(unset)する。
  `runDoctorCommand()` は「未設定」を `{ failures: [], configured: false }`
  として扱い、コマンド自体を失敗させない(`doctor`/`status` は `configured:
  false` を「doctor 検証は未実行」として表示する)。
- upstream `awslabs/aidlc-workflows` の `aidlc-doctor.ts` を含む世代へ実際に
  更新したプロジェクト(またはその実体を別途用意できるプロジェクト)であれば、
  そのプロジェクトの `aidlc-doctor.ts` へのパスを `AIDLC_FLEET_DOCTOR_CMD` に
  設定することで、`--json` 契約どおりに機能する。

根本修正(このリポジトリ自身が vendor しているエンジンを `aidlc-doctor.ts` を
含む世代へ更新すること)は、`aidlc-doctor.ts` が直接 import するだけでも
`aidlc-update.ts`・`aidlc-plugin.ts`(1,484行)・`aidlc-windows-uninstall.ts`・
`aidlc-color.ts`・`aidlc-model-policy.ts`・`aidlc-config-diagnostics.ts`
(2,256行)・`aidlc-settings.ts` の7ファイルを新規に要し、それらが更に
`aidlc-channel.ts`・`aidlc-install-paths.ts`・`aidlc-machine-config.ts`・
`aidlc-release.ts`・`aidlc-transaction.ts`・`aidlc-version.ts`・
`aidlc-tiers.ts`・`aidlc-distribution.ts` を推移的に要求する ——
実質的に upstream の「インストーラ/ライフサイクル管理」サブシステムをまるごと
vendor し直すのに等しい規模で、本 issue の範囲を明確に超える別種の変更である。
そのため本 PR ではこの根本修正を行わず、上記の現状と回避策の明記のみを対応範
囲とした。引き続き issue #19 でトラッキングする。

### Channel ファイル

`AIDLC_FLEET_CHANNEL_URL` が指す先は HTTP(S) で取得できる JSON で、
`schema`・`channel`・`engine`・`migration_boundaries`・`plugins` などの
フィールドを持つ(詳細は [`examples/README.md`](examples/README.md))。
サンプルは [`examples/channel.example.json`](examples/channel.example.json) —
値はすべてダミーなので、自分の配布物に合わせて書き換えて配信すること。
