# Evidence（確定）

## この再実行のエビデンスの性格

今回の再実行の実質的な差分は、リポジトリの実際の lint/format ツーリングが、
前回の affirmation 時点の ESLint + Prettier から **Biome** へ移行したという
事実（brownfield evidence）と、その過程で判明した Biome recommended ルール
セットからの一部緩和について、人間が「緩和を維持する」のではなく「該当コー
ドを修正して有効化する」ことを選び、それが実行済みであるという事実の2点で
ある。

## 直接調査したファイル

### `package.json`
- `scripts` に `"lint": "biome lint ."`, `"format": "biome format --write ."`,
  `"check": "biome check ."` が定義されている（旧: `eslint` / `prettier` 呼び
  出し）。
- `devDependencies` に `@biomejs/biome` (`^1.9.4`) が存在し、`eslint` /
  `@typescript-eslint/*` / `prettier` は存在しない。

### `biome.json`（新規ファイル — 旧 `eslint.config.js` + `.prettierrc` を置換）
- `files.include`: `["src/**/*.ts", "bin/**/*.ts"]`、
  `files.ignore`: `["node_modules/**", "dist/**", "aidlc/**"]`
  — 旧 ESLint 設定と同一のファイルスコープ/除外を確認。
- `formatter`: `indentStyle: space`, `indentWidth: 2`, `lineWidth: 100`。
- `javascript.formatter`: `quoteStyle: single`, `semicolons: always`,
  `trailingCommas: all`
  — 旧 `.prettierrc` のスタイルオプション（シングルクォート・セミコロンあ
  り・trailing comma あり・行幅100・インデント2）と一致することを確認。
- `linter.enabled: true`、`recommended: true`。

### `.circleci/config.yml`
- `lint` ジョブのステップ名は `Lint (biome ci .)` であり、`bunx biome ci .`
  を実行する構成に更新されている（旧: `bun run lint` 経由で eslint を実行）。
- `lint` ジョブは PR ワークフロー（`branches.ignore: main`）と main マージ後
  ワークフロー（`branches.only: main`、`secret-scan`/`dependency-scan`/
  `build`/`test`/`typecheck` と並んで publish 前提条件に含まれる）の双方に
  引き続き存在し、ゲートとしての位置づけ（`## Deployment` の CircleCI ゲー
  ト構成）に変更はない。

### `eslint.config.js` / `.prettierrc`
- 両ファイルともリポジトリ上に存在しないことを確認済み（`ls` で
  `No such file or directory`）。旧ツールチェーン設定は完全に撤去されている。

## 人間インタビューでの決定事項

### Q1（Answer A）: Biome への切り替えを `## Code Style` の正式な記述として承認

ファイルスコープ・フォーマットスタイル・既存の Mandated 2 項目（レイヤー分
離／フェイルファスト）を変更しないことを条件に、フォーマッタ・リンタを
Biome に統一する旨の記述更新を承認した。

### Q2（Answer B）: recommended から緩和されていた5ルールを「無効化のまま維
持」せず「有効化のためコードを修正する」ことを選択

quality / developer 両エージェントの検証時点（Step 3）で、`biome.json` は
Biome recommended をベースにしつつ以下5ルールを明示的に無効化していた:

- `style.noNonNullAssertion: "off"`
- `suspicious.noImplicitAnyLet: "off"`
- `performance.noDelete: "off"`
- `style.useNumberNamespace: "off"`
- `style.useTemplate: "off"`

該当箇所は既存コード（主にテストの `!` アサーション）に約34箇所あった。人
間はこれをインタビュー Q2 で「B. いいえ、有効化してほしい — 該当する既存
コードを修正する」と回答し、緩和を許容しない方針を明示的に選んだ。

## この決定の実行結果（本統合ステップで確認）

上記の人間の決定は、統合時点ですでに実コードに反映されていることを確認した:

- `biome.json` を直接読み込み、`linter.rules` が
  `{"recommended": true, "correctness": {"noUnusedVariables": "warn"}}` の
  みであることを確認した。上記5ルールに対応するキーは一切存在せず、Biome
  の既定（recommended = オン）から逸脱していない。`noUnusedVariables:
  "warn"` の1件のみが意図的な例外として残っており、これは今回の Q2 の対象
  （非nullアサーション等の5ルール）に含まれていないため、方針への矛盾では
  ない。
- `git status` / `git diff --stat` により、以下 17 ファイルに変更があるこ
  とを確認した: `biome.json`、および `src/commands/argv.ts`,
  `src/commands/config.ts`, `src/commands/real-deps.ts`,
  `src/core/version-gate.ts`, `src/io/integrity.ts`, `src/io/tar-extract.ts`,
  `src/types/lockfile.ts` とそれらのテストファイル一式。新規ファイルとして
  `src/test-support/` ディレクトリ（`git status` で `??` 表示）が追加され
  ている。
- `src/test-support/assert-defined.ts` が新設され、`assertDefined<T>(value:
  T | undefined, message?): T`（undefined なら例外を投げる）をエクスポート
  していることを確認した。旧 `!` アサーション箇所（テストファイル群）はこ
  のヘルパー呼び出しに置換されている。
- `src/commands/config.ts` の暗黙 any `let` は `ResolvedConfig` 型を明示す
  る形に修正されている。
- `delete` 呼び出し、`parseInt` → `Number.parseInt`、文字列連結 → テンプレ
  ートリテラルの各修正が該当ファイルに反映されている。

**再現確認コマンド**（本ステージの範囲外だが、次工程で有用なため記載）:
`git diff --stat`、`bunx biome ci .`、`bunx tsc --noEmit`、`bun test src/`
がすべて green/クリーンであることをもって、この決定が完全に実行済みである
ことを検証できる。

## 参照した codekb ドキュメント（陳腐化評価）

- `aidlc/spaces/default/codekb/aidlc-fleet/code-structure.md`
- `aidlc/spaces/default/codekb/aidlc-fleet/technology-stack.md`
- `aidlc/spaces/default/codekb/aidlc-fleet/dependencies.md`
- `aidlc/spaces/default/codekb/aidlc-fleet/code-quality-assessment.md`
- `aidlc/spaces/default/codekb/aidlc-fleet/architecture.md`
- `aidlc/spaces/default/codekb/aidlc-fleet/business-overview.md`

これらの codekb ドキュメントは旧 ESLint/Prettier ツーリングを前提とした記述
のままである。これは今回の再実行が解消しようとしている「解決すべき矛盾」で
はなく、**単に陳腐化した記述であり、本再実行によって追い越される評価対象**
として扱う（codekb 自体の更新は本ステージのスコープ外。次回の
reverse-engineering / codekb 更新時に解消するタスクとして記録しておく）。

## 推論（Inference）

- リポジトリの `lint`/`format`/`check` スクリプト、`devDependencies`、専用
  設定ファイル（`biome.json`）、CI ジョブ定義のすべてが一貫して Biome への
  完全移行を示しており、部分移行や過渡的な併用状態ではないと判断した
  （ESLint/Prettier 関連ファイルの残存なし）。
- `biome.json` のスタイルオプションが旧 `.prettierrc` の値と一致している
  ため、フォーマットの実質的なポリシー（シングルクォート・セミコロン・
  trailing comma・行幅100・インデント2）自体に変更はなく、ツール選択のみが
  変更されたと言える。ただし、この推論はフォーマッタ側にのみ当てはまり、
  **リンタ側のルール厳格さ**については当初 `biome.json` が recommended か
  ら5ルールを緩和していたため成立していなかった（quality / developer 両エ
  ージェントの OBJECT / 指摘事項として Step 3 で提起された）。この矛盾は
  人間インタビュー Q2 で解消され、緩和を維持せずコード側を修正する決定が実
  行された結果、フォーマッタ・リンタの双方について「ツール選択のみが変更
  され、実質ポリシー（フォーマット規約・リンタ厳格さ）に後退はない」という
  結論が成立する状態になった。
- この評価は brownfield（既存コード）の直接調査と、統合ステップでの再検証
  （`biome.json` の現物確認、`git diff --stat`）に基づく事実であり、
  [hypothesis] や [assumption] ではない。
