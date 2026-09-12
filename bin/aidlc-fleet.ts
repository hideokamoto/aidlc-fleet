#!/usr/bin/env bun
/**
 * `aidlc-fleet` CLI entrypoint. All argv/env routing lives in
 * `src/commands/cli.ts` (`runCli`) so it runs under `bun test src/`; this
 * file is only the process-boundary wrapper (real `process.argv`/`env`/
 * `cwd`/`exit`).
 */
import { runCli } from '../src/commands/cli';

runCli(process.argv.slice(2), process.env, process.cwd())
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((err) => {
    process.stderr.write(
      `aidlc-fleet: fatal error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
