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
