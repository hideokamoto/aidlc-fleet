# Project-Level Rules

> Project-specific specialisation and corrections. Loaded after `org.md` and
> `team.md` as strict-additive guidance; contradictions with broader policy
> are rejected. Populated by practices-discovery and the self-learning loop.
>
> Use sparingly: most teams don't need a project layer. Reach for it
> only when this specific project needs stable, durable guidance beyond the
> team practice (for example, package-specific release checks or an additional
> regression suite for a legacy component).

## Way of Working

<!-- Project-specific specialisation. Example: -->
<!-- This monorepo requires package-scoped branch names and a package owner -->
<!-- review in addition to the team's normal merge policy. -->

## Walking Skeleton

<!-- Project-specific specialisation. Example: -->
<!-- The walking skeleton must exercise the legacy service adapter as well -->
<!-- as the new service boundary. -->

## Testing Posture

<!-- Project-specific specialisation. -->

## Deployment

<!-- Project-specific specialisation. -->

## Code Style

<!-- Project-specific specialisation. -->

## Tech Stack

<!-- Technology choices locked for this project. -->

## Decided

<!-- Decisions made in earlier stages that should not be re-asked. -->
<!-- Format: DECIDED: [decision] (Stage [slug], [date]) -->

## Scope Overrides

<!-- Custom scope rules for this project. -->

## Forbidden

<!-- Populated by practices-discovery affirmation gate. -->
<!-- Format: NEVER [behavior] (affirmed [date]) -->
<!-- Example: NEVER throw exceptions across service layer boundaries (affirmed 2026-05-17) -->

- NEVER シンボリックリンクへの書き込みを行わない — ファイル所有権 invariant (affirmed 2026-09-07)
（v0.1 §7）に違反する操作として、いかなる状況でも許可しない。 (affirmed 2026-09-07)
- NEVER レシート（管理対象ファイル一覧）外のファイルを自動削除しない。 (affirmed 2026-09-07)
- NEVER バージョンゲート（v0.1 §4）の migration-boundary 判定をバイパスして (affirmed 2026-09-07)
既存インストールを変更しない。 (affirmed 2026-09-07)
- NEVER ファイル所有権 invariant 違反を警告のみで処理し、処理を継続しない (affirmed 2026-09-07)
（fail fast — 違反を検知したら即座に失敗させる）。 (affirmed 2026-09-07)
- NEVER `aidlc.lock.json` やチャネル設定ファイルに認証情報・APIキー等の秘密 (affirmed 2026-09-07)
情報をハードコードしない。 (affirmed 2026-09-07)
- NEVER upstream（`awslabs/aidlc-workflows`）のファイルを変更しない。 (affirmed 2026-09-07)
- NEVER `aidlc/` ワークスペース状態を読み書きしない（初期メモリシード複製を (affirmed 2026-09-07)
除く）。 (affirmed 2026-09-07)
- NEVER upstream の plugin-compose ロジックを再実装しない。 (affirmed 2026-09-07)

（今回の再実行に関連する新規 Forbidden 項目なし。コードスタイル／ツーリング (affirmed 2026-09-12)
に直接関連する既存 Forbidden 項目は `project.md` に現時点で存在しない。） (affirmed 2026-09-12)
--- (affirmed 2026-09-12)
**注記**: `project.md` にはこの3件以外にも多数の Mandated / Forbidden 項目 (affirmed 2026-09-12)
（バージョンゲート、レシート管理、シークレット非ハードコード、upstream 不変 (affirmed 2026-09-12)
更、CircleCI のシークレット/依存関係スキャン等）が存在するが、これらは今回の (affirmed 2026-09-12)
再実行スコープ（`## Code Style` のリンタ／フォーマッタ選択とその厳格さ）とは (affirmed 2026-09-12)
無関係のため、本ファイルには転記していない。転記対象は「コードスタイル／ (affirmed 2026-09-12)
ツーリングに関連する」と明示された項目のみとした。 (affirmed 2026-09-12)
## Mandated

<!-- Populated by practices-discovery affirmation gate. -->
<!-- Format: ALWAYS [behavior] (affirmed [date]) -->
<!-- Example: ALWAYS use Result<T,E> for fallible operations in service layer (affirmed 2026-05-17) -->

- ALWAYS `init` はバージョンゲート（v0.1 §4, origin-record version gate）を (affirmed 2026-09-07)
経由してから既存インストールへの変更を行う。reject/manual/none の (affirmed 2026-09-07)
migration-boundary 判定と `--acknowledge-migration` の相互作用は、いかなる (affirmed 2026-09-07)
コマンドパスでもバイパスしてはならない。 (affirmed 2026-09-07)
- ALWAYS ファイル所有権 invariant（v0.1 §7）を、engine が書き込みを行うすべ (affirmed 2026-09-07)
ての操作（`init`/`update`/`plugin add|remove` 等）で検証する — engine 所有 (affirmed 2026-09-07)
ディレクトリへの変更は `--force` とバックアップを伴わせ、settings/hooks は (affirmed 2026-09-07)
定義済みのマージ規則に従ってマージする。 (affirmed 2026-09-07)
- ALWAYS `aidlc/` ワークスペース配下は不可侵として扱う（初期メモリシードの (affirmed 2026-09-07)
複製処理を除く）。 (affirmed 2026-09-07)
- ALWAYS 四条件成功判定契約（v0.1 §6, M2）とファイル所有権 invariant（M4）の (affirmed 2026-09-07)
リスクが集中するロジックについては、実装前にテスト（TDD）を書き、失敗する (affirmed 2026-09-07)
ことを確認してから実装する。 (affirmed 2026-09-07)
- ALWAYS M4（ファイル所有権 invariant）は実ファイルシステムに対する統合テス (affirmed 2026-09-07)
ト（一時ディレクトリでの実際の書き込み・マージ・削除の検証）で検証する — (affirmed 2026-09-07)
モックのみのテストで代替してはならない。 (affirmed 2026-09-07)
- ALWAYS exit-code 契約（v0.1 §8, M8）を全コマンド（`init`/`update`/`check`/ (affirmed 2026-09-07)
`plugin add|remove`/`pin|unpin`/`status`/`doctor`）で一貫して守る。 (affirmed 2026-09-07)
- ALWAYS コマンド層 / コアロジック層（バージョンゲート・成功判定ロジック）/ (affirmed 2026-09-07)
ファイルシステム I/O 層を分離した実装構成にする。 (affirmed 2026-09-07)
- ALWAYS CircleCI パイプラインに、シークレットスキャン（例: gitleaks, (affirmed 2026-09-07)
GitHub Secret Scanning, TruffleHog 等）を必須ステップとして組み込む。 (affirmed 2026-09-07)
- ALWAYS CircleCI パイプラインに、依存関係スキャン（例: Dependabot または (affirmed 2026-09-07)
同等のツール）を必須ステップとして組み込む。 (affirmed 2026-09-07)
- ALWAYS プルリクエストごとに CircleCI で lint + typecheck + test を実行し、 (affirmed 2026-09-07)
グリーンであることをマージの条件とする。 (affirmed 2026-09-07)
- ALWAYS `main` へのマージ後、npm への公開の前に CircleCI ワークフロー上の (affirmed 2026-09-07)
手動承認ステップを経る。 (affirmed 2026-09-07)
- ALWAYS Biome（またはその後継のリンタ/フォーマッタ）の `recommended` ルー (affirmed 2026-09-12)
ルセットからルール単位で緩和・無効化する場合は、その緩和を既定として受け (affirmed 2026-09-12)
入れる前に、該当コードを修正してルールを満たす対応を優先的に検討する — (affirmed 2026-09-12)
「ルールを緩めて既存コードに合わせる」のではなく「コードを直してルールを (affirmed 2026-09-12)
厳格に保つ」を基本方針とする。（インタビュー Q2, Answer B で確定。すでに (affirmed 2026-09-12)
`noNonNullAssertion` / `noImplicitAnyLet` / `noDelete` / `useNumberNamespace` (affirmed 2026-09-12)
/ `useTemplate` の5ルールについて実行済み。`correctness.noUnusedVariables: (affirmed 2026-09-12)
"warn"` は本方針の対象外として意図的に維持されている。） (affirmed 2026-09-12)

- ALWAYS コマンド層 / コアロジック層（バージョンゲート・成功判定ロジック）/ (affirmed 2026-09-12)
ファイルシステム I/O 層を分離した実装構成にする。（`project.md` より継続、 (affirmed 2026-09-12)
変更なし） (affirmed 2026-09-12)
- ALWAYS ファイル所有権 invariant（v0.1 §7）違反を検知した場合、警告に留めず (affirmed 2026-09-12)
即座に失敗させる（fail fast）。（`project.md` より継続、変更なし） (affirmed 2026-09-12)
## Corrections

<!-- Project-specific corrections from human feedback. -->
<!-- Format: NEVER/ALWAYS [behavior] (learned [date]) -->
