---
name: harness-write-target-fix
depth: Minimal
keywords: []
description: Replace hardcoded .claude write-target paths in real-deps.ts with lockfile harness-resolved paths from plugin-targets.json
skeleton: off
review_cap: advisory
---

# harness-write-target-fix scope

Composed via `/aidlc compose` for GitHub issue #6. The write target in
`src/commands/real-deps.ts` is hardcoded to `.claude`, which blocks
distribution to non-Claude-Code harnesses. This scope replaces the five
hardcoded occurrences (around lines 188, 191, 240, 246, 255) with paths
resolved from `.claude/tools/data/plugin-targets.json` via the lockfile's
`harness` field, failing explicitly on an unknown harness value, and adds
an integration test covering two or more harness values.

Minimal custom grid: workspace bootstrap (scaffold, detection, state-init),
straight to code-generation and build-and-test. All ideation, inception,
and operation-phase stages are skipped — the issue is a scoped, well-defined
code fix with no open design questions, no new requirements ceremony, and
no deployment/operational surface change.

---
