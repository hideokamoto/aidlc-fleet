# Practices Discovery — Interview (Re-run: Code Style delta)

This re-run only revisits `## Code Style` in `team.md`. The other four
sections (Way of Working, Walking Skeleton, Testing Posture, Deployment)
carry forward unchanged from the current affirmed practices and are not
re-asked.

## Q1. `## Code Style` の更新内容の確認

現在チームで正式に採用しているのは Prettier（フォーマッタ）+ ESLint（リン
タ）ですが、実際のリポジトリのツールはすでに Biome（フォーマッタ・リンタ
を1つに統合したツール）へ切り替え済みです（`package.json` の `lint`/
`format` スクリプト、`biome.json`、CircleCI の lint ジョブで確認済み）。

ファイルの区切り方（`src/**/*.ts`, `bin/**/*.ts` を対象、`node_modules`/
`dist`/`aidlc` を除外）とフォーマットスタイル（シングルクォート、セミコロ
ンあり、末尾カンマあり、100 桁、インデント2）は旧 Prettier 設定と同一のま
まです。レイヤー分離とフェイルファストなエラーハンドリングの2つの必須事項
（Mandated）も変更しません。

`## Code Style` を「フォーマッタ・リンタ: Biome」に更新してよいですか？

- A. はい、Biome への切り替えとして更新する
- B. いいえ、まだ確定させない（保留にする）
- X. Other (please specify)

[Answer]: A. はい、Biome への切り替えとして更新する

## Q2. Biome 導入時に無効化した一部の厳格ルールの扱い

Biome の「recommended」ルールセットは、旧 ESLint 設定（`@typescript-eslint/
recommended` ベース）より厳しく、以下の5つのスタイル系ルールが新たに引っか
かりました（レビューした quality / developer エージェント両方から指摘あり）:

- 非nullアサーション（`!`）の禁止
- 型注釈なし `let` の禁止（暗黙 any）
- `delete` 演算子の禁止
- `parseInt` ではなく `Number.parseInt` を使う指定
- 文字列連結ではなくテンプレートリテラルを使う指定

これらは既存コード（テストコードの `!` アサーションなど）で計34箇所該当し
たため、今回の `biome.json` ではこの5ルールを明示的に無効化し、既存コード
は変更していません。これは実際のツール切り替え作業とは別の「リンタの厳格
さをどうするか」という独立した判断です。

この対応（5ルールを無効化のまま維持する）を、チームの正式な方針として承認
しますか？

- A. はい、この5ルールは無効化のままでよい（今回のスコープはツール切り替
     えのみ）
- B. いいえ、有効化してほしい — 該当する既存コード（主にテストの非nullア
     サーション）を別途修正するタスクを立てる
- C. 個別に判断したい（ルールごとにコメントで指示する）
- X. Other (please specify)

[Answer]: B. いいえ、有効化してほしい — 該当する既存コードを修正する
