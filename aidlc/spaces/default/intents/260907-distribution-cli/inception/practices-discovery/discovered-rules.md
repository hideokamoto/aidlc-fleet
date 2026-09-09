# 発見されたルール — 確定版（インタビュー確定済み）

> このステージのドラフト時点では人間が明示的に述べたハードな制約は存在しな
> かったが、支援エージェント（特に devsecops）のレビューと人間インタビュー
> （Q7）を経て、以下の項目が正式に `## Mandated` / `## Forbidden` として確定
> した。本ファイルの内容は `aidlc/spaces/default/memory/team.md` および
> `project.md` の `## Mandated` / `## Forbidden` へ昇格されます。

## Mandated

- ALWAYS `init` はバージョンゲート（v0.1 §4, origin-record version gate）を
  経由してから既存インストールへの変更を行う。reject/manual/none の
  migration-boundary 判定と `--acknowledge-migration` の相互作用は、いかなる
  コマンドパスでもバイパスしてはならない。
- ALWAYS ファイル所有権 invariant（v0.1 §7）を、engine が書き込みを行うすべ
  ての操作（`init`/`update`/`plugin add|remove` 等）で検証する — engine 所有
  ディレクトリへの変更は `--force` とバックアップを伴わせ、settings/hooks は
  定義済みのマージ規則に従ってマージする。
- ALWAYS `aidlc/` ワークスペース配下は不可侵として扱う（初期メモリシードの
  複製処理を除く）。
- ALWAYS 四条件成功判定契約（v0.1 §6, M2）とファイル所有権 invariant（M4）の
  リスクが集中するロジックについては、実装前にテスト（TDD）を書き、失敗する
  ことを確認してから実装する。
- ALWAYS M4（ファイル所有権 invariant）は実ファイルシステムに対する統合テス
  ト（一時ディレクトリでの実際の書き込み・マージ・削除の検証）で検証する —
  モックのみのテストで代替してはならない。
- ALWAYS exit-code 契約（v0.1 §8, M8）を全コマンド（`init`/`update`/`check`/
  `plugin add|remove`/`pin|unpin`/`status`/`doctor`）で一貫して守る。
- ALWAYS コマンド層 / コアロジック層（バージョンゲート・成功判定ロジック）/
  ファイルシステム I/O 層を分離した実装構成にする。
- ALWAYS CircleCI パイプラインに、シークレットスキャン（例: gitleaks,
  GitHub Secret Scanning, TruffleHog 等）を必須ステップとして組み込む。
- ALWAYS CircleCI パイプラインに、依存関係スキャン（例: Dependabot または
  同等のツール）を必須ステップとして組み込む。
- ALWAYS プルリクエストごとに CircleCI で lint + typecheck + test を実行し、
  グリーンであることをマージの条件とする。
- ALWAYS `main` へのマージ後、npm への公開の前に CircleCI ワークフロー上の
  手動承認ステップを経る。

## Forbidden

- NEVER シンボリックリンクへの書き込みを行わない — ファイル所有権 invariant
  （v0.1 §7）に違反する操作として、いかなる状況でも許可しない。
- NEVER レシート（管理対象ファイル一覧）外のファイルを自動削除しない。
- NEVER バージョンゲート（v0.1 §4）の migration-boundary 判定をバイパスして
  既存インストールを変更しない。
- NEVER ファイル所有権 invariant 違反を警告のみで処理し、処理を継続しない
  （fail fast — 違反を検知したら即座に失敗させる）。
- NEVER `aidlc.lock.json` やチャネル設定ファイルに認証情報・APIキー等の秘密
  情報をハードコードしない。
- NEVER upstream（`awslabs/aidlc-workflows`）のファイルを変更しない。
- NEVER `aidlc/` ワークスペース状態を読み書きしない（初期メモリシード複製を
  除く）。
- NEVER upstream の plugin-compose ロジックを再実装しない。

## 補足: スコープ境界由来の項目について

上記のうち upstream 不変更・`aidlc/` 不可侵・plugin-compose 再実装禁止の3項
目は、もともと `ideation/scope-definition/scope-document.md` の Out of Scope
節に明記されていた境界である。ドラフト時点ではこれらを Mandated/Forbidden へ
正式昇格するかどうかを conductor の判断に委ねていたが、人間インタビュー
（Q7）でファイル所有権 invariant・version gate と合わせて確定させる方針が
確認されたため、本ファイルでは file-ownership invariants・version gate と
同列に Forbidden として明記した。
