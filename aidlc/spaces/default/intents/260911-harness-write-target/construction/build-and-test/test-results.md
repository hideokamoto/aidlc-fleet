# Test Results — harness-write-target-fix (issue #6)

## Build Status

**Success.**

```
$ bunx tsc --noEmit
(no output — exit 0)

$ bun run lint
$ eslint .
(no output — exit 0)
```

## Test Results

| Command | Total | Passed | Failed | Skipped |
|---|---|---|---|---|
| `bun test src/orchestration/engine-installer.test.ts` | 6 | 6 | 0 | 0 |
| `bun test src/commands/real-deps.test.ts` | 30 | 30 | 0 | 0 |
| `bun test src/`（回帰確認・リポジトリ全体） | 173 | 173 | 0 | 0 |

```
$ bun test src/orchestration/engine-installer.test.ts
bun test v1.3.11 (af24e281)

 6 pass
 0 fail
 13 expect() calls
Ran 6 tests across 1 file. [55.00ms]

$ bun test src/commands/real-deps.test.ts
bun test v1.3.11 (af24e281)

 30 pass
 0 fail
 68 expect() calls
Ran 30 tests across 1 file. [131.00ms]

$ bun test src/
bun test v1.3.11 (af24e281)

 173 pass
 0 fail
 300 expect() calls
Ran 173 tests across 21 files. [216.00ms]
```

## Failure Details

なし — 全コマンドが green。

## Coverage Report

`bun test --coverage` はこのステージでは実行していない（このスコープ
（Minimal 戦略、`mvp`/`enterprise`/`feature`/`infra`/`classic` 以外）に
80%カバレッジ床の要求はない — team.md Testing Posture / org.md 参照）。
Code Generation ステージで変更した2ファイル（`real-deps.ts`,
`engine-installer.ts`）はいずれも新規追加コードパスの全てが対応するテス
トで直接エクササイズされている（`code-summary.md` 参照）。

## Target Verification Matrix

`build-and-test-summary.md` の Target Verification Matrix を参照
（issue-6-fr1〜fr4、TS-1、TS-2 — 全件 `Met`）。

## Loop-Back Log

該当なし — ビルド・テストとも初回実行で green だったため、Build-and-Test
失敗ループバックは一度も発火していない。
