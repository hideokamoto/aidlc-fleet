# Discovered Rules（確定）

`project.md` の既存 Mandated / Forbidden のうち、コードスタイル／ツーリング
に関連する項目をここに継続事項として引き継ぐ。今回の再実行の主エビデンス
（ESLint+Prettier → Biome）自体はツール置換であり新たな Mandated/Forbidden
を生まないが、Q2 の人間の決定（無効化ルールを緩和のまま維持せず、コードを
修正して有効化する）は、単発の設定調整を超えた明示的な方針表明と判断し、1件
追加する。

## Mandated

- ALWAYS コマンド層 / コアロジック層（バージョンゲート・成功判定ロジック）/
  ファイルシステム I/O 層を分離した実装構成にする。（`project.md` より継続、
  変更なし）
- ALWAYS ファイル所有権 invariant（v0.1 §7）違反を検知した場合、警告に留めず
  即座に失敗させる（fail fast）。（`project.md` より継続、変更なし）
- ALWAYS Biome（またはその後継のリンタ/フォーマッタ）の `recommended` ルー
  ルセットからルール単位で緩和・無効化する場合は、その緩和を既定として受け
  入れる前に、該当コードを修正してルールを満たす対応を優先的に検討する —
  「ルールを緩めて既存コードに合わせる」のではなく「コードを直してルールを
  厳格に保つ」を基本方針とする。（インタビュー Q2, Answer B で確定。すでに
  `noNonNullAssertion` / `noImplicitAnyLet` / `noDelete` / `useNumberNamespace`
  / `useTemplate` の5ルールについて実行済み。`correctness.noUnusedVariables:
  "warn"` は本方針の対象外として意図的に維持されている。）

## Forbidden

（今回の再実行に関連する新規 Forbidden 項目なし。コードスタイル／ツーリング
に直接関連する既存 Forbidden 項目は `project.md` に現時点で存在しない。）

---

**注記**: `project.md` にはこの3件以外にも多数の Mandated / Forbidden 項目
（バージョンゲート、レシート管理、シークレット非ハードコード、upstream 不変
更、CircleCI のシークレット/依存関係スキャン等）が存在するが、これらは今回の
再実行スコープ（`## Code Style` のリンタ／フォーマッタ選択とその厳格さ）とは
無関係のため、本ファイルには転記していない。転記対象は「コードスタイル／
ツーリングに関連する」と明示された項目のみとした。
