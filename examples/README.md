# Channel ファイルの例

`aidlc-fleet` の `init`/`update`/`plugin add`/`plugin remove` は、
`AIDLC_FLEET_CHANNEL_URL` が指す先から **Channel** JSON を取得し、それを
唯一の入力として動作する。Channel はこの CLI が読むだけの外部所有ファイル
であり、チャネル運用者(このリポジトリではなく、配布を管理する側)が
ホスティングして更新する。

このディレクトリの [`channel.example.json`](./channel.example.json) は、
実際に `parseChannel()`(`src/types/channel.ts`)を通る最小構成のサンプル。
値(SHA・バージョン等)はダミーであり、そのままでは動作しない — 自分の
配布物に合わせて書き換えて、任意の静的ホスティング(GitHub Pages、S3、
社内サーバ等)から配信すること。

## スキーマ(`schema: 1`)

トップレベル:

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `schema` | number | ✅ | このCLIが理解できる最大値は `1`(`HIGHEST_SUPPORTED_CHANNEL_SCHEMA`)。これより大きい値は起動時に拒否される。 |
| `channel` | string | ✅ | チャネル名(例: `"stable"`, `"beta"`)。CLI内では識別用の文字列として扱われるのみ。 |
| `engine` | object | ✅ | 配布するエンジン本体の情報。下記参照。 |
| `migration_boundaries` | array | — | バージョン境界ごとの移行ポリシー。省略時は空配列。下記参照。 |
| `plugins` | array | — | 配布するプラグインの一覧。省略時は空配列。下記参照。 |
| `settings_overlay` | object | — | 不透明なオーバーレイ。このCLIは中身を解釈せずそのまま透過する。 |
| `mcp_overlay` | object | — | 同上(MCPサーバー設定用)。 |

未知のトップレベルフィールドは無視される(加算的にのみ進化するスキーマ)。

### `engine`

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `ref` | string | ✅ | エンジンのコミットSHA。upstream配布物はタグをほぼ持たないため、`tag` ではなく `ref` が正準の参照先になる。 |
| `version` | string | ✅ | 表示用/ゲート判定用のバージョン文字列。 |
| `tag` | string \| null | — | 省略時・`null` はタグなし扱い。 |
| `sha256` | string | ✅ | `ref` が指すtarballの検証用ハッシュ。 |

### `migration_boundaries[]`

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `before` | string | ✅ | この境界が適用される「〜より前」のバージョン。 |
| `action` | `"reject"` \| `"manual"` \| `"none"` | ✅ | `reject`: このバージョン境界をまたぐ更新を拒否。`manual`: 人手の確認を要求(`update --acknowledge-migration` が必要)。`none`: 追加確認なしで通過。 |
| `note` | string | — | 単一行の注記。 |
| `notes` | string[] | — | 複数行の注記(主に `manual` で使用)。 |

### `plugins[]`

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `name` | string | ✅ | `plugin add <name>` / `plugin remove <name>` で参照する名前。 |
| `repo` | string | ✅ | `owner/name` 形式のGitHubリポジトリ。プラグインのtarball取得元。 |
| `ref` | string | ✅ | コミットSHA。 |
| `version` | string | ✅ | 表示用バージョン文字列。 |
| `sha256` | string | ✅ | tarball検証用ハッシュ。 |

スキーマの正本は `src/types/channel.ts` の `parseChannel()`。この表と
実装が食い違う場合は実装を正とする。

## この例をローカルで試す

`AIDLC_FLEET_CHANNEL_URL` は HTTP(S) URL を想定しているため、
ローカルファイルをそのまま指定することはできない。手早く試すには、
このディレクトリを静的サーバとして立ててURLを渡す:

```bash
cd examples
bun --hot -e 'Bun.serve({ port: 8787, fetch: (req) => new Response(Bun.file("." + new URL(req.url).pathname)) })' &
export AIDLC_FLEET_CHANNEL_URL=http://localhost:8787/channel.example.json
```

`AIDLC_FLEET_COMPOSE_CMD` / `AIDLC_FLEET_ENGINE_REPO` / `AIDLC_FLEET_DOCTOR_CMD`
については、リポジトリルートの [`README.md`](../README.md#aidlc-fleet-cli)
を参照。
