# エビデンス — Practices Discovery 最終統合

## Sources

- `aidlc/spaces/default/memory/org.md` — Way of Working / Walking Skeleton /
  Testing Posture / Deployment / Code Style の各節を読み込み、フレームワーク
  既定値として参照した。[memory:org.md]
- `aidlc/spaces/default/memory/team.md` — 実行開始時点ですべての見出しが空。
  チームによる affirmed practice がまだ存在しない（このワークフローが最初の
  practices-discovery 実行であることの確認）。[memory:team.md]
- `.claude/scopes/aidlc-aidlc-distribution-cli.md` — frontmatter を確認。
  `skeleton:` フィールドは存在しない。[scope]
- リポジトリ実体調査（`ls` / `find`）: リポジトリルートに `package.json`,
  `tsconfig.json`, `.eslintrc*`, `.prettierrc*` などの TypeScript/bun ツール
  チェーン設定ファイルは存在せず、greenfield であることを確認した。
- `.../scope-definition/scope-document.md` — In Scope / Out of Scope /
  Minimum Viable Scope / file-ownership invariants（§7 相当）を確認。[scope]
- `.../intent-capture/intent-statement.md` — 成功指標の四条件（M2）を確認。
  [desc]
- `contributions/aidlc-quality-agent.md` — M2/M3/M4 のリスク集中、テストツー
  ルチェーン未決定、マルチハーネス・マトリクステスト戦略の欠落、exit-code
  契約テストの必要性を指摘。[quality]
- `contributions/aidlc-developer-agent.md` — レイヤー境界（コマンド/コアロ
  ジック/I/O）の欠落、エラーハンドリング方針（exit-code 契約、fail-fast）の
  欠落を指摘。[dev]
- `contributions/aidlc-devsecops-agent.md` — このCLIが他プロジェクトのファ
  イルシステムへの書き込み権限を持つ配布・変更エージェントであり、file-
  ownership invariants と version gate がサプライチェーン制御に相当すること、
  secret/dependency scanning の CI 必須化、配布物公開前の人間承認の必要性を
  指摘。[devsecops]
- `practices-discovery-questions.md` — 全7問への人間の確定回答。本統合の
  一次ソース（source of truth）。[Q1]〜[Q7]

## 参加者ごとの調査・推論のまとめ

- **lead（ドラフト作成者）**: org.md の既定値を出発点に、greenfield 実態
  （設定ファイル不在）と scope-document.md / intent-statement.md の記載内容
  を突き合わせ、7項目の暫定提案とインタビュー論点を作成した。
- **quality エージェント**: scope-document.md の依存関係とリスク集中領域
  （M2/M3/M4）を分析し、境界値・組み合わせテスト、実ファイルシステム統合テ
  スト、テストツールチェーン選定、マルチハーネス試験戦略の欠落を指摘した。
- **developer エージェント**: 実装者視点でレイヤー境界（コマンド層/コアロ
  ジック層/I/O層）とエラーハンドリング方針（exit-code 契約、fail-fast）の
  欠落を指摘した。
- **devsecops エージェント**: このCLIを「他プロジェクトへの書き込み権限を
  持つ配布エージェント」と再定義し、file-ownership invariants・version gate
  をサプライチェーン制御として正式 Mandated 化すること、CI での secret/
  dependency scanning、配布物公開前の人間承認を提案した。
- **conductor（人間インタビュー実施）**: 上記すべてを踏まえて Q1〜Q7 の構造
  化された質問を human に提示し、確定回答を得た。

## 最終インタビュー決定とその根拠

1. **Way of Working**（Q1）: org.md 既定（トランクベース、squash マージ）を
   そのまま採用。変更なし。
2. **Walking Skeleton**（Q2）: **on** を選択。lockfile を書き出す最小 `init`
   を最初の縦切りとし、その上にバージョンゲート（M3）と四条件成功判定（M2）
   を積み上げる。ドラフトの暫定解釈（`skeleton: off` 相当）は人間により明示
   的に上書きされた。
3. **Bolt ゲーティング**（Q3）: 全 Bolt をゲート。ファイル所有権・バージョン
   ゲートのリスク面（devsecops レビュー）を理由に、自律継続ではなく明示的
   go/no-go を選択。
4. **Testing Posture**（Q4）: **TDD**（テストファースト）を選択 — これは
   org.md の既定（test-after）およびドラフトが提案していた test-after の
   踏襲を **明示的に上書き** する人間の決定である。80% ライン・カバレッジ床
   に加え、M4 のための実ファイルシステム統合テストを追加要件として明記。
   **この上書きはエビデンス不足ではなく、quality エージェントが指摘した
   M2/M3/M4 のリスク集中を踏まえた明示的なトレードオフ判断である**（品質
   エージェント自身は「M2/M3/M4 のみテストファースト」という折衷案も提示し
   ていたが、人間は全レイヤーへの TDD 適用を選んだ）。
5. **Deployment**（Q5）: **CircleCI** を具体的な CI/CD プラットフォームとし
   て人間が明示的に指定 — これはドラフトが提案していた汎用的な「pre-release
   自動公開 → stable 手動昇格」という抽象モデル（devsecops の提案を受けた
   もの）を **上書き** する決定である。確定したパイプラインは、PR ごとの
   lint+typecheck+test、`main` マージ時の再チェック + npm publish、公開前
   の CircleCI 手動承認ステップ、という具体構成。org.md の staging/
   production 二段階承認の精神は維持しつつ、実装をCircleCIのワークフロー
   承認ジョブとして具体化した。
6. **Code Style**（Q6）: リンタ/フォーマッタへの委任（org.md 既定）に加え、
   developer エージェントが指摘したレイヤー分離と fail-fast エラーハンドリ
   ングを明示的な必須事項として追加することに合意。
7. **Mandated/Forbidden への昇格**（Q7）: devsecops エージェントの提案どお
   り、file-ownership invariants（§7）と version gate（§4）を「昇格候補」
   から正式な Mandated/Forbidden に格上げ。加えて secret scanning・
   dependency scanning を CI 必須ステップとして Mandated 化。セキュリティ
   特化 lint プラグイン（`eslint-plugin-security` 等）は Should Have として
   非ブロッキングに留めた。

## 未解決事項

なし。インタビュー Q1〜Q7 の全項目について確定回答を得ており、
`practices-discovery-questions.md` の Assumptions & Open Questions も
「None.」で確定している。テストランナー／カバレッジ計測ツールの具体的な選定
（`bun test` か他か）、テストファイル配置規約、ESLintの詳細設定などの実装
ディテールは、practices-discovery の範囲を超える技術選定事項として、後続の
Code Generation / CI Pipeline ステージへ持ち越す。
