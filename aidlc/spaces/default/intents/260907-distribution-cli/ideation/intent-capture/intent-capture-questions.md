# Intent Capture — Clarifying Questions

## Sources

- [desc] Initial description: "以下のドキュメントを参考に、intentを作成して進めろ。ドキュメントにある情報は質問してくるな。aidlc-fleet — 配布 CLI 要件定義 v0.1。対象上流: awslabs/aidlc-workflows v2.7.0。複数プロジェクトのエンジン版とプラグイン集合を中央の1ファイルで宣言し、各プロジェクトがupdate/checkで追随する配布CLI(TypeScript/bun)を構築する。詳細は事前に共有した要件定義v0.1ドキュメントの通り。init/update/check/plugin add/remove/pin/unpin/status/doctorの各コマンド、lockfileとchannelのデータモデル、versionゲート、sessionStart hook、成功判定基準、ファイル所有ルールを実装する。"
- [scope] Workflow-selected scope: `aidlc-distribution-cli`.

## Note on scope

The user's request explicitly forbids re-asking anything already answered by
the shared v0.1 requirements document (§0–§12, provided in full to this
session at intent-creation time). Per that instruction, every question below
is answered directly from the document rather than left for a human
walkthrough. Only the mandatory scope-confirmation and consolidated-summary
checkpoints are presented to the human as live turns.

## Q1. What business problem are we solving?

Multiple projects independently track the AI-DLC engine version and plugin
set they run, with no central declaration and no mechanized way for a
project to follow a fleet-wide standard. `git submodule` is explicitly
rejected as the mechanism. [desc]

[Answer]: A. Central single-file declaration of engine version + plugin set,
consumed by per-project `update`/`check` — as specified in the v0.1 document
§0 (目的). [desc]

## Q2. Who is the customer (internal/external)? What pain are they experiencing?

Internal: the same individual/team operating multiple AI-DLC-enabled
projects (Cursor / Kiro / Codex / opencode / Copilot — explicitly not
Claude-Code-only). Pain: no central mechanism to keep engine version and
plugin set consistent across projects; naive file copy corrupts composed
plugin surfaces (E3); compose can silently degrade and still exit 0 (P5).
[desc]

[Answer]: A. Internal — maintainers of multiple AI-DLC projects across
several harnesses, per v0.1 §0 and §1. [desc]

## Q3. What does success look like? What metrics matter?

Per v0.1 §6 (成功判定): `init`/`update`/`plugin add` succeed only when (1)
the underlying compose process exits 0, (2) no `[degraded]` line appears in
the relevant `.drops` file, (3) `doctor`'s failed count (minus
`known_failures`) is 0, and (4) a `plugin sync` exit 1 is surfaced to a human
as "installation incomplete," not silently treated as failure. Exit-code-0
alone is explicitly disqualified as proof of success (P5). [desc]

[Answer]: A. The four-part success criterion in v0.1 §6, plus the exit-code
contract in §8 (0=in sync, 1=behind channel, 2=local drift, 3=version-gate
rejection, 4=compose degraded/incomplete). [desc]

## Q4. What is the trigger for this initiative (market pressure, tech debt, regulation, opportunity)?

Upstream (`awslabs/aidlc-workflows`) has not yet shipped native multi-project
distribution (tracked as upstream RFC #722 / PR #756: `aidlc update`,
project pin). This CLI is an explicitly temporary, thin distribution layer
meant to retire once upstream ships that feature. [desc]

[Answer]: A. Gap-filling until upstream ships native distribution (RFC #722
/ PR #756), per v0.1's opening positioning statement. [desc]

## Q5. Who are the key stakeholders and what does each care about?

The document defines a single-operator context (v0.1 §11 未決事項 explicitly
leaves "個人の複数PJか、チーム配布か" open, but states personal multi-project
use is the primary driver for the TypeScript-first implementation-language
choice in §10). No multi-team stakeholder roles, approval chains, or
reporting cadences are described anywhere in the document. [desc]

[Answer]: D. Not yet defined beyond the document's own framing — single
maintainer/operator running multiple projects; no additional stakeholder
roles specified. [desc]

## Q6. Who decides scope or priority, and who influences those decisions?

Not addressed in the document; no product-council or delivery-team decision
process is described. Command surface, data model, and gating rules are
already fixed in v0.1 §2–§4. [desc]

[Answer]: D. Not yet defined — the document itself is the settled scope of
record for this build; no separate prioritization authority is described.
[desc]

## Q7. Are there communication requirements or a reporting cadence?

Not addressed in the document. `status`/`doctor`/`check` are the CLI's own
reporting surfaces (v0.1 §3, §9); there's no external stakeholder reporting
process described.

[Answer]: C. None — the CLI's own `status`/`doctor`/`check` commands are the
only reporting surfaces defined. [desc]

## Q8. The workflow was started with the scope in `[scope]`; does that scope match the user's intended product boundary?

The composed `aidlc-distribution-cli` scope (15/33 stages: intent-capture,
scope-definition, approval-handoff, practices-discovery, domain-design,
contract-design, functional-design, nfr-requirements, nfr-design,
code-generation, build-and-test, ci-pipeline, plus the three initialization
stages) was proposed by the adaptive composer against the full v0.1 scope
(commands, data model, version gate, install/update procedures, success
criteria, file-ownership rules — §0–§9) and explicitly approved by the human
before this stage began.

[Answer]: A. Confirmed — the workflow-selected scope `aidlc-distribution-cli`
matches the intended product boundary as already approved. [scope]

## Assumptions & Open Questions

- Unknown (open question) [assumption]: whether "downstream projects" ever
  represent distinct human stakeholders (e.g. separate team owners per
  project) rather than the same operator across multiple repos — the
  document's §11 "未決事項" leaves personal-vs-team distribution unresolved
  and defers it to a future decision. (carried from `stakeholder-map.md`)

## Assumption Confirmation

The stakeholder map carries one unresolved assumption: whether "downstream
projects" in the v0.1 document ever represent distinct human stakeholders
(separate team owners per project) rather than the same operator across
multiple repos. The document's own §11 leaves this open ("個人の複数PJか、
チーム配布か").

[Answer]: A. Accept assumptions

## Consolidated Summary Confirmation

All eight clarifying questions above have been answered directly from the
v0.1 requirements document already shared with this workflow, per the user's
explicit instruction not to re-ask anything the document already settles.
No assumptions remain open.

[Answer]: Looks correct
