# Team-Level Rules（確定）

## Way of Working

トランクベース開発を採用します。すべての作業は短命なフィーチャーブランチ経由で
`main` にマージし、ブランチは概ね 1〜2 日以内に解消します。長命ブランチはマージ
負債を蓄積するため避けます。

Construction のワークツリーは、ベースブランチを `main`、マージ先を `main` とし
ます。

Bolt ブランチは `main` へ **squash マージ** します。各 Bolt は Bolt スラッグを
コミット名とする 1 コミットとして trunk に載り、Bolt の完全なコミット履歴はワー
クツリーが破棄されるまでソースブランチ側に保持されます。

（インタビュー Q1 で org.md の既定をそのまま確認・採用。変更なし。）

## Walking Skeleton

**Walking Skeleton を実施します（on）。**

最小の `init` — lockfile（`aidlc.lock.json` 相当）を書き出すだけの縦切り —
を最初の Bolt として実装し、コマンド〜コアロジック〜ファイル I/O の各層が
end-to-end で貫通することを最初に証明します。バージョンゲート（M3, v0.1 §4）
と四条件成功判定（M2, v0.1 §6）の全体は、この最小スライスが通ったうえで、
後続の Bolt で積み上げます。

Bolt 1（Walking Skeleton）は solo かつゲート付きで実行し、人間が明示的に承認
してから残りの Bolt に進みます。Bolt 1 出荷後、org.md の ladder prompt が
発火しますが、本プロジェクトは下記のとおり「全 Bolt ゲート」をあらかじめ選択
済みです（Q3 参照）。

（インタビュー Q2 で確定。ドラフトの「skeleton: off 相当」という暫定解釈は
人間の確認により **on** へ上書きされました。）

## Testing Posture

- **Methodology**: tdd
- **Ordering**: 各テスト対象レイヤーについて、まず失敗するテストを書き、それ
  を通す最小の実装を書く、という順序を全レイヤーで徹底する（テストファース
  ト。org.md 既定の test-after をこのプロジェクトでは明示的に上書きする）。
  - 80% ライン・カバレッジ床を CI で必須化し、マージ前に green であることを
    要求する。
  - 加えて、ファイル所有権 invariant（M4: engine 所有ディレクトリの `--force`
    + バックアップ、settings/hooks のマージ規則、`aidlc/` 不可侵、シンボリッ
    クリンク書き込み禁止、レシート外ファイルの自動削除禁止）については、モ
    ックでは検出できない不変条件があるため、**実ファイルシステムに対する統
    合テスト**（一時ディレクトリを用いた実際の書き込み・マージ・削除の検証）
    を必須とする。

*根拠*: quality エージェントのレビューにより、M2（四条件成功判定契約）・M3
（version gate）・M4（file-ownership invariants）がこの CLI の最重要ロジック
であり、境界値・組み合わせテストと実ファイルシステム統合テストが必要と指摘さ
れた。人間はこれを受けて、ドラフトが提案した test-after ではなく **TDD**
（テストファースト）を明示的に選択した — これはドラフトの既定提案を上書きす
る決定であり、エビデンス不足による妥協ではない（詳細は `evidence.md` 参照）。

（インタビュー Q4 で確定。）

## Deployment

**CircleCI ベースの CI/CD パイプライン**を採用します。

- **プルリクエストごと**: CircleCI が lint + typecheck + test を実行する。
- **`main` へのマージ時**: 同じチェック（lint + typecheck + test）を再実行し、
  グリーンであれば npm への公開ジョブに進む。
- **npm 公開の前段**: CircleCI ワークフロー上の **手動承認ステップ**（approval
  job）を必須ゲートとして挟み、承認されるまで publish ジョブは実行されない。

この構成は、org.md の「staging 自動デプロイ + production 手動承認」という
二段階承認の精神を、配布物（npm パッケージ）のリリースに読み替えたものであり、
CircleCI の承認ワークフローステップとして具体化する。

*根拠*: 人間インタビューにより CircleCI が具体的な CI/CD プラットフォームと
して明示的に指定された。これはドラフトが提案していた汎用的な「pre-release 自動
公開 → stable 手動昇格」という抽象モデル（devsecops エージェントの提案を受け
たドラフト案）を **上書き** する決定である。詳細は `evidence.md` 参照。

（インタビュー Q5 で確定。）

## Code Style

プロジェクトレベルの設定に従います:
- **フォーマッタ + リンタ: Biome（`@biomejs/biome`）に統一** — 従来の
  Prettier（フォーマッタ）+ ESLint（リンタ）の二本立てを置き換え、単一ツール
  チェーンに一本化する。
  - 設定ファイルは `biome.json`（旧 `eslint.config.js` + `.prettierrc` を置換）。
  - 対象範囲は旧 ESLint 設定と同一: `src/**/*.ts`, `bin/**/*.ts` を対象とし、
    `node_modules/**`, `dist/**`, `aidlc/**` を除外する。
  - スタイルオプションは旧 Prettier 設定を踏襲: シングルクォート、セミコロン
    あり、trailing comma あり、行幅 100 文字、インデント幅 2 スペース。
  - `package.json` の `lint` / `format` / `check` スクリプトはそれぞれ
    `biome lint .` / `biome format --write .` / `biome check .` を実行する。
  - CI（CircleCI）の lint ジョブは `bunx biome ci .` を実行し、マージ前の
    ゲートとする（`## Deployment` の CircleCI ゲートと一貫）。この `lint`
    はツール非依存の CI ゲート要件であり、現在は `bunx biome ci .` によって
    充足される — 将来別のツールへ再移行しても、このゲート要件自体は不変で
    ある。
  - **ルールの厳格さ: Biome の `recommended` ルールセットをそのまま使用し、
    ルール単位の緩和は一切行わない。** 導入当初 `biome.json` は以下の5ルー
    ルを明示的に無効化していたが、チームはこれを「無効化のまま許容する」の
    ではなく「該当コードを修正してルールを有効化する」方針を明示的に選んだ
    （インタビュー Q2, Answer B）。この決定はすでに実行済みであり、
    `biome.json` は現在これら5ルールについて既定値（オン）から一切逸脱して
    いない:
    - `style.noNonNullAssertion` — 非nullアサーション（`!`）禁止。既存の
      `!` 呼び出し箇所（主にテストコード）はすべて、新設の共有テストヘルパ
      `src/test-support/assert-defined.ts`（`assertDefined<T>(value: T |
      undefined, message?): T` — 値が undefined の場合は例外を投げる）に置
      き換えて解消した。
    - `suspicious.noImplicitAnyLet` — 型注釈なし `let` の暗黙 any 禁止。
      `src/commands/config.ts` の該当箇所は `ResolvedConfig` 型を明示するこ
      とで解消した。
    - `performance.noDelete` — `delete` 演算子禁止。該当箇所を修正済み。
    - `style.useNumberNamespace` — `parseInt` ではなく `Number.parseInt` を
      使用。該当箇所を修正済み。
    - `style.useTemplate` — 文字列連結ではなくテンプレートリテラルを使用。
      該当箇所を修正済み。
    - 唯一 `correctness.noUnusedVariables: "warn"` のみは意図的に `warn` の
      まま維持する（今回のインタビューの対象外であり、エラー昇格は求められ
      ていない）。
  - この決定により、`tsconfig.json` の `strict: true` が意図する「型の抜け
    穴を塞ぐ」方針と、リンタのルール厳格さの間に矛盾がない状態を維持する
    （チームは「ルールを緩めて既存コードに合わせる」のではなく「コードを直
    してルールを厳格に保つ」を選んだ）。
- `tsconfig.json` は `strict: true` を採用する（変更なし）。
- 命名規則: 言語慣用（TS/JS は camelCase）（変更なし）。

上記に加え、以下の 2 点をリンタ・フォーマッタでは強制できない明示的なチーム
規約として **必須（Mandated）** とする（現行 team.md からそのまま引き継ぎ、
変更なし）:

- **レイヤー分離**: コマンド層（`src/commands/*.ts` 相当、引数パースと
  exit code 決定のみ）／コアロジック層（バージョンゲート判定 M3、四条件成功
  判定 M2 のロジック）／ファイルシステム I/O 層、の 3 層に分離する。これに
  より、最もリスクの高いロジック（M2/M3/M4）をディスクに触れずにユニットテ
  ストできる状態を保つ。
- **フェイルファストなエラーハンドリング**: ファイル所有権 invariant（M4）
  違反を検知した場合は、警告に留めず即座に失敗させる（fail fast）。exit-code
  契約（M8: `init`/`update`/`check`/`plugin add|remove`/`pin|unpin`/`status`/
  `doctor` 全コマンドの 0/1/2/3/4 契約）は、コマンド横断で一貫して守られなけ
  ればならない。

*根拠（今回の再実行分）*: リポジトリの実際のツールチェーンが ESLint+Prettier
から Biome へ移行済みであることが `package.json` / `biome.json` /
`.circleci/config.yml` の直接調査により確認された（詳細は `evidence.md` 参
照）。旧 `eslint.config.js` と `.prettierrc` は既にリポジトリから削除されて
いる。人間インタビュー（Q1）でこの Biome 移行を正式に承認し、加えて
（Q2）Biome recommended から緩和されていた5ルール（非nullアサーション禁止・
暗黙any禁止・`delete`禁止・`Number.parseInt`使用・テンプレートリテラル使用）
について、緩和を維持するのではなく **該当コード（約34箇所）を修正してルー
ルを有効化する** ことを選択した。この決定はすでに実行され、`biome.json` は
`correctness.noUnusedVariables: "warn"` の1件を除き、Biome recommended から
の逸脱を持たない状態になっている（検証: `git diff --stat`、および
`bunx biome ci .` / `bunx tsc --noEmit` / `bun test src/` の再実行結果が
green であることで確認可能）。

*根拠（前回確定分、変更なし）*: developer エージェントのレビューにより、レ
イヤー境界とエラーハンドリング方針がドラフトに欠けていると指摘された。人間
はこれを両方とも明示的な必須事項として採用した。（インタビュー Q6 で確定。）
