**Collaborator:** aidlc-devsecops-agent

## Contribution

このCLIは「デプロイされたサービスを持たない」という理由でセキュリティ検討が
軽量化されがちだが、実態は逆である。`init` / `update` / `plugin add` は
**他プロジェクトのファイルシステムに書き込み権限を持つ配布・変更エージェント**
であり、scope-document.md の file-ownership invariants（§7）— engine 所有
ディレクトリ、settings/hooks のマージ規則、`aidlc/` 不可侵（メモリシード複製を
除く）、シンボリックリンク書き込み禁止、レシート外ファイルの自動削除禁止 — は
実質的にサプライチェーン・ブラストラディウス制御である。ドラフト
(`team-practices.md` / `discovered-rules.md`) はこの角度からの検討が抜けている
ため、以下を追加提案する。

### Lint/Format
- org.md 既定（ESLint + Prettier, TS/JS camelCase）に加え、CLI 特有のリスクとして
  `eslint-plugin-security`（あるいは同等の静的解析ルール）を導入し、
  `child_process` の動的実行、パストラバーサル、`fs` への未検証パス書き込みを
  静的検出する構成を推奨する。これは対象ファイルシステムを書き換えるツールの
  コードベースで、フォーマット/命名規則だけのlint設定では不十分。

### SAST
- CI に SAST ゲートを必須化する（例: CodeGuru Security, Semgrep, または
  `eslint-plugin-security` を含む拡張lint）。特に `init`/`update`/
  `plugin add|remove` が触れる、ファイルパス組み立て・シンボリックリンク判定・
  JSON/YAML パース箇所を重点対象とする。マージ前必須ゲートとし、
  construction phase guardrails の「Security」節（認証/認可バイパスコードの
  フラグ、境界での入力検証）と直結させる。

### DAST
- 本CLIには従来型のネットワークサービス面がないため、古典的DASTは非該当。
  代わりに「ファイルシステム境界に対する動的検証」を等価物として提案する:
  - `check`/`doctor` の exit code contract、四条件成功判定ロジック、
    `.drops`/`known_failures` 走査を、意図的に壊れた/悪意ある入力
    （不正なlockfile、シンボリックリンクを含むターゲットディレクトリ、
    権限のない書き込み先）でファジング/対抗テストする統合テストスイートを
    Testing Posture のカバレッジ床に明記する。
  - サンドボックス化されたテンポラリディレクトリでの「破壊的操作シミュレー
    ション」（`init`/`update`/`plugin remove` が engine 所有外のファイルを
    誤って削除・上書きしないことを検証する境界テスト）をCI必須項目に追加する。

### Secret Scanning
- 配布物（npm パッケージ/バイナリ）とgitリポジトリ双方に対する secret scanning
  をCIゲートとして明記する（例: gitleaks, GitHub Secret Scanning, TruffleHog）。
  Deployment 節が「npm公開/GitHub Releasesでの配布」を提案しているため、
  **公開前** に秘密情報混入がないことを確認するゲートが不可欠 — これは
  ドラフトの Deployment 節に抜けている。
- `aidlc.lock.json` やチャネル設定に認証情報を埋め込まない設計原則を Forbidden
  候補として明記すべき（construction guardrails の「credentials/API keysの
  ハードコード禁止」を配布物レベルにも適用）。

### 依存関係スキャン / サプライチェーン
- greenfieldでpackage.jsonがまだ存在しないため、最初のコミットから
  `npm audit` / Dependabot / Snyk 等の依存脆弱性スキャンをCIに組み込む前提を
  Testing PostureまたはCode Style節に明記すべき。
- 本CLI自体が「他プロジェクトへ配布されるプラグイン/エンジンの供給元」である
  ため、以下のサプライチェーン制御を Mandated 候補として追加提案する:
  - 配布物のビルド再現性（lockfileでのバージョン固定、`npm ci`相当の厳密
    インストール）
  - リリース署名/チェックサム発行（GitHub Releasesでのバイナリ配布時、
    SHA256チェックサムまたは署名を添付し、`init`/`update`側で検証可能にする）
  - 版数ゲート（v0.1 §4 の origin-record version gate）は実質的に
    「信頼できるアップグレード元のみを許可する」サプライチェーン制御であり、
    discovered-rules.md の「Mandated/Forbidden昇格候補」に挙げられている
    file-ownership invariantsと合わせて、正式にMandatedへ昇格することを強く
    推奨する（現ドラフトは「conductor判断に委ねる」として保留しているが、
    これはセキュリティ制御そのものであり、practices-discoveryの範囲内と考える）。

### IaC/インフラスキャン
- 該当インフラ(CloudFormation等)は本スコープに存在しないため非該当。Operation
  フェーズ全SKIPの判断（scope-document.md Out of Scope）を支持する。

### CI/CDセキュリティゲート
- Deployment節（team-practices.md）が「マージ即リリースかどうか未確定」として
  いる点について、devsecops視点では **配布物公開の承認は最低限 tech lead 相当
  の人間承認を必須ゲートとする** ことを強く推奨する。理由: 本ツールは他プロ
  ジェクトのファイルシステムを書き換えるエンジン/プラグインの配布元であり、
  誤った版のマージ即時公開はダウンストリームの複数プロジェクトへ即座に
  ブラストラディウスが及ぶ。org.mdのstaging/production二段階承認モデルは
  「配布物のpre-release公開（例: npm dist-tag `next`）→ 手動昇格 →
  `latest`/GitHub Releases安定タグ」という形で読み替えて維持することを提案する
  （ドラフトが提案する「二段階モデルをそのまま適用しない」という結論には
  部分的に異議あり、Positionsに記載）。

## Positions

- AGREE: Testing Postureドラフインが「四条件成功判定ロジック（exit code
  contract, `.drops`走査, known_failures差し引き, degraded検出）はテストで
  直接検証すべき最重要ロジック」としている点 — このロジックはファイル
  システム変更の安全性を担保する境界であり、SAST/DASTの代替としての境界
  テスト強化と方向性が一致する。
- AGREE: Code Style節がgreenfieldゆえの未確定を正直に記録している点 —
  ただしlint設定にsecurity系ルールを含めるべきという追加提案あり(本文参照)。
- OBJECT: discovered-rules.mdが file-ownership invariants(§7)と version gate
  (§4)を「Mandated/Forbidden昇格候補」に留め「conductor側の判断に委ねる」と
  している点 — これらは事実上のサプライチェーン・セキュリティ制御であり、
  devsecops観点では practices-discoveryの人間インタビューで明示的に確認し、
  Mandatedへ正式昇格することを提案する。保留のままだと後続のcode-generation/
  build-and-testステージでセキュリティ要件として参照されない恐れがある。
- OBJECT: team-practices.mdのDeployment節が「org.mdのstaging/production二段階
  承認モデルはそのままでは適用しない」と結論づけている点 — 完全に外すのでは
  なく、「pre-release公開→手動承認→stable公開」という形で二段階モデルの
  精神(段階的リリース・人間承認ゲート)を配布リリースに読み替えて維持すべき
  と考える。理由は前述のブラストラディウスの大きさ。
- OBJECT: 現ドラフトのどの節にもSecret Scanning・依存関係スキャン・SASTの
  CI必須化への言及がない — greenfieldのため「まだ設定ファイルがない」ことは
  理由にならず、むしろ最初のコミットから組み込むべき最重要事項として
  Testing Posture / Code Style節に追記することをインタビューで確認したい。
