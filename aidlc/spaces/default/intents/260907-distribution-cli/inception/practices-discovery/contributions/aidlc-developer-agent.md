**Collaborator:** aidlc-developer-agent

## Contribution

TypeScript/bun 製 CLI の実装担当としての観点から、命名・レイヤー境界・エラー処
理・ファイル構成・コードスタイルについてドラフトを補足する。

### レイヤー境界（未記載 — 追加提案）

ドラフトの `team-practices.md` / `discovered-rules.md` にはレイヤー境界に関する
記述がない。scope-document.md の依存関係節（`init` が依存ルート、`update` の
バージョンゲートが `engine_origin` に依存、`plugin add/remove` が §6 の成功検証
契約を共有、`doctor`/`status` が終端の read-only consumer）は、そのまま実装上の
レイヤー分割の根拠になる。以下の分割を提案する。

- **コマンド層**（`src/commands/*.ts`）: 各サブコマンドのエントリポイント。引数
  パース・exit code 決定のみを担当し、ビジネスロジックを持たない。
- **ドメイン/コアロジック層**（`src/core/*.ts` 等）: バージョンゲート判定
  （§4）、四条件成功判定（§6）、ファイル所有権invariant検証（§7）など、
  scope-document.md が「構造的に load-bearing」と明記したロジック。コマンド層
  から独立してユニットテスト可能であることが必須（`init`/`update`/`check` の
  最重要ロジックのテスト容易性は evidence.md のインタビュー論点3とも一致）。
- **I/O・副作用層**（`src/io/*.ts` 等）: ファイルシステム操作
  （`aidlc.lock.json` の読み書き、`.drops` ファイル走査、settings/hooks
  マージ）、プロセス実行（upstream doctor 呼び出し等）。コア層からはこの層への
  依存を抽象化（インターフェース経由）し、テスト時にモック可能にする。

この分割がないままコマンド層に直接 fs 操作とビジネスロジックを混在させると、
四条件成功判定や §7 のファイル所有権 invariant のような「最重要」ロジックが
CLI 引数パースと密結合し、ユニットテストが書きにくくなるリスクがある。

### エラーハンドリング（未記載 — 追加提案）

`discovered-rules.md` にはエラーハンドリング方針の記載がない。org.md/
construction.md フェーズガードレールの「エラーハンドリングは統合境界（ファイル
I/O 含む）で必須、サイレント失敗は不可」を踏まえ、以下を提案する。

- exit code 契約はコマンドごとに明示的な定数として定義する（`check` の CI 用
  exit code、`plugin sync` の exit 1 など、intent-statement.md の成功指標が
  exit code に依存しているため、マジックナンバーでの散在を避ける）。
- `known_failures` による差し引き、`.drops` の `[degraded]` 検出は、例外を握り
  つぶすロジックではなく明示的な分類関数として実装し、握りつぶし（catch して
  何もしない）と区別できるようにする。
- ファイル所有権 invariant 違反（symlink 書き込み禁止、receipt 外ファイルの
  自動削除禁止など §7）は fail-fast 対象とし、警告ではなくエラーとして扱う。

### ファイル構成・命名（未記載 — 追加提案）

- greenfield のため `package.json` の `name` / bin エントリ命名、
  ディレクトリ構成（`src/commands/`, `src/core/`, `src/io/`, `test/` または
  `*.test.ts` 隣接配置）は Code Generation 開始前に一度合意しておくことを推奨。
  ドラフトは「既存の `.claude/tools/*.ts` の bun/TypeScript スタイルに揃える
  か」を論点に挙げているが、揃える場合は具体的にどのファイル（例:
  `aidlc-orchestrate.ts` のサブコマンドディスパッチパターン）を参照実装とする
  かをインタビューで明確にすべき。
- テストファイル配置（`*.test.ts` 隣接 vs `test/` ディレクトリ集約）は bun test
  のデフォルト探索パターンに従うのが最も摩擦が少ない。

### コードスタイル（ドラフトへの補足）

ドラフトの Prettier/ESLint/camelCase 採用（org.md 既定踏襲）に同意する。追加で:

- bun ネイティブの TypeScript 実行（トランスパイル不要）を前提とするなら、
  `tsconfig.json` の `strict: true` をこの段階で合意しておくと、後続の
  Code Generation での型安全性の議論を省ける。
- CLI の exit code / stdout・stderr 使い分け（人間可読メッセージは stdout、
  CI 用の構造化出力の要否）は Code Style というより契約設計寄りだが、命名規則
  同様に早期合意が望ましい論点として付記する。

## Positions

- AGREE: Testing Posture ドラフトが test-after を維持しつつ 80% カバレッジ床 +
  CI green を暫定提案している点 — `init`/`update`/`check` の最重要ロジック
  （四条件成功判定、バージョンゲート、ファイル所有権 invariant）はレイヤー
  分離すればユニットテストが書きやすく、カバレッジ床の達成コストも下がる。
- AGREE: Code Style ドラフトが Prettier/ESLint/camelCase という org.md 既定を
  そのまま踏襲し、greenfield ゆえ具体設定をインタビュー待ちとしている判断 —
  リンタ設定ファイルが存在しない現状で先走った規約を書き込むよりも妥当。
- OBJECT: ドラフトにレイヤー境界（コマンド層 / コアロジック層 / I/O層の分離)
  についての記述が一切ない — scope-document.md 自身が §6/§7 を「構造的に
  load-bearing」と強調しているのに、そのロジックをどう分離してテスト可能にす
  るかの方針がないまま Code Generation に進むと、後戻りコストが高い密結合実装
  になるリスクがある。
- OBJECT: discovered-rules.md にエラーハンドリング方針（exit code 契約の扱い、
  `known_failures`/`.drops` の分類ロジックとサイレント失敗の区別)が記載されて
  いない — construction フェーズガードレール（エラーは呼び出し元へ伝播/ログ、
  サイレント失敗不可）を踏まえると、この段階で最低限の方針を Testing Posture
  や Way of Working と並ぶ見出しとして残すべき。
