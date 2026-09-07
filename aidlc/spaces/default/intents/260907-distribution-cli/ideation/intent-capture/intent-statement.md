# Intent Statement — aidlc-fleet Distribution CLI

## Problem Statement

Individuals and teams running AI-DLC across multiple projects have no
central way to declare "which engine version and which plugin set" every
project should run, and no mechanized way for a project to follow that
declaration over time. `git submodule` is explicitly rejected as the
distribution mechanism. Naive file-copy engine upgrades corrupt already-
composed plugin surfaces [Q2], and the plugin compose process can silently
degrade a stage while still exiting 0 — success cannot be inferred from exit
code alone. [Q1] [Q3]

## Target Customer

Internal: the same individual or team operating multiple AI-DLC-enabled
projects across several harnesses (Cursor, Kiro, Codex, opencode, Copilot —
explicitly not Claude-Code-only). They experience version/plugin drift
across projects and lack a safe, harness-agnostic update path. [Q2]

## Success Metrics

`init` / `update` / `plugin add` are judged successful only when **all**
of the following hold simultaneously:

1. The compose process exits 0.
2. No `[degraded]` line appears in the relevant `.drops` file.
3. `doctor`'s failed count, minus `known_failures`, is 0.
4. A `plugin sync` exit 1 is surfaced to the human as "installation
   incomplete" rather than silently treated as failure.

Exit-code-0 from compose alone is explicitly disqualified as proof of
success. The CLI's exit-code contract is: `0` = lockfile/channel/disk in
sync, `1` = behind channel (resolvable via `update`), `2` = local
modification drift, `3` = version-gate rejection, `4` = compose
degraded or engine install incomplete. [Q3]

## Initiative Trigger

Upstream `awslabs/aidlc-workflows` has not yet shipped native multi-project
distribution (tracked upstream as RFC #722 / PR #756: `aidlc update`,
project pin). This CLI is explicitly positioned as a thin, temporary
distribution layer intended to retire once upstream ships that capability —
it does not reimplement upstream's plugin-compose logic and does not modify
upstream files. [Q4] [desc]

## Initial Scope Signal

- **Workflow-selected scope** (composer-proposed, human-approved before this
  stage began): `aidlc-distribution-cli` — a custom 15-of-33-stage grid
  (intent-capture, scope-definition, approval-handoff, practices-discovery,
  domain-design, contract-design, functional-design, nfr-requirements,
  nfr-design, code-generation, build-and-test, ci-pipeline, plus the three
  initialization stages). [scope]
- **User-confirmed product boundary**: confirmed as matching the intended
  scope — command surface (`init`, `update`, `check`, `plugin add/remove`,
  `pin`/`unpin`, `status`, `doctor`), the channel/lockfile data model, the
  origin-record version gate, the sessionStart hook, the four-part success
  criterion, and the file-ownership invariants, all as specified in the
  shared v0.1 requirements document. [Q8]

## Assumptions & Open Questions

None.

## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-product-lead-agent
**Date:** 2026-09-07T14:19:22Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Critical | intent-statement.md > Initial Scope Signal, bullet 1 | 「ARS 45/100」というスコアと、除外された9ステージの具体リスト（market-research, feasibility, team-formation, mockups, user-stories, units-generation, delivery-planning, infrastructure-design, および全Operationフェーズステージ）およびその除外理由（"internal dev-tooling CLI with an already-complete requirements document and no deployment/operational surface of its own"）は、`intent-capture-questions.md` のいずれの Q&A にも、`[desc]`/`[scope]`/`[memory:M<n>]` のどの許可ソースにも見当たらない。Q8 は15ステージの含有リストと「承認済み」という事実のみを確認しており、ARSスコアや除外理由の根拠にはなっていない。ステージ定義のgrounding contract（許可ソースは [desc], confirmed [Q<n>], [scope], [memory:M<n>] のみ）に違反する未ソースの事実主張。 | ARSスコアと除外ステージの理由付けの記述を削除するか、実際に許可された情報源（例えば `[scope]` タグで裏付けられる実際のスコープファイルの内容）から出典を明示する。Q8で確認された「15/33ステージ、ARS/理由は言及なし」の範囲に記述を絞る。 | Resolved |
| R-02 | Critical | stakeholder-map.md > Assumptions & Open Questions（intent-capture-questions.md 全体） | `stakeholder-map.md` の `## Assumptions & Open Questions` は `None.` ではなく、未解決の assumption（downstream projectsが別人格のstakeholderかどうか）を1件含んでいる。ステージ定義 Step 5 により、両artifactのAssumptions欄が両方とも `None.` でない限り `## Assumption Confirmation` セクションを `intent-capture-questions.md` に作成し、`A. Accept assumptions` / `B. Convert to follow-up questions` の選択を人間に提示しなければならないが、`intent-capture-questions.md` にはそのセクションが存在せず、人間の確認を経ないまま完了扱いになっている。 | `intent-capture-questions.md` に `## Assumption Confirmation` セクションを追加し、当該assumptionについて人間の確認（Accept / Convert to follow-up）を得てから、必要であれば両artifactを改訂し、レビューをやり直す。 | Resolved |
| R-03 | Major | intent-statement.md > Problem Statement | 段落は `[Q1] [Q3]` のみでタグ付けされているが、「Naive file-copy engine upgrades corrupt already-composed plugin surfaces」という主張は `intent-capture-questions.md` の Q2 回答（"naive file copy corrupts composed plugin surfaces (E3)"）に由来しており、Q2由来の内容にQ2タグが付いていない。ソーストレーサビリティが不正確。 | 当該文に `[Q2]` タグを追加し、出典を正確に反映する。 | Resolved |

### Summary

問題定義・顧客・成功指標・トリガーの各セクションはQ&Aへのトレーサビリティが概ね良好で、削除された `git submodule` の却下や四部構成の成功基準など、要件文書の重要な制約を正確に反映している点は評価できる。しかし Initial Scope Signal に含まれる ARS スコアと除外ステージの理由付けが完全に未ソースであり（R-01）、さらに stakeholder-map.md に残った未解決 assumption がステージ定義で必須の Assumption Confirmation ゲートを経ずに素通りしている（R-02）。この2件のCriticalは、開発者がこの成果物だけを見て「スコープが正確にどう決まったか」「未解決事項について人間が本当に合意したか」を検証できない状態を作っており、承認ゲートに進む前に対処が必要。

**Post-review fixes applied (see audit trail for DECISION_RECORDED/QUESTION_ANSWERED evidence):** R-01 — Initial Scope Signal trimmed to only the `[Q8]`/`[scope]`-sourced 15-stage list and confirmed-boundary claim, ARS score and exclusion rationale removed. R-02 — `## Assumption Confirmation` added to `intent-capture-questions.md`, human answered "A. Accept assumptions", `stakeholder-map.md` and this file's Assumptions sections updated to `None.` accordingly. R-03 — `[Q2]` tag added to the naive file-copy corruption sentence.
