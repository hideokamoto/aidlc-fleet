# Build Instructions — aidlc-fleet Distribution CLI

## Prerequisites

- **bun** `>=1.1.0` (per `package.json` `engines`). Install: `curl -fsSL https://bun.sh/install | bash`.
- No database, no external services, no `.env` file required — this CLI
  has zero runtime infrastructure dependencies (NFR6.2/6.3,
  `tech-stack-decisions.md`).

## Dependency Installation

```bash
bun install
```

Installs `devDependencies` only (`@types/bun`, `typescript`, `eslint`,
`@typescript-eslint/*`, `prettier`) — the CLI itself has zero runtime
dependencies beyond the Node/Bun standard library (`node:fs`,
`node:child_process`, `node:crypto`, `node:path`).

## Environment Setup

No environment variables are required for build or test. Two optional
env vars configure production wiring (`src/commands/real-deps.ts`), used
only when actually running the built CLI against a real project, never
during build or test:
- `AIDLC_FLEET_COMPOSE_CMD` — overrides the upstream compose command
  shape. Defaults to a documented fallback.
- `AIDLC_FLEET_DOCTOR_CMD` — overrides the upstream doctor command shape.
  When unset, doctor reports no failures (documented no-op default).

## Build Commands

```bash
bun run build
```

Runs `bun build ./bin/aidlc-fleet.ts --outdir ./dist --target bun`,
producing a single bundled `dist/aidlc-fleet.js` (bun-target, ~42 KB).

## Type Checking

```bash
bunx tsc --noEmit
```

`tsconfig.json` has `strict: true` (team.md Code Style Mandated).

## Linting

```bash
bun run lint
```

Runs `eslint .` against `eslint.config.js`'s flat config.

## Build Verification Steps

1. `bun install` — confirm no dependency-resolution errors.
2. `bunx tsc --noEmit` — confirm zero type errors.
3. `bun run lint` — confirm zero lint errors/warnings.
4. `bun run build` — confirm `dist/aidlc-fleet.js` is produced with no
   bundler errors.
5. `node dist/aidlc-fleet.js --help` (or `bun dist/aidlc-fleet.js --help`)
   — confirm the bundled entrypoint executes and prints usage without
   crashing (smoke test of the build artifact itself, distinct from the
   source-level test suite below).

## Troubleshooting Common Build Issues

| Symptom | Likely Cause | Fix |
|---|---|---|
| `bun: command not found` | bun not installed or not on PATH | Re-run the install script; for non-interactive shells, ensure the PATH export is in `~/.bashrc`/`~/.zshenv`, not `~/.zshrc` |
| `tsc --noEmit` reports errors in `node_modules` | Stale/partial `bun install` | `rm -rf node_modules bun.lock && bun install` |
| `bun build` bundles but `dist/aidlc-fleet.js` fails at runtime with a module-resolution error | `--target bun` mismatch with the actual runtime invoking the bundle | Confirm the bundle is executed via `bun`/`node` matching the `--target` flag used |
| `eslint .` reports parser errors on `.test.ts` files | `eslint.config.js` missing a TS parser override for test globs | Confirm `@typescript-eslint/parser` is configured for `**/*.ts` including `*.test.ts` |
